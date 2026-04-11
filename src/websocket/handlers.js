const { rooms, clients, liveRooms, liveJoinRequests } = require('../state/store');
const { MAX_CLIENTS_PER_ROOM } = require('../config');
const {
  sendMessage,
  sendError,
  broadcastToRoom,
  findClientByUserId,
  ensureLiveRoom,
  generateClientId,
} = require('../utils/helpers');

function getClientUserId(client) {
  return client?.userId ? String(client.userId) : '';
}

function removeUserFromSet(setLike, userId) {
  if (!(setLike instanceof Set) || !userId) return;

  const safeUserId = String(userId);
  const prefix = `${safeUserId}::`;

  for (const value of Array.from(setLike)) {
    const raw = String(value);
    if (raw === safeUserId || raw.startsWith(prefix)) {
      setLike.delete(value);
    }
  }
}

function setHasUser(setLike, userId) {
  if (!(setLike instanceof Set) || !userId) return false;

  const safeUserId = String(userId);
  const prefix = `${safeUserId}::`;

  for (const value of setLike) {
    const raw = String(value);
    if (raw === safeUserId || raw.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function syncLiveStats(roomId) {
  const liveRoom = liveRooms.get(roomId);
  if (!liveRoom) return;

  const viewerCount = liveRoom.viewers instanceof Set ? liveRoom.viewers.size : 0;
  const guestCount = liveRoom.guests instanceof Set ? liveRoom.guests.size : 0;

  liveRoom.stats = liveRoom.stats || {};
  liveRoom.stats.peakViewers = Math.max(
    Number(liveRoom.stats.peakViewers || 0),
    viewerCount + guestCount
  );

  broadcastToRoom(roomId, {
    type: 'liveStats',
    from: 'server',
    to: roomId,
    data: {
      viewerCount,
      guestCount,
      stats: liveRoom.stats,
      hostId: liveRoom.hostId,
    },
  });
}

async function handleMessage(ws, message) {
  const client = clients.get(ws);
  if (!client) return;

  console.log(
    `📨 Message reçu: ${message.type} de ${message.from || 'anonymous'}`
  );

  if (message.from && message.from !== 'server') {
    client.userId = message.from;
  }

  try {
    switch (message.type) {
      case 'joinRoom':
        await handleJoinRoom(ws, message);
        break;
      case 'leaveRoom':
        await handleLeaveRoom(ws, message);
        break;
      case 'offer':
      case 'answer':
      case 'iceCandidate':
        await handleWebRTCSignaling(ws, message);
        break;
      case 'liveControl':
        await handleLiveControl(ws, message);
        break;
      case 'liveChat':
        await handleLiveChat(ws, message);
        break;
      case 'virtualGift':
        await handleVirtualGift(ws, message);
        break;
      case 'heartbeat':
        handleHeartbeat(ws, message);
        break;
      case 'initiateCall':
        await handleInitiateCall(ws, message);
        break;
      case 'ping':
        sendMessage(ws, {
          type: 'pong',
          from: 'server',
          to: client.userId,
          data: { timestamp: new Date().toISOString() },
        });
        break;
      default:
        console.warn(`⚠️ Type de message non géré: ${message.type}`);
        sendError(ws, `Type de message non supporté: ${message.type}`);
    }
  } catch (error) {
    console.error(`❌ Erreur handling message ${message.type}:`, error);
    sendError(ws, 'Erreur serveur lors du traitement du message');
  }
}

async function handleJoinRoom(ws, message) {
  const client = clients.get(ws);
  const { roomId, callType, metadata } = message.data || {};

  if (!roomId) {
    sendError(ws, 'Room ID requis');
    return;
  }

  if (client.roomId) {
    await handleLeaveRoom(ws, { to: client.roomId });
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    console.log(`🏠 Nouvelle room créée: ${roomId}`);
  }

  const room = rooms.get(roomId);

  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    sendError(ws, `Room pleine (max ${MAX_CLIENTS_PER_ROOM} participants)`);
    return;
  }

  room.add(ws);
  client.roomId = roomId;
  client.isHost = metadata?.isHost || false;
  client.liveRole = metadata?.isHost
    ? 'host'
    : metadata?.isGuest
        ? 'guest'
        : callType === 'live'
            ? 'audience'
            : null;

  broadcastToRoom(
    roomId,
    {
      type: 'userJoined',
      from: 'server',
      to: roomId,
      data: {
        userId: client.userId,
        isHost: client.isHost,
        callType,
        participantCount: room.size,
        joinedAt: new Date().toISOString(),
      },
    },
    ws
  );

  sendMessage(ws, {
    type: 'roomJoined',
    from: 'server',
    to: client.userId,
    data: {
      roomId,
      participantCount: room.size,
      isHost: client.isHost,
      callType,
    },
  });

  if (callType === 'live') {
    await handleLiveRoomJoin(ws, roomId, metadata);
  }

  console.log(
    `✅ ${client.userId || client.id} a rejoint la room ${roomId} (${room.size} participants)`
  );
}

async function handleLeaveRoom(ws, message) {
  const client = clients.get(ws);
  const roomId = message?.to || client?.roomId;

  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  room.delete(ws);

  const liveRoom = liveRooms.get(roomId);
  const userId = getClientUserId(client);

  if (liveRoom && userId) {
    if (String(liveRoom.hostId || '') === userId) {
      liveRoom.isActive = false;
    }

    removeUserFromSet(liveRoom.guests, userId);
    removeUserFromSet(liveRoom.viewers, userId);

    if (liveRoom.requests instanceof Set) {
      liveRoom.requests.delete(userId);
    }

    syncLiveStats(roomId);
  }

  broadcastToRoom(roomId, {
    type: 'userLeft',
    from: 'server',
    to: roomId,
    data: {
      userId: client.userId,
      participantCount: room.size,
      leftAt: new Date().toISOString(),
    },
  });

  if (room.size === 0) {
    rooms.delete(roomId);
    liveRooms.delete(roomId);
    liveJoinRequests.delete(roomId);
    console.log(`🗑️ Room ${roomId} supprimée (vide)`);
  }

  client.roomId = null;
  client.isHost = false;
  client.liveRole = null;

  console.log(`👋 ${client.userId || client.id} a quitté la room ${roomId}`);
}

async function handleWebRTCSignaling(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room pour le signaling');
    return;
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      timestamp: new Date().toISOString(),
      fromUserId: client.userId,
    },
  };

  broadcastToRoom(roomId, enrichedMessage, ws);
  console.log(
    `🔄 Signal ${message.type} relayé dans ${roomId} par ${client.userId}`
  );
}

async function handleLiveRoomJoin(ws, roomId, metadata) {
  const liveRoom = ensureLiveRoom(roomId);
  const client = clients.get(ws);
  const userId = getClientUserId(client);

  if (!userId) return;

  if (metadata?.isHost) {
    liveRoom.hostId = userId;
    liveRoom.title = metadata?.title || liveRoom.title;
    removeUserFromSet(liveRoom.guests, userId);
    removeUserFromSet(liveRoom.viewers, userId);
    client.liveRole = 'host';
  } else if (metadata?.isGuest) {
    removeUserFromSet(liveRoom.viewers, userId);
    liveRoom.guests.add(userId);
    client.liveRole = 'guest';
  } else {
    if (!setHasUser(liveRoom.guests, userId)) {
      liveRoom.viewers.add(userId);
      liveRoom.stats.totalViewers = Number(liveRoom.stats.totalViewers || 0) + 1;
    }
    client.liveRole = 'audience';
  }

  syncLiveStats(roomId);
}

async function handleLiveControl(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId || !liveRooms.has(roomId)) {
    sendError(ws, 'Live room introuvable');
    return;
  }

  const liveRoom = liveRooms.get(roomId);
  const { controlType, data } = message.data || {};

  switch (controlType) {
    case 'inviteGuest':
      if (client.userId === liveRoom.hostId) {
        broadcastToRoom(roomId, message);
      } else {
        sendError(ws, "Seul l'hôte peut inviter des invités");
      }
      break;

    case 'acceptInvite':
      if (data?.guestId) {
        removeUserFromSet(liveRoom.viewers, data.guestId);
        liveRoom.guests.add(String(data.guestId));
        syncLiveStats(roomId);
      }
      broadcastToRoom(roomId, message);
      break;

    case 'removeGuest':
      if (client.userId === liveRoom.hostId) {
        if (data?.guestId) {
          removeUserFromSet(liveRoom.guests, data.guestId);
          syncLiveStats(roomId);
        }
        broadcastToRoom(roomId, message);
      } else {
        sendError(ws, "Seul l'hôte peut retirer des invités");
      }
      break;

    default:
      broadcastToRoom(roomId, message, ws);
  }
}

async function handleLiveChat(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
      id: generateClientId(),
    },
  };

  broadcastToRoom(roomId, enrichedMessage);
  console.log(
    `💬 Message chat de ${client.userId} dans ${roomId}: ${message.data.text?.substring(0, 50)}...`
  );
}

async function handleVirtualGift(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }

  if (liveRooms.has(roomId)) {
    const liveRoom = liveRooms.get(roomId);
    liveRoom.stats.totalGifts = Number(liveRoom.stats.totalGifts || 0) + (message.data.quantity || 1);
    if (message.data.giftId === 'heart') {
      liveRoom.stats.totalHearts = Number(liveRoom.stats.totalHearts || 0) + (message.data.quantity || 1);
    }
    syncLiveStats(roomId);
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
      id: generateClientId(),
    },
  };

  broadcastToRoom(roomId, enrichedMessage);
  console.log(`🎁 Cadeau ${message.data.giftId} de ${client.userId} dans ${roomId}`);
}

async function handleInitiateCall(ws, message) {
  const client = clients.get(ws);
  const { targetUserId, callerName, callType, roomId } = message.data;

  console.log(`📞 Tentative d'appel de ${client.userId} vers ${targetUserId}`);

  const targetClient = findClientByUserId(targetUserId);

  if (targetClient) {
    sendMessage(targetClient.ws, {
      type: 'incomingCall',
      from: 'server',
      to: targetUserId,
      data: {
        callerId: client.userId,
        callerName: callerName || client.userId,
        roomId,
        callType,
        timestamp: new Date().toISOString(),
      },
    });

    sendMessage(ws, {
      type: 'callInitiated',
      from: 'server',
      to: client.userId,
      data: {
        targetUserId,
        roomId,
        status: 'ringing',
      },
    });

    console.log(`✅ Notification d'appel envoyée à ${targetUserId} de ${client.userId}`);
  } else {
    sendError(ws, `Utilisateur ${targetUserId} hors ligne`);
    console.log(`❌ Utilisateur ${targetUserId} introuvable pour appel`);
  }
}

function handleHeartbeat(ws) {
  const client = clients.get(ws);
  if (client) {
    client.lastHeartbeat = new Date();
  }

  sendMessage(ws, {
    type: 'heartbeatAck',
    from: 'server',
    to: client?.userId || 'client',
    data: {
      timestamp: new Date().toISOString(),
      serverUptime: Math.floor(process.uptime()),
    },
  });
}

function handleDisconnection(ws) {
  const client = clients.get(ws);
  if (!client) return;

  console.log(`📱 Déconnexion: ${client.userId || client.id}`);

  if (client.roomId) {
    handleLeaveRoom(ws, { to: client.roomId });
  }

  clients.delete(ws);
}

module.exports = {
  handleMessage,
  handleDisconnection,
};