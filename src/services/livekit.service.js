const { AccessToken } = require('livekit-server-sdk');
const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
} = require('../config');

function requireLiveKitConfig() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error(
      'LIVEKIT_URL, LIVEKIT_API_KEY ou LIVEKIT_API_SECRET manquant dans les variables d’environnement'
    );
  }
}

function safeString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

async function createLiveKitToken({
  roomId,
  identity,
  name,
  role = 'audience',
  metadata = {},
}) {
  requireLiveKitConfig();

  const safeRole = ['host', 'guest', 'audience'].includes(role)
    ? role
    : 'audience';

  const safeIdentity = safeString(String(identity || 'participant'));
  const safeName = safeString(String(name || safeIdentity));

  const realUserId = safeString(
    String(metadata.userId || ''),
    safeIdentity
  );

  const realUserName = safeString(
    String(metadata.userName || metadata.displayName || ''),
    safeName
  );

  const photoUrl = safeString(String(metadata.photoUrl || ''), '') || null;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: safeIdentity,
    name: safeName,
    ttl: '2h',
    metadata: JSON.stringify({
      userId: realUserId,
      userName: realUserName,
      username: realUserName,
      displayName: realUserName,
      photoUrl,
      avatar: photoUrl,
      role: safeRole,
      isHost: safeRole === 'host',
      isGuest: safeRole === 'guest',
      isAudience: safeRole === 'audience',
      isVerified: metadata.isVerified === true,
      level: Number(metadata.level) || 1,
    }),
  });

  const canPublish = safeRole === 'host' || safeRole === 'guest';

    at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: canPublish ? ['camera', 'microphone'] : [],
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