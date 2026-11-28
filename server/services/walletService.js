const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { generateUpiQr } = require('../utils/qrcode');
const { generateTxnId } = require('../utils/helpers');

/**
 * Ensure user has a wallet_accounts record (integer paise)
 * Keeps in sync with users.wallet_balance
 */
async function ensureWalletAccount(userId) {
  let account = await db.get('SELECT * FROM wallet_accounts WHERE user_id = ?', [userId]);
  const user = await db.get('SELECT wallet_balance, winning_balance FROM users WHERE id = ?', [userId]);
  const userBalPaise = Math.round(Number(user?.wallet_balance || 0) * 100);
  const userWinPaise = Math.round(Number(user?.winning_balance || 0) * 100);

  if (!account) {
    const accId = 'wacc-' + userId;
    await db.run(
      `INSERT INTO wallet_accounts (id, user_id, balance_paise, winning_balance_paise, currency, status)
       VALUES (?, ?, ?, ?, 'INR', 'ACTIVE')`,
      [accId, userId, userBalPaise, userWinPaise]
    );
    account = await db.get('SELECT * FROM wallet_accounts WHERE user_id = ?', [userId]);
  } else if (Number(account.balance_paise) !== userBalPaise) {
    // Auto-sync if external routes modified users.wallet_balance
    await db.run(
      `UPDATE wallet_accounts SET balance_paise = ?, winning_balance_paise = ?, updated_at = datetime('now') WHERE id = ?`,
      [userBalPaise, userWinPaise, account.id]
    );
    account.balance_paise = userBalPaise;
    account.winning_balance_paise = userWinPaise;
  }
  return account;
}

/**
 * Get accurate wallet balance in both paise and rupees
 */
async function getWalletBalance(userId) {
  const account = await ensureWalletAccount(userId);
  const user = await db.get('SELECT wallet_balance, winning_balance FROM users WHERE id = ?', [userId]);

  return {
    accountId: account.id,
    userId: account.user_id,
    balancePaise: Number(account.balance_paise || 0),
    winningBalancePaise: Number(account.winning_balance_paise || 0),
    walletBalance: Number(user?.wallet_balance || 0),
    winningBalance: Number(user?.winning_balance || 0),
    currency: account.currency || 'INR',
    status: account.status || 'ACTIVE'
  };
}

/**
 * Create a unique UPI Payment Order for user deposit
 */
async function createPaymentOrder({ userId, amount }) {
  const numAmount = Number(amount);
  const minDeposit = config.payment.minDepositAmount || 10;
  const maxDeposit = 50000;

  if (isNaN(numAmount) || numAmount < minDeposit) {
    const err = new Error(`Minimum deposit amount is ₹${minDeposit}.`);
    err.statusCode = 400;
    throw err;
  }

  if (numAmount > maxDeposit) {
    const err = new Error(`Maximum single deposit amount is ₹${maxDeposit}.`);
    err.statusCode = 400;
    throw err;
  }

  // Ensure wallet account exists
  await ensureWalletAccount(userId);

  const amountPaise = Math.round(numAmount * 100);
  const orderId = `SCG-UPI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString(); // 15-minute validity

  // Generate NPCI standard QR Code & URI
  const qrDetails = await generateUpiQr({
    amount: numAmount,
    referenceId: orderId,
    note: `SCG Wallet Deposit ${orderId}`
  });

  const recordId = 'ord-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex');

  // Insert into payment_orders
  await db.run(
    `INSERT INTO payment_orders (id, order_id, user_id, amount_paise, currency, upi_id, upi_uri, qr_data_url, status, expires_at)
     VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, 'PENDING', ?)`,
    [
      recordId,
      orderId,
      userId,
      amountPaise,
      qrDetails.upiId,
      qrDetails.upiUri,
      qrDetails.qrDataUrl,
      expiresAt
    ]
  );

  // Sync to legacy deposits table for backwards compatibility
  await db.run(
    `INSERT INTO deposits (id, deposit_id, user_id, amount, upi_id, payment_method, status)
     VALUES (?, ?, ?, ?, ?, 'UPI', 'PENDING')`,
    [db.generateId('dep'), orderId, userId, numAmount, qrDetails.upiId]
  );

  return {
    orderId,
    amount: numAmount,
    amountPaise,
    currency: 'INR',
    upiId: qrDetails.upiId,
    upiUri: qrDetails.upiUri,
    qrDataUrl: qrDetails.qrDataUrl,
    merchantName: qrDetails.merchantName,
    expiresAt,
    status: 'PENDING'
  };
}

/**
 * Submit Bank Reference / UTR Number for verification
 */
async function submitOrderUtr({ orderId, userId, utrNumber }) {
  if (!utrNumber || typeof utrNumber !== 'string') {
    const err = new Error('UTR / Bank Reference number is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanUtr = utrNumber.trim();

  const order = await db.get('SELECT * FROM payment_orders WHERE order_id = ?', [orderId]);
  if (!order) {
    const err = new Error('Payment order not found.');
    err.statusCode = 404;
    throw err;
  }

  if (order.user_id !== userId) {
    const err = new Error('Unauthorized access to this payment order.');
    err.statusCode = 403;
    throw err;
  }

  if (order.status === 'VERIFIED') {
    return {
      success: true,
      alreadyVerified: true,
      message: 'This payment order has already been verified and credited!',
      order
    };
  }

  // Update order status to SUBMITTED
  await db.run(
    `UPDATE payment_orders 
     SET utr_number = ?, status = 'SUBMITTED', updated_at = datetime('now')
     WHERE id = ?`,
    [cleanUtr, order.id]
  );

  // Sync to deposits table
  await db.run(
    `UPDATE deposits SET utr_number = ?, status = 'PENDING' WHERE deposit_id = ?`,
    [cleanUtr, orderId]
  );

  return {
    success: true,
    message: 'UTR submitted successfully! Our automated system & admins are verifying your bank transaction.',
    orderId,
    utrNumber: cleanUtr,
    status: 'SUBMITTED'
  };
}

/**
 * Verify payment order & atomically credit user wallet in integer paise
 * Used by HMAC Webhook or Admin manual approval
 */
async function verifyPaymentOrder({
  orderId,
  adminId = null,
  verificationMethod = 'MANUAL_ADMIN',
  utrNumber = null,
  webhookPayload = null,
  ipAddress = null,
  io = null
}) {
  const order = await db.get('SELECT * FROM payment_orders WHERE order_id = ?', [orderId]);
  if (!order) {
    const err = new Error(`Payment order ${orderId} not found.`);
    err.statusCode = 404;
    throw err;
  }

  // Exactly-once guarantee (Idempotency)
  if (order.status === 'VERIFIED') {
    const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [order.user_id]);
    return {
      success: true,
      alreadyVerified: true,
      message: 'Payment has already been verified and credited.',
      order,
      walletBalance: user?.wallet_balance
    };
  }

  const cleanUtr = utrNumber ? utrNumber.trim() : order.utr_number;

  // Prevent duplicate wallet credits across all wallet_transactions
  const duplicateTxn = await db.get(
    "SELECT id FROM wallet_transactions WHERE reference_id = ? AND type = 'DEPOSIT'",
    [order.order_id]
  );
  if (duplicateTxn) {
    const err = new Error(`Transaction for order ${order.order_id} was already credited.`);
    err.statusCode = 409;
    throw err;
  }

  // Ensure user wallet account exists
  const walletAcc = await ensureWalletAccount(order.user_id);
  const currentBalPaise = Number(walletAcc.balance_paise || 0);
  const depositAmountPaise = Number(order.amount_paise);
  const newBalPaise = currentBalPaise + depositAmountPaise;
  const newBalRupees = newBalPaise / 100.0;

  // 1. Update payment_orders status
  await db.run(
    `UPDATE payment_orders 
     SET status = 'VERIFIED',
         utr_number = COALESCE(?, utr_number),
         verification_method = ?,
         verified_by = ?,
         verified_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    [cleanUtr, verificationMethod, adminId || 'WEBHOOK', order.id]
  );

  // 2. Atomically update wallet_accounts in integer paise
  await db.run(
    `UPDATE wallet_accounts 
     SET balance_paise = balance_paise + ?, updated_at = datetime('now')
     WHERE id = ?`,
    [depositAmountPaise, walletAcc.id]
  );

  // 3. Synchronize users.wallet_balance in rupees for existing app compat
  await db.run(
    `UPDATE users 
     SET wallet_balance = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [newBalRupees, order.user_id]
  );

  // 4. Record in wallet_transactions (paise ledger)
  const wtxId = 'wtx-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  await db.run(
    `INSERT INTO wallet_transactions 
     (id, account_id, user_id, type, amount_paise, balance_before_paise, balance_after_paise, reference_id, reference_type, status, description)
     VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, ?, 'UPI_DEPOSIT', 'SUCCESS', ?)`,
    [
      wtxId,
      walletAcc.id,
      order.user_id,
      depositAmountPaise,
      currentBalPaise,
      newBalPaise,
      order.order_id,
      `UPI Wallet Deposit (UTR: ${cleanUtr || 'Auto-Verified'})`
    ]
  );

  // 5. Record in legacy transactions table for unified history & receipts
  const txnId = generateTxnId('UPI');
  await db.run(
    `INSERT INTO transactions 
     (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
     VALUES (?, ?, ?, 'DEPOSIT', ?, ?, 'SUCCESS', 'UPI', ?, ?)`,
    [
      db.generateId('txn'),
      txnId,
      order.user_id,
      depositAmountPaise / 100.0,
      newBalRupees,
      cleanUtr || order.order_id,
      `UPI Instant Wallet Deposit (Order: ${order.order_id})`
    ]
  );

  // 6. Update legacy deposits table
  await db.run(
    `UPDATE deposits 
     SET status = 'APPROVED', utr_number = COALESCE(?, utr_number), verified_by = ?, verified_at = datetime('now')
     WHERE deposit_id = ?`,
    [cleanUtr, adminId || 'WEBHOOK', order.order_id]
  );

  // 7. Record in admin_audit_logs if verified manually
  if (adminId) {
    await db.run(
      `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, ip_address)
       VALUES (?, ?, 'APPROVE_UPI_DEPOSIT', 'PAYMENT_ORDER', ?, ?, ?)`,
      [
        'aud-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
        adminId,
        order.order_id,
        JSON.stringify({
          amount_paise: depositAmountPaise,
          amount_rupees: depositAmountPaise / 100.0,
          utr_number: cleanUtr,
          user_id: order.user_id
        }),
        ipAddress || '127.0.0.1'
      ]
    );
  }

  // 8. If webhook, record in payment_webhooks
  if (webhookPayload) {
    await db.run(
      `INSERT INTO payment_webhooks (id, event_id, provider, order_id, payload_json, signature, is_valid_signature, status, ip_address)
       VALUES (?, ?, 'UPI_GATEWAY', ?, ?, ?, 1, 'VERIFIED_CREDITED', ?)`,
      [
        'whk-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
        webhookPayload.event_id || 'evt-' + Date.now(),
        order.order_id,
        JSON.stringify(webhookPayload.payload || webhookPayload),
        webhookPayload.signature || 'HMAC_VERIFIED',
        ipAddress || '127.0.0.1'
      ]
    );
  }

  // 9. Emit real-time socket event
  if (io) {
    io.emit('wallet_updated', {
      userId: order.user_id,
      newBalance: newBalRupees,
      orderId: order.order_id
    });
  }

  console.log(`✅ UPI Payment ₹${depositAmountPaise / 100.0} successfully verified for user ${order.user_id} (Order: ${order.order_id})`);

  return {
    success: true,
    message: `Payment of ₹${(depositAmountPaise / 100.0).toFixed(2)} verified and credited to wallet.`,
    orderId: order.order_id,
    newBalance: newBalRupees,
    newBalancePaise: newBalPaise,
    txnId
  };
}

/**
 * Reject a payment order
 */
async function rejectPaymentOrder({ orderId, adminId, reason, ipAddress = null }) {
  const order = await db.get('SELECT * FROM payment_orders WHERE order_id = ?', [orderId]);
  if (!order) {
    const err = new Error(`Payment order ${orderId} not found.`);
    err.statusCode = 404;
    throw err;
  }

  if (order.status === 'VERIFIED') {
    const err = new Error('Cannot reject an already verified and credited payment order.');
    err.statusCode = 400;
    throw err;
  }

  const rejectReason = reason || 'Payment not received or invalid bank reference.';

  await db.run(
    `UPDATE payment_orders 
     SET status = 'REJECTED', rejection_reason = ?, verified_by = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [rejectReason, adminId, order.id]
  );

  await db.run(
    `UPDATE deposits 
     SET status = 'REJECTED', rejection_reason = ?, verified_by = ?, verified_at = datetime('now')
     WHERE deposit_id = ?`,
    [rejectReason, adminId, order.order_id]
  );

  // Record in audit log
  await db.run(
    `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json, ip_address)
     VALUES (?, ?, 'REJECT_UPI_DEPOSIT', 'PAYMENT_ORDER', ?, ?, ?)`,
    [
      'aud-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
      adminId,
      order.order_id,
      JSON.stringify({
        reason: rejectReason,
        amount_paise: order.amount_paise,
        user_id: order.user_id,
        utr: order.utr_number
      }),
      ipAddress || '127.0.0.1'
    ]
  );

  return {
    success: true,
    message: `Payment order ${orderId} rejected.`,
    orderId
  };
}

module.exports = {
  ensureWalletAccount,
  getWalletBalance,
  createPaymentOrder,
  submitOrderUtr,
  verifyPaymentOrder,
  rejectPaymentOrder
};
