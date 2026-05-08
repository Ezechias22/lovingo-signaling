'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const { deviceTokensByToken, userTokensIndex } = require('../state/store');

let firebaseApp = null;
let firebaseInitError = null;
let firebaseMode = 'simulation'; // simulation | live

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function loadServiceAccount() {
  const envJson = process.env.FIREBASE_ADMIN_JSON;

  if (envJson && envJson.trim()) {
    const parsed = safeJsonParse(envJson);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    throw new Error(
      'FIREBASE_ADMIN_JSON existe mais son contenu JSON est invalide.'
    );
  }

  const localPath = path.join(__dirname, '..', '..', 'firebase-admin.json');
  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, 'utf8');
    const parsed = safeJsonParse(raw);

    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    throw new Error(
      'Le fichier firebase-admin.json existe mais son contenu JSON est invalide.'
    );
  }

  return null;
}

function initializeFirebaseAdmin() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    const serviceAccount = loadServiceAccount();

    if (!serviceAccount) {
      firebaseMode = 'simulation';
      firebaseInitError =
        'Aucun credential Firebase Admin trouvé (env FIREBASE_ADMIN_JSON ou fichier local firebase-admin.json).';
      console.warn(`⚠️ PushService: ${firebaseInitError}`);
      return null;
    }

    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
    } else {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    firebaseMode = 'live';
    firebaseInitError = null;
    console.log('✅ PushService: Firebase Admin initialisé');
    return firebaseApp;
  } catch (error) {
    firebaseMode = 'simulation';
    firebaseInitError = error.message || 'Erreur inconnue Firebase Admin';
    console.warn(`⚠️ PushService init fallback simulation: ${firebaseInitError}`);
    return null;
  }
}

function isFcmReady() {
  initializeFirebaseAdmin();
  return firebaseMode === 'live' && !!firebaseApp;
}

function getStatus() {
  initializeFirebaseAdmin();

  return {
    fcm_ready: isFcmReady(),
    mode: firebaseMode,
    initialized: !!firebaseApp,
    init_error: firebaseInitError,
    total_devices: deviceTokensByToken.size,
    total_users_indexed: userTokensIndex.size,
    timestamp: new Date().toISOString(),
  };
}

function normalizeToken(token) {
  return String(token || '').trim();
}

function normalizeUserId(userId) {
  const value = String(userId || '').trim();
  return value || null;
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function removeTokenFromUserIndex(userId, token) {
  if (!userId) return;

  const currentSet = userTokensIndex.get(userId);
  if (!currentSet) return;

  currentSet.delete(token);

  if (currentSet.size === 0) {
    userTokensIndex.delete(userId);
  }
}

function addTokenToUserIndex(userId, token) {
  if (!userId) return;

  if (!userTokensIndex.has(userId)) {
    userTokensIndex.set(userId, new Set());
  }

  userTokensIndex.get(userId).add(token);
}

function registerDevice({
  token,
  platform,
  user_id,
  username,
  locale,
}) {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    throw new Error('Le token device est requis.');
  }

  const existing = deviceTokensByToken.get(normalizedToken);
  const now = new Date().toISOString();
  const normalizedUserId = normalizeUserId(user_id);

  if (existing?.user_id && existing.user_id !== normalizedUserId) {
    removeTokenFromUserIndex(existing.user_id, normalizedToken);
  }

  const record = {
    token: normalizedToken,
    platform: normalizeOptionalString(platform) || 'unknown',
    user_id: normalizedUserId,
    username: normalizeOptionalString(username),
    locale: normalizeOptionalString(locale),
    created_at: existing?.created_at || now,
    updated_at: now,
    last_seen_at: now,
  };

  deviceTokensByToken.set(normalizedToken, record);
  addTokenToUserIndex(normalizedUserId, normalizedToken);

  return {
    ok: true,
    action: existing ? 'updated' : 'created',
    device: record,
  };
}

function listDevices() {
  return Array.from(deviceTokensByToken.values()).sort((a, b) => {
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function deleteDevice(token) {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    throw new Error('Le token à supprimer est requis.');
  }

  const existing = deviceTokensByToken.get(normalizedToken);
  if (!existing) {
    return {
      ok: true,
      deleted: false,
      token: normalizedToken,
    };
  }

  removeTokenFromUserIndex(existing.user_id, normalizedToken);
  deviceTokensByToken.delete(normalizedToken);

  return {
    ok: true,
    deleted: true,
    token: normalizedToken,
  };
}

async function sendToToken({
  token,
  title,
  body,
  image_url,
  data = {},
}) {
  initializeFirebaseAdmin();

  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    throw new Error('Le token cible est requis.');
  }

  if (!title && !body) {
    throw new Error('Le titre ou le body est requis pour envoyer une notification.');
  }

  const message = {
    token: normalizedToken,
    notification: {
      title: String(title || ''),
      body: String(body || ''),
    },
    data: stringifyData(data),
    android: {
      priority: 'high',
      notification: {
        channelId: 'lovingo_default',
        imageUrl: image_url || undefined,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
      fcmOptions: {
        imageUrl: image_url || undefined,
      },
    },
  };

  if (firebaseMode !== 'live' || !firebaseApp) {
    return {
      ok: true,
      mode: 'simulation',
      target_type: 'token',
      target_value: normalizedToken,
      message_preview: message,
      simulated: true,
    };
  }

  const response = await admin.messaging().send(message);

  return {
    ok: true,
    mode: 'live',
    target_type: 'token',
    target_value: normalizedToken,
    message_id: response,
  };
}

async function sendToTokens({
  tokens,
  title,
  body,
  image_url,
  data = {},
}) {
  initializeFirebaseAdmin();

  const normalizedTokens = Array.from(
    new Set((tokens || []).map(normalizeToken).filter(Boolean))
  );

  if (normalizedTokens.length === 0) {
    throw new Error('La liste des tokens cibles est vide.');
  }

  if (!title && !body) {
    throw new Error('Le titre ou le body est requis pour envoyer une notification.');
  }

  const message = {
    tokens: normalizedTokens,
    notification: {
      title: String(title || ''),
      body: String(body || ''),
    },
    data: stringifyData(data),
    android: {
      priority: 'high',
      notification: {
        channelId: 'lovingo_default',
        imageUrl: image_url || undefined,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
      fcmOptions: {
        imageUrl: image_url || undefined,
      },
    },
  };

  if (firebaseMode !== 'live' || !firebaseApp) {
    return {
      ok: true,
      mode: 'simulation',
      target_type: 'tokens',
      target_count: normalizedTokens.length,
      simulated: true,
      message_preview: message,
    };
  }

  const response = await admin.messaging().sendEachForMulticast(message);

  const failedTokens = [];
  response.responses.forEach((item, index) => {
    if (!item.success) {
      failedTokens.push({
        token: normalizedTokens[index],
        error: item.error?.message || 'Unknown error',
      });
    }
  });

  return {
    ok: true,
    mode: 'live',
    target_type: 'tokens',
    target_count: normalizedTokens.length,
    success_count: response.successCount,
    failure_count: response.failureCount,
    failed_tokens: failedTokens,
  };
}

async function sendToTopic({
  topic,
  title,
  body,
  image_url,
  data = {},
}) {
  initializeFirebaseAdmin();

  const normalizedTopic = normalizeOptionalString(topic);
  if (!normalizedTopic) {
    throw new Error('Le topic cible est requis.');
  }

  if (!title && !body) {
    throw new Error('Le titre ou le body est requis pour envoyer une notification.');
  }

  const message = {
    topic: normalizedTopic,
    notification: {
      title: String(title || ''),
      body: String(body || ''),
    },
    data: stringifyData(data),
    android: {
      priority: 'high',
      notification: {
        channelId: 'lovingo_default',
        imageUrl: image_url || undefined,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
      fcmOptions: {
        imageUrl: image_url || undefined,
      },
    },
  };

  if (firebaseMode !== 'live' || !firebaseApp) {
    return {
      ok: true,
      mode: 'simulation',
      target_type: 'topic',
      target_value: normalizedTopic,
      simulated: true,
      message_preview: message,
    };
  }

  const response = await admin.messaging().send(message);

  return {
    ok: true,
    mode: 'live',
    target_type: 'topic',
    target_value: normalizedTopic,
    message_id: response,
  };
}

async function sendToUser({
  user_id,
  title,
  body,
  image_url,
  data = {},
}) {
  const normalizedUserId = normalizeUserId(user_id);
  if (!normalizedUserId) {
    throw new Error('Le user_id cible est requis.');
  }

  const tokenSet = userTokensIndex.get(normalizedUserId);
  const tokens = tokenSet ? Array.from(tokenSet) : [];

  if (tokens.length === 0) {
    return {
      ok: true,
      mode: firebaseMode,
      target_type: 'user',
      target_value: normalizedUserId,
      success_count: 0,
      failure_count: 0,
      skipped: true,
      reason: 'Aucun device enregistré pour cet utilisateur.',
    };
  }

  return sendToTokens({
    tokens,
    title,
    body,
    image_url,
    data,
  }).then((result) => ({
    ...result,
    target_type: 'user',
    target_value: normalizedUserId,
  }));
}

async function subscribeTopic({
  topic,
  tokens,
}) {
  initializeFirebaseAdmin();

  const normalizedTopic = normalizeOptionalString(topic);
  if (!normalizedTopic) {
    throw new Error('Le topic est requis.');
  }

  const normalizedTokens = Array.from(
    new Set((tokens || []).map(normalizeToken).filter(Boolean))
  );

  if (normalizedTokens.length === 0) {
    throw new Error('Aucun token fourni pour l’abonnement au topic.');
  }

  if (firebaseMode !== 'live' || !firebaseApp) {
    return {
      ok: true,
      mode: 'simulation',
      topic: normalizedTopic,
      token_count: normalizedTokens.length,
      simulated: true,
    };
  }

  const response = await admin
    .messaging()
    .subscribeToTopic(normalizedTokens, normalizedTopic);

  return {
    ok: true,
    mode: 'live',
    topic: normalizedTopic,
    token_count: normalizedTokens.length,
    success_count: response.successCount,
    failure_count: response.failureCount,
    errors: response.errors || [],
  };
}

async function unsubscribeTopic({
  topic,
  tokens,
}) {
  initializeFirebaseAdmin();

  const normalizedTopic = normalizeOptionalString(topic);
  if (!normalizedTopic) {
    throw new Error('Le topic est requis.');
  }

  const normalizedTokens = Array.from(
    new Set((tokens || []).map(normalizeToken).filter(Boolean))
  );

  if (normalizedTokens.length === 0) {
    throw new Error('Aucun token fourni pour le désabonnement du topic.');
  }

  if (firebaseMode !== 'live' || !firebaseApp) {
    return {
      ok: true,
      mode: 'simulation',
      topic: normalizedTopic,
      token_count: normalizedTokens.length,
      simulated: true,
    };
  }

  const response = await admin
    .messaging()
    .unsubscribeFromTopic(normalizedTokens, normalizedTopic);

  return {
    ok: true,
    mode: 'live',
    topic: normalizedTopic,
    token_count: normalizedTokens.length,
    success_count: response.successCount,
    failure_count: response.failureCount,
    errors: response.errors || [],
  };
}

// ════════════════════════════════════════════════════════════════════════
// 📡 NOTIFICATION AUX FOLLOWERS QUAND UN LIVE DÉMARRE
// ════════════════════════════════════════════════════════════════════════

/**
 * Envoie une notification "X est en live" à tous les followers du host.
 * Utilise Firestore (sous-collection users/{hostId}/followers) pour la liste,
 * puis exploite les FCM tokens (mémoire + Firestore fallback).
 */
async function notifyFollowersOfLive({
  hostId,
  hostName,
  hostAvatar,
  liveRoomId,
  liveTitle,
}) {
  initializeFirebaseAdmin();

  if (!hostId || !liveRoomId) {
    console.warn('⚠️ notifyFollowersOfLive: hostId ou liveRoomId manquant');
    return { ok: false, sent: 0, failed: 0, reason: 'missing_params' };
  }

  if (firebaseMode !== 'live' || !firebaseApp) {
    console.warn(
      `⚠️ notifyFollowersOfLive: Firebase Admin non initialisé (${firebaseMode})`
    );
    return {
      ok: true,
      mode: 'simulation',
      sent: 0,
      failed: 0,
      simulated: true,
      reason: firebaseInitError || 'firebase_not_live',
    };
  }

  try {
    const db = admin.firestore();

    // 1. Récupère tous les followers du host
    const followersSnap = await db
      .collection('users')
      .doc(String(hostId))
      .collection('followers')
      .get();

    if (followersSnap.empty) {
      console.log(`ℹ️ Host ${hostId} n'a aucun follower`);
      return { ok: true, sent: 0, failed: 0, total_followers: 0 };
    }

    const followerIds = followersSnap.docs.map((d) => d.id);
    console.log(
      `📡 ${followerIds.length} followers à notifier pour live de ${hostName || hostId}`
    );

    // 2. Construit le payload commun
    const title = `🔴 ${hostName || 'Quelqu\'un'} est en live !`;
    const body =
      liveTitle && String(liveTitle).trim().length > 0
        ? String(liveTitle)
        : 'Rejoignez le live maintenant';

    const payloadData = {
      type: 'live_started',
      live_room_id: String(liveRoomId),
      host_id: String(hostId),
      host_name: String(hostName || ''),
      host_avatar: String(hostAvatar || ''),
      live_title: String(liveTitle || ''),
      action_url: '/live/room',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };

    // 3. Récupère les tokens (mémoire d'abord, puis Firestore en fallback)
    const allTokens = [];
    const tokenToUserId = new Map();

    const BATCH = 30;
    for (let i = 0; i < followerIds.length; i += BATCH) {
      const slice = followerIds.slice(i, i + BATCH);

      const idsToFetchFromFirestore = [];
      for (const fid of slice) {
        const memSet = userTokensIndex.get(fid);
        if (memSet && memSet.size > 0) {
          for (const t of memSet) {
            allTokens.push(t);
            tokenToUserId.set(t, fid);
          }
        } else {
          idsToFetchFromFirestore.push(fid);
        }
      }

      if (idsToFetchFromFirestore.length > 0) {
        try {
          const usersSnap = await db
            .collection('users')
            .where(
              admin.firestore.FieldPath.documentId(),
              'in',
              idsToFetchFromFirestore
            )
            .get();

          usersSnap.docs.forEach((doc) => {
            const data = doc.data() || {};

            // Préférences user (optionnelles)
            if (data.notificationsEnabled === false) return;
            if (data.liveNotificationsEnabled === false) return;

            const fcmTokens = Array.isArray(data.fcmTokens)
              ? data.fcmTokens
              : data.fcmToken
              ? [data.fcmToken]
              : [];

            fcmTokens.forEach((t) => {
              if (t && typeof t === 'string' && t.trim().length > 0) {
                allTokens.push(t.trim());
                tokenToUserId.set(t.trim(), doc.id);
              }
            });
          });
        } catch (e) {
          console.warn(
            `⚠️ Fetch Firestore fcmTokens batch a échoué: ${e.message}`
          );
        }
      }
    }

    const uniqueTokens = Array.from(new Set(allTokens));

    if (uniqueTokens.length === 0) {
      console.log('⚠️ Aucun FCM token valide parmi les followers');
      return {
        ok: true,
        sent: 0,
        failed: 0,
        total_followers: followerIds.length,
        reason: 'no_tokens',
      };
    }

    // 4. Construit le message FCM
    const baseMessage = {
      notification: { title, body },
      data: stringifyData(payloadData),
      android: {
        priority: 'high',
        notification: {
          channelId: 'lovingo_default',
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          imageUrl: hostAvatar || undefined,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
          },
        },
        fcmOptions: {
          imageUrl: hostAvatar || undefined,
        },
      },
    };

    // 5. Envoi multicast par chunks de 500
    let sent = 0;
    let failed = 0;
    const invalidTokens = [];

    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500);
      try {
        const resp = await admin.messaging().sendEachForMulticast({
          ...baseMessage,
          tokens: chunk,
        });
        sent += resp.successCount;
        failed += resp.failureCount;

        resp.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code || '';
            if (
              code.includes('registration-token-not-registered') ||
              code.includes('invalid-argument') ||
              code.includes('invalid-registration-token')
            ) {
              invalidTokens.push(chunk[idx]);
            }
          }
        });
      } catch (e) {
        console.error('❌ Erreur sendEachForMulticast (live):', e.message);
        failed += chunk.length;
      }
    }

    // 6. Cleanup tokens invalides
    if (invalidTokens.length > 0) {
      console.log(`🧹 Suppression de ${invalidTokens.length} tokens invalides`);
      for (const t of invalidTokens) {
        const uid = tokenToUserId.get(t);
        try {
          if (deviceTokensByToken.has(t)) {
            const rec = deviceTokensByToken.get(t);
            removeTokenFromUserIndex(rec?.user_id, t);
            deviceTokensByToken.delete(t);
          }
          if (uid) {
            await db
              .collection('users')
              .doc(uid)
              .update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(t),
              })
              .catch(() => {});
          }
        } catch (_) {}
      }
    }

    console.log(
      `✅ Live notification: ${sent} envoyées, ${failed} échecs (${followerIds.length} followers, ${uniqueTokens.length} tokens)`
    );

    return {
      ok: true,
      mode: 'live',
      sent,
      failed,
      total_followers: followerIds.length,
      total_tokens: uniqueTokens.length,
      cleaned_invalid: invalidTokens.length,
    };
  } catch (e) {
    console.error('❌ notifyFollowersOfLive erreur:', e);
    return { ok: false, sent: 0, failed: 0, error: e.message };
  }
}

function stringifyData(data) {
  const result = {};
  const input = data && typeof data === 'object' ? data : {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string') {
      result[key] = value;
      continue;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      result[key] = String(value);
      continue;
    }

    result[key] = JSON.stringify(value);
  }

  return result;
}

initializeFirebaseAdmin();

module.exports = {
  initializeFirebaseAdmin,
  isFcmReady,
  getStatus,
  registerDevice,
  listDevices,
  deleteDevice,
  sendToToken,
  sendToTokens,
  sendToTopic,
  sendToUser,
  subscribeTopic,
  unsubscribeTopic,
  notifyFollowersOfLive,
};