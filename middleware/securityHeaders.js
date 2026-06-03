const helmet = require('helmet');

/**
 * Apply Helmet security headers with sensible defaults.
 * In production we enable CSP, HSTS, DNS prefetch control, etc.
 */
module.exports = helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"] ,
      styleSrc: ["'self'", 'https:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'wss:']
    }
  } : false,
  referrerPolicy: { policy: 'no-referrer' },
  hidePoweredBy: true,
});
