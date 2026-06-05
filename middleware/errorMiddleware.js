const errorHandler = (err, req, res, next) => {
  const { statusCode = 500, message } = err;

  console.error(`[Error] ${message}`);

  res.status(statusCode).json({
    success: false,
    message: message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
