/**
 * SC GAMEING - Backend-Only OTP Management Service
 * 
 * Rules:
 * - 6-digit cryptographically secure OTP
 * - Stored ONLY as bcrypt hash in password_reset_otps table
 * - Expires in 5 minutes
 * - Resend cooldown: 60 seconds
 * - Maximum 5 verification attempts
 * - Invalidate OTP after successful verification
 * - Never return OTP in API responses
 * - Never display OTP on frontend
 * - Never log OTP in console or logs
 * - Never store OTP as plain text
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { sendOtpEmail } = require('../utils/email');

const OTP_EXPIRY_MS = 5 * 60 * 1000;       // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;      // 60 seconds
const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Request and issue a password reset OTP
 */
async function generateAndSendResetOtp(email, role = 'user') {
  const cleanEmail = email.toLowerCase().trim();

  // Check 60-second cooldown on existing active OTP
  const existingOtp = await db.get(
    `SELECT id, resend_after, expires_at, attempts, is_used FROM password_reset_otps 
     WHERE email = ? AND is_used = 0
     ORDER BY created_at DESC LIMIT 1`,
    [cleanEmail]
  );

  if (existingOtp) {
    const expiresDate = new Date(existingOtp.expires_at);
    const cooldownDate = new Date(existingOtp.resend_after);
    const now = new Date();
    if (expiresDate > now && cooldownDate > now) {
      const remainingSeconds = Math.ceil((cooldownDate.getTime() - now.getTime()) / 1000);
      const err = new Error(`Please wait ${remainingSeconds} seconds before requesting a new verification code.`);
      err.statusCode = 429;
      throw err;
    }
  }

  // Generate cryptographically secure 6-digit OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();

  // Hash OTP with bcrypt before storing
  const salt = bcrypt.genSaltSync(10);
  const otpHash = bcrypt.hashSync(rawOtp, salt);

  const id = 'otp-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
  const resendAfter = new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString();

  // Invalidate any previous unused OTPs for this email
  await db.run(
    `UPDATE password_reset_otps SET is_used = 1 WHERE email = ? AND is_used = 0`,
    [cleanEmail]
  );

  // Store hashed OTP
  await db.run(
    `INSERT INTO password_reset_otps (id, email, role, otp_hash, attempts, resend_after, expires_at, is_used)
     VALUES (?, ?, ?, ?, 0, ?, ?, 0)`,
    [id, cleanEmail, role, otpHash, resendAfter, expiresAt]
  );

  // Send email via Nodemailer
  await sendOtpEmail({
    to: cleanEmail,
    otp: rawOtp,
    role
  });

  return {
    success: true,
    message: 'A 6-digit verification code has been sent to your email address.'
  };
}

/**
 * Verify a submitted 6-digit OTP
 */
async function verifyResetOtp(email, submittedOtp) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanOtp = String(submittedOtp || '').trim();

  if (!cleanOtp || cleanOtp.length !== 6) {
    throw new Error('Please enter a valid 6-digit verification code.');
  }

  // Look up latest active OTP record for this email
  const record = await db.get(
    `SELECT * FROM password_reset_otps 
     WHERE email = ? AND is_used = 0
     ORDER BY created_at DESC LIMIT 1`,
    [cleanEmail]
  );

  if (!record) {
    throw new Error('No active verification code found for this email. Please request a new code.');
  }

  // Check expiration (5 minutes)
  const now = new Date();
  if (new Date(record.expires_at) < now) {
    await db.run(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [record.id]);
    throw new Error('Verification code has expired. Please request a new code.');
  }

  // Check maximum verification attempts (5)
  if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    await db.run(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [record.id]);
    throw new Error('Maximum verification attempts exceeded. Please request a new code.');
  }

  // Compare submitted OTP against the stored bcrypt hash
  const isValid = bcrypt.compareSync(cleanOtp, record.otp_hash);

  if (!isValid) {
    const newAttempts = record.attempts + 1;
    const remaining = MAX_VERIFICATION_ATTEMPTS - newAttempts;

    if (newAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      await db.run(`UPDATE password_reset_otps SET attempts = ?, is_used = 1 WHERE id = ?`, [newAttempts, record.id]);
      throw new Error('Maximum verification attempts exceeded. Please request a new code.');
    } else {
      await db.run(`UPDATE password_reset_otps SET attempts = ? WHERE id = ?`, [newAttempts, record.id]);
      throw new Error(`Invalid verification code. You have ${remaining} attempt(s) remaining.`);
    }
  }

  // Invalidate OTP immediately upon successful verification
  await db.run(`UPDATE password_reset_otps SET is_used = 1 WHERE id = ?`, [record.id]);

  // Issue temporary signed reset_token (valid for 10 minutes) with unique jti for single-use protection
  const tokenId = 'rst-' + crypto.randomBytes(8).toString('hex');
  const resetToken = jwt.sign(
    {
      jti: tokenId,
      email: cleanEmail,
      role: record.role,
      purpose: 'PASSWORD_RESET'
    },
    config.jwtSecret,
    { expiresIn: '10m' }
  );

  // Store active reset token in user record for single-use verification
  await db.run(
    `UPDATE users SET reset_token = ?, reset_token_expiry = datetime('now', '+10 minutes') WHERE email = ?`,
    [tokenId, cleanEmail]
  );

  return {
    success: true,
    message: 'Verification code confirmed. You may now reset your password.',
    resetToken
  };
}

module.exports = {
  generateAndSendResetOtp,
  verifyResetOtp
};
