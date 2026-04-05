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

async function createLiveKitToken({
  roomId,
  identity,
  name,
  role = 'audience',
}) {
  requireLiveKitConfig();

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '2h',
  });

  const canPublish = role === 'host' || role === 'guest';

  at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
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