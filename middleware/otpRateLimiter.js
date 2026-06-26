const rateLimitMap = new Map(); // phone -> array of timestamps (ms)

/**
 * Middleware to limit OTP requests per phone number.
 * Allows max 3 requests per 10 minutes.
 * Responds with { success: false, message, errors, statusCode } on limit.
 */
module.exports = (req, res, next) => {
  const { phone } = req.body;
  if (!phone) {
    // Let validation middleware handle missing phone.
    return next();
  }

  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxAttempts = 3;

  const attempts = rateLimitMap.get(phone) || [];
  // Filter out timestamps older than window
  const recent = attempts.filter(ts => now - ts < windowMs);

  if (recent.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message: 'Too many OTP requests. Please try after 1 hour.',
      errors: [{ param: 'phone', msg: 'Rate limit exceeded' }],
      statusCode: 429
    });
  }

  recent.push(now);
  rateLimitMap.set(phone, recent);
  next();
};
