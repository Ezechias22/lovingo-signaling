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
  console.log('🚀 ===============================================');
  console.log('🚀 Serveur Lovingo Complet v2.2.0');
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 WebSocket: ws://localhost:${PORT}`);
  console.log(`🚀 Website: http://localhost:${PORT}`);
  console.log(`🚀 API: http://localhost:${PORT}/api/*`);
  console.log(`🚀 Live API: http://localhost:${PORT}/live/*`);
  console.log(`🚀 Health: ${RENDER_URL}/health`);
  console.log(`🚀 Live Health: ${RENDER_URL}/live/health`);
  console.log(`🚀 Stats: ${RENDER_URL}/stats`);
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

module.exports = { app, server, wss };