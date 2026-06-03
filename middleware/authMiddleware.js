const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Mechanic = require('../models/Mechanic');

/**
 * Protect routes - Verification of JWT
 */
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this resource. Token missing.'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_jwt_secret_token_12345');

    // Attach account object to request based on role
    if (decoded.role === 'customer' || decoded.role === 'admin') {
      const user = await User.findById(decoded.id).select('-otp');
      if (!user) {
        return res.status(401).json({ success: false, message: 'User account no longer exists.' });
      }
      if (user.isBlocked) {
        return res.status(403).json({ success: false, message: 'Your account is blocked.' });
      }
      req.user = user; // Attach mongoose model
    } else if (decoded.role === 'mechanic') {
      const mechanic = await Mechanic.findById(decoded.id).select('-otp');
      if (!mechanic) {
        return res.status(401).json({ success: false, message: 'Mechanic account no longer exists.' });
      }
      if (mechanic.isBlocked) {
        return res.status(403).json({ success: false, message: 'Your account is blocked.' });
      }
      req.user = mechanic;
    }

    req.authInfo = decoded; // Raw decoded token info: { id, role }
    next();
  } catch (error) {
    console.error('[Auth Middleware] JWT Verification failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this resource. Invalid token.'
    });
  }
};

/**
 * Limit access to specific roles
 * @param {...string} roles - Approved roles ('customer', 'mechanic', 'admin')
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.authInfo || !roles.includes(req.authInfo.role)) {
      return res.status(403).json({
        success: false,
        message: `Role (${req.authInfo ? req.authInfo.role : 'none'}) is not authorized to access this endpoint.`
      });
    }
    next();
  };
};

module.exports = {
  protect,
  restrictTo
};
