const rateLimit = require('express-rate-limit');

// General API limiter (tuned for high concurrency & 50k+ players)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Allow active gaming sessions & multiple players behind NAT/LAN
  message: { success: false, message: 'Too many requests from this network, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Strict limiter for authentication (protect against brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Financial transactions limiter (deposit & withdrawal)
const transactionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many transaction requests, please try again in a few minutes.' }
});

module.exports = {
  apiLimiter,
  authLimiter,
  transactionLimiter
};
