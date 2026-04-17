const WebSocket = require('ws');
const { clients } = require('../state/store');
const { generateClientId, sendMessage, sendError } = require('../utils/helpers');
const { handleMessage, handleDisconnection } = require('./handlers');

function extractUserIdFromRequest(req) {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const userId = url.searchParams.get('userId');
    return userId ? String(userId).trim() : null;
  } catch (error) {
    console.error('❌ Erreur lecture userId depuis URL websocket:', error);
    return null;
  }
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'Unknown'
  );
}

function startHeartbeatInterval(wss) {
  return setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        const client = clients.get(ws);
        console.warn(
          `⚠️ Socket inactif, terminaison: ${client?.userId || client?.id || 'unknown'}`
        );

        try {
          ws.terminate();
        } catch (_) {}

        continue;
      }

      ws.isAlive = false;

      try {
        ws.ping();
      } catch (error) {
        console.error('❌ Erreur envoi ping websocket:', error);
        try {
          ws.terminate();
        } catch (_) {}
      }
    }
  }, 30000);
}

function createWebSocketServer(server) {
  const wss = new WebSocket.Server({
    server,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  });

  const heartbeatInterval = startHeartbeatInterval(wss);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws, req) => {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const clientIP = getClientIp(req);
    const userIdFromQuery = extractUserIdFromRequest(req);

    console.log(
      `📱 Nouvelle connexion: ${clientIP} (${String(userAgent).substring(0, 80)})`
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
        if (!data) {
          sendError(ws, 'Message vide');
          return;
        }

        const raw = typeof data === 'string' ? data : data.toString();
        const message = JSON.parse(raw);

        if (!message || typeof message !== 'object') {
          sendError(ws, 'Message invalide');
          return;
        }

        await handleMessage(ws, message);
      } catch (error) {
        console.error('❌ Erreur parsing message:', error);
        sendError(ws, 'Message invalide');
      }
    });

    ws.on('close', (code, reasonBuffer) => {
      const reason =
          typeof reasonBuffer === 'string'
            ? reasonBuffer
            : reasonBuffer?.toString?.() || '';
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
        version: '2.2.0',
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