const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Initialize database
db.initDatabase();

const app = express();
const server = http.createServer(app);

// Socket.IO for real-time updates (Room ID release, slot counters, live match state)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e7
});

// Attach socket.io instance to req for routes to emit events
app.set('io', io);

// Security & Middlewares
app.use(helmet({
  contentSecurityPolicy: false // Allows inline scripts & Google fonts & FontAwesome
}));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiter & ensure DB schema/seeding is ready for all API calls
app.use('/api', apiLimiter);
app.use('/api', async (req, res, next) => {
  try {
    await db.ensureReady();
  } catch (err) {
    console.warn('DB ensureReady warning:', err.message);
  }
  next();
});

// Serve static assets with high-performance caching for 50k users
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads'), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// Routes
const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournaments');
const walletRoutes = require('./routes/wallet');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhook');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const supportRoutes = require('./routes/support');
const notificationRoutes = require('./routes/notifications');

app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let dbConnected = false;
  let dbError = null;
  try {
    await db.get('SELECT 1 as ok');
    dbConnected = true;
  } catch (err) {
    dbError = err.message;
  }
  res.json({
    status: 'ONLINE',
    platform: 'SC GAMEING',
    timestamp: new Date().toISOString(),
    database: db.getDbType(),
    dbConnected,
    ...(dbError ? { dbError } : {})
  });
});

// Dedicated User Authentication Pages
app.get(['/login', '/register', '/forgot-password', '/verify-otp', '/reset-password'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
});

// Dedicated Admin Authentication Pages
app.get(['/admin/login', '/admin/forgot-password', '/admin/verify-otp', '/admin/reset-password'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-auth.html'));
});

// Admin Dashboard
app.get(['/admin', '/admin/dashboard'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Catch-all for API routes: ALWAYS return JSON, NEVER return index.html!
app.all('/api/*', (req, res) => {
  return res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Centralized error handling
app.use(errorHandler);

// Socket.io connection handling
io.on('connection', (socket) => {
  // Authenticated user private channel (for room credentials push notifications)
  socket.on('authenticate_user', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
    }
  });

  // Join tournament specific room for instant updates
  socket.on('join_tournament_room', (tournamentId) => {
    socket.join(`tournament_${tournamentId}`);
  });

  socket.on('leave_tournament_room', (tournamentId) => {
    socket.leave(`tournament_${tournamentId}`);
  });

  // Live Customer Support Chat Handlers
  socket.on('join_support_conversation', (convId) => {
    if (convId) {
      socket.join(`support_${convId}`);
    }
  });

  socket.on('leave_support_conversation', (convId) => {
    if (convId) {
      socket.leave(`support_${convId}`);
    }
  });

  socket.on('join_admin_support', () => {
    socket.join('admin_support');
  });

  socket.on('typing_start', (data) => {
    if (data && data.conversationId) {
      socket.to(`support_${data.conversationId}`).emit('typing_indicator', {
        conversationId: data.conversationId,
        senderName: data.senderName || 'Someone',
        senderType: data.senderType || 'USER',
        isTyping: true
      });
    }
  });

  socket.on('typing_stop', (data) => {
    if (data && data.conversationId) {
      socket.to(`support_${data.conversationId}`).emit('typing_indicator', {
        conversationId: data.conversationId,
        isTyping: false
      });
    }
  });
});

// Start Server
const PORT = process.env.PORT || config.port || 5000;

function getLanIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (e) {}
  return '127.0.0.1';
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const lanIp = getLanIp();
    console.log(`=======================================================`);
    console.log(`🔥 SC GAMEING - Free Fire Tournament Platform is LIVE!`);
    console.log(`🏠 Local URL:        http://localhost:${PORT}`);
    console.log(`🌐 Network (LAN):    http://${lanIp}:${PORT}`);
    console.log(`👑 Admin Local:      http://localhost:${PORT}/admin`);
    console.log(`👑 Admin LAN:        http://${lanIp}:${PORT}/admin`);
    console.log(`💳 UPI Gateway:      Direct Dynamic UPI & Automated Verification (6363440966@apl)`);
    console.log(`🛡️ Security:         Authorized Admin: Configured & Secured`);
    console.log(`=======================================================`);
  });
}

// Crash protection for high concurrency & 50k users resilience
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

// Export for Vercel Serverless & Tests
module.exports = app;
module.exports.app = app;
module.exports.server = server;
module.exports.io = io;
