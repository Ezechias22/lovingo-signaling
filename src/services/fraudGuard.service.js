// signaling_server/src/services/fraudGuard.service.js
const { admin, getFirestore } = require('./firebase.service');

function db() {
  return getFirestore();
}

async function computeRiskScore({
  userId,
  ipHash,
  packageId,
  amount,
}) {
  let score = 0;

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  // 🔴 1. Trop d’achats récents (user)
  const userRecent = await db()
    .collection('payment_intent_logs')
    .where('userId', '==', userId)
    .where('createdAtDate', '>=', oneHourAgo)
    .get();

  if (userRecent.size > 5) score += 25;
  if (userRecent.size > 10) score += 40;

  // 🔴 2. Trop d’IP
  const ipRecent = await db()
    .collection('payment_intent_logs')
    .where('ipHash', '==', ipHash)
    .where('createdAtDate', '>=', oneHourAgo)
    .get();

  if (ipRecent.size > 10) score += 30;

  // 🔴 3. Achat trop élevé
  if (amount > 5000) score += 20;

  // 🔴 4. Nouveau compte (faible historique)
  const userDoc = await db().collection('users').doc(userId).get();
  const user = userDoc.data();

  if (user?.createdAt) {
    const created = user.createdAt.toDate?.() || new Date(user.createdAt);
    const ageHours = (Date.now() - created.getTime()) / (1000 * 60 * 60);

    if (ageHours < 24) score += 30;
  }

  return Math.min(score, 100);
}

async function isBlacklisted({ userId, ipHash }) {
  const userBlock = await db()
    .collection('fraud_blacklist')
    .doc(`user_${userId}`)
    .get();

  if (userBlock.exists) return true;

  const ipBlock = await db()
    .collection('fraud_blacklist')
    .doc(`ip_${ipHash}`)
    .get();

  return ipBlock.exists;
}

async function logFraudEvent(data) {
  await db().collection('fraud_logs').add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function evaluatePurchaseSecurity({
  req,
  userId,
  packageId,
  amount,
}) {
  const ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    'unknown';

  const ipHash = require('crypto')
    .createHash('sha256')
    .update(ip)
    .digest('hex');

  // 🔴 blacklist
  if (await isBlacklisted({ userId, ipHash })) {
    return {
      allowed: false,
      reason: 'Accès bloqué (sécurité)',
    };
  }

  const riskScore = await computeRiskScore({
    userId,
    ipHash,
    packageId,
    amount,
  });

  // 🔴 LOG
  await logFraudEvent({
    type: 'risk_evaluation',
    userId,
    ipHash,
    packageId,
    amount,
    riskScore,
  });

  // 🔴 blocage
  if (riskScore >= 70) {
    await logFraudEvent({
      type: 'blocked_high_risk',
      userId,
      ipHash,
      riskScore,
    });

    return {
      allowed: false,
      reason: 'Transaction bloquée (risque élevé)',
    };
  }

  return {
    allowed: true,
    riskScore,
    ipHash,
  };
}

module.exports = {
  evaluatePurchaseSecurity,
};