const QRCode = require('qrcode');
const config = require('../config');

/**
 * Generate a standard UPI payment URI and high-res QR code
 * Spec: upi://pay?pa=<UPI_ID>&pn=<NAME>&am=<AMOUNT>&cu=INR&tn=<NOTE>&tr=<REF_ID>
 */
async function generateUpiQr({ amount, referenceId, note }) {
  const upiId = config.payment.upiId; // 6363440966@apl
  const merchantName = config.payment.merchantName; // SC GAMEING
  const formattedAmount = Number(amount).toFixed(2);
  const transactionNote = note || `SCG Deposit ${referenceId}`;

  // Standard NPCI UPI URI Scheme
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${formattedAmount}&cu=INR&tn=${encodeURIComponent(transactionNote)}&tr=${encodeURIComponent(referenceId)}`;

  // Generate Base64 Data URL for display on web & mobile
  const qrDataUrl = await QRCode.toDataURL(upiUri, {
    errorCorrectionLevel: 'H',
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    },
    width: 320
  });

  return {
    upiUri,
    qrDataUrl,
    upiId,
    merchantName,
    amount: formattedAmount,
    referenceId
  };
}

module.exports = {
  generateUpiQr
};
