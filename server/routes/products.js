const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

// 1. LIST CATEGORIES
router.get('/categories', async (req, res) => {
  try {
    const categories = await db.query('SELECT * FROM categories ORDER BY name ASC');
    return res.json({ success: true, categories });
  } catch (error) {
    console.error('Fetch categories error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve categories.' });
  }
});

// 2. LIST PRODUCTS
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category_id, search } = req.query;
    let sql = `
      SELECT p.*, p.stock as stock_quantity, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.is_active = TRUE
    `;
    const params = [];

    if (category_id) {
      sql += ' AND p.category_id = ?';
      params.push(category_id);
    }

    if (search) {
      sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY p.created_at DESC';

    const products = await db.query(sql, params);
    return res.json({ success: true, products });
  } catch (error) {
    console.error('Fetch products error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve products.' });
  }
});

// 3. GET SINGLE PRODUCT
router.get('/:id', async (req, res) => {
  try {
    const product = await db.get(
      `SELECT p.*, p.stock as stock_quantity, c.name as category_name 
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       WHERE p.id = ?`,
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    return res.json({ success: true, product });
  } catch (error) {
    console.error('Fetch product detail error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve product.' });
  }
});

module.exports = router;
