function errorHandler(err, req, res, next) {
  console.error('Unhandled Application Error:', err);

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ success: false, message: 'Invalid token or unauthorized access.' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON payload.' });
  }

  return res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error occurred.',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}

module.exports = errorHandler;
