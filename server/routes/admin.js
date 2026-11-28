const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { generateTxnId } = require('../utils/helpers');
const walletService = require('../services/walletService');

// All admin routes require admin privileges
router.use(requireAdmin);

// 1. ADMIN DASHBOARD STATS
router.get('/stats', async (req, res) => {
  try {
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    const totalUsers = Number(userCount?.count || 0);

    const tournCount = await db.get("SELECT COUNT(*) as count FROM tournaments WHERE status IN ('upcoming', 'room_ready', 'live')");
    const activeTournaments = Number(tournCount?.count || 0);

    const walletSum = await db.get('SELECT COALESCE(SUM(wallet_balance), 0) as total FROM users');
    const totalWalletFloat = Number(walletSum?.total || 0);

    const depositSum = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE status IN ('APPROVED', 'COMPLETED')");
    const totalDeposited = Number(depositSum?.total || 0);

    const pendingDeposits = await db.get("SELECT COUNT(*) as count FROM deposits WHERE status = 'PENDING'");
    const pendingDepositsCount = Number(pendingDeposits?.count || 0);

    const withdrawalSum = await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'PAID'");
    const totalPaidWithdrawals = Number(withdrawalSum?.total || 0);

    const pendingWithdrawals = await db.get("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'PENDING'");
    const pendingWithdrawalsCount = Number(pendingWithdrawals?.count || 0);

    return res.json({
      success: true,
      stats: {
        totalUsers,
        activeTournaments,
        totalWalletFloat,
        totalDeposited,
        pendingDepositsCount,
        totalPaidWithdrawals,
        pendingWithdrawalsCount
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve dashboard statistics.' });
  }
});

// 2. USER MANAGEMENT
// 2a. List users with search
router.get('/users', async (req, res) => {
  try {
    const { search, status } = req.query;
    let sql = `SELECT id, name, email, mobile, ff_ign, ff_uid, role, wallet_balance, winning_balance, status, password_hash, created_at FROM users WHERE 1=1`;
    const params = [];

    if (search) {
      sql += ` AND (name LIKE ? OR email LIKE ? OR mobile LIKE ? OR ff_ign LIKE ? OR ff_uid LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const users = await db.query(sql, params);
    return res.json({ success: true, users });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users list.' });
  }
});

// 2b. Block / Unblock user
router.put('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be "active" or "blocked".' });
    }

    const targetUser = await db.get('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (targetUser.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot block administrator accounts.' });
    }

    await db.run(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, req.params.id]);
    return res.json({ success: true, message: `User status changed to ${status}.` });
  } catch (error) {
    console.error('User status error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user status.' });
  }
});

// 2c. Adjust user wallet balance manually
router.post(['/users/:id/wallet-adjust', '/users/:id/wallet'], async (req, res) => {
  try {
    const { type, amount, reason } = req.body; // type: 'CREDIT' or 'DEBIT'
    const numAmount = Number(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Adjustment amount must be a positive number.' });
    }

    if (!reason) {
      return res.status(400).json({ success: false, message: 'A reason must be provided for manual wallet adjustments.' });
    }

    const user = await db.get('SELECT id, name, wallet_balance FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let newBalance = Number(user.wallet_balance);
    if (type === 'CREDIT') {
      newBalance += numAmount;
    } else if (type === 'DEBIT') {
      if (newBalance < numAmount) {
        return res.status(400).json({ success: false, message: `User balance insufficient (Current: ₹${newBalance.toFixed(2)})` });
      }
      newBalance -= numAmount;
    } else {
      return res.status(400).json({ success: false, message: 'Type must be CREDIT or DEBIT.' });
    }

    await db.run(`UPDATE users SET wallet_balance = ?, updated_at = datetime('now') WHERE id = ?`, [newBalance, user.id]);
    await db.run(`UPDATE wallet_accounts SET balance_paise = ?, updated_at = datetime('now') WHERE user_id = ?`, [Math.round(newBalance * 100), user.id]);

    const txnId = generateTxnId('ADJ');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, description)
       VALUES (?, ?, ?, 'ADMIN_ADJUSTMENT', ?, ?, 'SUCCESS', 'SYSTEM', ?)`,
      [
        db.generateId('txn'),
        txnId,
        user.id,
        numAmount,
        newBalance,
        `Admin manual ${type}: ${reason}`
      ]
    );

    return res.json({
      success: true,
      message: `Wallet ${type === 'CREDIT' ? 'credited' : 'debited'} with ₹${numAmount.toFixed(2)}. New balance: ₹${newBalance.toFixed(2)}`,
      newBalance
    });
  } catch (error) {
    console.error('Wallet adjust error:', error);
    return res.status(500).json({ success: false, message: 'Failed to adjust user wallet.' });
  }
});

// 2d. Admin directly views or sets/resets a user's password
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const user = await db.get('SELECT id, name, email, role FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPassword, salt);

    await db.run(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      [passwordHash, user.id]
    );

    return res.json({
      success: true,
      message: `Password updated successfully for ${user.name} (${user.email}).`,
      userId: user.id
    });
  } catch (error) {
    console.error('Admin reset user password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user password.' });
  }
});

// 3. TOURNAMENT MANAGEMENT
// 3a. Create Tournament
router.post('/tournaments', async (req, res) => {
  try {
    const {
      title,
      game_mode,
      match_type,
      map,
      version,
      entry_fee,
      total_prize_pool,
      prize_1st,
      prize_2nd,
      prize_3rd,
      per_kill_prize,
      max_slots,
      schedule_time,
      rules,
      banner_url
    } = req.body;

    if (!title || !match_type || !map || !schedule_time) {
      return res.status(400).json({ success: false, message: 'Title, match type, map, and schedule time are required.' });
    }

    const tournId = db.generateId('tourn');
    await db.run(
      `INSERT INTO tournaments (
        id, title, game_mode, match_type, map, version,
        entry_fee, total_prize_pool, prize_1st, prize_2nd, prize_3rd, per_kill_prize,
        max_slots, slots_joined, schedule_time, status, rules, banner_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'upcoming', ?, ?)`,
      [
        tournId,
        title.trim(),
        game_mode || 'BATTLE_ROYALE',
        match_type.toUpperCase(),
        map,
        version || 'TPP',
        Number(entry_fee) || 0,
        Number(total_prize_pool) || 0,
        Number(prize_1st) || 0,
        Number(prize_2nd) || 0,
        Number(prize_3rd) || 0,
        Number(per_kill_prize) || 0,
        Number(max_slots) || 48,
        schedule_time,
        rules || 'Standard Free Fire rules apply. No hacking, no emulators.',
        banner_url || `/assets/images/${map.toLowerCase()}.jpg`
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Tournament created successfully!',
      tournamentId: tournId
    });
  } catch (error) {
    console.error('Tournament creation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create tournament.' });
  }
});

// 3b. Update Tournament Details
router.put('/tournaments/:id', async (req, res) => {
  try {
    const {
      title,
      entry_fee,
      total_prize_pool,
      prize_1st,
      prize_2nd,
      prize_3rd,
      per_kill_prize,
      max_slots,
      schedule_time,
      status,
      rules
    } = req.body;

    const tournament = await db.get('SELECT id FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    await db.run(
      `UPDATE tournaments SET
        title = COALESCE(?, title),
        entry_fee = COALESCE(?, entry_fee),
        total_prize_pool = COALESCE(?, total_prize_pool),
        prize_1st = COALESCE(?, prize_1st),
        prize_2nd = COALESCE(?, prize_2nd),
        prize_3rd = COALESCE(?, prize_3rd),
        per_kill_prize = COALESCE(?, per_kill_prize),
        max_slots = COALESCE(?, max_slots),
        schedule_time = COALESCE(?, schedule_time),
        status = COALESCE(?, status),
        rules = COALESCE(?, rules),
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        title,
        entry_fee !== undefined ? Number(entry_fee) : null,
        total_prize_pool !== undefined ? Number(total_prize_pool) : null,
        prize_1st !== undefined ? Number(prize_1st) : null,
        prize_2nd !== undefined ? Number(prize_2nd) : null,
        prize_3rd !== undefined ? Number(prize_3rd) : null,
        per_kill_prize !== undefined ? Number(per_kill_prize) : null,
        max_slots !== undefined ? Number(max_slots) : null,
        schedule_time,
        status,
        rules,
        req.params.id
      ]
    );

    // If schedule time changed, notify clients & joined players
    if (schedule_time) {
      const io = req.app.get('io');
      if (io) {
        io.emit('tournaments_updated');
        io.emit('tournament_rescheduled', { tournamentId: req.params.id, schedule_time });
      }

      // Notify registered players
      const participants = await db.query(
        'SELECT DISTINCT user_id FROM tournament_participants WHERE tournament_id = ?',
        [req.params.id]
      );
      if (participants && participants.length > 0) {
        const fullTourn = await db.get('SELECT title FROM tournaments WHERE id = ?', [req.params.id]);
        const tournTitle = fullTourn ? fullTourn.title : 'Tournament';
        const formattedDate = new Date(schedule_time).toLocaleString();
        for (const p of participants) {
          const notifId = 'notif-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
          const notifData = JSON.stringify({ tournamentId: req.params.id, schedule_time });
          await db.run(
            `INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read)
             VALUES (?, ?, 'TOURNAMENT_SCHEDULE_CHANGED', ?, ?, ?, 0)`,
            [
              notifId,
              p.user_id,
              '⏰ Match Rescheduled',
              `"${tournTitle}" has been rescheduled to ${formattedDate}. Please verify your match countdown!`,
              notifData
            ]
          );
        }
      }
    }

    return res.json({ success: true, message: 'Tournament updated successfully.' });
  } catch (error) {
    console.error('Tournament update error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update tournament.' });
  }
});

// 3b-2. Dedicated Quick Schedule Time Edit (supports PATCH, PUT, POST, GET)
router.all('/tournaments/:id/schedule', async (req, res) => {
  try {
    const tournament = await db.get('SELECT id, title, schedule_time, status FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (req.method === 'GET') {
      return res.json({
        success: true,
        tournamentId: tournament.id,
        title: tournament.title,
        schedule_time: tournament.schedule_time
      });
    }

    if (!['PATCH', 'PUT', 'POST'].includes(req.method)) {
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { schedule_time, notify_players } = req.body || {};
    if (!schedule_time) {
      return res.status(400).json({ success: false, message: 'New schedule date and time is required.' });
    }

    // Ensure valid ISO format if possible
    let cleanScheduleTime = schedule_time;
    try {
      const parsedDate = new Date(schedule_time);
      if (!isNaN(parsedDate.getTime())) {
        cleanScheduleTime = parsedDate.toISOString();
      }
    } catch (e) {}

    await db.run(
      `UPDATE tournaments SET schedule_time = ?, updated_at = datetime('now') WHERE id = ?`,
      [cleanScheduleTime, req.params.id]
    );

    // Notify connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('tournaments_updated');
      io.emit('tournament_rescheduled', {
        tournamentId: req.params.id,
        title: tournament.title,
        schedule_time: cleanScheduleTime
      });
    }

    // Push notification to joined players
    let notifiedCount = 0;
    if (notify_players !== false) {
      const participants = await db.query(
        'SELECT DISTINCT user_id FROM tournament_participants WHERE tournament_id = ?',
        [req.params.id]
      );
      if (participants && participants.length > 0) {
        const formattedDate = new Date(cleanScheduleTime).toLocaleString();
        for (const p of participants) {
          const notifId = 'notif-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
          const notifData = JSON.stringify({ tournamentId: req.params.id, schedule_time: cleanScheduleTime });
          await db.run(
            `INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read)
             VALUES (?, ?, 'TOURNAMENT_SCHEDULE_CHANGED', ?, ?, ?, 0)`,
            [
              notifId,
              p.user_id,
              '⏰ Match Rescheduled',
              `"${tournament.title}" has been rescheduled to ${formattedDate}. Check your My Matches schedule!`,
              notifData
            ]
          );
          notifiedCount++;
        }
      }
    }

    return res.json({
      success: true,
      message: `Match schedule time updated to ${new Date(cleanScheduleTime).toLocaleString()}! (${notifiedCount} players notified)`,
      tournamentId: req.params.id,
      schedule_time: cleanScheduleTime,
      notifiedCount
    });
  } catch (error) {
    console.error('Tournament reschedule error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update tournament schedule time.' });
  }
});

// 3c. Delete Tournament
router.delete('/tournaments/:id', async (req, res) => {
  try {
    const tournament = await db.get('SELECT * FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    // If slots were joined, refund entry fees to participants
    if (tournament.slots_joined > 0 && tournament.entry_fee > 0) {
      const participants = await db.query(
        'SELECT user_id FROM tournament_participants WHERE tournament_id = ?',
        [tournament.id]
      );

      for (const p of participants) {
        await db.run(
          `UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = datetime('now') WHERE id = ?`,
          [tournament.entry_fee, p.user_id]
        );
        const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [p.user_id]);
        const txnId = generateTxnId('REF');
        await db.run(
          `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
           VALUES (?, ?, ?, 'REFUND', ?, ?, 'SUCCESS', 'SYSTEM', ?, ?)`,
          [
            db.generateId('txn'),
            txnId,
            p.user_id,
            tournament.entry_fee,
            user.wallet_balance,
            tournament.id,
            `Refund for cancelled tournament "${tournament.title}"`
          ]
        );
      }
    }

    await db.run('DELETE FROM tournaments WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Tournament deleted and registered players refunded.' });
  } catch (error) {
    console.error('Delete tournament error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete tournament.' });
  }
});

// 4. ROOM MANAGEMENT (SET & PUBLISH ROOM ID AND PASSWORD)
router.post('/tournaments/:id/room', async (req, res) => {
  try {
    const { room_id, room_password, status } = req.body;

    if (!room_id || !room_password) {
      return res.status(400).json({ success: false, message: 'Room ID and Room Password are required.' });
    }

    const tournament = await db.get('SELECT id, title, schedule_time, map, match_type FROM tournaments WHERE id = ?', [req.params.id]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    const cleanRoomId = room_id.trim();
    const cleanRoomPass = room_password.trim();
    const targetStatus = status || 'room_ready';

    await db.run(
      `UPDATE tournaments SET
        room_id = ?,
        room_password = ?,
        room_released_at = datetime('now'),
        status = ?,
        updated_at = datetime('now')
       WHERE id = ?`,
      [cleanRoomId, cleanRoomPass, targetStatus, req.params.id]
    );

    // FETCH ALL REGISTERED PLAYERS FOR THIS TOURNAMENT ONLY
    const participants = await db.query(
      `SELECT tp.user_id, tp.slot_number, u.name, u.email 
       FROM tournament_participants tp 
       JOIN users u ON tp.user_id = u.id 
       WHERE tp.tournament_id = ?`,
      [req.params.id]
    );

    const io = req.app.get('io');
    const notifTitle = `🎮 Room Credentials Unlocked: ${tournament.title}`;
    const notifMsg = `Custom Room ID: ${cleanRoomId} | Password: ${cleanRoomPass}. Join your match custom room within 10 minutes!`;
    const notifData = JSON.stringify({
      tournament_id: req.params.id,
      tournament_title: tournament.title,
      room_id: cleanRoomId,
      room_password: cleanRoomPass,
      schedule_time: tournament.schedule_time,
      map: tournament.map,
      match_type: tournament.match_type
    });

    // PUSH NOTIFICATION EXCLUSIVELY TO REGISTERED/JOINED USERS ONLY
    for (const p of participants) {
      const notifId = 'notif-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
      await db.run(
        `INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read)
         VALUES (?, ?, 'ROOM_RELEASED', ?, ?, ?, 0)`,
        [notifId, p.user_id, notifTitle, notifMsg, notifData]
      );

      // Targeted real-time push exclusively to this player's private Socket.IO channel
      if (io) {
        io.to(`user_${p.user_id}`).emit('room_credentials_released', {
          id: notifId,
          tournamentId: req.params.id,
          title: tournament.title,
          roomId: cleanRoomId,
          roomPassword: cleanRoomPass,
          slotNumber: p.slot_number,
          scheduleTime: tournament.schedule_time,
          message: notifMsg
        });
      }
    }

    // Emit safe public refresh event (without credentials) so lobby lists update status pills
    if (io) {
      io.emit('tournament_updated', {
        tournamentId: req.params.id,
        status: targetStatus
      });
    }

    return res.json({
      success: true,
      message: `Room details published! Push notification sent to ${participants.length} joined player(s).`,
      roomId: cleanRoomId,
      roomPassword: cleanRoomPass,
      notifiedUsersCount: participants.length,
      status: targetStatus
    });
  } catch (error) {
    console.error('Room publish error:', error);
    return res.status(500).json({ success: false, message: 'Failed to publish room credentials.' });
  }
});

// 5. SUBMIT TOURNAMENT RESULTS & AUTO-PAYOUT
router.post('/tournaments/:id/results', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { playerResults } = req.body; // Array of { userId, rank, kills }

    const tournament = await db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (!Array.isArray(playerResults) || playerResults.length === 0) {
      return res.status(400).json({ success: false, message: 'Valid playerResults array is required.' });
    }

    const prize1st = Number(tournament.prize_1st || 0);
    const prize2nd = Number(tournament.prize_2nd || 0);
    const prize3rd = Number(tournament.prize_3rd || 0);
    const perKillPrize = Number(tournament.per_kill_prize || 0);

    const payoutSummary = [];

    for (const item of playerResults) {
      const { userId, rank, kills, slotNumber } = item;
      const numKills = Number(kills) || 0;
      const numRank = rank ? Number(rank) : null;

      let positionPrize = 0;
      if (numRank === 1) positionPrize = prize1st;
      else if (numRank === 2) positionPrize = prize2nd;
      else if (numRank === 3) positionPrize = prize3rd;

      const killPrize = numKills * perKillPrize;
      const totalPrize = positionPrize + killPrize;

      let targetUserId = userId;

      // Fallback: If targetUserId is missing or 'undefined', look up by slot number
      if (!targetUserId || targetUserId === 'undefined' || targetUserId === 'null') {
        const part = await db.get(
          'SELECT user_id FROM tournament_participants WHERE tournament_id = ? AND slot_number = ?',
          [tournamentId, slotNumber || 0]
        );
        if (part && part.user_id) {
          targetUserId = part.user_id;
        }
      }

      // Update participant record
      await db.run(
        `UPDATE tournament_participants SET kills = ?, rank = ?, prize_won = ? WHERE tournament_id = ? AND (user_id = ? OR slot_number = ?)`,
        [numKills, numRank, totalPrize, tournamentId, targetUserId || '', slotNumber || 0]
      );

      // If player won cash prize, credit directly to wallet & winnings!
      if (totalPrize > 0 && targetUserId && targetUserId !== 'undefined' && targetUserId !== 'null') {
        const userExists = await db.get('SELECT id, wallet_balance FROM users WHERE id = ?', [targetUserId]);

        if (userExists) {
          await db.run(
            `UPDATE users SET
              wallet_balance = wallet_balance + ?,
              winning_balance = winning_balance + ?,
              updated_at = datetime('now')
             WHERE id = ?`,
            [totalPrize, totalPrize, targetUserId]
          );

          const updatedUser = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [targetUserId]);
          const finalBal = updatedUser ? updatedUser.wallet_balance : (userExists.wallet_balance + totalPrize);

          const txnId = generateTxnId('WIN');
          await db.run(
            `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
             VALUES (?, ?, ?, 'PRIZE', ?, ?, 'SUCCESS', 'WALLET', ?, ?)`,
            [
              db.generateId('txn'),
              txnId,
              targetUserId,
              totalPrize,
              finalBal,
              tournamentId,
              `Prize won in "${tournament.title}" (Rank #${numRank || 'N/A'}, ${numKills} Kills)`
            ]
          );

          payoutSummary.push({ userId: targetUserId, rank: numRank, kills: numKills, totalPrize });
        } else {
          console.warn(`⚠️ User ID ${targetUserId} not found in database for tournament prize credit.`);
        }
      }
    }

    // Mark tournament status as COMPLETED
    await db.run(
      `UPDATE tournaments SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
      [tournamentId]
    );

    // Notify connected clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`tournament_${tournamentId}`).emit('tournament_results_published', {
        tournamentId,
        payoutSummary
      });
      io.emit('tournaments_updated');
    }

    return res.json({
      success: true,
      message: `Results published and prize payouts distributed successfully for "${tournament.title}"!`,
      payoutSummary
    });
  } catch (error) {
    console.error('Publish results error:', error);
    return res.status(500).json({ success: false, message: 'Failed to publish results and payouts.' });
  }
});

// 5b. PAYMENT GATEWAY SETTINGS MANAGEMENT
router.get('/payment-settings', async (req, res) => {
  try {
    let settings = await db.get('SELECT * FROM payment_settings WHERE id = ?', ['default_settings']);
    if (!settings) {
      settings = {
        razorpay_key_id: '',
        razorpay_key_secret: '',
        gateway_mode: 'TEST',
        gateway_status: 'ACTIVE',
        min_deposit: 10,
        max_deposit: 50000,
        min_withdrawal: 50,
        max_withdrawal: 10000
      };
    }
    return res.json({ success: true, settings });
  } catch (error) {
    console.error('Fetch payment settings error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve payment settings.' });
  }
});

router.put('/payment-settings', async (req, res) => {
  try {
    const {
      razorpay_key_id,
      razorpay_key_secret,
      gateway_mode,
      gateway_status,
      min_deposit,
      max_deposit,
      min_withdrawal,
      max_withdrawal
    } = req.body;

    const existing = await db.get('SELECT id FROM payment_settings WHERE id = ?', ['default_settings']);
    if (existing) {
      await db.run(
        `UPDATE payment_settings SET
          razorpay_key_id = ?,
          razorpay_key_secret = ?,
          gateway_mode = ?,
          gateway_status = ?,
          min_deposit = ?,
          max_deposit = ?,
          min_withdrawal = ?,
          max_withdrawal = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
        [
          razorpay_key_id ? razorpay_key_id.trim() : '',
          razorpay_key_secret ? razorpay_key_secret.trim() : '',
          gateway_mode || 'TEST',
          gateway_status || 'ACTIVE',
          Number(min_deposit) || 10,
          Number(max_deposit) || 50000,
          Number(min_withdrawal) || 50,
          Number(max_withdrawal) || 10000,
          'default_settings'
        ]
      );
    } else {
      await db.run(
        `INSERT INTO payment_settings (id, razorpay_key_id, razorpay_key_secret, gateway_mode, gateway_status, min_deposit, max_deposit, min_withdrawal, max_withdrawal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'default_settings',
          razorpay_key_id ? razorpay_key_id.trim() : '',
          razorpay_key_secret ? razorpay_key_secret.trim() : '',
          gateway_mode || 'TEST',
          gateway_status || 'ACTIVE',
          Number(min_deposit) || 10,
          Number(max_deposit) || 50000,
          Number(min_withdrawal) || 50,
          Number(max_withdrawal) || 10000
        ]
      );
    }

    return res.json({ success: true, message: 'Payment gateway configuration updated successfully!' });
  } catch (error) {
    console.error('Update payment settings error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update payment settings.' });
  }
});

// 6. UPI WALLET MANAGEMENT & DEPOSITS
// 6a. Get all UPI payment orders with user info, status filter & search
router.get('/deposits/orders', async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `
      SELECT p.*, u.name as user_name, u.email as user_email, u.mobile as user_mobile, u.wallet_balance as user_balance
      FROM payment_orders p
      JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'ALL') {
      sql += ` AND p.status = ?`;
      params.push(status.toUpperCase());
    }

    if (search) {
      sql += ` AND (u.email LIKE ? OR u.name LIKE ? OR p.order_id LIKE ? OR p.utr_number LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 150`;

    const orders = await db.query(sql, params);
    return res.json({
      success: true,
      orders: orders.map(o => ({
        ...o,
        amount: Number(o.amount_paise) / 100.0
      }))
    });
  } catch (error) {
    console.error('Admin UPI orders fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch payment orders.' });
  }
});

// 6b. Verify UPI payment order & credit wallet in integer paise (Admin 1-Click Verification)
router.post('/deposits/orders/:orderId/verify', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { utrNumber } = req.body;
    const io = req.app.get('io');

    const result = await walletService.verifyPaymentOrder({
      orderId,
      adminId: req.user.id,
      verificationMethod: 'MANUAL_ADMIN',
      utrNumber,
      ipAddress: req.ip,
      io
    });

    return res.json(result);
  } catch (error) {
    console.error('Verify UPI order error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to verify payment order.'
    });
  }
});

// 6c. Reject UPI payment order
router.post('/deposits/orders/:orderId/reject', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const result = await walletService.rejectPaymentOrder({
      orderId,
      adminId: req.user.id,
      reason,
      ipAddress: req.ip
    });

    return res.json(result);
  } catch (error) {
    console.error('Reject UPI order error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to reject payment order.'
    });
  }
});

// 6d. Admin Audit Trail
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await db.query(
      `SELECT a.*, u.name as admin_name, u.email as admin_email 
       FROM admin_audit_logs a
       LEFT JOIN users u ON a.admin_id = u.id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    return res.json({ success: true, logs });
  } catch (error) {
    console.error('Admin audit logs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch audit logs.' });
  }
});

// 6e. Legacy deposits list (backward compatibility)
router.get('/deposits', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT d.*, u.name as user_name, u.email as user_email, u.mobile as user_mobile 
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ` AND d.status = ?`;
      params.push(status.toUpperCase());
    }

    sql += ` ORDER BY d.created_at DESC LIMIT 100`;

    const deposits = await db.query(sql, params);
    return res.json({ success: true, deposits });
  } catch (error) {
    console.error('Admin deposits fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch deposits.' });
  }
});

// 6f. Legacy Approve Deposit
router.post('/deposits/:depositId/approve', async (req, res) => {
  try {
    // Check if there is an associated payment_orders row
    const existingOrder = await db.get('SELECT order_id FROM payment_orders WHERE order_id = ?', [req.params.depositId]);
    if (existingOrder) {
      const result = await walletService.verifyPaymentOrder({
        orderId: existingOrder.order_id,
        adminId: req.user.id,
        verificationMethod: 'MANUAL_ADMIN',
        ipAddress: req.ip,
        io: req.app.get('io')
      });
      return res.json(result);
    }

    const deposit = await db.get('SELECT * FROM deposits WHERE deposit_id = ?', [req.params.depositId]);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found.' });
    }

    if (deposit.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Deposit is already ${deposit.status}.` });
    }

    // Atomic credit with paise sync
    const depositPaise = Math.round(deposit.amount * 100);
    const walletAcc = await walletService.ensureWalletAccount(deposit.user_id);
    await db.run(`UPDATE wallet_accounts SET balance_paise = balance_paise + ?, updated_at = datetime('now') WHERE id = ?`, [depositPaise, walletAcc.id]);
    await db.run(`UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = datetime('now') WHERE id = ?`, [deposit.amount, deposit.user_id]);

    const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [deposit.user_id]);

    // Update deposit status
    await db.run(
      `UPDATE deposits SET status = 'APPROVED', verified_by = ?, verified_at = datetime('now') WHERE deposit_id = ?`,
      [req.user.id, deposit.deposit_id]
    );

    // Create success transaction record
    const txnId = generateTxnId('DEP');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
       VALUES (?, ?, ?, 'DEPOSIT', ?, ?, 'SUCCESS', 'UPI', ?, ?)`,
      [
        db.generateId('txn'),
        txnId,
        deposit.user_id,
        deposit.amount,
        user.wallet_balance,
        deposit.utr_number || deposit.deposit_id,
        `UPI Deposit approved (UTR: ${deposit.utr_number || 'Verified'})`
      ]
    );

    // Audit log
    await db.run(
      `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, ip_address)
       VALUES (?, ?, 'APPROVE_DEPOSIT', 'DEPOSIT', ?, ?, ?)`,
      [
        'aud-' + Date.now(),
        req.user.id,
        deposit.deposit_id,
        JSON.stringify({ amount: deposit.amount, user_id: deposit.user_id }),
        req.ip || '127.0.0.1'
      ]
    );

    return res.json({
      success: true,
      message: `Deposit of ₹${Number(deposit.amount).toFixed(2)} approved! User wallet credited.`,
      newBalance: user.wallet_balance
    });
  } catch (error) {
    console.error('Approve deposit error:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve deposit.' });
  }
});

// 6g. Legacy Reject Deposit
router.post('/deposits/:depositId/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const existingOrder = await db.get('SELECT order_id FROM payment_orders WHERE order_id = ?', [req.params.depositId]);
    if (existingOrder) {
      const result = await walletService.rejectPaymentOrder({
        orderId: existingOrder.order_id,
        adminId: req.user.id,
        reason,
        ipAddress: req.ip
      });
      return res.json(result);
    }

    const deposit = await db.get('SELECT * FROM deposits WHERE deposit_id = ?', [req.params.depositId]);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found.' });
    }

    if (deposit.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Deposit is already ${deposit.status}.` });
    }

    await db.run(
      `UPDATE deposits SET status = 'REJECTED', rejection_reason = ?, verified_by = ?, verified_at = datetime('now') WHERE deposit_id = ?`,
      [reason || 'Invalid UTR or payment not received', req.user.id, deposit.deposit_id]
    );

    await db.run(
      `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, ip_address)
       VALUES (?, ?, 'REJECT_DEPOSIT', 'DEPOSIT', ?, ?, ?)`,
      [
        'aud-' + Date.now(),
        req.user.id,
        deposit.deposit_id,
        JSON.stringify({ reason }),
        req.ip || '127.0.0.1'
      ]
    );

    return res.json({
      success: true,
      message: 'Deposit request rejected.'
    });
  } catch (error) {
    console.error('Reject deposit error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reject deposit.' });
  }
});

// 7. WITHDRAWALS MANAGEMENT (APPROVE / PAY / REJECT)
// 7a. Get all withdrawals
router.get('/withdrawals', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT w.*, u.name as user_name, u.email as user_email, u.mobile as user_mobile 
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ` AND w.status = ?`;
      params.push(status.toUpperCase());
    }

    sql += ` ORDER BY w.created_at DESC LIMIT 100`;

    const withdrawals = await db.query(sql, params);
    return res.json({ success: true, withdrawals });
  } catch (error) {
    console.error('Admin withdrawals fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch withdrawals.' });
  }
});

// 7b. Mark Withdrawal as PAID
router.post('/withdrawals/:id/pay', async (req, res) => {
  try {
    const { adminUtr, notes } = req.body;
    const withdrawal = await db.get('SELECT * FROM withdrawals WHERE id = ? OR withdrawal_id = ?', [req.params.id, req.params.id]);

    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    if (withdrawal.status === 'PAID') {
      return res.status(400).json({ success: false, message: 'Withdrawal has already been marked as paid.' });
    }

    await db.run(
      `UPDATE withdrawals SET status = 'PAID', admin_utr = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [adminUtr ? adminUtr.trim() : 'PAID-MANUAL', notes ? notes.trim() : null, withdrawal.id]
    );

    // Update transaction entry to SUCCESS
    await db.run(
      `UPDATE transactions SET status = 'SUCCESS', reference_id = ? WHERE reference_id = ? OR description LIKE ?`,
      [adminUtr || 'PAID', withdrawal.withdrawal_id, `%${withdrawal.withdrawal_id}%`]
    );

    return res.json({
      success: true,
      message: `Withdrawal of ₹${Number(withdrawal.amount).toFixed(2)} marked as PAID to ${withdrawal.upi_id}.`
    });
  } catch (error) {
    console.error('Withdrawal pay error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process withdrawal payment.' });
  }
});

// 7c. Reject Withdrawal (Automatic refund back to user wallet!)
router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const withdrawal = await db.get('SELECT * FROM withdrawals WHERE id = ? OR withdrawal_id = ?', [req.params.id, req.params.id]);

    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    if (withdrawal.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Cannot reject withdrawal with status ${withdrawal.status}.` });
    }

    const rejectionReason = reason || 'Invalid UPI ID or account verification failed';

    // 1. Update withdrawal status to REJECTED
    await db.run(
      `UPDATE withdrawals SET status = 'REJECTED', admin_notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [rejectionReason, withdrawal.id]
    );

    // 2. Refund balance back to user's wallet!
    await db.run(
      `UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = datetime('now') WHERE id = ?`,
      [withdrawal.amount, withdrawal.user_id]
    );

    const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [withdrawal.user_id]);

    // 3. Create refund transaction record
    const txnId = generateTxnId('REF');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
       VALUES (?, ?, ?, 'REFUND', ?, ?, 'SUCCESS', 'WALLET', ?, ?)`,
      [
        db.generateId('txn'),
        txnId,
        withdrawal.user_id,
        withdrawal.amount,
        user.wallet_balance,
        withdrawal.withdrawal_id,
        `Withdrawal rejected and refunded: ${rejectionReason}`
      ]
    );

    return res.json({
      success: true,
      message: `Withdrawal rejected. ₹${Number(withdrawal.amount).toFixed(2)} automatically refunded to user wallet.`
    });
  } catch (error) {
    console.error('Withdrawal reject error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reject withdrawal.' });
  }
});

// 8. ANNOUNCEMENTS MANAGEMENT
router.get('/announcements', async (req, res) => {
  const announcements = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');
  return res.json({ success: true, announcements });
});

router.post('/announcements', async (req, res) => {
  try {
    const { title, message, type } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    const id = db.generateId('ann');
    await db.run(
      `INSERT INTO announcements (id, title, message, type, is_active) VALUES (?, ?, ?, ?, TRUE)`,
      [id, title.trim(), message.trim(), type || 'INFO']
    );

    return res.status(201).json({ success: true, message: 'Announcement created!' });
  } catch (error) {
    console.error('Announcement creation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create announcement.' });
  }
});

router.delete('/announcements/:id', async (req, res) => {
  await db.run('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  return res.json({ success: true, message: 'Announcement deleted.' });
});

// ============================================================
// 9. PRODUCTS & INVENTORY MANAGEMENT
// ============================================================
router.get('/products', async (req, res) => {
  try {
    const products = await db.query(
      `SELECT p.*, p.stock as stock_quantity, c.name as category_name 
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       ORDER BY p.created_at DESC`
    );
    return res.json({ success: true, products });
  } catch (error) {
    console.error('Admin get products error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve products.' });
  }
});

router.post('/products', async (req, res) => {
  try {
    const { name, category_id, description, price, stock, stock_quantity, sku, image_url } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Product name and price are required.' });
    }

    const productId = db.generateId('prod');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
    const initialStock = Number(stock !== undefined ? stock : stock_quantity) || 0;

    await db.run(
      `INSERT INTO products (id, category_id, name, slug, description, price, stock, sku, image_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        productId,
        category_id || null,
        name.trim(),
        slug,
        description ? description.trim() : null,
        Number(price),
        initialStock,
        sku ? sku.trim() : 'SKU-' + Date.now().toString(36).toUpperCase(),
        image_url || '/assets/images/product-placeholder.jpg'
      ]
    );

    // Record initial inventory
    if (initialStock > 0) {
      await db.run(
        `INSERT INTO inventory (id, product_id, change_type, quantity, previous_stock, new_stock, notes)
         VALUES (?, ?, 'INITIAL', ?, 0, ?, 'Product creation initial stock')`,
        [db.generateId('inv'), productId, initialStock, initialStock]
      );
    }

    const productRecord = await db.get('SELECT *, stock as stock_quantity FROM products WHERE id = ?', [productId]);

    return res.status(201).json({
      success: true,
      message: 'Product created successfully!',
      productId,
      product: productRecord || { id: productId, stock_quantity: initialStock }
    });
  } catch (error) {
    console.error('Admin create product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const { name, category_id, description, price, sku, is_active, image_url } = req.body;
    const product = await db.get('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    await db.run(
      `UPDATE products SET
        name = COALESCE(?, name),
        category_id = COALESCE(?, category_id),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        sku = COALESCE(?, sku),
        is_active = COALESCE(?, is_active),
        image_url = COALESCE(?, image_url),
        updated_at = datetime('now')
       WHERE id = ?`,
      [name, category_id, description, price !== undefined ? Number(price) : null, sku, is_active, image_url, req.params.id]
    );

    return res.json({ success: true, message: 'Product updated successfully.' });
  } catch (error) {
    console.error('Admin update product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Product deleted.' });
  } catch (error) {
    console.error('Admin delete product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
});

// Adjust product stock & record inventory audit
router.post('/products/:id/stock', async (req, res) => {
  try {
    const { quantity, change_type, reason, notes } = req.body;
    const qty = Number(quantity);
    if (isNaN(qty)) {
      return res.status(400).json({ success: false, message: 'Valid quantity is required.' });
    }

    const product = await db.get('SELECT id, stock FROM products WHERE id = ?', [req.params.id]);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const previousStock = product.stock;
    let newStock = previousStock;
    const type = (change_type || 'ADD').toUpperCase();
    if (type === 'ADD') {
      newStock = previousStock + qty;
    } else if (type === 'REMOVE') {
      newStock = Math.max(0, previousStock - qty);
    } else if (type === 'SET') {
      newStock = Math.max(0, qty);
    } else {
      newStock = Math.max(0, previousStock + qty);
    }

    await db.run(
      `UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`,
      [newStock, product.id]
    );

    await db.run(
      `INSERT INTO inventory (id, product_id, change_type, quantity, previous_stock, new_stock, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        db.generateId('inv'),
        product.id,
        type,
        qty,
        previousStock,
        newStock,
        reason || notes || 'Manual admin inventory adjustment'
      ]
    );

    return res.json({
      success: true,
      message: `Stock adjusted. New stock: ${newStock}`,
      current_stock: newStock,
      previousStock,
      newStock
    });
  } catch (error) {
    console.error('Admin stock adjust error:', error);
    return res.status(500).json({ success: false, message: 'Failed to adjust stock.' });
  }
});

// ============================================================
// 10. CATEGORIES MANAGEMENT
// ============================================================
router.get('/categories', async (req, res) => {
  try {
    const categories = await db.query('SELECT * FROM categories ORDER BY name ASC');
    return res.json({ success: true, categories });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, description, image_url } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const id = db.generateId('cat');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    await db.run(
      `INSERT INTO categories (id, name, slug, description, image_url) VALUES (?, ?, ?, ?, ?)`,
      [id, name.trim(), slug, description ? description.trim() : null, image_url || null]
    );

    return res.status(201).json({ success: true, message: 'Category created!', categoryId: id });
  } catch (error) {
    console.error('Create category error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create category.' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Category deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete category.' });
  }
});

// ============================================================
// 11. ORDERS MANAGEMENT
// ============================================================
router.get('/orders', async (req, res) => {
  try {
    const orders = await db.query(
      `SELECT o.*, u.name as user_name, u.email as user_email, u.mobile as user_mobile 
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       ORDER BY o.created_at DESC`
    );

    const formatted = orders.map(o => {
      let items = [];
      try { items = JSON.parse(o.items_json); } catch(e){}
      return { ...o, items };
    });

    return res.json({ success: true, orders: formatted });
  } catch (error) {
    console.error('Admin get orders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve orders.' });
  }
});

router.put('/orders/:id/status', async (req, res) => {
  try {
    const status = req.body.status || req.body.order_status;
    const payment_status = req.body.payment_status;
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    await db.run(
      `UPDATE orders SET
        payment_status = COALESCE(?, payment_status),
        order_status = COALESCE(?, order_status),
        updated_at = datetime('now')
       WHERE id = ?`,
      [payment_status || null, status || null, req.params.id]
    );

    const updated = await db.get('SELECT *, order_status as status FROM orders WHERE id = ?', [req.params.id]);

    return res.json({
      success: true,
      message: 'Order status updated successfully.',
      order: updated
    });
  } catch (error) {
    console.error('Admin update order error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
});

// ============================================================
// 12. INVENTORY AUDIT LOGS
// ============================================================
router.get('/inventory', async (req, res) => {
  try {
    const logs = await db.query(
      `SELECT i.*, p.name as product_name, p.sku as product_sku 
       FROM inventory i 
       JOIN products p ON i.product_id = p.id 
       ORDER BY i.created_at DESC LIMIT 100`
    );
    return res.json({ success: true, inventory: logs });
  } catch (error) {
    console.error('Admin get inventory error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve inventory logs.' });
  }
});

module.exports = router;
