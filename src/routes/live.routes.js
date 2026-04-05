const express = require('express');
const crypto = require('crypto');
const { liveRooms, liveJoinRequests } = require('../state/store');
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
  return value.trim();
}

function safeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRoomViewerCount(room) {
  if (!room) return 0;

  const liveViewers = room.viewers instanceof Set ? room.viewers.size : 0;
  const liveGuests = room.guests instanceof Set ? room.guests.size : 0;
  const peak = safeNumber(room?.stats?.peakViewers, 0);

  return Math.max(liveViewers + liveGuests, peak > 0 ? liveViewers + liveGuests : 0);
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

    // Compatibilité Flutter premium discovery
    livekitRoomName: room.livekitRoomName || room.roomId,
    hostUsername: room.hostUsername || room.hostId,
    hostPhotoUrl: room.hostPhotoUrl || null,
    viewerCount,
    thumbnailUrl: room.thumbnailUrl || null,
    category: room.category || null,
    isTrending: safeBoolean(room.isTrending, false),
    isNew: safeBoolean(room.isNew, false),

    // Infos utiles backend / détails room
    guestCount,
    requestCount,
    stats: {
      totalViewers: safeNumber(room?.stats?.totalViewers, viewerCount),
      peakViewers: safeNumber(
        room?.stats?.peakViewers,
        viewerCount
      ),
      totalGifts: safeNumber(room?.stats?.totalGifts, 0),
      totalHearts: safeNumber(room?.stats?.totalHearts, 0),
    },
  };
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

/**
 * LISTER LES LIVES ACTIFS
 * Route attendue par Flutter: GET /live/rooms
 */
router.get('/live/rooms', async (req, res) => {
  try {
    const rooms = Array.from(liveRooms.values())
      .filter((room) => room && room.isActive !== false)
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

    return res.status(200).json(rooms);
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

      // Nouveaux champs premium supportés
      hostUsername,
      hostPhotoUrl,
      thumbnailUrl,
      category,
      isTrending = false,
      isNew = true,
    } = req.body || {};

    const roomId = crypto.randomUUID();

    const room = {
      roomId,
      hostId: userId,
      title: safeString(title, 'Live Lovingo'),
      maxGuests: Number(maxGuests) > 0 ? Number(maxGuests) : 20,

      // Champs pour discovery premium
      livekitRoomName: roomId,
      hostUsername: safeString(hostUsername, safeString(userId, 'Host')),
      hostPhotoUrl: safeString(hostPhotoUrl) || null,
      thumbnailUrl: safeString(thumbnailUrl) || null,
      category: safeString(category) || null,
      isTrending: safeBoolean(isTrending, false),
      isNew: safeBoolean(isNew, true),

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

router.post('/live/rooms/:roomId/token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { role = 'audience', userName } = req.body || {};
    const userId =
      getUserIdFromRequest(req) || req.body.userId || `${role}_${Date.now()}`;

    const room = liveRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const safeRole = ['host', 'guest', 'audience'].includes(role)
      ? role
      : 'audience';

    const identity = String(userId);
    const displayName = userName || identity;

    // Mise à jour légère des stats mémoire
    if (safeRole === 'audience') {
      room.viewers.add(identity);
    } else if (safeRole === 'guest') {
      room.guests.add(identity);
    }

    const currentLiveCount =
      (room.viewers instanceof Set ? room.viewers.size : 0) +
      (room.guests instanceof Set ? room.guests.size : 0);

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
      identity,
      name: displayName,
      role: safeRole,
    });

    return res.status(200).json({
      roomId,
      role: safeRole,
      userId: identity,
      userName: displayName,
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
    const { message = '' } = req.body || {};
    const userId =
      getUserIdFromRequest(req) || req.body.userId || `guest_${Date.now()}`;

    const room = liveRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    const existing = requests.find(
      (r) => r.userId === userId && r.status === 'pending'
    );

    if (existing) {
      return res.status(200).json({
        success: true,
        alreadyPending: true,
        requestId: existing.requestId,
      });
    }

    const requestId = crypto.randomUUID();
    const joinRequest = {
      requestId,
      roomId,
      userId,
      userName: req.body?.userName || userId,
      photoUrl: req.body?.photoUrl || null,
      message: safeString(message),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    requests.push(joinRequest);
    liveJoinRequests.set(roomId, requests);

    room.requests.add(userId);

    broadcastToRoom(roomId, {
      type: 'liveJoinRequest',
      from: 'server',
      to: roomId,
      data: joinRequest,
    });

    console.log(`🙋 Join request: ${userId} -> ${roomId}`);

    return res.status(201).json({
      success: true,
      requestId,
      roomId,
      userId,
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

    const requests = liveJoinRequests.get(roomId) || [];
    const request = requests.find((r) => r.requestId === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    request.status = 'accepted';
    room.guests.add(request.userId);
    room.requests.delete(request.userId);

    broadcastToRoom(roomId, {
      type: 'liveJoinRequestAccepted',
      from: 'server',
      to: roomId,
      data: {
        requestId,
        userId: request.userId,
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
    room.requests.delete(request.userId);

    broadcastToRoom(roomId, {
      type: 'liveJoinRequestRejected',
      from: 'server',
      to: roomId,
      data: {
        requestId,
        userId: request.userId,
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

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
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
    room.guests.delete(userId);
    room.viewers.delete(userId);
    room.requests.delete(userId);

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