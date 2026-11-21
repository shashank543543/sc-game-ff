const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generateTxnId } = require('../utils/helpers');

// 1. PLACE ORDER
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { items, shippingAddress, shipping_address } = req.body;
    const shippingInfo = shippingAddress || shipping_address || 'Standard Delivery';

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    let totalAmount = 0;
    const orderItems = [];

    // Verify each product and check stock
    for (const item of items) {
      const prodId = item.productId || item.product_id;
      const product = await db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [prodId]);
      if (!product) {
        return res.status(400).json({ success: false, message: `Product ${prodId} is no longer available.` });
      }

      const qty = Math.max(1, Number(item.quantity) || 1);
      if (product.stock < qty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Only ${product.stock} available.`
        });
      }

      const itemTotal = Number(product.price) * qty;
      totalAmount += itemTotal;

      orderItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: qty,
        total: itemTotal
      });
    }

    // Check user wallet balance
    const user = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [req.user.id]);
    if (user.wallet_balance < totalAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Total is ₹${totalAmount.toFixed(2)}, your balance is ₹${user.wallet_balance.toFixed(2)}.`
      });
    }

    // Deduct user wallet
    await db.run(
      `UPDATE users SET wallet_balance = wallet_balance - ?, updated_at = datetime('now') WHERE id = ?`,
      [totalAmount, req.user.id]
    );
    await db.run(
      `UPDATE wallet_accounts SET balance_paise = balance_paise - ?, updated_at = datetime('now') WHERE user_id = ?`,
      [Math.round(totalAmount * 100), req.user.id]
    );

    const updatedUser = await db.get('SELECT wallet_balance FROM users WHERE id = ?', [req.user.id]);
    const orderNumber = 'ORD-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const orderId = 'ord-' + Date.now();

    // Insert order record
    await db.run(
      `INSERT INTO orders (id, order_number, user_id, total_amount, payment_status, order_status, shipping_address, items_json)
       VALUES (?, ?, ?, ?, 'paid', 'placed', ?, ?)`,
      [
        orderId,
        orderNumber,
        req.user.id,
        totalAmount,
        typeof shippingInfo === 'string' ? shippingInfo : JSON.stringify(shippingInfo),
        JSON.stringify(orderItems)
      ]
    );

    // Update inventory stock for each product
    for (const item of orderItems) {
      const prevProd = await db.get('SELECT stock FROM products WHERE id = ?', [item.productId]);
      const newStock = Math.max(0, prevProd.stock - item.quantity);

      await db.run(
        `UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`,
        [newStock, item.productId]
      );

      // Record in inventory audit table
      await db.run(
        `INSERT INTO inventory (id, product_id, change_type, quantity, previous_stock, new_stock, notes)
         VALUES (?, ?, 'SALE', ?, ?, ?, ?)`,
        [
          'inv-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
          item.productId,
          -item.quantity,
          prevProd.stock,
          newStock,
          `Order ${orderNumber}`
        ]
      );
    }

    // Record wallet transaction
    const txnId = generateTxnId('ORD');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, reference_id, description)
       VALUES (?, ?, ?, 'PURCHASE', ?, ?, 'SUCCESS', 'WALLET', ?, ?)`,
      [
        'txn-' + Date.now(),
        txnId,
        req.user.id,
        totalAmount,
        updatedUser.wallet_balance,
        orderNumber,
        `Payment for Order ${orderNumber}`
      ]
    );

    const orderData = {
      id: orderId,
      order_number: orderNumber,
      user_id: req.user.id,
      total_amount: totalAmount,
      payment_status: 'paid',
      status: 'placed',
      order_status: 'placed'
    };

    return res.status(201).json({
      success: true,
      message: `Order #${orderNumber} placed successfully!`,
      orderId,
      orderNumber,
      totalAmount,
      order: orderData,
      newBalance: updatedUser.wallet_balance
    });
  } catch (error) {
    console.error('Order creation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process order.' });
  }
});

// 2. GET USER'S ORDER HISTORY
router.get('/my-orders', authenticateToken, async (req, res) => {
  try {
    const orders = await db.query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    const formattedOrders = orders.map(o => {
      let parsedItems = [];
      try { parsedItems = JSON.parse(o.items_json); } catch(e){}
      return {
        ...o,
        items: parsedItems
      };
    });

    return res.json({ success: true, orders: formattedOrders });
  } catch (error) {
    console.error('Fetch my-orders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve order history.' });
  }
});

// 3. GET SINGLE ORDER DETAILS
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const order = await db.get(
      `SELECT * FROM orders WHERE (id = ? OR order_number = ?) AND user_id = ?`,
      [req.params.id, req.params.id, req.user.id]
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    let parsedItems = [];
    try { parsedItems = JSON.parse(order.items_json); } catch(e){}

    return res.json({
      success: true,
      order: {
        ...order,
        items: parsedItems
      }
    });
  } catch (error) {
    console.error('Fetch order detail error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load order details.' });
  }
});

module.exports = router;
