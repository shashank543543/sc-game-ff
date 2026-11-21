const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { optionalAuth, requireAdmin } = require('../middleware/auth');
const supportBot = require('../services/supportBotService');

// Multer Storage Configuration for Customer Support Screenshots
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'support');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    let ext = path.extname(file.originalname).toLowerCase();
    if (!ext || ext === '.') {
      if (file.mimetype === 'image/jpeg') ext = '.jpg';
      else if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else ext = '.png';
    }
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    cb(null, `screenshot-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for high-res mobile photos
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|bmp/i;
    const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/') || allowed.test(ext)) {
      return cb(null, true);
    }
    cb(new Error('Only image files (JPG, PNG, WEBP, GIF) are allowed for screenshots.'));
  }
});

// Upload Screenshot Endpoint
router.post('/upload', optionalAuth, (req, res) => {
  upload.single('screenshot')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Screenshot upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No screenshot file received.' });
    }
    const publicUrl = `/uploads/support/${req.file.filename}`;
    return res.json({
      success: true,
      url: publicUrl,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  });
});

// Quick Topics for Chat UI
router.get('/quick-topics', (req, res) => {
  return res.json({
    success: true,
    topics: supportBot.QUICK_TOPICS
  });
});

/**
 * ============================================================
 * PLAYER / GUEST CLIENT ENDPOINTS
 * ============================================================
 */

// 1. GET OR INITIALIZE CONVERSATION
router.get('/conversation', optionalAuth, async (req, res) => {
  try {
    let conversation = null;

    if (req.user) {
      // Find conversation by user_id
      conversation = await db.get(
        'SELECT * FROM support_conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );

      if (!conversation) {
        // Create initial conversation for logged in user
        const convId = 'conv-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
        await db.run(
          `INSERT INTO support_conversations (id, user_id, user_name, user_email, user_mobile, status, subject, last_message)
           VALUES (?, ?, ?, ?, ?, 'OPEN', 'Customer Support', ?)`,
          [
            convId,
            req.user.id,
            req.user.name,
            req.user.email,
            req.user.mobile,
            '👋 Welcome to SC GAMEING Customer Service! How can we assist you today?'
          ]
        );

        // Add initial bot welcome message
        const initialMsgId = 'msg-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
        await db.run(
          `INSERT INTO support_messages (id, conversation_id, sender_type, sender_id, sender_name, message, is_read)
           VALUES (?, ?, 'BOT', 'bot', ?, ?, 0)`,
          [
            initialMsgId,
            convId,
            supportBot.BOT_NAME,
            `👋 Hello **${req.user.name}**! Welcome to **SC GAMEING 24/7 Live Customer Service**.\n\nHow can our support team help you today? You can select a quick topic below or type your inquiry directly.`
          ]
        );

        conversation = await db.get('SELECT * FROM support_conversations WHERE id = ?', [convId]);
      }
    } else {
      // Guest User: Check if guest_id was provided
      const guestId = req.query.guest_id;
      if (guestId) {
        conversation = await db.get('SELECT * FROM support_conversations WHERE id = ?', [guestId]);
      }

      if (!conversation) {
        const convId = 'conv-guest-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
        const guestName = (req.query.guest_name || 'Guest Player').trim();
        await db.run(
          `INSERT INTO support_conversations (id, user_id, user_name, user_email, user_mobile, status, subject, last_message)
           VALUES (?, NULL, ?, NULL, NULL, 'OPEN', 'Customer Support', ?)`,
          [
            convId,
            guestName,
            '👋 Welcome to SC GAMEING Customer Service! How can we assist you today?'
          ]
        );

        const initialMsgId = 'msg-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
        await db.run(
          `INSERT INTO support_messages (id, conversation_id, sender_type, sender_id, sender_name, message, is_read)
           VALUES (?, ?, 'BOT', 'bot', ?, ?, 0)`,
          [
            initialMsgId,
            convId,
            supportBot.BOT_NAME,
            `👋 Welcome to **SC GAMEING 24/7 Live Customer Service**! How can our support team assist you today? Feel free to ask about Deposits, Room IDs, Withdrawals, or talk to an agent.`
          ]
        );

        conversation = await db.get('SELECT * FROM support_conversations WHERE id = ?', [convId]);
      }
    }

    // Fetch conversation message history
    const messages = await db.query(
      'SELECT id, conversation_id, sender_type, sender_id, sender_name, message, screenshot_url, is_read, created_at FROM support_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversation.id]
    );

    return res.json({
      success: true,
      conversation,
      messages
    });
  } catch (error) {
    console.error('Support conversation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve support chat.' });
  }
});

// 2. SEND MESSAGE AS CUSTOMER / GUEST
router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { conversation_id, message, screenshot_url, guest_name, guest_email, guest_mobile } = req.body;

    const hasMessage = message && typeof message === 'string' && message.trim();
    const hasScreenshot = screenshot_url && typeof screenshot_url === 'string' && screenshot_url.trim();

    if (!hasMessage && !hasScreenshot) {
      return res.status(400).json({ success: false, message: 'Message content or screenshot is required.' });
    }

    const cleanText = hasMessage ? message.trim() : '📷 Attached Screenshot';
    const cleanScreenshot = hasScreenshot ? screenshot_url.trim() : null;
    let conversation = null;

    if (conversation_id) {
      conversation = await db.get('SELECT * FROM support_conversations WHERE id = ?', [conversation_id]);
    }

    if (!conversation && req.user) {
      conversation = await db.get('SELECT * FROM support_conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [req.user.id]);
    }

    if (!conversation) {
      const convId = (req.user ? 'conv-' : 'conv-guest-') + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
      const userName = req.user ? req.user.name : (guest_name || 'Guest Player');
      const userEmail = req.user ? req.user.email : (guest_email || null);
      const userMobile = req.user ? req.user.mobile : (guest_mobile || null);

      await db.run(
        `INSERT INTO support_conversations (id, user_id, user_name, user_email, user_mobile, status, subject, last_message)
         VALUES (?, ?, ?, ?, ?, 'OPEN', 'Customer Support', ?)`,
        [convId, req.user ? req.user.id : null, userName, userEmail, userMobile, cleanText]
      );
      conversation = await db.get('SELECT * FROM support_conversations WHERE id = ?', [convId]);
    } else {
      // Update guest details if provided
      if (!conversation.user_id && guest_name) {
        await db.run(
          `UPDATE support_conversations SET user_name = ?, user_email = COALESCE(?, user_email), user_mobile = COALESCE(?, user_mobile) WHERE id = ?`,
          [guest_name, guest_email || null, guest_mobile || null, conversation.id]
        );
      }
    }

    const senderName = req.user ? req.user.name : (guest_name || conversation.user_name || 'Player');
    const senderId = req.user ? req.user.id : null;
    const msgId = 'msg-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
    const nowIso = new Date().toISOString();

    // 1. Insert player message
    await db.run(
      `INSERT INTO support_messages (id, conversation_id, sender_type, sender_id, sender_name, message, screenshot_url, is_read, created_at)
       VALUES (?, ?, 'USER', ?, ?, ?, ?, 0, ?)`,
      [msgId, conversation.id, senderId, senderName, cleanText, cleanScreenshot, nowIso]
    );

    // 2. Update conversation status, last_message, and unread admin count
    await db.run(
      `UPDATE support_conversations
       SET last_message = ?, last_message_at = datetime('now'), unread_admin_count = unread_admin_count + 1, status = 'OPEN', updated_at = datetime('now')
       WHERE id = ?`,
      [cleanScreenshot && !hasMessage ? '📷 [Screenshot Attached]' : cleanText, conversation.id]
    );

    const userMsg = {
      id: msgId,
      conversation_id: conversation.id,
      sender_type: 'USER',
      sender_id: senderId,
      sender_name: senderName,
      message: cleanText,
      screenshot_url: cleanScreenshot,
      is_read: 0,
      created_at: nowIso
    };

    // Emit via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`support_${conversation.id}`).emit('chat_message', userMsg);
      io.to('admin_support').emit('new_customer_message', {
        conversationId: conversation.id,
        userName: senderName,
        message: userMsg,
        unreadCount: (conversation.unread_admin_count || 0) + 1
      });
    }

    // 3. Automated Bot Guidance
    let botMsg = null;
    const botContext = {
      name: senderName,
      isLoggedIn: !!req.user,
      walletBalance: req.user?.wallet_balance
    };
    const botResp = supportBot.getBotResponse(cleanText, botContext);

    if (botResp) {
      const botMsgId = 'msg-' + (Date.now() + 10) + '-' + crypto.randomBytes(3).toString('hex');
      const botTimeIso = new Date(Date.now() + 500).toISOString();

      await db.run(
        `INSERT INTO support_messages (id, conversation_id, sender_type, sender_id, sender_name, message, is_read, created_at)
         VALUES (?, ?, 'BOT', 'bot', ?, ?, 0, ?)`,
        [botMsgId, conversation.id, botResp.sender_name, botResp.message, botTimeIso]
      );

      await db.run(
        `UPDATE support_conversations SET last_message = ?, updated_at = datetime('now') WHERE id = ?`,
        [botResp.message.substring(0, 150) + '...', conversation.id]
      );

      botMsg = {
        id: botMsgId,
        conversation_id: conversation.id,
        sender_type: 'BOT',
        sender_id: 'bot',
        sender_name: botResp.sender_name,
        message: botResp.message,
        is_read: 0,
        created_at: botTimeIso
      };

      if (io) {
        // Slight natural delay before emitting bot answer
        setTimeout(() => {
          io.to(`support_${conversation.id}`).emit('chat_message', botMsg);
        }, 300);
      }
    }

    return res.status(201).json({
      success: true,
      message: userMsg,
      botMessage: botMsg
    });
  } catch (error) {
    console.error('Error posting support message:', error);
    return res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// 3. MARK USER MESSAGES AS READ (WHEN PLAYER OPENS CHAT)
router.post('/mark-read', optionalAuth, async (req, res) => {
  try {
    const { conversation_id } = req.body;
    if (!conversation_id) return res.status(400).json({ success: false, message: 'Conversation ID required.' });

    await db.run(
      `UPDATE support_conversations SET unread_user_count = 0 WHERE id = ?`,
      [conversation_id]
    );

    await db.run(
      `UPDATE support_messages SET is_read = 1 WHERE conversation_id = ? AND sender_type IN ('ADMIN', 'BOT')`,
      [conversation_id]
    );

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to mark read.' });
  }
});

/**
 * ============================================================
 * ADMIN SUPPORT WORKSTATION ENDPOINTS
 * ============================================================
 */

// 4. ADMIN: LIST ALL SUPPORT CONVERSATIONS
router.get('/admin/conversations', requireAdmin, async (req, res) => {
  try {
    const status = (req.query.status || 'ALL').toUpperCase();
    const search = (req.query.search || '').trim();

    let sql = `
      SELECT 
        c.id, c.user_id, c.user_name, c.user_email, c.user_mobile,
        c.status, c.subject, c.last_message, c.last_message_at,
        c.unread_user_count, c.unread_admin_count, c.created_at, c.updated_at,
        u.ff_ign, u.ff_uid, u.wallet_balance, u.winning_balance
      FROM support_conversations c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status !== 'ALL') {
      sql += ` AND c.status = ?`;
      params.push(status);
    }

    if (search) {
      sql += ` AND (c.user_name LIKE ? OR c.user_email LIKE ? OR c.user_mobile LIKE ? OR u.ff_ign LIKE ? OR c.last_message LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    sql += ` ORDER BY c.last_message_at DESC LIMIT 100`;

    const conversations = await db.query(sql, params);

    // Get total unread count for admin badge
    const totalUnreadRow = await db.get(
      `SELECT COALESCE(SUM(unread_admin_count), 0) as total FROM support_conversations WHERE status = 'OPEN'`
    );
    const totalUnreadAdmin = Number(totalUnreadRow?.total || 0);

    return res.json({
      success: true,
      conversations,
      totalUnreadAdmin
    });
  } catch (error) {
    console.error('Admin conversations list error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve support conversations.' });
  }
});

// 5. ADMIN: GET CONVERSATION DETAILS & MESSAGES
router.get('/admin/conversations/:id', requireAdmin, async (req, res) => {
  try {
    const convId = req.params.id;

    // Auto mark as read by admin first
    await db.run(
      `UPDATE support_conversations SET unread_admin_count = 0 WHERE id = ?`,
      [convId]
    );
    await db.run(
      `UPDATE support_messages SET is_read = 1 WHERE conversation_id = ? AND sender_type = 'USER'`,
      [convId]
    );

    const conversation = await db.get(
      `SELECT c.*, u.ff_ign, u.ff_uid, u.wallet_balance, u.winning_balance, u.created_at as user_joined_at
       FROM support_conversations c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [convId]
    );

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    // Fetch messages
    const messages = await db.query(
      `SELECT id, conversation_id, sender_type, sender_id, sender_name, message, screenshot_url, is_read, created_at
       FROM support_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
      [convId]
    );

    // Optional user tournament stats
    let playerStats = null;
    if (conversation.user_id) {
      const stats = await db.get(
        `SELECT COUNT(*) as matches_played, COALESCE(SUM(kills), 0) as total_kills, COALESCE(SUM(prize_won), 0) as total_cash_won
         FROM tournament_participants
         WHERE user_id = ?`,
        [conversation.user_id]
      );
      playerStats = stats;
    }

    return res.json({
      success: true,
      conversation,
      messages,
      playerStats
    });
  } catch (error) {
    console.error('Admin get conversation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve conversation.' });
  }
});

// 6. ADMIN: SEND LIVE SUPPORT REPLY
router.post('/admin/conversations/:id/reply', requireAdmin, async (req, res) => {
  try {
    const convId = req.params.id;
    const { message, screenshot_url } = req.body;

    const hasMessage = message && typeof message === 'string' && message.trim();
    const hasScreenshot = screenshot_url && typeof screenshot_url === 'string' && screenshot_url.trim();

    if (!hasMessage && !hasScreenshot) {
      return res.status(400).json({ success: false, message: 'Reply message or screenshot is required.' });
    }

    const conversation = await db.get('SELECT * FROM support_conversations WHERE id = ?', [convId]);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    const cleanText = hasMessage ? message.trim() : '📷 Attached Screenshot';
    const cleanScreenshot = hasScreenshot ? screenshot_url.trim() : null;
    const msgId = 'msg-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
    const nowIso = new Date().toISOString();
    const adminName = req.user.name || 'SC Support Manager';

    // Insert admin reply
    await db.run(
      `INSERT INTO support_messages (id, conversation_id, sender_type, sender_id, sender_name, message, screenshot_url, is_read, created_at)
       VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, 0, ?)`,
      [msgId, convId, req.user.id, adminName, cleanText, cleanScreenshot, nowIso]
    );

    // Update conversation
    await db.run(
      `UPDATE support_conversations
       SET last_message = ?, last_message_at = datetime('now'), unread_user_count = unread_user_count + 1, status = 'OPEN', updated_at = datetime('now')
       WHERE id = ?`,
      [cleanScreenshot && !hasMessage ? '📷 [Screenshot Attached]' : cleanText, convId]
    );

    const adminMsg = {
      id: msgId,
      conversation_id: convId,
      sender_type: 'ADMIN',
      sender_id: req.user.id,
      sender_name: adminName,
      message: cleanText,
      screenshot_url: cleanScreenshot,
      is_read: 0,
      created_at: nowIso
    };

    // Emit live real-time events via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`support_${convId}`).emit('chat_message', adminMsg);
      io.to(`support_${convId}`).emit('new_support_reply', {
        conversationId: convId,
        message: adminMsg
      });
      io.to('admin_support').emit('conversation_updated', {
        conversationId: convId,
        message: adminMsg
      });
    }

    return res.status(201).json({
      success: true,
      message: adminMsg
    });
  } catch (error) {
    console.error('Admin support reply error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send admin reply.' });
  }
});

// 7. ADMIN: UPDATE STATUS (RESOLVED / OPEN)
router.patch('/admin/conversations/:id/status', requireAdmin, async (req, res) => {
  try {
    const convId = req.params.id;
    const { status } = req.body;

    if (!['OPEN', 'RESOLVED', 'CLOSED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be OPEN, RESOLVED, or CLOSED.' });
    }

    await db.run(
      `UPDATE support_conversations SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, convId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`support_${convId}`).emit('conversation_status_changed', { conversationId: convId, status });
      io.to('admin_support').emit('conversation_status_changed', { conversationId: convId, status });
    }

    return res.json({
      success: true,
      message: `Conversation status updated to ${status}.`,
      status
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update conversation status.' });
  }
});

module.exports = router;
