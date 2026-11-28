const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const {
  AUTHORIZED_ADMIN_EMAIL,
  authenticateToken,
  setAuthCookie,
  clearAuthCookie,
  recordSession
} = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { isValidEmail, isValidMobile, generateTxnId } = require('../utils/helpers');
const { generateAndSendResetOtp, verifyResetOtp } = require('../services/otpService');

// Helper to sign user JWT token
function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// ============================================================
// 1. USER REGISTRATION
// ============================================================
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, mobile, password, ff_ign, ff_uid } = req.body;

    if (!name || !email || !mobile || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, mobile number, and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanMobile = mobile.trim();

    // MANDATORY ADMIN SECURITY: Never allow public registration of admin email or admin role
    if (cleanEmail === AUTHORIZED_ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: 'This email address is not available for registration.'
      });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    if (!isValidMobile(cleanMobile)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit mobile number.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    // Check existing email
    const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Check existing mobile
    const existingMobile = await db.get('SELECT id FROM users WHERE mobile = ?', [cleanMobile]);
    if (existingMobile) {
      return res.status(409).json({ success: false, message: 'An account with this mobile number already exists.' });
    }

    // Hash password with bcrypt
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const userId = db.generateId('usr');

    // Welcome bonus: ₹10 instant wallet credit for new players
    const welcomeBonus = 10.00;

    await db.run(
      `INSERT INTO users (id, name, email, mobile, ff_ign, ff_uid, password_hash, role, wallet_balance, winning_balance, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, 0.00, 'active')`,
      [
        userId,
        name.trim(),
        cleanEmail,
        cleanMobile,
        ff_ign ? ff_ign.trim() : `FF_${name.slice(0, 5).toUpperCase()}`,
        ff_uid ? ff_uid.trim() : '',
        passwordHash,
        welcomeBonus
      ]
    );

    // Create user_profiles entry
    const profileId = db.generateId('prof');
    await db.run(
      `INSERT INTO user_profiles (id, user_id, bio, city, state)
       VALUES (?, ?, 'Competitive Free Fire Player', '', '')`,
      [profileId, userId]
    );

    // Initialize wallet_accounts with welcome bonus (1000 paise = ₹10.00)
    await db.run(
      `INSERT INTO wallet_accounts (id, user_id, balance_paise, winning_balance_paise, currency, status)
       VALUES (?, ?, ?, 0, 'INR', 'ACTIVE')`,
      ['wacc-' + userId, userId, Math.round(welcomeBonus * 100)]
    );

    // Record welcome bonus transaction
    const txnId = generateTxnId('BONUS');
    await db.run(
      `INSERT INTO transactions (id, txn_id, user_id, type, amount, balance_after, status, method, description)
       VALUES (?, ?, ?, 'DEPOSIT', ?, ?, 'SUCCESS', 'SYSTEM', '🎉 SC GAMEING Welcome Bonus Credited')`,
      [
        db.generateId('txn'),
        txnId,
        userId,
        welcomeBonus,
        welcomeBonus
      ]
    );

    const newUser = await db.get(
      'SELECT id, name, email, mobile, ff_ign, ff_uid, role, wallet_balance, winning_balance FROM users WHERE id = ?',
      [userId]
    );

    const token = createToken(newUser);
    setAuthCookie(res, token);
    await recordSession(newUser.id, token, req);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! ₹10 welcome bonus credited to your wallet.',
      token,
      user: newUser
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({ success: false, message: 'Error creating account. Please try again.' });
  }
});

// ============================================================
// 2. USER LOGIN
// ============================================================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email/Mobile and password are required.' });
    }

    const cleanIdentifier = identifier.trim();
    const user = await db.get(
      'SELECT * FROM users WHERE email = ? OR mobile = ?',
      [cleanIdentifier.toLowerCase(), cleanIdentifier]
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended by administration.' });
    }

    // MANDATORY ADMIN SECURITY: If role is admin, strictly require authorized admin email
    if (user.role === 'admin' && user.email.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Unauthorized administrative account.'
      });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email/mobile or password.' });
    }

    const token = createToken(user);
    setAuthCookie(res, token);
    await recordSession(user.id, token, req);

    const { password_hash, reset_token, reset_token_expiry, ...userData } = user;

    return res.json({
      success: true,
      message: 'Login successful! Welcome back.',
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ success: false, message: 'Login error. Please try again.' });
  }
});

// ============================================================
// 3. ADMIN LOGIN (STRICT AUTHORIZED EMAIL ENFORCEMENT)
// ============================================================
router.post('/admin/login', authLimiter, async (req, res) => {
  try {
    const { email, identifier, password } = req.body;
    const adminIdentifier = (email || identifier || '').toLowerCase().trim();

    if (!adminIdentifier || !password) {
      return res.status(400).json({ success: false, message: 'Admin email and password are required.' });
    }

    // MANDATORY ADMIN EMAIL RESTRICTION:
    // Reject any other email address immediately
    if (adminIdentifier !== AUTHORIZED_ADMIN_EMAIL && adminIdentifier !== '6363440966') {
      console.warn(`🚨 Rejected unauthorized admin login attempt: ${adminIdentifier}`);
      return res.status(403).json({
        success: false,
        message: 'Access denied: Unauthorized administrative account.'
      });
    }

    const admin = await db.get(
      'SELECT * FROM users WHERE (email = ? OR mobile = ?) AND role = ?',
      [AUTHORIZED_ADMIN_EMAIL, '6363440966', 'admin']
    );

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Admin account not found.' });
    }

    const passwordMatch = bcrypt.compareSync(password, admin.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin password.' });
    }

    // Update last login in admin_accounts
    await db.run(
      `UPDATE admin_accounts SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE email = ?`,
      [AUTHORIZED_ADMIN_EMAIL]
    );

    const token = createToken(admin);
    setAuthCookie(res, token);
    await recordSession(admin.id, token, req);

    const { password_hash, reset_token, reset_token_expiry, ...adminData } = admin;

    return res.json({
      success: true,
      message: 'Admin authorization successful! Welcome to SC GAMEING Console.',
      token,
      user: adminData
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ success: false, message: 'Admin login processing error.' });
  }
});

// ============================================================
// 4. USER FORGOT PASSWORD (REQUEST 6-DIGIT EMAIL OTP)
// ============================================================
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Verify user exists
    const user = await db.get('SELECT id, email, status FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      // Don't leak user non-existence, return friendly confirmation
      return res.json({
        success: true,
        message: 'If this email is registered, a 6-digit verification code has been sent.'
      });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({ success: false, message: 'This account is suspended. Please contact support.' });
    }

    // Generate, hash, and deliver OTP via Nodemailer
    const result = await generateAndSendResetOtp(cleanEmail, 'user');
    return res.json(result);
  } catch (error) {
    console.error('Forgot password error:', error);
    const statusCode = error.statusCode || (error.message.includes('Please wait') ? 429 : 400);
    return res.status(statusCode).json({ success: false, message: error.message || 'Error processing OTP request.' });
  }
});

// ============================================================
// 5. ADMIN FORGOT PASSWORD (RESTRICTED TO shas86728@gmail.com)
// ============================================================
router.post('/admin/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanEmail) {
      return res.status(400).json({ success: false, message: 'Admin email address is required.' });
    }

    // MANDATORY ADMIN RESTRICTION: Reject all other emails
    if (cleanEmail !== AUTHORIZED_ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Unauthorized administrative account.'
      });
    }

    const admin = await db.get('SELECT id FROM users WHERE email = ? AND role = ?', [AUTHORIZED_ADMIN_EMAIL, 'admin']);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Authorized admin account not found in system.' });
    }

    // Send OTP exclusively to shas86728@gmail.com
    const result = await generateAndSendResetOtp(AUTHORIZED_ADMIN_EMAIL, 'admin');
    return res.json({
      success: true,
      message: 'A secure 6-digit verification code has been sent to the authorized admin email.'
    });
  } catch (error) {
    console.error('Admin forgot password error:', error);
    const statusCode = error.statusCode || (error.message.includes('Please wait') ? 429 : 400);
    return res.status(statusCode).json({ success: false, message: error.message || 'Error processing admin OTP request.' });
  }
});

// ============================================================
// 6. VERIFY 6-DIGIT OTP (USER & ADMIN)
// ============================================================
router.post(['/verify-otp', '/admin/verify-otp'], authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and 6-digit verification code are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const isAdminRoute = req.path.includes('admin');

    if (isAdminRoute && cleanEmail !== AUTHORIZED_ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Unauthorized administrative account.'
      });
    }

    // Verify OTP against hashed database record
    const result = await verifyResetOtp(cleanEmail, otp);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'OTP verification failed.' });
  }
});

// ============================================================
// 7. RESET PASSWORD (WITH VERIFIED RESET TOKEN)
// ============================================================
router.post(['/reset-password', '/admin/reset-password'], authLimiter, async (req, res) => {
  try {
    const { resetToken, email, resetCode, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    let targetEmail = '';

    // If resetToken is provided (preferred secure flow)
    if (resetToken) {
      try {
        const decoded = jwt.verify(resetToken, config.jwtSecret);
        if (decoded.purpose !== 'PASSWORD_RESET') {
          return res.status(400).json({ success: false, message: 'Invalid reset token purpose.' });
        }
        targetEmail = decoded.email;

        // Verify token single-use against user record
        const userCheck = await db.get('SELECT reset_token FROM users WHERE email = ?', [targetEmail]);
        if (!userCheck || userCheck.reset_token !== decoded.jti) {
          return res.status(400).json({ success: false, message: 'This reset token has already been used or has expired. Please request a new code.' });
        }

        if (req.path.includes('admin') && targetEmail !== AUTHORIZED_ADMIN_EMAIL) {
          return res.status(403).json({ success: false, message: 'Access denied: Unauthorized admin email.' });
        }
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Reset token has expired or is invalid. Please request a new code.' });
      }
    } else if (email && resetCode) {
      // Direct verification fallback
      targetEmail = email.toLowerCase().trim();
      if (req.path.includes('admin') && targetEmail !== AUTHORIZED_ADMIN_EMAIL) {
        return res.status(403).json({ success: false, message: 'Access denied: Unauthorized admin email.' });
      }
      await verifyResetOtp(targetEmail, resetCode);
    } else {
      return res.status(400).json({ success: false, message: 'Verification token and new password are required.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    await db.run(
      `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL, updated_at = CURRENT_TIMESTAMP WHERE email = ?`,
      [newHash, targetEmail]
    );

    // Invalidate existing sessions for security
    const user = await db.get('SELECT id FROM users WHERE email = ?', [targetEmail]);
    if (user) {
      await db.run(`UPDATE sessions SET is_active = FALSE WHERE user_id = ?`, [user.id]);
    }

    return res.json({
      success: true,
      message: 'Password reset successful! You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to reset password.' });
  }
});

// ============================================================
// 8. LOGOUT (CLEAR COOKIE & TERMINATE SESSION)
// ============================================================
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    if (req.user && req.user.id) {
      // Invalidate session in DB
      await db.run(
        `UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE`,
        [req.user.id]
      );
    }

    clearAuthCookie(res);
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    clearAuthCookie(res);
    return res.json({ success: true, message: 'Logged out.' });
  }
});

// ============================================================
// 9. GET USER PROFILE
// ============================================================
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.get(
      `SELECT u.id, u.name, u.email, u.mobile, u.ff_ign, u.ff_uid, u.role, u.wallet_balance, u.winning_balance, u.status, u.created_at,
              p.bio, p.avatar_url, p.address, p.city, p.state, p.pincode
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = ?`,
      [req.user.id]
    );

    // Fetch user gameplay stats
    const stats = await db.get(
      `SELECT 
        COUNT(id) as total_tournaments,
        COALESCE(SUM(kills), 0) as total_kills,
        COALESCE(SUM(prize_won), 0) as total_winnings,
        COUNT(CASE WHEN rank = 1 THEN 1 END) as booyahs
       FROM tournament_participants 
       WHERE user_id = ?`,
      [req.user.id]
    );

    const depositStat = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total_deposited FROM deposits WHERE user_id = ? AND status IN ('APPROVED', 'COMPLETED')`,
      [req.user.id]
    );

    const withdrawalStat = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total_withdrawn FROM withdrawals WHERE user_id = ? AND status = 'PAID'`,
      [req.user.id]
    );

    const profileData = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [req.user.id]);

    return res.json({
      success: true,
      user: {
        ...user,
        profile: profileData || {
          bio: user.bio || null,
          avatar_url: user.avatar_url || null,
          address: user.address || null,
          city: user.city || null,
          state: user.state || null,
          pincode: user.pincode || null
        },
        stats: {
          totalMatches: Number(stats?.total_tournaments || 0),
          totalKills: Number(stats?.total_kills || 0),
          totalWinnings: Number(stats?.total_winnings || 0),
          booyahs: Number(stats?.booyahs || 0),
          totalDeposited: Number(depositStat?.total_deposited || 0),
          totalWithdrawn: Number(withdrawalStat?.total_withdrawn || 0)
        }
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load profile details.' });
  }
});

// ============================================================
// 10. UPDATE USER PROFILE
// ============================================================
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, ff_ign, ff_uid, bio, avatar_url, address, city, state, pincode } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name cannot be empty.' });
    }

    // Update users table
    await db.run(
      `UPDATE users SET name = ?, ff_ign = ?, ff_uid = ?, updated_at = datetime('now') WHERE id = ?`,
      [name.trim(), ff_ign ? ff_ign.trim() : null, ff_uid ? ff_uid.trim() : null, req.user.id]
    );

    // Update or insert user_profiles table
    const profileExists = await db.get('SELECT id FROM user_profiles WHERE user_id = ?', [req.user.id]);
    if (profileExists) {
      await db.run(
        `UPDATE user_profiles SET bio = ?, avatar_url = ?, address = ?, city = ?, state = ?, pincode = ?, updated_at = datetime('now') WHERE user_id = ?`,
        [bio || null, avatar_url || null, address || null, city || null, state || null, pincode || null, req.user.id]
      );
    } else {
      await db.run(
        `INSERT INTO user_profiles (id, user_id, bio, avatar_url, address, city, state, pincode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['prof-' + req.user.id, req.user.id, bio || null, avatar_url || null, address || null, city || null, state || null, pincode || null]
      );
    }

    const updatedUser = await db.get(
      `SELECT u.id, u.name, u.email, u.mobile, u.ff_ign, u.ff_uid, u.role, u.wallet_balance, u.winning_balance, u.status,
              p.bio, p.avatar_url, p.address, p.city, p.state, p.pincode
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = ?`,
      [req.user.id]
    );

    return res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: updatedUser
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// ============================================================
// 11. CHANGE PASSWORD (LOGGED IN)
// ============================================================
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const currentPassword = req.body.currentPassword || req.body.oldPassword;
    const { newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const match = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Incorrect current password.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    await db.run(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      [newHash, req.user.id]
    );

    return res.json({ success: true, message: 'Password changed successfully!' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to change password.' });
  }
});

module.exports = router;
