const { sendMessage } = require('../utils/helpers');

function gracefulShutdown(server, wss) {
  console.log('🛑 Démarrage arrêt gracieux...');

  wss.clients.forEach((ws) => {
    sendMessage(ws, {
      type: 'serverShutdown',
      from: 'server',
      data: { message: 'Serveur en cours de redémarrage' },
    });
    ws.close();
  });

  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('❌ Force quit après timeout');
    process.exit(1);
  }, 10000);
}

function setupProcessHandlers(server, wss) {
  process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non gérée:', error);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });

  process.on('SIGINT', () => {
    console.log('🛑 Signal SIGINT reçu, arrêt du serveur...');
    gracefulShutdown(server, wss);
  });

  process.on('SIGTERM', () => {
    console.log('🛑 Signal SIGTERM reçu, arrêt du serveur...');
    gracefulShutdown(server, wss);
  });
}

module.exports = {
  gracefulShutdown,
  setupProcessHandlers,
};