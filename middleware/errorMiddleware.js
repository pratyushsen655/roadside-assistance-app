/**
 * Global Error Handler Middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log for developers
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Express Error Block] Path: ${req.path}`, err);
  }

  // Mongoose Bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found with id of ${err.value}`;
    error = { message, statusCode: 404 };
  }

  // Mongoose Duplicate Key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered. Unique constraint failed.';
    error = { message, statusCode: 400 };
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  const response = {
    success: false,
    message: error.message || 'Server Error',
    errors: error.errors || [],
    statusCode: error.statusCode || 500
  };
  res.status(response.statusCode).json(response);
};

module.exports = errorHandler;
