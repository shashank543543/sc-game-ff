const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { generateTxnId } = require('../utils/helpers');

// Webhook listener for payment gateway callbacks
router.post('/payment-callback', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || req.headers['x-webhook-signature'];
    const payload = req.body;

    // Verify webhook signature if secret configured
    if (config.payment.razorpayWebhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac('sha256', config.payment.razorpayWebhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

      if (signature !== expectedSignature) {
        console.warn('⚠️ Webhook signature mismatch detected.');
        return res.status(400).json({ success: false, message: 'Invalid signature' });
      }
    }

    const event = payload.event;
    if (event === 'payment.captured' || event === 'PAYMENT_SUCCESS') {
      const paymentEntity = payload.payload?.payment?.entity || payload.data;
      const paymentId = paymentEntity.id || payload.orderId;
      const amount = (paymentEntity.amount || payload.amount) / 100; // in rupees
      const notes = paymentEntity.notes || {};
      const userId = notes.user_id || payload.userId;
      const depositId = notes.deposit_id || payload.depositId;

      if (!userId || !amount) {
        return res.status(400).json({ success: false, message: 'Incomplete webhook data.' });
      }

      // Idempotency: check if this payment was already credited
      const existingTxn = await db.get(
        "SELECT id FROM transactions WHERE reference_id = ? AND type = 'DEPOSIT'",
        [paymentId]
      );
      if (existingTxn) {
        return res.json({ success: true, message: 'Payment already processed.' });
      }

      // Credit user's wallet atomically
      await db.run(
        `UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = datetime('now') WHERE id = ?`,
        [amount, userId]
      );

      const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [userId]);

      // Record transaction
      const txnId = generateTxnId('GW');
      await db.run(
        `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
         VALUES (?, ?, ?, 'DEPOSIT', ?, ?, 'SUCCESS', 'GATEWAY', ?, ?)`,
        [
          'txn-' + Date.now(),
          txnId,
          userId,
          amount,
          user.wallet_balance,
          paymentId,
          `Gateway payment verified (${paymentId})`
        ]
      );

      // If deposit ID was passed, update its status
      if (depositId) {
        await db.run(
          `UPDATE deposits SET status = 'APPROVED', verified_at = datetime('now') WHERE deposit_id = ?`,
          [depositId]
        );
      }

      console.log(`✅ Webhook verified payment of ₹${amount} for user ${userId}.`);
    }

    return res.json({ success: true, received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ success: false, message: 'Webhook processing error.' });
  }
});

module.exports = router;
