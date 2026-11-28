const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const AUTHORIZED_ADMIN_EMAIL = 'shas86728@gmail.com';

// Verify standard JWT token from Cookie or Authorization header
async function authenticateToken(req, res, next) {
  try {
    let token = null;

    // 1. Check HTTP-only cookie first
    if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }

    // 2. Fallback to Authorization: Bearer <token>
    if (!token) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      } else if (req.query && req.query.token) {
        token = req.query.token;
      }
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please login.' });
    }

    jwt.verify(token, config.jwtSecret, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ success: false, message: 'Invalid or expired session. Please login again.' });
      }

      // Fetch fresh user from DB
      const user = await db.get(
        'SELECT id, name, email, mobile, ff_ign, ff_uid, role, wallet_balance, winning_balance, status FROM users WHERE id = ?',
        [decoded.id]
      );
      if (!user) {
        return res.status(404).json({ success: false, message: 'User account not found.' });
      }

      if (user.status === 'blocked') {
        return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
      }

      req.user = user;
      req.token = token;
      next();
    });
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
  }
}

// Require Admin Role & Enforce Authorized Admin Email
async function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const userEmail = (req.user.email || '').toLowerCase().trim();

    // Mandatory Backend Enforcement: Role must be admin AND email must be shas86728@gmail.com
    if (req.user.role === 'admin' && userEmail === AUTHORIZED_ADMIN_EMAIL) {
      next();
    } else {
      console.warn(`🚨 Unauthorized admin access attempt by user: ${userEmail} (ID: ${req.user.id})`);
      return res.status(403).json({
        success: false,
        message: 'Access denied: Unauthorized administrative account.'
      });
    }
  });
}

// Optional Auth (for public routes that can show extra info if logged in)
async function optionalAuth(req, res, next) {
  let token = null;
  if (req.cookies && req.cookies.auth_token) {
    token = req.cookies.auth_token;
  }
  const authHeader = req.headers['authorization'];
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (token) {
    jwt.verify(token, config.jwtSecret, async (err, decoded) => {
      if (!err && decoded) {
        const user = await db.get(
          'SELECT id, name, email, mobile, ff_ign, ff_uid, role, wallet_balance, winning_balance, status FROM users WHERE id = ?',
          [decoded.id]
        );
        if (user && user.status !== 'blocked') {
          req.user = user;
          req.token = token;
        }
      }
      next();
    });
  } else {
    next();
  }
}

// Helper: Set secure HTTP-only Cookie
function setAuthCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

// Helper: Clear auth cookie on logout
function clearAuthCookie(res) {
  res.clearCookie('auth_token', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });
}

// Helper: Log active session in database
async function recordSession(userId, token, req) {
  try {
    const sessionId = db.generateId('sess');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (db.getDbType() === 'sqlite') {
      await db.run(
        `INSERT OR REPLACE INTO sessions (id, user_id, session_token, ip_address, user_agent, expires_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [sessionId, userId, tokenHash, String(ip).slice(0, 50), String(userAgent).slice(0, 255), expiresAt]
      );
    } else {
      await db.run(
        `INSERT INTO sessions (id, user_id, session_token, ip_address, user_agent, expires_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)
         ON CONFLICT (session_token) DO UPDATE SET expires_at = EXCLUDED.expires_at, is_active = TRUE`,
        [sessionId, userId, tokenHash, String(ip).slice(0, 50), String(userAgent).slice(0, 255), expiresAt]
      );
    }
  } catch (err) {
    console.error('Session recording error:', err);
  }
}

module.exports = {
  AUTHORIZED_ADMIN_EMAIL,
  authenticateToken,
  requireAdmin,
  optionalAuth,
  setAuthCookie,
  clearAuthCookie,
  recordSession
};
