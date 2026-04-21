// ============================================
// 🧠 STATE GLOBAL (MEMORY STORE)
// ============================================

const rooms = new Map();
const clients = new Map();
const liveRooms = new Map();
const liveJoinRequests = new Map();

// ============================================
// 🔔 PUSH NOTIFICATIONS STORE (FCM)
// ============================================

// token -> device info
const deviceTokensByToken = new Map();

/*
Structure:
{
  token: string,
  platform: string,
  user_id: string | null,
  username: string | null,
  locale: string | null,
  created_at: string,
  updated_at: string,
  last_seen_at: string
}
*/

// user_id -> Set<token>
const userTokensIndex = new Map();

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // existing
  rooms,
  clients,
  liveRooms,
  liveJoinRequests,

  // new (push)
  deviceTokensByToken,
  userTokensIndex,
};