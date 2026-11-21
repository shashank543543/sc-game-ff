// Vercel Serverless Function Entry Point
const app = require('../server/index');

module.exports = (req, res) => {
  // Normalize URL in case Vercel rewrites stripped the /api prefix
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
};
