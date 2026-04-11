const WebSocket = require('ws');
const {
  liveRooms,
  liveJoinRequests,
  rooms,
  clients,
} = require('../state/store');

function generateClientId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

function sendMessage(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('❌ Erreur envoi message:', error);
    }
  }
}

function sendError(ws, error) {
  sendMessage(ws, {
    type: 'error',
    from: 'server',
    to: 'client',
    data: {
      error,
      timestamp: new Date().toISOString(),
    },
  });
}

function broadcastToRoom(roomId, message, excludeWs = null) {
  if (!rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  let sentCount = 0;

  room.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      sendMessage(ws, message);
      sentCount++;
    }
  });

  console.log(`📡 Message broadcast dans ${roomId} à ${sentCount} clients`);
}

function findClientByUserId(userId) {
  for (const [ws, client] of clients.entries()) {
    if (
      String(client.userId) === String(userId) &&
      ws.readyState === WebSocket.OPEN
    ) {
      return { ws, client };
    }
  }
  return null;
}

function _safeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function _decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;

    let payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    while (payload.length % 4 !== 0) {
      payload += '=';
    }

    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    console.warn('⚠️ Impossible de décoder le JWT:', error.message);
    return null;
  }
}

function getUserIdFromRequest(req) {
  try {
    if (!req) return null;

    const fakeUserId = _safeString(req.headers?.['x-user-id']);
    if (fakeUserId) {
      return fakeUserId;
    }

    const requestUserId =
      _safeString(req.user?.uid) ||
      _safeString(req.user?.user_id) ||
      _safeString(req.user?.sub) ||
      _safeString(req.auth?.uid) ||
      _safeString(req.auth?.user_id);

    if (requestUserId) {
      return requestUserId;
    }

    const authHeader = _safeString(req.headers?.authorization) || '';
    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring('Bearer '.length).trim();
    if (!token) {
      return null;
    }

    const payload = _decodeJwtPayload(token);
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const firebaseUserId =
      _safeString(payload.user_id) ||
      _safeString(payload.uid) ||
      _safeString(payload.sub);

    if (firebaseUserId) {
      return firebaseUserId;
    }

    return null;
  } catch (error) {
    console.error('❌ Erreur getUserIdFromRequest:', error);
    return null;
  }
}

function ensureLiveRoom(roomId) {
  if (!liveRooms.has(roomId)) {
    liveRooms.set(roomId, {
      roomId,
      hostId: null,
      title: 'Live Stream',
      maxGuests: 8,
      guests: new Set(),
      viewers: new Set(),
      requests: new Set(),
      startTime: new Date(),
      stats: {
        totalViewers: 0,
        peakViewers: 0,
        totalGifts: 0,
        totalHearts: 0,
      },
      isActive: true,
    });
  }

  if (!liveJoinRequests.has(roomId)) {
    liveJoinRequests.set(roomId, []);
  }

  return liveRooms.get(roomId);
}

module.exports = {
  generateClientId,
  sendMessage,
  sendError,
  broadcastToRoom,
  findClientByUserId,
  getUserIdFromRequest,
  ensureLiveRoom,
};