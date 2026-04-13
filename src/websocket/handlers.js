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

function isBlocked(liveRoom, userId) {
  if (!liveRoom || !(liveRoom.blockedUsers instanceof Set) || !userId) {
    return false;
  }

  return liveRoom.blockedUsers.has(String(userId));
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
      isActive: liveRoom.isActive === true,
    },
  });
}

function terminateLiveRoom(roomId, endedByUserId = null) {
  const liveRoom = liveRooms.get(roomId);
  if (!liveRoom) return;

  liveRoom.isActive = false;
  liveRoom.endedAt = new Date().toISOString();

  if (liveRoom.viewers instanceof Set) {
    liveRoom.viewers.clear();
  }

  if (liveRoom.guests instanceof Set) {
    liveRoom.guests.clear();
  }

  if (liveRoom.requests instanceof Set) {
    liveRoom.requests.clear();
  }

  if (liveRoom.invitedUsers instanceof Set) {
    liveRoom.invitedUsers.clear();
  }

  const requests = liveJoinRequests.get(roomId) || [];
  for (const request of requests) {
    if (request.status === 'pending' || request.status === 'invited') {
      request.status = 'ended';
    }
  }
  liveJoinRequests.set(roomId, requests);

  broadcastToRoom(roomId, {
    type: 'liveEnded',
    from: 'server',
    to: roomId,
    data: {
      roomId,
      endedAt: liveRoom.endedAt,
      endedByUserId: endedByUserId ? String(endedByUserId) : liveRoom.hostId,
    },
  });

  const room = rooms.get(roomId);
  if (room instanceof Set) {
    for (const socket of Array.from(room)) {
      const roomClient = clients.get(socket);
      if (roomClient) {
        roomClient.roomId = null;
        roomClient.isHost = false;
        roomClient.liveRole = null;
      }
    }
    rooms.delete(roomId);
  }

  console.log(`🔴 Room live terminée: ${roomId}`);
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

  const liveRoom = liveRooms.get(roomId);
  const joiningUserId =
    metadata?.userId || client.userId || message.from || client.id;

  if (liveRoom && isBlocked(liveRoom, joiningUserId)) {
    sendError(ws, 'Vous êtes bloqué dans ce live');
    return;
  }

  if (liveRoom && liveRoom.isActive === false) {
    sendError(ws, 'Ce live est terminé');
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
    const isHostLeaving = String(liveRoom.hostId || '') === userId;

    if (isHostLeaving) {
      terminateLiveRoom(roomId, userId);
    } else {
      removeUserFromSet(liveRoom.guests, userId);
      removeUserFromSet(liveRoom.viewers, userId);

      if (liveRoom.requests instanceof Set) {
        liveRoom.requests.delete(userId);
      }

      if (liveRoom.invitedUsers instanceof Set) {
        liveRoom.invitedUsers.delete(userId);
      }

      syncLiveStats(roomId);

      if (room.size === 0 && liveRoom.isActive !== true) {
        rooms.delete(roomId);
        liveRooms.delete(roomId);
        liveJoinRequests.delete(roomId);
      }
    }
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

    const liveRoomAfter = liveRooms.get(roomId);
    if (!liveRoomAfter || liveRoomAfter.isActive !== true) {
      liveRooms.delete(roomId);
      liveJoinRequests.delete(roomId);
      console.log(`🗑️ Room ${roomId} supprimée (vide)`);
    }
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

  if (!(liveRoom.blockedUsers instanceof Set)) {
    liveRoom.blockedUsers = new Set();
  }

  if (!(liveRoom.invitedUsers instanceof Set)) {
    liveRoom.invitedUsers = new Set();
  }

  if (metadata?.isHost) {
    liveRoom.hostId = userId;
    liveRoom.title = metadata?.title || liveRoom.title;
    liveRoom.isActive = true;
    removeUserFromSet(liveRoom.guests, userId);
    removeUserFromSet(liveRoom.viewers, userId);
    client.liveRole = 'host';
  } else if (metadata?.isGuest) {
    removeUserFromSet(liveRoom.viewers, userId);
    removeUserFromSet(liveRoom.guests, userId);
    liveRoom.guests.add(userId);
    liveRoom.invitedUsers.delete(String(userId));
    client.liveRole = 'guest';
  } else {
    removeUserFromSet(liveRoom.viewers, userId);
    if (!setHasUser(liveRoom.guests, userId)) {
      liveRoom.viewers.add(userId);
      liveRoom.stats.totalViewers =
        Number(liveRoom.stats.totalViewers || 0) + 1;
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
    case 'inviteGuest': {
      if (client.userId !== liveRoom.hostId) {
        sendError(ws, "Seul l'hôte peut inviter des invités");
        return;
      }

      const targetUserId = data?.guestId || data?.userId;
      if (!targetUserId) {
        sendError(ws, 'guestId requis');
        return;
      }

      if (!(liveRoom.invitedUsers instanceof Set)) {
        liveRoom.invitedUsers = new Set();
      }

      liveRoom.invitedUsers.add(String(targetUserId));

      broadcastToRoom(roomId, {
        type: 'liveGuestInvited',
        from: 'server',
        to: roomId,
        data: {
          roomId,
          userId: String(targetUserId),
        },
      });

      break;
    }

    case 'acceptInvite': {
      const guestId = data?.guestId || data?.userId;
      if (guestId) {
        removeUserFromSet(liveRoom.viewers, guestId);
        removeUserFromSet(liveRoom.guests, guestId);
        liveRoom.guests.add(String(guestId));

        if (liveRoom.invitedUsers instanceof Set) {
          liveRoom.invitedUsers.delete(String(guestId));
        }

        syncLiveStats(roomId);
      }

      broadcastToRoom(roomId, {
        type: 'liveGuestInviteAccepted',
        from: 'server',
        to: roomId,
        data: {
          roomId,
          userId: String(guestId || ''),
        },
      });

      break;
    }

    case 'removeGuest': {
      const targetUserId = data?.guestId || data?.userId;
      if (!targetUserId) {
        sendError(ws, 'guestId requis');
        return;
      }

      const isSelf = String(targetUserId) === String(client.userId);
      const isHost = String(client.userId) === String(liveRoom.hostId);

      if (!isHost && !isSelf) {
        sendError(ws, "Seul l'hôte ou le guest concerné peut descendre");
        return;
      }

      removeUserFromSet(liveRoom.guests, targetUserId);
      removeUserFromSet(liveRoom.viewers, targetUserId);
      liveRoom.viewers.add(String(targetUserId));

      if (liveRoom.invitedUsers instanceof Set) {
        liveRoom.invitedUsers.delete(String(targetUserId));
      }

      syncLiveStats(roomId);

      broadcastToRoom(roomId, {
        type: 'liveGuestRemoved',
        from: 'server',
        to: roomId,
        data: {
          roomId,
          userId: String(targetUserId),
        },
      });

      break;
    }

    case 'muteUser': {
      if (client.userId !== liveRoom.hostId) {
        sendError(ws, "Seul l'hôte peut mute un participant");
        return;
      }

      const targetUserId = data?.userId;
      if (!targetUserId) {
        sendError(ws, 'userId requis');
        return;
      }

      broadcastToRoom(roomId, {
        type: 'liveModerationMute',
        from: 'server',
        to: roomId,
        data: {
          roomId,
          userId: String(targetUserId),
          muted: Boolean(data?.muted),
        },
      });

      break;
    }

    case 'blockUser': {
      if (client.userId !== liveRoom.hostId) {
        sendError(ws, "Seul l'hôte peut bloquer un participant");
        return;
      }

      const targetUserId = data?.userId;
      if (!targetUserId) {
        sendError(ws, 'userId requis');
        return;
      }

      if (!(liveRoom.blockedUsers instanceof Set)) {
        liveRoom.blockedUsers = new Set();
      }

      liveRoom.blockedUsers.add(String(targetUserId));
      removeUserFromSet(liveRoom.guests, targetUserId);
      removeUserFromSet(liveRoom.viewers, targetUserId);

      if (liveRoom.requests instanceof Set) {
        liveRoom.requests.delete(String(targetUserId));
      }

      if (liveRoom.invitedUsers instanceof Set) {
        liveRoom.invitedUsers.delete(String(targetUserId));
      }

      const requests = liveJoinRequests.get(roomId) || [];
      for (const request of requests) {
        if (
          String(request.userId) === String(targetUserId) &&
          (request.status === 'pending' ||
            request.status === 'accepted' ||
            request.status === 'invited')
        ) {
          request.status = 'blocked';
        }
      }
      liveJoinRequests.set(roomId, requests);

      syncLiveStats(roomId);

      broadcastToRoom(roomId, {
        type: 'liveUserBlocked',
        from: 'server',
        to: roomId,
        data: {
          roomId,
          userId: String(targetUserId),
        },
      });

      break;
    }

    case 'endLive': {
      if (client.userId !== liveRoom.hostId) {
        sendError(ws, "Seul l'hôte peut terminer le live");
        return;
      }

      terminateLiveRoom(roomId, client.userId);
      break;
    }

    default:
      broadcastToRoom(roomId, message, ws);
      break;
  }
}

async function handleLiveChat(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }

  const liveRoom = liveRooms.get(roomId);
  if (liveRoom && isBlocked(liveRoom, client.userId)) {
    sendError(ws, 'Vous êtes bloqué dans ce live');
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

  const liveRoom = liveRooms.get(roomId);
  if (liveRoom && isBlocked(liveRoom, client.userId)) {
    sendError(ws, 'Vous êtes bloqué dans ce live');
    return;
  }

  if (liveRooms.has(roomId)) {
    const room = liveRooms.get(roomId);
    room.stats.totalGifts =
      Number(room.stats.totalGifts || 0) + (message.data.quantity || 1);

    if (message.data.giftId === 'heart') {
      room.stats.totalHearts =
        Number(room.stats.totalHearts || 0) + (message.data.quantity || 1);
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
  console.log(
    `🎁 Cadeau ${message.data.giftId} de ${client.userId} dans ${roomId}`
  );
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

    console.log(
      `✅ Notification d'appel envoyée à ${targetUserId} de ${client.userId}`
    );
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
  terminateLiveRoom,
  syncLiveStats,
};