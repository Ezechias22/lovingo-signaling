const http = require('http');
const { createApp } = require('./app');
const { createWebSocketServer } = require('./websocket/setup');
const { setupBackgroundJobs } = require('./jobs/background.jobs');
const { setupProcessHandlers } = require('./shutdown/gracefulShutdown');
const {
  PORT,
  RENDER_URL,
  PLAYSTORE_URL,
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
} = require('./config');

const app = createApp();
const server = http.createServer(app);
const wss = createWebSocketServer(server);

setupBackgroundJobs(wss);
setupProcessHandlers(server, wss);

server.listen(PORT, () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const localBaseUrl = `http://localhost:${PORT}`;
  const wsProtocol = isProduction ? 'wss' : 'ws';
  const publicBaseUrl = RENDER_URL || localBaseUrl;

  console.log('🚀 ===============================================');
  console.log('🚀 Serveur Lovingo Complet v2.2.0');
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 Environment: ${nodeEnv}`);
  console.log(`🚀 HTTP local: ${localBaseUrl}`);
  console.log(`🚀 WebSocket local: ${wsProtocol}://localhost:${PORT}`);
  console.log(`🚀 Public URL: ${publicBaseUrl}`);
  console.log(`🚀 API: ${publicBaseUrl}/api/*`);
  console.log(`🚀 Live API: ${publicBaseUrl}/live/*`);
  console.log(`🚀 Health: ${publicBaseUrl}/health`);
  console.log(`🚀 Live Health: ${publicBaseUrl}/live/health`);
  console.log(`🚀 Stats: ${publicBaseUrl}/stats`);
  console.log(`🚀 Play Store: ${PLAYSTORE_URL}`);
  console.log(
    `🚀 LiveKit configuré: ${
      LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? 'OUI' : 'NON'
    }`
  );

  if (LIVEKIT_URL) {
    console.log(`🚀 LiveKit URL: ${LIVEKIT_URL}`);
  }

  console.log('🚀 ===============================================');
});

server.on('error', (error) => {
  console.error('❌ Erreur démarrage serveur:', error);

  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Le port ${PORT} est déjà utilisé`);
  } else if (error.code === 'EACCES') {
    console.error(`❌ Permission refusée pour le port ${PORT}`);
  }

  process.exit(1);
});

module.exports = { app, server, wss };