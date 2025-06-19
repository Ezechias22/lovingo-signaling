// signaling_server/server.js - SERVEUR DE SIGNALING WEBRTC COMPLET
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 8080;
const MAX_CLIENTS_PER_ROOM = 100;

// État du serveur
const rooms = new Map(); // roomId -> Set<WebSocket>
const clients = new Map(); // WebSocket -> clientInfo
const liveRooms = new Map(); // liveId -> liveInfo

// Middleware
app.use(cors());
app.use(express.json());

// Routes API
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/stats', (req, res) => {
  res.json({
    totalClients: clients.size,
    totalRooms: rooms.size,
    totalLiveRooms: liveRooms.size,
    uptime: process.uptime(),
  });
});

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  console.log(`📱 Nouvelle connexion: ${req.connection.remoteAddress}`);
  
  // Initialiser le client
  const clientInfo = {
    id: generateClientId(),
    userId: null,
    roomId: null,
    connectedAt: new Date(),
    isHost: false,
    lastHeartbeat: new Date(),
  };
  
  clients.set(ws, clientInfo);
  
  // Message handler
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      await handleMessage(ws, message);
    } catch (error) {
      console.error('❌ Erreur parsing message:', error);
      sendError(ws, 'Message invalide');
    }
  });
  
  // Déconnexion handler
  ws.on('close', () => {
    handleDisconnection(ws);
  });
  
  // Erreur handler
  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error);
    handleDisconnection(ws);
  });
  
  // Envoyer confirmation de connexion
  sendMessage(ws, {
    type: 'connected',
    from: 'server',
    to: clientInfo.id,
    data: { clientId: clientInfo.id },
  });
});

// ✅ GESTIONNAIRE DE MESSAGES PRINCIPAL
async function handleMessage(ws, message) {
  const client = clients.get(ws);
  if (!client) return;
  
  console.log(`📨 Message reçu: ${message.type} de ${message.from}`);
  
  // Mettre à jour userId si fourni
  if (message.from && message.from !== 'server') {
    client.userId = message.from;
  }
  
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
      
    default:
      console.warn(`⚠️ Type de message non géré: ${message.type}`);
  }
}

// ✅ REJOINDRE UNE ROOM
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
  }
  
  const room = rooms.get(roomId);
  
  // Vérifier la limite de participants
  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    sendError(ws, 'Room pleine');
    return;
  }
  
  // Ajouter à la room
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
    },
  }, ws);
  
  // Confirmer la jonction
  sendMessage(ws, {
    type: 'roomJoined',
    from: 'server',
    to: client.userId,
    data: {
      roomId: roomId,
      participantCount: room.size,
      isHost: client.isHost,
    },
  });
  
  // Gestion spéciale pour les lives
  if (callType === 'live') {
    await handleLiveRoomJoin(ws, roomId, metadata);
  }
  
  console.log(`✅ ${client.userId} a rejoint la room ${roomId} (${room.size} participants)`);
}

// ✅ QUITTER UNE ROOM
async function handleLeaveRoom(ws, message) {
  const client = clients.get(ws);
  const roomId = message.to || client.roomId;
  
  if (!roomId || !rooms.has(roomId)) return;
  
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
    },
  });
  
  // Supprimer la room si vide
  if (room.size === 0) {
    rooms.delete(roomId);
    liveRooms.delete(roomId);
    console.log(`🗑️ Room ${roomId} supprimée (vide)`);
  }
  
  client.roomId = null;
  client.isHost = false;
  
  console.log(`👋 ${client.userId} a quitté la room ${roomId}`);
}

// ✅ GESTION SIGNALING WEBRTC
async function handleWebRTCSignaling(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;
  
  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }
  
  // Relayer le message aux autres participants de la room
  broadcastToRoom(roomId, message, ws);
  
  console.log(`🔄 Signal ${message.type} relayé dans ${roomId}`);
}

// ✅ GESTION LIVE STREAMING
async function handleLiveRoomJoin(ws, roomId, metadata) {
  if (!liveRooms.has(roomId)) {
    liveRooms.set(roomId, {
      hostId: metadata.isHost ? clients.get(ws).userId : null,
      title: metadata.title || 'Live Stream',
      maxGuests: metadata.maxGuests || 8,
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
  }
  
  const liveRoom = liveRooms.get(roomId);
  
  if (metadata.isHost) {
    liveRoom.hostId = clients.get(ws).userId;
  } else if (metadata.isGuest) {
    liveRoom.guests.add(clients.get(ws).userId);
  } else {
    liveRoom.viewers.add(clients.get(ws).userId);
    liveRoom.stats.totalViewers++;
    liveRoom.stats.peakViewers = Math.max(liveRoom.stats.peakViewers, liveRoom.viewers.size);
  }
  
  // Envoyer les stats mises à jour
  broadcastToRoom(roomId, {
    type: 'liveStats',
    from: 'server',
    to: roomId,
    data: {
      viewerCount: liveRoom.viewers.size,
      guestCount: liveRoom.guests.size,
      stats: liveRoom.stats,
    },
  });
}

// ✅ CONTRÔLES LIVE
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
      }
      break;
      
    default:
      broadcastToRoom(roomId, message, ws);
  }
}

// ✅ CHAT LIVE
async function handleLiveChat(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;
  
  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }
  
  // Ajouter des infos du sender
  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
    },
  };
  
  broadcastToRoom(roomId, enrichedMessage);
  
  console.log(`💬 Message chat de ${client.userId} dans ${roomId}`);
}

// ✅ CADEAUX VIRTUELS
async function handleVirtualGift(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;
  
  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }
  
  // Mettre à jour les stats du live
  if (liveRooms.has(roomId)) {
    const liveRoom = liveRooms.get(roomId);
    liveRoom.stats.totalGifts += message.data.quantity || 1;
    
    if (message.data.giftId === 'heart') {
      liveRoom.stats.totalHearts += message.data.quantity || 1;
    }
  }
  
  // Enrichir le message
  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
    },
  };
  
  broadcastToRoom(roomId, enrichedMessage);
  
  console.log(`🎁 Cadeau ${message.data.giftId} de ${client.userId} dans ${roomId}`);
}

// ✅ HEARTBEAT
function handleHeartbeat(ws, message) {
  const client = clients.get(ws);
  if (client) {
    client.lastHeartbeat = new Date();
  }
  
  // Répondre au heartbeat
  sendMessage(ws, {
    type: 'heartbeatAck',
    from: 'server',
    to: client.userId,
    data: { timestamp: new Date().toISOString() },
  });
}

// ✅ DÉCONNEXION
function handleDisconnection(ws) {
  const client = clients.get(ws);
  if (!client) return;
  
  console.log(`📱 Déconnexion: ${client.userId}`);
  
  // Quitter la room si nécessaire
  if (client.roomId) {
    handleLeaveRoom(ws, { to: client.roomId });
  }
  
  // Nettoyer les références
  clients.delete(ws);
}

// ✅ UTILITAIRES
function sendMessage(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws, error) {
  sendMessage(ws, {
    type: 'error',
    from: 'server',
    to: 'client',
    data: { error },
  });
}

function broadcastToRoom(roomId, message, excludeWs = null) {
  if (!rooms.has(roomId)) return;
  
  const room = rooms.get(roomId);
  room.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      sendMessage(ws, message);
    }
  });
}

function generateClientId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// ✅ NETTOYAGE PÉRIODIQUE
setInterval(() => {
  const now = new Date();
  let cleanedClients = 0;
  
  // Nettoyer les clients inactifs
  clients.forEach((client, ws) => {
    const timeSinceHeartbeat = now - client.lastHeartbeat;
    
    // Déconnecter après 2 minutes sans heartbeat
    if (timeSinceHeartbeat > 120000) {
      console.log(`🧹 Nettoyage client inactif: ${client.userId}`);
      ws.terminate();
      handleDisconnection(ws);
      cleanedClients++;
    }
  });
  
  if (cleanedClients > 0) {
    console.log(`🧹 ${cleanedClients} clients inactifs nettoyés`);
  }
}, 60000); // Vérifier toutes les minutes

// ✅ STATISTIQUES PÉRIODIQUES
setInterval(() => {
  console.log(`📊 Stats: ${clients.size} clients, ${rooms.size} rooms, ${liveRooms.size} lives`);
}, 300000); // Toutes les 5 minutes

// ✅ DÉMARRAGE DU SERVEUR
server.listen(PORT, () => {
  console.log(`🚀 Serveur de signaling démarré sur le port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 API: http://localhost:${PORT}`);
});

// Gestion des erreurs
process.on('uncaughtException', (error) => {
  console.error('❌ Erreur non gérée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesse rejetée non gérée:', reason);
});

// Arrêt propre
process.on('SIGINT', () => {
  console.log('🛑 Arrêt du serveur...');
  
  // Fermer toutes les connexions WebSocket
  wss.clients.forEach(ws => {
    ws.close();
  });
  
  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });
});

module.exports = { app, server, wss };