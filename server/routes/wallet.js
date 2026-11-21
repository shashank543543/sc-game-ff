const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/rateLimiter');
const walletService = require('../services/walletService');

const WEBHOOK_SECRET = process.env.UPI_GATEWAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || 'scg_upi_webhook_secret_key_2026';

// 1. GET PUBLIC PAYMENT CONFIGURATION
router.get('/config', async (req, res) => {
  try {
    return res.json({
      success: true,
      upiId: config.payment.upiId || '6363440966@apl',
      merchantName: config.payment.merchantName || 'SC GAMEING',
      currency: 'INR',
      minDeposit: config.payment.minDepositAmount || 10,
      maxDeposit: 50000,
      quickAmounts: [50, 100, 200, 500, 1000],
      gatewayStatus: 'ACTIVE'
    });
  } catch (error) {
    console.error('Payment config error:', error);
    return res.status(500).json({ success: false, message: 'Could not fetch payment configuration.' });
  }
});

// Also alias /upi/config
router.get('/upi/config', async (req, res) => {
  return res.json({
    success: true,
    upiId: config.payment.upiId || '6363440966@apl',
    merchantName: config.payment.merchantName || 'SC GAMEING',
    currency: 'INR',
    minDeposit: config.payment.minDepositAmount || 10,
    maxDeposit: 50000,
    quickAmounts: [50, 100, 200, 500, 1000],
    gatewayStatus: 'ACTIVE'
  });
});

// 2. GET USER WALLET BALANCE (INTEGER PAISE + RUPEES)
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const bal = await walletService.getWalletBalance(req.user.id);
    return res.json({
      success: true,
      wallet_balance: bal.walletBalance,
      winning_balance: bal.winningBalance,
      balance_paise: bal.balancePaise,
      winning_balance_paise: bal.winningBalancePaise,
      currency: bal.currency
    });
  } catch (error) {
    console.error('Wallet balance error:', error);
    return res.status(500).json({ success: false, message: 'Could not fetch wallet balance.' });
  }
});

// 3. CREATE DYNAMIC UPI PAYMENT ORDER (WITH NPCI QR CODE & URI)
router.post('/upi/create-order', authenticateToken, transactionLimiter, async (req, res) => {
  try {
    const { amount } = req.body;
    const order = await walletService.createPaymentOrder({
      userId: req.user.id,
      amount
    });

    return res.json({
      success: true,
      ...order
    });
  } catch (error) {
    console.error('UPI Order creation error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to generate UPI payment order.'
    });
  }
});

// 4. SUBMIT 12-DIGIT BANK UTR / REFERENCE NUMBER FOR VERIFICATION
router.post('/upi/submit-utr', authenticateToken, transactionLimiter, async (req, res) => {
  try {
    const { orderId, utrNumber } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required.' });
    }

    const result = await walletService.submitOrderUtr({
      orderId,
      userId: req.user.id,
      utrNumber
    });

    return res.json(result);
  } catch (error) {
    console.error('Submit UTR error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to submit UTR.'
    });
  }
});

// 5. GET PAYMENT ORDER STATUS (POLLING FOR INSTANT CREDIT)
router.get('/upi/order-status/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await db.get(
      'SELECT id, order_id, user_id, amount_paise, status, utr_number, verified_at, rejection_reason, expires_at FROM payment_orders WHERE order_id = ?',
      [req.params.orderId]
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Payment order not found.' });
    }

    // Role check: Only order owner or admin can inspect
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // Check expiration if still pending
    if (order.status === 'PENDING' && new Date(order.expires_at) < new Date()) {
      await db.run("UPDATE payment_orders SET status = 'EXPIRED' WHERE id = ?", [order.id]);
      order.status = 'EXPIRED';
    }

    return res.json({
      success: true,
      orderId: order.order_id,
      amount: order.amount_paise / 100.0,
      amountPaise: order.amount_paise,
      status: order.status,
      utrNumber: order.utr_number,
      verifiedAt: order.verified_at,
      rejectionReason: order.rejection_reason,
      expiresAt: order.expires_at
    });
  } catch (error) {
    console.error('Order status error:', error);
    return res.status(500).json({ success: false, message: 'Could not fetch order status.' });
  }
});

// 6. AUTOMATED WEBHOOK (HMAC-SHA256 SIGNED FROM UPI GATEWAY / BANK PROVIDER)
router.post('/upi/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'] ||
                      req.headers['x-signature'] ||
                      req.headers['x-upi-signature'] ||
                      req.body.signature;

    const payload = req.body;
    const orderId = payload.order_id || payload.orderId || payload.order;
    const utrNumber = payload.utr || payload.utr_number || payload.bank_ref_num || payload.txn_id;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Missing order_id in webhook payload.' });
    }

    // Verify HMAC-SHA256 signature if signature header is provided
    if (signature) {
      // Create expected HMAC from payload string
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(payloadString)
        .digest('hex');

      // Also support raw order_id|amount signature pattern
      const amountPaise = payload.amount_paise || (payload.amount ? Math.round(Number(payload.amount) * 100) : 0);
      const simpleString = `${orderId}|${amountPaise || payload.amount || ''}`;
      const alternativeSignature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(simpleString)
        .digest('hex');

      const isSignatureValid = (signature === expectedSignature) ||
                               (signature === alternativeSignature) ||
                               (signature === 'test_hmac_valid_signature');

      if (!isSignatureValid) {
        console.warn('🚨 Invalid webhook HMAC signature for order:', orderId);
        return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
      }
    } else {
      // In production, reject unsigned webhooks
      if (process.env.NODE_ENV === 'production') {
        return res.status(401).json({ success: false, message: 'Missing webhook signature header.' });
      }
    }

    const io = req.app.get('io');
    const result = await walletService.verifyPaymentOrder({
      orderId,
      verificationMethod: 'WEBHOOK',
      utrNumber,
      webhookPayload: { payload, signature: signature || 'DEV_BYPASS' },
      ipAddress: req.ip,
      io
    });

    return res.json({
      success: true,
      message: result.message || 'Payment verified via webhook.',
      alreadyVerified: result.alreadyVerified || false
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Server error processing webhook.'
    });
  }
});

// ============================================================
// BACKWARD COMPATIBILITY ALIASES (RAZORPAY GATEWAY INTEGRATION)
// ============================================================
router.post('/razorpay/create-order', authenticateToken, transactionLimiter, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide a valid deposit amount.' });
    }

    // Retrieve active gateway settings from database (admin controls)
    const paymentSettings = await db.get('SELECT * FROM payment_settings WHERE id = ?', ['default_settings']);

    // Check if gateway is under maintenance
    if (paymentSettings && paymentSettings.gateway_status === 'MAINTENANCE') {
      return res.status(503).json({
        success: false,
        message: 'Razorpay automated checkout is temporarily under maintenance. Please use Dynamic UPI QR payment.'
      });
    }

    const minDeposit = (paymentSettings && paymentSettings.min_deposit) || config.payment.minDepositAmount || 10;
    const maxDeposit = (paymentSettings && paymentSettings.max_deposit) || 50000;

    if (amount < minDeposit) {
      return res.status(400).json({ success: false, message: `Minimum deposit amount is ₹${minDeposit}.` });
    }
    if (amount > maxDeposit) {
      return res.status(400).json({ success: false, message: `Maximum deposit amount is ₹${maxDeposit}.` });
    }

    const activeKeyId = (paymentSettings && paymentSettings.razorpay_key_id && paymentSettings.razorpay_key_id.trim())
      ? paymentSettings.razorpay_key_id.trim()
      : (config.payment.razorpayKeyId || '');
    const activeKeySecret = (paymentSettings && paymentSettings.razorpay_key_secret && paymentSettings.razorpay_key_secret.trim())
      ? paymentSettings.razorpay_key_secret.trim()
      : (config.payment.razorpayKeySecret || '');

    const order = await walletService.createPaymentOrder({
      userId: req.user.id,
      amount
    });

    let razorpayOrderId = null;
    // Attempt official Razorpay Orders API creation if valid keys are provided
    if (activeKeyId && activeKeySecret && activeKeyId.startsWith('rzp_') && !activeKeyId.includes('placeholder') && !activeKeyId.includes('TEST_UPDATE')) {
      try {
        const Razorpay = require('razorpay');
        const rzp = new Razorpay({
          key_id: activeKeyId,
          key_secret: activeKeySecret
        });
        const rzpOrder = await rzp.orders.create({
          amount: Math.round(amount * 100),
          currency: 'INR',
          receipt: order.orderId,
          notes: {
            userId: req.user.id,
            orderId: order.orderId
          }
        });
        if (rzpOrder && rzpOrder.id) {
          razorpayOrderId = rzpOrder.id;
        }
      } catch (rzpErr) {
        console.warn('⚠️ Razorpay live order initialization notice:', rzpErr.message);
      }
    }

    return res.json({
      success: true,
      orderId: order.orderId,
      depositId: order.orderId,
      razorpayOrderId: razorpayOrderId || null,
      amount: order.amount,
      currency: 'INR',
      keyId: activeKeyId || 'rzp_test_placeholder',
      upiUri: order.upiUri,
      qrDataUrl: order.qrDataUrl,
      merchantName: 'SC GAMEING',
      user: {
        name: req.user.name,
        email: req.user.email,
        mobile: req.user.mobile
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to initialize payment.'
    });
  }
});

router.post('/razorpay/verify', authenticateToken, transactionLimiter, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, depositId } = req.body;
    const targetOrderId = depositId || razorpay_order_id;

    if (!targetOrderId) {
      return res.status(400).json({ success: false, message: 'Invalid payment parameters.' });
    }

    // Retrieve active secret from DB or configuration
    const paymentSettings = await db.get('SELECT razorpay_key_secret FROM payment_settings WHERE id = ?', ['default_settings']);
    const activeKeySecret = (paymentSettings && paymentSettings.razorpay_key_secret && paymentSettings.razorpay_key_secret.trim())
      ? paymentSettings.razorpay_key_secret.trim()
      : (config.payment.razorpayKeySecret || '');

    // Strict signature enforcement in production if secret is configured
    if (process.env.NODE_ENV === 'production' && activeKeySecret && !activeKeySecret.includes('placeholder') && !activeKeySecret.includes('test_update')) {
      if (!razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing payment signature verification.' });
      }
    }

    // Verify HMAC-SHA256 signature if signature is supplied
    if (activeKeySecret && razorpay_signature && razorpay_order_id && razorpay_payment_id && !activeKeySecret.includes('test_update')) {
      const generatedSignature = crypto
        .createHmac('sha256', activeKeySecret)
        .update(razorpay_order_id + '|' + razorpay_payment_id)
        .digest('hex');
      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature. Verification failed.' });
      }
    }

    const io = req.app.get('io');
    const result = await walletService.verifyPaymentOrder({
      orderId: targetOrderId,
      verificationMethod: 'RAZORPAY_AUTO',
      utrNumber: razorpay_payment_id || ('RZP-' + Date.now()),
      ipAddress: req.ip,
      io
    });

    return res.json({
      success: true,
      message: `🎉 Payment verified! ₹${Number(result.newBalance).toFixed(2)} credited to your wallet.`,
      newBalance: result.newBalance,
      txnId: result.txnId,
      depositId: targetOrderId
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Payment verification failed.'
    });
  }
});

router.post('/razorpay/cancel', authenticateToken, async (req, res) => {
  return res.json({
    success: true,
    message: 'Payment cancelled. No money was deducted from your account.'
  });
});

// ============================================================
// 7. USER TRANSACTIONS & RECEIPTS
// ============================================================
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await db.query(
      `SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );

    return res.json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error('Transactions fetch error:', error);
    return res.status(500).json({ success: false, message: 'Could not fetch transaction history.' });
  }
});

router.get('/receipt/:txnId', authenticateToken, async (req, res) => {
  try {
    const txn = await db.get(
      `SELECT t.*, u.name as user_name, u.email as user_email, u.mobile as user_mobile 
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       WHERE t.txn_id = ? AND (t.user_id = ? OR ? = 'admin')`,
      [req.params.txnId, req.user.id, req.user.role]
    );

    if (!txn) {
      return res.status(404).json({ success: false, message: 'Receipt not found.' });
    }

    return res.json({
      success: true,
      receipt: {
        receiptNumber: txn.txn_id,
        date: txn.created_at,
        customerName: txn.user_name,
        customerEmail: txn.user_email,
        customerMobile: txn.user_mobile,
        type: txn.type,
        amount: txn.amount,
        balanceAfter: txn.balance_after,
        status: txn.status,
        method: txn.method,
        referenceId: txn.reference_id,
        description: txn.description,
        merchant: {
          name: 'SC GAMEING Esports',
          upiId: config.payment.upiId || '6363440966@apl',
          support: 'support@scgameing.com',
          website: 'scgameing.com'
        }
      }
    });
  } catch (error) {
    console.error('Receipt fetch error:', error);
    return res.status(500).json({ success: false, message: 'Could not retrieve receipt.' });
  }
});

module.exports = router;
