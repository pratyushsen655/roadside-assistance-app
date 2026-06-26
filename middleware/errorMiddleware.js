const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  process.stderr.write(`[Error] ${req.method} ${req.originalUrl} | ${statusCode} | ${message}\n`);

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || [],
    statusCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
