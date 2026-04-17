const express = require('express');
const { clients, rooms, liveRooms } = require('../state/store');

const router = express.Router();

function getMemoryStats() {
  const usage = process.memoryUsage();

  return {
    used: Math.round(usage.heapUsed / 1024 / 1024),
    total: Math.round(usage.heapTotal / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
    external: Math.round((usage.external || 0) / 1024 / 1024),
  };
}

function getRoomStats() {
  return Array.from(rooms.entries()).map(([id, roomClients]) => ({
    roomId: id,
    participants: roomClients instanceof Set ? roomClients.size : 0,
  }));
}

function getLiveRoomStats() {
  return Array.from(liveRooms.values()).map((room) => ({
    roomId: room.roomId,
    hostId: room.hostId,
    isActive: room.isActive === true,
    title: room.title || 'Live Lovingo',
    viewers:
      room.viewers instanceof Set
        ? room.viewers.size
        : 0,
    guests:
      room.guests instanceof Set
        ? room.guests.size
        : 0,
    requests:
      room.requests instanceof Set
        ? room.requests.size
        : 0,
    createdAt: room.startTime
      ? new Date(room.startTime).toISOString()
      : null,
    endedAt: room.endedAt || null,
  }));
}

router.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    clients: clients.size,
    rooms: rooms.size,
    liveRooms: liveRooms.size,
    website: 'integrated',
  });
});

router.get('/keepalive', (req, res) => {
  return res.status(204).end();
});

router.get('/ping', (req, res) => {
  return res.status(200).json({
    pong: Date.now(),
    status: 'OK',
  });
});

router.get('/stats', (req, res) => {
  return res.status(200).json({
    server: {
      uptime: Math.floor(process.uptime()),
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      environment: process.env.NODE_ENV || 'development',
      website: 'integrated',
      timestamp: new Date().toISOString(),
    },
    connections: {
      totalClients: clients.size,
      totalRooms: rooms.size,
      totalLiveRooms: liveRooms.size,
      rooms: getRoomStats(),
      liveRooms: getLiveRoomStats(),
    },
    memory: getMemoryStats(),
  });
});

router.get('/test', (req, res) => {
  return res.status(200).json({
    message: 'Serveur Lovingo actif!',
    website: 'integrated',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;