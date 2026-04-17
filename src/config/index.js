const PORT = Number(process.env.PORT) || 8080;
const MAX_CLIENTS_PER_ROOM = 100;

const RENDER_URL =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.RENDER_URL ||
  'https://lovingo-signaling.onrender.com';

const PLAYSTORE_URL =
  process.env.PLAYSTORE_URL ||
  'https://play.google.com/store/apps/details?id=com.lovingo2.app&pcampaignid=web_share';

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

function isLiveKitConfigured() {
  return Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

module.exports = {
  PORT,
  MAX_CLIENTS_PER_ROOM,
  RENDER_URL,
  PLAYSTORE_URL,
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  isLiveKitConfigured,
};