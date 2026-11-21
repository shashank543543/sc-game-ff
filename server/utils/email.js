/**
 * SC GAMEING - Secure Email Service (Nodemailer Gmail SMTP)
 * 
 * Credentials stored securely in backend environment variables:
 * - GMAIL_USER
 * - GMAIL_APP_PASSWORD
 * 
 * Never expose Gmail credentials in frontend code, public APIs, or responses.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

let transporter = null;
let lastTestOtpByEmail = {};

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : null;
  const pass = process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '').trim() : null;
  const smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : null;
  const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : null;
  const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : null;

  if (smtpHost && smtpUser && smtpPass) {
    const port = Number(process.env.SMTP_PORT) || 587;
    const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure: isSecure,
      auth: { user: smtpUser, pass: smtpPass }
    });
    console.log(`📧 Email Service: Connected to custom SMTP at ${smtpHost}:${port}`);
  } else if (user && pass) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
    console.log(`📧 Email Service: Connected to Gmail SMTP for ${user}`);
  } else {
    // Development / Offline Fallback Transporter
    transporter = nodemailer.createTransport({
      jsonTransport: true
    });
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ [EMAIL NOTICE]: GMAIL_USER and GMAIL_APP_PASSWORD not configured. Live OTP emails require a Gmail App Password.');
    }
  }

  return transporter;
}

/**
 * Send 6-Digit Verification Code Email
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.otp - 6-digit verification code
 * @param {string} options.role - 'admin' or 'user'
 */
async function sendOtpEmail({ to, otp, role = 'user' }) {
  const client = getTransporter();

  const senderEmail = process.env.GMAIL_USER || 'shas86728@gmail.com';
  const fromAddress = `"SC GAMEING Admin" <${senderEmail}>`;

  const subject = role === 'admin'
    ? '🔒 [ADMIN SECURITY] SC GAMEING - 5-Minute Admin Verification Code'
    : '🔐 Your SC GAMEING 5-Minute Verification Code';

  const title = role === 'admin' ? 'SC GAMEING Admin Console' : 'SC GAMEING Esports';
  const subtitle = role === 'admin' ? 'Admin Password Reset Request' : 'Password Reset Verification';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0e14; color: #e2e8f0; margin: 0; padding: 24px; }
    .card { max-width: 480px; margin: 0 auto; background: #131a26; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .logo { font-size: 20px; font-weight: 900; color: #ff5100; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .code-box { background: #0b0e14; border: 2px dashed #ff5100; border-radius: 8px; padding: 18px; text-align: center; font-size: 32px; font-weight: 900; letter-spacing: 10px; color: #ffffff; font-family: 'Courier New', Courier, monospace; margin: 24px 0; }
    .warning { font-size: 12px; color: #94a3b8; line-height: 1.6; margin-top: 16px; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px; }
    .footer { font-size: 11px; color: #64748b; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔥 ${title}</div>
    <h2 style="color: #ffffff; margin-top: 0; font-size: 18px;">${subtitle}</h2>
    <p style="font-size: 14px; color: #cbd5e1; line-height: 1.5;">
      A request was received to reset your account password. Enter the 6-digit verification code below:
    </p>
    <div class="code-box">${otp}</div>
    <div class="warning">
      ⏱️ <strong>This OTP expires in exactly 5 minutes.</strong><br>
      ⚠️ <strong>Never share this code with anyone.</strong> SC GAMEING staff will never ask for your verification code.
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} SC GAMEING Platform. All rights reserved.
    </div>
  </div>
</body>
</html>
  `;

  let info = { messageId: 'mock-' + Date.now() };
  try {
    info = await client.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
      text: `Your SC GAMEING verification code is: ${otp}. It expires in 5 minutes.`
    });
  } catch (err) {
    console.error('❌ [EMAIL DISPATCH ERROR]:', err.message);
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Unable to deliver verification code to your email. Please try again shortly or contact support.');
    }
  }

  // Store only for in-memory test suite verification when testing locally
  lastTestOtpByEmail[to.toLowerCase()] = {
    otp,
    createdAt: Date.now()
  };

  // Cross-process test runner synchronization in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    try {
      const fs = require('fs');
      const testOtpsPath = path.join(__dirname, '..', '..', 'data', '.test_otps.json');
      let existing = {};
      if (fs.existsSync(testOtpsPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(testOtpsPath, 'utf8') || '{}');
        } catch (_) {
          existing = {};
        }
      }
      existing[to.toLowerCase()] = { otp, createdAt: Date.now() };
      fs.writeFileSync(testOtpsPath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (err) {
      console.error('[EMAIL DISPATCH WRITE ERROR]:', err);
    }
  }

  return { success: true, messageId: info.messageId };
}

// Test-only helper to inspect OTP in automated unit tests
function getTestOtpForEmail(email) {
  const normalized = (email || '').toLowerCase();
  const item = lastTestOtpByEmail[normalized];
  if (item) return item.otp;

  try {
    const fs = require('fs');
    const testOtpsPath = path.join(__dirname, '..', '..', 'data', '.test_otps.json');
    if (fs.existsSync(testOtpsPath)) {
      const data = JSON.parse(fs.readFileSync(testOtpsPath, 'utf8') || '{}');
      if (data[normalized]) return data[normalized].otp;
    }
  } catch (err) {
    console.error('[getTestOtpForEmail error]:', err);
  }

  return null;
}

module.exports = {
  sendOtpEmail,
  getTestOtpForEmail
};
