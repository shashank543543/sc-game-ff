const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/rateLimiter');
const { generateTxnId } = require('../utils/helpers');

// 1. SUBMIT WITHDRAWAL REQUEST
router.post('/request', authenticateToken, transactionLimiter, async (req, res) => {
  try {
    const { amount, upiId, accountHolderName } = req.body;
    const numAmount = Number(amount);

    if (isNaN(numAmount) || numAmount < config.payment.minWithdrawalAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₹${config.payment.minWithdrawalAmount}.`
      });
    }

    if (numAmount > config.payment.maxWithdrawalAmount) {
      return res.status(400).json({
        success: false,
        message: `Maximum withdrawal limit per request is ₹${config.payment.maxWithdrawalAmount}.`
      });
    }

    if (!upiId || !accountHolderName) {
      return res.status(400).json({
        success: false,
        message: 'UPI ID and Account Holder Name are required for payout.'
      });
    }

    const cleanUpi = String(upiId).trim();
    if (!cleanUpi.includes('@') || cleanUpi.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid UPI ID (e.g., yourname@okaxis, 9876543210@paytm).'
      });
    }

    // Check user balance
    const user = await db.get('SELECT wallet_balance, winning_balance FROM users WHERE id = ?', [req.user.id]);
    const currentBalance = Number(user.wallet_balance);

    if (currentBalance < numAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance! Your current balance is ₹${currentBalance.toFixed(2)}, but requested ₹${numAmount.toFixed(2)}.`
      });
    }

    // Check if user has an existing unresolved pending withdrawal
    const pendingWithdrawal = await db.get(
      `SELECT id FROM withdrawals WHERE user_id = ? AND status = 'PENDING'`,
      [req.user.id]
    );
    if (pendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending withdrawal request. Please wait until it is processed.'
      });
    }

    const withdrawalId = generateTxnId('WTH');
    const newBalance = currentBalance - numAmount;

    // 1. Atomically deduct balance from user
    await db.run(
      `UPDATE users SET wallet_balance = ?, updated_at = datetime('now') WHERE id = ?`,
      [newBalance, req.user.id]
    );

    // 2. Insert into withdrawals
    await db.run(
      `INSERT INTO withdrawals (id, withdrawal_id, user_id, amount, upi_id, account_holder_name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      ['wth-' + Date.now(), withdrawalId, req.user.id, numAmount, cleanUpi, accountHolderName.trim()]
    );

    // 3. Create transaction entry
    const txnId = generateTxnId('TXN');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'UPI', ?, ?)`,
      [
        'txn-' + Date.now(),
        txnId,
        req.user.id,
        'WITHDRAWAL',
        numAmount,
        newBalance,
        withdrawalId,
        `Withdrawal request submitted to ${cleanUpi}`
      ]
    );

    return res.status(201).json({
      success: true,
      message: `Withdrawal request for ₹${numAmount.toFixed(2)} submitted successfully! It will be reviewed and transferred to ${cleanUpi}.`,
      withdrawalId,
      newBalance
    });
  } catch (error) {
    console.error('Withdrawal request error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process withdrawal request.' });
  }
});

// 2. GET USER'S WITHDRAWAL HISTORY
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const withdrawals = await db.query(
      `SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({
      success: true,
      withdrawals
    });
  } catch (error) {
    console.error('Withdrawals fetch error:', error);
    return res.status(500).json({ success: false, message: 'Could not fetch withdrawal history.' });
  }
});

module.exports = router;
