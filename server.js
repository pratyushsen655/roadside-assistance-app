const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();
const connectDB = require('./config/db');
const socketHandler = require('./sockets/socketHandler');
const errorHandler = require('./middleware/errorMiddleware');
const securityHeaders = require('./middleware/securityHeaders');
const rateLimiter = require('./middleware/rateLimiter');
const apiKeyRotation = require('./middleware/apiKeyRotation');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');

// Load configurations (already called above; removed duplicate dotenv.config() call)

// Connect to MongoDB Database
connectDB();

const app = express();
app.set('trust proxy', 1); // trust first proxy
const server = http.createServer(app);

// Configure Socket.io
const io = new SocketServer(server, {
  cors: {
    origin: '*', // Allow all origins for dev mobility. Lock down in production.
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization'],
    credentials: true
  }
});

// Initialize Socket.io Connection Handlers
socketHandler.initSocketServer(io);

// Global Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.includes('vercel.app') || origin.includes('railway.app')) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true
}));

// Security middlewares
app.use(securityHeaders);
app.use(rateLimiter);
app.use(mongoSanitize());
app.use(xssClean());
app.use(apiKeyRotation);

app.use((req, res, next) => {
  /** @type {any} */ (req).io = io;
  next();
});

// Body parsers with size limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Log incoming REST requests in development only
if (process.env.NODE_ENV === 'development') {
  const morgan = require('morgan');
  app.use(morgan('dev'));
}

// Welcome Endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'RescueMe Roadside Assistance API Server is running',
    version: '1.0.0',
    status: 'online'
  });
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: Date.now()
  });
});

// Import API Routers
const authRoutes = require('./routes/authRoutes');
const mechanicAuthRoutes = require('./routes/mechanicAuthRoutes');
const userRoutes = require('./routes/userRoutes');
const mechanicRoutes = require('./routes/mechanicRoutes');
const requestRoutes = require('./routes/requestRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const referralRoutes = require('./routes/referralRoutes');
const ratingRoutes = require('./routes/ratingRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');

// Mount API Routers
app.use('/api/auth', authRoutes);
app.use('/api/sos', require('./routes/sos'));
app.use('/api/mechanic/auth', mechanicAuthRoutes);
app.use('/api/users', userRoutes);
app.use('/api/mechanics', mechanicRoutes);
app.use('/api/mechanic', mechanicRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/servicerequests', requestRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/address', require('./routes/address'));

// Catch-all route handler for 404
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Global Centralized Error Middleware
app.use(errorHandler);

// Define running port
const PORT = process.env.PORT || 5000;

// Only bind to port when run directly (not when imported by tests)
let serverInstance;
if (require.main === module) {
  serverInstance = server.listen(PORT, () => {
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write(`\n[API Server] ${process.env.NODE_ENV || 'development'} mode · port ${PORT}\n`);
    }
  });
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[CRITICAL] Unhandled Rejection: ${message}\n`);
  if (serverInstance) serverInstance.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[CRITICAL] Uncaught Exception: ${err.message}\n`);
  process.exit(1);
});

// Export app and server for testing
module.exports = app;
module.exports.server = server;

