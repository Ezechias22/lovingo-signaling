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
};