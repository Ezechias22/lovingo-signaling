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

router.post('/live/rooms', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req) || req.body.hostId || 'host_demo';
    const { title = 'Live Lovingo', maxGuests = 20 } = req.body || {};

    const roomId = crypto.randomUUID();

    const room = {
      roomId,
      hostId: userId,
      title,
      maxGuests: Number(maxGuests) > 0 ? Number(maxGuests) : 20,
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

    res.status(201).json({
      roomId,
      hostId: userId,
      title,
      maxGuests: room.maxGuests,
      isActive: true,
      createdAt: room.startTime.toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur create live room:', error);
    res.status(500).json({
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

    res.json({
      roomId: room.roomId,
      hostId: room.hostId,
      title: room.title,
      maxGuests: room.maxGuests,
      isActive: room.isActive,
      createdAt: room.startTime?.toISOString?.() || new Date().toISOString(),
      viewerCount: room.viewers.size,
      guestCount: room.guests.size,
      stats: room.stats,
    });
  } catch (error) {
    console.error('❌ Erreur get room:', error);
    res.status(500).json({
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

    const tokenData = await createLiveKitToken({
      roomId,
      identity,
      name: displayName,
      role: safeRole,
    });

    res.json({
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
    res.status(500).json({
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
      userId,
      message,
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

    res.status(201).json({
      success: true,
      requestId,
      roomId,
      userId,
      status: 'pending',
    });
  } catch (error) {
    console.error('❌ Erreur requestToJoin:', error);
    res.status(500).json({
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
    res.json({
      roomId,
      requests,
    });
  } catch (error) {
    console.error('❌ Erreur list requests:', error);
    res.status(500).json({
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

    res.json({
      success: true,
      roomId,
      requestId,
      userId: request.userId,
      status: 'accepted',
    });
  } catch (error) {
    console.error('❌ Erreur accept request:', error);
    res.status(500).json({
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

    res.json({
      success: true,
      roomId,
      requestId,
      userId: request.userId,
      status: 'rejected',
    });
  } catch (error) {
    console.error('❌ Erreur reject request:', error);
    res.status(500).json({
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

    res.json({
      success: true,
      roomId,
      userId,
      muted: Boolean(muted),
    });
  } catch (error) {
    console.error('❌ Erreur mute user:', error);
    res.status(500).json({
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

    res.json({
      success: true,
      roomId,
      userId,
      kicked: true,
    });
  } catch (error) {
    console.error('❌ Erreur kick user:', error);
    res.status(500).json({
      error: 'Impossible de kick user',
      details: error.message,
    });
  }
});

module.exports = router;