const express = require('express');
const { clients, rooms, liveRooms } = require('../state/store');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    clients: clients.size,
    rooms: rooms.size,
    website: 'integrated',
  });
});

router.get('/keepalive', (req, res) => res.status(204).end());

router.get('/ping', (req, res) => res.json({ pong: Date.now() }));

router.get('/stats', (req, res) => {
  const roomStats = Array.from(rooms.entries()).map(([id, roomClients]) => ({
    roomId: id,
    participants: roomClients.size,
  }));

  res.json({
    server: {
      uptime: Math.floor(process.uptime()),
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      environment: process.env.NODE_ENV || 'development',
      website: 'integrated',
    },
    connections: {
      totalClients: clients.size,
      totalRooms: rooms.size,
      totalLiveRooms: liveRooms.size,
      rooms: roomStats,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

router.get('/test', (req, res) => {
  res.json({
    message: 'Serveur Lovingo actif!',
    website: 'integrated',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;