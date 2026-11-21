const crypto = require('crypto');

function generateTxnId(prefix = 'TXN') {
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  const timestamp = Date.now().toString().slice(-6);
  return `SCG-${prefix}-${timestamp}${randomPart}`;
}

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

function isValidMobile(mobile) {
  const cleaned = String(mobile).replace(/\D/g, '');
  return cleaned.length === 10;
}

module.exports = {
  generateTxnId,
  isValidEmail,
  isValidMobile
};
