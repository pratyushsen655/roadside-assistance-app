const { validationResult } = require('express-validator');

/**
 * Validation result middleware for express-validator.
 * If validation fails, responds with the global error format:
 *   { success: false, message, errors, statusCode }
 */
module.exports = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({ param: err.param, msg: err.msg })),
      statusCode: 400,
    });
  }
  next();
};
