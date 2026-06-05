const helmet = require('helmet');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
});

module.exports = securityHeaders;
