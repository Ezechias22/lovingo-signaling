const WebSocket = require('ws');
const { clients } = require('../state/store');
const { generateClientId, sendMessage, sendError } = require('../utils/helpers');
const { handleMessage, handleDisconnection } = require('./handlers');

function extractUserIdFromRequest(req) {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const userId = url.searchParams.get('userId');
    return userId ? String(userId) : null;
  } catch (error) {
    console.error('❌ Erreur lecture userId depuis URL websocket:', error);
    return null;
  }
}

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
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      req.headers['x-forwarded-for'] ||
      'Unknown';

    const userIdFromQuery = extractUserIdFromRequest(req);

    console.log(
      `📱 Nouvelle connexion: ${clientIP} (${String(userAgent).substring(0, 50)})`
    );
    console.log(`🆔 userId websocket détecté: ${userIdFromQuery || 'AUCUN'}`);

    const clientInfo = {
      id: generateClientId(),
      userId: userIdFromQuery,
      roomId: null,
      connectedAt: new Date(),
      isHost: false,
      liveRole: null,
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
      to: clientInfo.userId || clientInfo.id,
      data: {
        clientId: clientInfo.id,
        userId: clientInfo.userId,
        serverTime: new Date().toISOString(),
        version: '2.1.1',
      },
    });

    console.log(
      `✅ Socket enregistré: clientId=${clientInfo.id} | userId=${clientInfo.userId || 'null'}`
    );
  });

  return wss;
}

module.exports = {
  createWebSocketServer,
};