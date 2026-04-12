const express = require('express');
const crypto = require('crypto');
const { liveRooms, liveJoinRequests, rooms, clients } = require('../state/store');
const { getUserIdFromRequest, broadcastToRoom } = require('../utils/helpers');
const { createLiveKitToken } = require('../services/livekit.service');
const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
} = require('../config');

const router = express.Router();

function toIsoDate(value) {
  if (!value) return new Date().toISOString();

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function safeString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function safeNullableString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function safeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildUniqueParticipantIdentity({
  userId,
  role,
  roomId,
  deviceId,
}) {
  const safeUserId = safeString(String(userId || 'user'));
  const safeRole = safeString(String(role || 'audience'));
  const safeRoomId = safeString(String(roomId || 'room'));
  const safeDeviceId =
    safeString(String(deviceId || '')) || crypto.randomUUID();

  return `${safeUserId}::${safeRole}::${safeRoomId}::${safeDeviceId}`;
}

function getRoomViewerCount(room) {
  if (!room) return 0;

  const liveViewers = room.viewers instanceof Set ? room.viewers.size : 0;
  const liveGuests = room.guests instanceof Set ? room.guests.size : 0;
  const hostCount = room.isActive === false ? 0 : 1;

  return liveViewers + liveGuests + hostCount;
}

function serializeRoom(room) {
  const viewerCount = getRoomViewerCount(room);
  const requestCount = room.requests instanceof Set ? room.requests.size : 0;
  const guestCount = room.guests instanceof Set ? room.guests.size : 0;

  return {
    roomId: room.roomId,
    hostId: room.hostId,
    title: room.title || 'Live Lovingo',
    maxGuests: safeNumber(room.maxGuests, 20),
    isActive: safeBoolean(room.isActive, true),
    createdAt: toIsoDate(room.startTime),
    endedAt: room.endedAt ? toIsoDate(room.endedAt) : null,

    livekitRoomName: room.livekitRoomName || room.roomId,
    hostUsername: room.hostUsername || room.hostId,
    hostPhotoUrl: room.hostPhotoUrl || null,
    viewerCount,
    thumbnailUrl: room.thumbnailUrl || null,
    category: room.category || null,
    isTrending: safeBoolean(room.isTrending, false),
    isNew: safeBoolean(room.isNew, false),

    guestCount,
    requestCount,
    stats: {
      totalViewers: safeNumber(room?.stats?.totalViewers, viewerCount),
      peakViewers: safeNumber(room?.stats?.peakViewers, viewerCount),
      totalGifts: safeNumber(room?.stats?.totalGifts, 0),
      totalHearts: safeNumber(room?.stats?.totalHearts, 0),
    },
  };
}

function setHasRealUser(setLike, userId) {
  if (!(setLike instanceof Set)) return false;
  const prefix = `${String(userId)}::`;

  for (const value of setLike) {
    if (String(value) === String(userId) || String(value).startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function removeUserFromSet(setLike, userId) {
  if (!(setLike instanceof Set)) return;

  const prefix = `${String(userId)}::`;

  for (const value of Array.from(setLike)) {
    if (String(value) === String(userId) || String(value).startsWith(prefix)) {
      setLike.delete(value);
    }
  }
}

function terminateLiveRoom(roomId, endedByUserId = null) {
  const room = liveRooms.get(roomId);
  if (!room) return null;

  room.isActive = false;
  room.endedAt = new Date().toISOString();

  if (room.viewers instanceof Set) {
    room.viewers.clear();
  }

  if (room.guests instanceof Set) {
    room.guests.clear();
  }

  if (room.requests instanceof Set) {
    room.requests.clear();
  }

  const requests = liveJoinRequests.get(roomId) || [];
  for (const request of requests) {
    if (request.status === 'pending') {
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
      endedAt: room.endedAt,
      endedByUserId: endedByUserId ? String(endedByUserId) : room.hostId,
    },
  });

  const roomClients = rooms.get(roomId);
  if (roomClients instanceof Set) {
    for (const ws of Array.from(roomClients)) {
      const client = clients.get(ws);
      if (client) {
        client.roomId = null;
        client.isHost = false;
        client.liveRole = null;
      }
    }
    rooms.delete(roomId);
  }

  console.log(`🔴 Live terminé: ${roomId}`);
  return room;
}

router.get('/live/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    liveRooms: liveRooms.size,
    liveJoinRequests: liveJoinRequests.size,
    livekitConfigured: Boolean(
      LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
    ),
    timestamp: new Date().toISOString(),
  });
});

router.get('/live/rooms', async (req, res) => {
  try {
    const roomsList = Array.from(liveRooms.values())
      .filter((room) => room && room.isActive === true)
      .map(serializeRoom)
      .sort((a, b) => {
        const aTrending = a.isTrending ? 1 : 0;
        const bTrending = b.isTrending ? 1 : 0;

        if (bTrending !== aTrending) {
          return bTrending - aTrending;
        }

        if (b.viewerCount !== a.viewerCount) {
          return b.viewerCount - a.viewerCount;
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    return res.status(200).json(roomsList);
  } catch (error) {
    console.error('❌ Erreur get active live rooms:', error);
    return res.status(500).json({
      error: 'Impossible de récupérer les lives actifs',
      details: error.message,
    });
  }
});

router.post('/live/rooms', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req) || req.body.hostId || 'host_demo';

    const {
      title = 'Live Lovingo',
      maxGuests = 20,
      hostUsername,
      userName,
      hostPhotoUrl,
      photoUrl,
      thumbnailUrl,
      category,
      isTrending = false,
      isNew = true,
    } = req.body || {};

    const roomId = crypto.randomUUID();

    const resolvedHostUsername = safeString(
      hostUsername || userName,
      String(userId)
    );

    const resolvedHostPhotoUrl = safeNullableString(
      hostPhotoUrl || photoUrl
    );

    const room = {
      roomId,
      hostId: String(userId),
      title: safeString(title, 'Live Lovingo'),
      maxGuests: Number(maxGuests) > 0 ? Number(maxGuests) : 20,
      livekitRoomName: roomId,
      hostUsername: resolvedHostUsername,
      hostPhotoUrl: resolvedHostPhotoUrl,
      thumbnailUrl: safeNullableString(thumbnailUrl),
      category: safeNullableString(category),
      isTrending: safeBoolean(isTrending, false),
      isNew: safeBoolean(isNew, true),
      guests: new Set(),
      viewers: new Set(),
      requests: new Set(),
      startTime: new Date(),
      endedAt: null,
      stats: {
        totalViewers: 1,
        peakViewers: 1,
        totalGifts: 0,
        totalHearts: 0,
      },
      isActive: true,
    };

    liveRooms.set(roomId, room);
    liveJoinRequests.set(roomId, []);

    console.log(`🔴 Live room créée: ${roomId} par ${userId}`);

    return res.status(201).json(serializeRoom(room));
  } catch (error) {
    console.error('❌ Erreur create live room:', error);
    return res.status(500).json({
      error: 'Impossible de créer la room live',
      details: error.message,
    });
  }
});

router.get('/live/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    return res.status(200).json(serializeRoom(room));
  } catch (error) {
    console.error('❌ Erreur get room:', error);
    return res.status(500).json({
      error: 'Impossible de récupérer la room',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/end', async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const authUserId = getUserIdFromRequest(req);
    const bodyUserId = req.body?.userId;
    const userId = String(authUserId || bodyUserId || '');

    if (!userId) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    if (String(room.hostId) !== userId) {
      return res.status(403).json({ error: 'Seul le host peut terminer le live' });
    }

    const endedRoom = terminateLiveRoom(roomId, userId);
    const alternativeRooms = Array.from(liveRooms.values())
      .filter((item) => item && item.roomId !== roomId && item.isActive === true)
      .map(serializeRoom)
      .sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0))
      .slice(0, 20);

    return res.status(200).json({
      success: true,
      roomId,
      endedAt: endedRoom?.endedAt || new Date().toISOString(),
      alternativeRooms,
    });
  } catch (error) {
    console.error('❌ Erreur end live room:', error);
    return res.status(500).json({
      error: 'Impossible de terminer le live',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const {
      role = 'audience',
      userName,
      userId: bodyUserId,
      photoUrl,
      deviceId,
    } = req.body || {};

    const authUserId = getUserIdFromRequest(req);
    const userId = authUserId || bodyUserId || `${role}_${Date.now()}`;

    const room = liveRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    if (room.isActive !== true) {
      return res.status(409).json({ error: 'Ce live est terminé' });
    }

    const safeRole = ['host', 'guest', 'audience'].includes(role)
      ? role
      : 'audience';

    const realUserId = String(userId);

    const displayName = safeString(
      userName,
      safeRole === 'host' ? room.hostUsername || realUserId : realUserId
    );

    const resolvedPhotoUrl =
      safeNullableString(photoUrl) ||
      (safeRole === 'host' ? room.hostPhotoUrl || null : null);

    const uniqueIdentity = buildUniqueParticipantIdentity({
      userId: realUserId,
      role: safeRole,
      roomId,
      deviceId,
    });

    if (safeRole === 'audience') {
      room.viewers.add(uniqueIdentity);
    } else if (safeRole === 'guest') {
      removeUserFromSet(room.viewers, realUserId);
      room.guests.add(uniqueIdentity);
      if (room.requests instanceof Set) {
        room.requests.delete(realUserId);
      }

      const requests = liveJoinRequests.get(roomId) || [];
      for (const item of requests) {
        if (String(item.userId) === realUserId && item.status === 'pending') {
          item.status = 'accepted';
        }
      }
      liveJoinRequests.set(roomId, requests);
    }

    const currentLiveCount =
      (room.viewers instanceof Set ? room.viewers.size : 0) +
      (room.guests instanceof Set ? room.guests.size : 0) +
      1;

    room.stats.totalViewers = Math.max(
      safeNumber(room?.stats?.totalViewers, 0),
      currentLiveCount
    );
    room.stats.peakViewers = Math.max(
      safeNumber(room?.stats?.peakViewers, 0),
      currentLiveCount
    );

    const tokenData = await createLiveKitToken({
      roomId,
      identity: uniqueIdentity,
      name: displayName,
      role: safeRole,
      metadata: {
        userId: realUserId,
        userName: displayName,
        displayName,
        photoUrl: resolvedPhotoUrl,
        role: safeRole,
      },
    });

    return res.status(200).json({
      roomId,
      role: safeRole,
      userId: realUserId,
      participantIdentity: uniqueIdentity,
      userName: displayName,
      photoUrl: resolvedPhotoUrl,
      token: tokenData.token,
      url: tokenData.url,
      livekitUrl: tokenData.url,
    });
  } catch (error) {
    console.error('❌ Erreur get room token:', error);
    return res.status(500).json({
      error: 'Impossible de générer le token LiveKit',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/requests', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { message = '', userName, photoUrl } = req.body || {};
    const userId =
      getUserIdFromRequest(req) || req.body.userId || `guest_${Date.now()}`;

    const room = liveRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    if (room.isActive !== true) {
      return res.status(409).json({ error: 'Ce live est terminé' });
    }

    const realUserId = String(userId);

    if (String(room.hostId) === realUserId) {
      return res.status(409).json({
        error: 'Le host ne peut pas envoyer de demande',
      });
    }

    if (setHasRealUser(room.guests, realUserId)) {
      return res.status(409).json({
        error: 'Utilisateur déjà guest dans ce live',
      });
    }

    const requests = liveJoinRequests.get(roomId) || [];

    const existingPending = requests.find(
      (r) => String(r.userId) === realUserId && r.status === 'pending'
    );

    if (existingPending) {
      return res.status(200).json({
        success: true,
        alreadyPending: true,
        requestId: existingPending.requestId,
        roomId,
        userId: realUserId,
        status: 'pending',
      });
    }

    const requestId = crypto.randomUUID();
    const joinRequest = {
      requestId,
      roomId,
      userId: realUserId,
      userName: safeString(userName, realUserId),
      photoUrl: safeNullableString(photoUrl),
      message: safeString(message),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    requests.push(joinRequest);
    liveJoinRequests.set(roomId, requests);

    if (room.requests instanceof Set) {
      room.requests.add(realUserId);
    }

    broadcastToRoom(roomId, {
      type: 'liveJoinRequest',
      from: 'server',
      to: roomId,
      data: joinRequest,
    });

    console.log(`🙋 Join request: ${realUserId} -> ${roomId}`);

    return res.status(201).json({
      success: true,
      requestId,
      roomId,
      userId: realUserId,
      status: 'pending',
    });
  } catch (error) {
    console.error('❌ Erreur requestToJoin:', error);
    return res.status(500).json({
      error: 'Impossible d’envoyer la demande',
      details: error.message,
    });
  }
});

router.get('/live/rooms/:roomId/requests', async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!liveRooms.has(roomId)) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    return res.status(200).json({
      roomId,
      requests,
    });
  } catch (error) {
    console.error('❌ Erreur list requests:', error);
    return res.status(500).json({
      error: 'Impossible de récupérer les demandes',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/requests/:requestId/accept', async (req, res) => {
  try {
    const { roomId, requestId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    if (room.isActive !== true) {
      return res.status(409).json({ error: 'Ce live est terminé' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    const request = requests.find((r) => r.requestId === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    request.status = 'accepted';

    if (room.requests instanceof Set) {
      room.requests.delete(request.userId);
    }

    broadcastToRoom(roomId, {
      type: 'liveJoinRequestAccepted',
      from: 'server',
      to: roomId,
      data: {
        requestId,
        userId: request.userId,
        userName: request.userName || request.userId,
        photoUrl: request.photoUrl || null,
        roomId,
      },
    });

    console.log(`✅ Demande acceptée: ${request.userId} dans ${roomId}`);

    return res.status(200).json({
      success: true,
      roomId,
      requestId,
      userId: request.userId,
      status: 'accepted',
    });
  } catch (error) {
    console.error('❌ Erreur accept request:', error);
    return res.status(500).json({
      error: 'Impossible d’accepter la demande',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/requests/:requestId/reject', async (req, res) => {
  try {
    const { roomId, requestId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    const request = requests.find((r) => r.requestId === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    request.status = 'rejected';

    if (room.requests instanceof Set) {
      room.requests.delete(request.userId);
    }

    broadcastToRoom(roomId, {
      type: 'liveJoinRequestRejected',
      from: 'server',
      to: roomId,
      data: {
        requestId,
        userId: request.userId,
        roomId,
      },
    });

    console.log(`❌ Demande rejetée: ${request.userId} dans ${roomId}`);

    return res.status(200).json({
      success: true,
      roomId,
      requestId,
      userId: request.userId,
      status: 'rejected',
    });
  } catch (error) {
    console.error('❌ Erreur reject request:', error);
    return res.status(500).json({
      error: 'Impossible de rejeter la demande',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/moderation/mute', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, muted } = req.body || {};

    if (!liveRooms.has(roomId)) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    broadcastToRoom(roomId, {
      type: 'liveModerationMute',
      from: 'server',
      to: roomId,
      data: {
        userId,
        muted: Boolean(muted),
      },
    });

    return res.status(200).json({
      success: true,
      roomId,
      userId,
      muted: Boolean(muted),
    });
  } catch (error) {
    console.error('❌ Erreur mute user:', error);
    return res.status(500).json({
      error: 'Impossible de mute user',
      details: error.message,
    });
  }
});

router.post('/live/rooms/:roomId/moderation/kick', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body || {};

    if (!liveRooms.has(roomId)) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const room = liveRooms.get(roomId);

    removeUserFromSet(room?.guests, userId);
    removeUserFromSet(room?.viewers, userId);

    if (room?.requests instanceof Set) {
      room.requests.delete(userId);
    }

    const requests = liveJoinRequests.get(roomId) || [];
    for (const request of requests) {
      if (String(request.userId) === String(userId) && request.status === 'pending') {
        request.status = 'rejected';
      }
    }
    liveJoinRequests.set(roomId, requests);

    broadcastToRoom(roomId, {
      type: 'liveModerationKick',
      from: 'server',
      to: roomId,
      data: { userId },
    });

    return res.status(200).json({
      success: true,
      roomId,
      userId,
      kicked: true,
    });
  } catch (error) {
    console.error('❌ Erreur kick user:', error);
    return res.status(500).json({
      error: 'Impossible de kick user',
      details: error.message,
    });
  }
});

module.exports = router;