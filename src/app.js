const express = require('express');
const cors = require('cors');
const path = require('path');

const webRoutes = require('./routes/web.routes');
const paymentRoutes = require('./routes/payment.routes');
const liveRoutes = require('./routes/live.routes');
const systemRoutes = require('./routes/system.routes');

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: [
        'https://lovingo.app',
        'https://www.lovingo.app',
        'http://localhost:3000',
        'http://localhost:8080',
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(webRoutes);
  app.use(paymentRoutes);
  app.use(liveRoutes);
  app.use(systemRoutes);

  return app;
}

module.exports = {
  createApp,
};