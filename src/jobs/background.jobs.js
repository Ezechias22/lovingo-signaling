const { clients, rooms, liveRooms } = require('../state/store');
const { RENDER_URL } = require('../config');
const { handleDisconnection } = require('../websocket/handlers');

function setupBackgroundJobs(wss) {
  if (process.env.NODE_ENV === 'production') {
    console.log(`🏥 Activation du keep-alive avancé pour: ${RENDER_URL}`);

    setInterval(async () => {
      try {
        const fetch = require('node-fetch');
        const endpoints = ['/health', '/ping', '/keepalive', '/', '/test', '/live/health'];

        for (const endpoint of endpoints) {
          const url = `${RENDER_URL}${endpoint}`;
          try {
            const response = await fetch(url, { timeout: 5000 });
            console.log(`🏥 Keep-alive ${endpoint}: ${response.status}`);
          } catch (e) {
            console.error(`❌ Keep-alive ${endpoint} failed:`, e.message);
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error('❌ Keep-alive system error:', error);
      }
    }, 4 * 60 * 1000);

    setInterval(() => {
      wss.clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      });
      console.log(`♻️ Ping WebSocket envoyé à ${wss.clients.size} clients`);
    }, 30000);
  }

  setInterval(() => {
    const now = new Date();
    let cleanedClients = 0;

    clients.forEach((client, ws) => {
      const timeSinceHeartbeat = now - client.lastHeartbeat;
      if (timeSinceHeartbeat > 120000) {
        console.log(`🧹 Nettoyage client inactif: ${client.userId || client.id}`);
        ws.terminate();
        handleDisconnection(ws);
        cleanedClients++;
      }
    });

    if (cleanedClients > 0) {
      console.log(`🧹 ${cleanedClients} clients inactifs nettoyés`);
    }
  }, 60000);

  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('💀 Connexion WebSocket morte détectée, terminaison...');
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  setInterval(() => {
    const stats = {
      clients: clients.size,
      rooms: rooms.size,
      lives: liveRooms.size,
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };

    console.log(
      `📊 Stats: ${stats.clients} clients, ${stats.rooms} rooms, ${stats.lives} lives, ${stats.memory}MB RAM, ${stats.uptime}s uptime`
    );
  }, 5 * 60 * 1000);
}

module.exports = {
  setupBackgroundJobs,
};