const rateLimit = require('express-rate-limit');

/**
 * Rate limiter: max 100 requests per 15 minutes per IP.
 * In development we can disable it by setting NODE_ENV !== 'production'.
 */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true, // Return rate limit info in the RateLimit-* headers
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    errors: [],
    statusCode: 429
  },
  // Apply only in production for stricter security
  skip: () => process.env.NODE_ENV !== 'production'
});

module.exports = limiter;
