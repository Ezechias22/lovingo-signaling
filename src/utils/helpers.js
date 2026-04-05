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
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      return { ws, client };
    }
  }
  return null;
}

function getUserIdFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const fakeUserId = req.headers['x-user-id'];

  if (fakeUserId) return String(fakeUserId);

  if (authHeader.startsWith('Bearer ')) {
    return 'authenticated_user';
  }

  return null;
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