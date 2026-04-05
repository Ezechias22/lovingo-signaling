const WebSocket = require('ws');
const { clients } = require('../state/store');
const { generateClientId, sendMessage, sendError } = require('../utils/helpers');
const { handleMessage, handleDisconnection } = require('./handlers');

function createWebSocketServer(server) {
  const wss = new WebSocket.Server({
    server,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  });

  wss.on('connection', (ws, req) => {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const clientIP =
      req.connection.remoteAddress ||
      req.headers['x-forwarded-for'] ||
      'Unknown';

    console.log(
      `📱 Nouvelle connexion: ${clientIP} (${userAgent.substring(0, 50)})`
    );

    const clientInfo = {
      id: generateClientId(),
      userId: null,
      roomId: null,
      connectedAt: new Date(),
      isHost: false,
      lastHeartbeat: new Date(),
      userAgent,
      ip: clientIP,
    };

    clients.set(ws, clientInfo);

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      const client = clients.get(ws);
      if (client) {
        client.lastHeartbeat = new Date();
      }
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        await handleMessage(ws, message);
      } catch (error) {
        console.error('❌ Erreur parsing message:', error);
        sendError(ws, 'Message invalide');
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`📱 Connexion fermée: ${code} - ${reason}`);
      handleDisconnection(ws);
    });

    ws.on('error', (error) => {
      console.error('❌ Erreur WebSocket:', error);
      handleDisconnection(ws);
    });

    sendMessage(ws, {
      type: 'connected',
      from: 'server',
      to: clientInfo.id,
      data: {
        clientId: clientInfo.id,
        serverTime: new Date().toISOString(),
        version: '2.1.0',
      },
    });
  });

  return wss;
}

module.exports = {
  createWebSocketServer,
};