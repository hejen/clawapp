// server/middleware.js

// CORS middleware
export function corsMiddleware(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins === '*' || allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    next();
  };
}

// Error handler middleware
export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}

// Request logging middleware
export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}
