// signaling_server/src/app.js
const express = require('express');
const cors = require('cors');
const path = require('path');

const webRoutes = require('./routes/web.routes');
const paymentRoutes = require('./routes/payment.routes');
const { stripeWebhookHandler } = require('./routes/payment.routes');
const giftRoutes = require('./routes/gift.routes');
const liveRoutes = require('./routes/live.routes');
const systemRoutes = require('./routes/system.routes');
const pushRoutes = require('./routes/push.routes');
const publicIdRoutes = require('./routes/public-id.routes');
const fraudAdminRoutes = require('./routes/fraud-admin.routes');
const adminRoutes = require('./routes/admin.routes');
const pkRoutes = require('./routes/pk.routes');

const mercadopagoRoutes = require('./routes/mercadopago.routes');
const paypalRoutes = require('./routes/paypal.routes');
const googleplayRoutes = require('./routes/googleplay.routes');
const paypalCheckoutPageRoutes = require('./routes/paypal-checkout-page.routes');

function createCorsOptions() {
  const baseOrigins = [
    'https://lovingosocial.com',
    'https://www.lovingosocial.com',
    'https://lovingo-signaling.onrender.com',
    'https://lovingo.app',
    'https://www.lovingo.app',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
    'https://www.paypal.com',
    'https://www.sandbox.paypal.com',
    'https://www.mercadopago.com',
  ];

  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const allowedOrigins = new Set([...baseOrigins, ...envOrigins]);

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      console.warn(`⚠️ CORS refusé pour origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-admin-secret'],
    credentials: false,
  };
}

function registerCoreMiddlewares(app) {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors(createCorsOptions()));

  // ⚠️ Webhook Stripe DOIT être avant express.json()
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    stripeWebhookHandler
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
}

function registerRoutes(app) {
  // 🔴 IMPORTANT : Les routes API DOIVENT être enregistrées AVANT webRoutes
  // car webRoutes contient des patterns "catch-all" comme /live/:roomId
  // qui matcheraient sinon /live/rooms, /live/health, etc.

  // ============================================
  // 1️⃣ ROUTES API (en premier)
  // ============================================
  app.use(paymentRoutes);
  app.use(giftRoutes);
  app.use(publicIdRoutes);
  app.use(fraudAdminRoutes);
  app.use(adminRoutes);
  app.use(liveRoutes);      // ✅ /live/rooms, /live/health, /live/rooms/:id, etc.
  app.use(pkRoutes);

  // Intégrations de paiement
  app.use(mercadopagoRoutes);
  app.use(paypalRoutes);
  app.use(googleplayRoutes);
  app.use(paypalCheckoutPageRoutes);

  app.use(systemRoutes);
  app.use('/api/push', pushRoutes);

  // ============================================
  // 2️⃣ ROUTES WEB (HTML) — EN DERNIER
  // ============================================
  // ⚠️ webRoutes contient /live/:roomId (page de partage HTML)
  // qui doit être enregistré APRÈS toutes les routes API /live/*
  app.use(webRoutes);
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
        origin: req.headers.origin || null,
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
