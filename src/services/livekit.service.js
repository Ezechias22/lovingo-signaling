const { AccessToken } = require('livekit-server-sdk');
const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
} = require('../config');

/**
 * Vérifie que LiveKit est correctement configuré
 */
function requireLiveKitConfig() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error(
      'LIVEKIT_URL, LIVEKIT_API_KEY ou LIVEKIT_API_SECRET manquant dans les variables d’environnement'
    );
  }
}

/**
 * Génère un token LiveKit sécurisé avec metadata utilisateur
 */
async function createLiveKitToken({
  roomId,
  identity,
  name,
  role = 'audience',
  metadata = {},
}) {
  requireLiveKitConfig();

  // Sécurisation du rôle
  const safeRole = ['host', 'guest', 'audience'].includes(role)
    ? role
    : 'audience';

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: String(identity),
    name: String(name || identity),
    ttl: '2h',
  });

  // 🎯 Permissions selon rôle
  const canPublish = safeRole === 'host' || safeRole === 'guest';

  at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });

  // 🔥 METADATA → ULTRA IMPORTANT POUR TON UI FLUTTER
  at.metadata = JSON.stringify({
    userId: String(identity),
    userName: String(name || identity),
    role: safeRole,

    // 👇 Infos enrichies pour UI
    photoUrl: metadata.photoUrl || null,
    bio: metadata.bio || null,
    isHost: safeRole === 'host',
    isGuest: safeRole === 'guest',
    isAudience: safeRole === 'audience',

    // 👇 pour futur features (gifts, badges, etc)
    isVerified: metadata.isVerified || false,
    level: metadata.level || 1,
  });

  const token = await at.toJwt();

  return {
    token,
    url: LIVEKIT_URL,
  };
}

module.exports = {
  requireLiveKitConfig,
  createLiveKitToken,
};