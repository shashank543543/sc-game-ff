require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'sc_gameing_default_secret_key_change_in_production_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  
  // Admin & Owner Settings
  admin: {
    email: process.env.ADMIN_EMAIL || 'shas86728@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@SC123',
    name: process.env.ADMIN_NAME || 'SC GAMEING Admin',
    upi: process.env.ADMIN_UPI || '6363440966@apl'
  },
  
  // Database Config
  db: {
    url: process.env.DATABASE_URL || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_KEY || ''
  },
  
  // Payment Gateway (Razorpay/UPI)
  payment: {
    upiId: process.env.ADMIN_UPI || '6363440966@apl',
    merchantName: 'SC GAMEING',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    minDepositAmount: 10,
    minWithdrawalAmount: 50,
    maxWithdrawalAmount: 10000
  },
  
  // Automated Email Dispatch Settings (Gmail: shas86728@gmail.com)
  email: {
    user: process.env.GMAIL_USER || 'shas86728@gmail.com',
    appPassword: process.env.GMAIL_APP_PASSWORD || '',
    fromAddress: `"SC GAMEING Admin" <${process.env.GMAIL_USER || 'shas86728@gmail.com'}>`
  },
  
  uploadDir: process.env.UPLOAD_DIR || 'public/uploads'
};
