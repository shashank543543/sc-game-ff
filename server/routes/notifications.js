const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// All notification routes require authentication
router.use(authenticateToken);

// 1. GET USER NOTIFICATIONS
router.get('/', async (req, res) => {
  try {
    const notifications = await db.query(
      `SELECT id, user_id, type, title, message, data_json, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    const unreadCountRow = await db.get(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [req.user.id]
    );
    const unreadCount = Number(unreadCountRow?.count || 0);

    return res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve notifications.' });
  }
});

// 2. MARK NOTIFICATIONS AS READ
router.post('/mark-read', async (req, res) => {
  try {
    const { notification_id } = req.body;

    if (notification_id) {
      await db.run(
        `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
        [notification_id, req.user.id]
      );
    } else {
      // Mark all read for this user
      await db.run(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ?`,
        [req.user.id]
      );
    }

    return res.json({ success: true, message: 'Notifications marked as read.' });
  } catch (error) {
    console.error('Mark read notifications error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update notification state.' });
  }
});

// 3. DELETE / CLEAR A NOTIFICATION
router.delete('/:id', async (req, res) => {
  try {
    await db.run(
      `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    return res.json({ success: true, message: 'Notification removed.' });
  } catch (error) {
    console.error('Delete notification error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete notification.' });
  }
});

module.exports = router;
