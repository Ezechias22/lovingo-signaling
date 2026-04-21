const express = require('express');
const cors = require('cors');
const path = require('path');

const webRoutes = require('./routes/web.routes');
const paymentRoutes = require('./routes/payment.routes');
const liveRoutes = require('./routes/live.routes');
const systemRoutes = require('./routes/system.routes');
const pushRoutes = require('./routes/push.routes');

function createCorsOptions() {
  const allowedOrigins = new Set([
    'https://lovingo.app',
    'https://www.lovingo.app',
    'http://localhost:3000',
    'http://localhost:8080',
  ]);

  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      console.warn(`⚠️ CORS refusé pour origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
    credentials: false,
  };
}

function registerCoreMiddlewares(app) {
  app.disable('x-powered-by');

  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
}

function registerRoutes(app) {
  app.use(webRoutes);
  app.use(paymentRoutes);
  app.use(liveRoutes);
  app.use(systemRoutes);

  // Push notifications
  app.use('/api/push', pushRoutes);
}

function registerErrorHandlers(app) {
  app.use((req, res) => {
    res.status(404).json({
      error: 'Route introuvable',
      method: req.method,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  });

  app.use((error, req, res, next) => {
    console.error('❌ Erreur Express non gérée:', error);

    if (error?.message === 'Not allowed by CORS') {
      return res.status(403).json({
        error: 'Origine non autorisée',
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(500).json({
      error: 'Erreur interne du serveur',
      details:
        process.env.NODE_ENV === 'production'
          ? undefined
          : error?.message || 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  });
}

function createApp() {
  const app = express();

  registerCoreMiddlewares(app);
  registerRoutes(app);
  registerErrorHandlers(app);

  return app;
}

module.exports = {
  createApp,
};