const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024, // 1MB max payload
});

// Configuration
const PORT = process.env.PORT || 8080;
const MAX_CLIENTS_PER_ROOM = 100;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://lovingo-signaling.onrender.com`;

// État du serveur
const rooms = new Map();
const clients = new Map();
const liveRooms = new Map();

// Middleware
app.use(cors({
  origin: ['https://lovingo.app', 'https://www.lovingo.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// =================== ENDPOINTS API ===================

// Health check pour Render.com
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    clients: clients.size,
    rooms: rooms.size
  });
});

// Stats détaillées
app.get('/stats', (req, res) => {
  const roomStats = Array.from(rooms.entries()).map(([id, clients]) => ({
    roomId: id,
    participants: clients.size
  }));

  res.json({
    server: {
      uptime: Math.floor(process.uptime()),
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      environment: process.env.NODE_ENV || 'development'
    },
    connections: {
      totalClients: clients.size,
      totalRooms: rooms.size,
      totalLiveRooms: liveRooms.size,
      rooms: roomStats
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
    }
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: 'Serveur signaling WebRTC Lovingo actif!',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Lovingo WebRTC Signaling Server',
    version: '2.0.0',
    status: 'Running',
    endpoints: {
      health: '/health',
      stats: '/stats',
      test: '/test'
    }
  });
});

// =================== WEBSOCKET HANDLING ===================

wss.on('connection', (ws, req) => {
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const clientIP = req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown';
  
  console.log(`📱 Nouvelle connexion: ${clientIP} (${userAgent.substring(0, 50)})`);
  
  const clientInfo = {
    id: generateClientId(),
    userId: null,
    roomId: null,
    connectedAt: new Date(),
    isHost: false,
    lastHeartbeat: new Date(),
    userAgent: userAgent,
    ip: clientIP
  };
  
  clients.set(ws, clientInfo);

  // Configuration WebSocket
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
      const message = JSON.parse(data);
      await handleMessage(ws, message);
    } catch (error) {
      console.error('❌ Erreur parsing message:', error);
      sendError(ws, 'Message invalide');
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`📱 Connexion fermée: ${code} - ${reason}`);
    handleDisconnection(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error);
    handleDisconnection(ws);
  });

  // Message de bienvenue
  sendMessage(ws, {
    type: 'connected',
    from: 'server',
    to: clientInfo.id,
    data: { 
      clientId: clientInfo.id,
      serverTime: new Date().toISOString(),
      version: '2.0.0'
    },
  });
});

// =================== MESSAGE HANDLERS ===================

async function handleMessage(ws, message) {
  const client = clients.get(ws);
  if (!client) {
    console.warn('⚠️ Message reçu d\'un client non trouvé');
    return;
  }

  console.log(`📨 Message reçu: ${message.type} de ${message.from || 'anonymous'}`);
  
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
      // 🚨 NOUVEAU : Gestion des appels
      case 'initiateCall':
        await handleInitiateCall(ws, message);
        break;
      case 'ping':
        sendMessage(ws, {
          type: 'pong',
          from: 'server',
          to: client.userId,
          data: { timestamp: new Date().toISOString() }
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

  // Quitter la room actuelle si nécessaire
  if (client.roomId) {
    await handleLeaveRoom(ws, { to: client.roomId });
  }

  // Créer la room si elle n'existe pas
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    console.log(`🏠 Nouvelle room créée: ${roomId}`);
  }

  const room = rooms.get(roomId);
  
  // Vérifier la limite
  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    sendError(ws, `Room pleine (max ${MAX_CLIENTS_PER_ROOM} participants)`);
    return;
  }

  // Rejoindre la room
  room.add(ws);
  client.roomId = roomId;
  client.isHost = metadata?.isHost || false;

  // Notifier les autres participants
  broadcastToRoom(roomId, {
    type: 'userJoined',
    from: 'server',
    to: roomId,
    data: {
      userId: client.userId,
      isHost: client.isHost,
      callType: callType,
      participantCount: room.size,
      joinedAt: new Date().toISOString()
    },
  }, ws);

  // Confirmer à l'utilisateur
  sendMessage(ws, {
    type: 'roomJoined',
    from: 'server',
    to: client.userId,
    data: {
      roomId: roomId,
      participantCount: room.size,
      isHost: client.isHost,
      callType: callType
    },
  });

  // Gestion spéciale pour les lives
  if (callType === 'live') {
    await handleLiveRoomJoin(ws, roomId, metadata);
  }

  console.log(`✅ ${client.userId || client.id} a rejoint la room ${roomId} (${room.size} participants)`);
}

async function handleLeaveRoom(ws, message) {
  const client = clients.get(ws);
  const roomId = message?.to || client?.roomId;

  if (!roomId || !rooms.has(roomId)) {
    console.warn(`⚠️ Tentative de quitter une room inexistante: ${roomId}`);
    return;
  }

  const room = rooms.get(roomId);
  room.delete(ws);

  // Notifier les autres participants
  broadcastToRoom(roomId, {
    type: 'userLeft',
    from: 'server',
    to: roomId,
    data: {
      userId: client.userId,
      participantCount: room.size,
      leftAt: new Date().toISOString()
    },
  });

  // Nettoyer si room vide
  if (room.size === 0) {
    rooms.delete(roomId);
    liveRooms.delete(roomId);
    console.log(`🗑️ Room ${roomId} supprimée (vide)`);
  }

  // Reset client
  client.roomId = null;
  client.isHost = false;

  console.log(`👋 ${client.userId || client.id} a quitté la room ${roomId}`);
}

async function handleWebRTCSignaling(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room pour le signaling');
    return;
  }

  // Ajouter timestamp et metadata
  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      timestamp: new Date().toISOString(),
      fromUserId: client.userId
    }
  };

  broadcastToRoom(roomId, enrichedMessage, ws);
  console.log(`🔄 Signal ${message.type} relayé dans ${roomId} par ${client.userId}`);
}

async function handleLiveRoomJoin(ws, roomId, metadata) {
  if (!liveRooms.has(roomId)) {
    liveRooms.set(roomId, {
      hostId: metadata?.isHost ? clients.get(ws).userId : null,
      title: metadata?.title || 'Live Stream',
      maxGuests: metadata?.maxGuests || 8,
      guests: new Set(),
      viewers: new Set(),
      startTime: new Date(),
      stats: {
        totalViewers: 0,
        peakViewers: 0,
        totalGifts: 0,
        totalHearts: 0,
      },
    });
    console.log(`🔴 Nouvelle live room créée: ${roomId}`);
  }

  const liveRoom = liveRooms.get(roomId);

  if (metadata?.isHost) {
    liveRoom.hostId = clients.get(ws).userId;
  } else if (metadata?.isGuest) {
    liveRoom.guests.add(clients.get(ws).userId);
  } else {
    liveRoom.viewers.add(clients.get(ws).userId);
    liveRoom.stats.totalViewers++;
    liveRoom.stats.peakViewers = Math.max(liveRoom.stats.peakViewers, liveRoom.viewers.size);
  }

  // Broadcast stats
  broadcastToRoom(roomId, {
    type: 'liveStats',
    from: 'server',
    to: roomId,
    data: {
      viewerCount: liveRoom.viewers.size,
      guestCount: liveRoom.guests.size,
      stats: liveRoom.stats,
      hostId: liveRoom.hostId
    },
  });
}

async function handleLiveControl(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId || !liveRooms.has(roomId)) {
    sendError(ws, 'Live room introuvable');
    return;
  }

  const liveRoom = liveRooms.get(roomId);
  const { controlType, data } = message.data;

  switch (controlType) {
    case 'inviteGuest':
      if (client.userId === liveRoom.hostId) {
        broadcastToRoom(roomId, message);
      } else {
        sendError(ws, 'Seul l\'hôte peut inviter des invités');
      }
      break;
    case 'acceptInvite':
      liveRoom.guests.add(data.guestId);
      broadcastToRoom(roomId, message);
      break;
    case 'removeGuest':
      if (client.userId === liveRoom.hostId) {
        liveRoom.guests.delete(data.guestId);
        broadcastToRoom(roomId, message);
      } else {
        sendError(ws, 'Seul l\'hôte peut retirer des invités');
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
      id: generateClientId()
    },
  };

  broadcastToRoom(roomId, enrichedMessage);
  console.log(`💬 Message chat de ${client.userId} dans ${roomId}: ${message.data.text?.substring(0, 50)}...`);
}

async function handleVirtualGift(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }

  // Mettre à jour les stats si c'est une live
  if (liveRooms.has(roomId)) {
    const liveRoom = liveRooms.get(roomId);
    liveRoom.stats.totalGifts += message.data.quantity || 1;
    if (message.data.giftId === 'heart') {
      liveRoom.stats.totalHearts += message.data.quantity || 1;
    }
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
      id: generateClientId()
    },
  };

  broadcastToRoom(roomId, enrichedMessage);
  console.log(`🎁 Cadeau ${message.data.giftId} de ${client.userId} dans ${roomId}`);
}

// 🚨 NOUVELLE FONCTION : Gestion de l'initiation d'appel
async function handleInitiateCall(ws, message) {
  const client = clients.get(ws);
  const { targetUserId, callerName, callType, roomId } = message.data;
  
  console.log(`📞 Tentative d'appel de ${client.userId} vers ${targetUserId}`);
  
  // Trouver le destinataire connecté
  const targetClient = findClientByUserId(targetUserId);
  
  if (targetClient) {
    // Envoyer notification d'appel entrant au destinataire
    sendMessage(targetClient.ws, {
      type: 'incomingCall',
      from: 'server',
      to: targetUserId,
      data: {
        callerId: client.userId,
        callerName: callerName || client.userId,
        roomId: roomId,
        callType: callType,
        timestamp: new Date().toISOString()
      },
    });
    
    // Confirmer à l'appelant que la notification a été envoyée
    sendMessage(ws, {
      type: 'callInitiated',
      from: 'server',
      to: client.userId,
      data: {
        targetUserId: targetUserId,
        roomId: roomId,
        status: 'ringing'
      },
    });
    
    console.log(`✅ Notification d'appel envoyée à ${targetUserId} de ${client.userId}`);
  } else {
    // Utilisateur hors ligne
    sendError(ws, `Utilisateur ${targetUserId} hors ligne`);
    console.log(`❌ Utilisateur ${targetUserId} introuvable pour appel`);
  }
}

function handleHeartbeat(ws, message) {
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
      serverUptime: Math.floor(process.uptime())
    },
  });
}

function handleDisconnection(ws) {
  const client = clients.get(ws);
  if (!client) return;

  console.log(`📱 Déconnexion: ${client.userId || client.id}`);

  // Quitter la room si dans une
  if (client.roomId) {
    handleLeaveRoom(ws, { to: client.roomId });
  }

  // Supprimer le client
  clients.delete(ws);
}

// =================== UTILITY FUNCTIONS ===================

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
      timestamp: new Date().toISOString()
    },
  });
}

function broadcastToRoom(roomId, message, excludeWs = null) {
  if (!rooms.has(roomId)) {
    console.warn(`⚠️ Tentative de broadcast dans room inexistante: ${roomId}`);
    return;
  }

  const room = rooms.get(roomId);
  let sentCount = 0;
  
  room.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      sendMessage(ws, message);
      sentCount++;
    }
  });

  console.log(`📡 Message broadcast dans ${roomId} à ${sentCount} clients`);
}

function generateClientId() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

// 🚨 NOUVELLE FONCTION : Trouver un client par son userId
function findClientByUserId(userId) {
  for (const [ws, client] of clients.entries()) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      return { ws, client };
    }
  }
  return null;
}

// =================== KEEP-ALIVE SYSTEM ===================

// Système de keep-alive pour empêcher l'endormissement sur Render.com
if (process.env.NODE_ENV === 'production') {
  console.log(`🏥 Activation du keep-alive pour: ${RENDER_URL}`);
  
  setInterval(async () => {
    try {
      const fetch = require('node-fetch');
      const response = await fetch(`${RENDER_URL}/health`, {
        timeout: 10000
      });
      
      if (response.ok) {
        console.log(`🏥 Keep-alive ping réussi: ${response.status}`);
      } else {
        console.warn(`⚠️ Keep-alive ping failed: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Keep-alive ping failed:', error.message);
    }
  }, 14 * 60 * 1000); // Ping toutes les 14 minutes
}

// =================== CLEANUP & MONITORING ===================

// Nettoyage des connexions inactives
setInterval(() => {
  const now = new Date();
  let cleanedClients = 0;

  clients.forEach((client, ws) => {
    const timeSinceHeartbeat = now - client.lastHeartbeat;
    if (timeSinceHeartbeat > 120000) { // 2 minutes
      console.log(`🧹 Nettoyage client inactif: ${client.userId || client.id}`);
      ws.terminate();
      handleDisconnection(ws);
      cleanedClients++;
    }
  });

  if (cleanedClients > 0) {
    console.log(`🧹 ${cleanedClients} clients inactifs nettoyés`);
  }
}, 60000); // Check toutes les minutes

// Ping WebSocket pour détecter les connexions mortes
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('💀 Connexion WebSocket morte détectée, terminaison...');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // Ping toutes les 30 secondes

// Stats périodiques
setInterval(() => {
  const stats = {
    clients: clients.size,
    rooms: rooms.size,
    lives: liveRooms.size,
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  };
  
  console.log(`📊 Stats: ${stats.clients} clients, ${stats.rooms} rooms, ${stats.lives} lives, ${stats.memory}MB RAM, ${stats.uptime}s uptime`);
}, 5 * 60 * 1000); // Stats toutes les 5 minutes

// =================== SERVER STARTUP ===================

server.listen(PORT, () => {
  console.log('🚀 ===============================================');
  console.log(`🚀 Serveur Signaling WebRTC Lovingo v2.0.0`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 WebSocket: ws://localhost:${PORT}`);
  console.log(`🚀 API: http://localhost:${PORT}`);
  console.log(`🚀 Health: ${RENDER_URL}/health`);
  console.log(`🚀 Stats: ${RENDER_URL}/stats`);
  console.log('🚀 ===============================================');
});

// =================== ERROR HANDLING ===================

process.on('uncaughtException', (error) => {
  console.error('❌ Erreur non gérée:', error);
  // Log mais ne pas crash en production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesse rejetée non gérée:', reason);
  // Log mais ne pas crash en production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  console.log('🛑 Signal SIGINT reçu, arrêt du serveur...');
  gracefulShutdown();
});

process.on('SIGTERM', () => {
  console.log('🛑 Signal SIGTERM reçu, arrêt du serveur...');
  gracefulShutdown();
});

function gracefulShutdown() {
  console.log('🛑 Démarrage arrêt gracieux...');
  
  // Fermer toutes les connexions WebSocket
  wss.clients.forEach(ws => {
    sendMessage(ws, {
      type: 'serverShutdown',
      from: 'server',
      data: { message: 'Serveur en cours de redémarrage' }
    });
    ws.close();
  });
  
  // Fermer le serveur
  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });
  
  // Force quit après 10 secondes
  setTimeout(() => {
    console.error('❌ Force quit après timeout');
    process.exit(1);
  }, 10000);
}

module.exports = { app, server, wss };