// signaling_server/src/services/giftSecurity.service.js
const { admin, getFirestore } = require('./firebase.service');

const COINS_PER_USD = 5000;
const PLATFORM_COMMISSION_RATE = 0.20;
const CREATOR_SHARE_RATE = 0.80;

function db() {
  return getFirestore();
}

async function logGiftFraudEvent(data) {
  await db().collection('gift_fraud_logs').add({
    ...data,
    createdAtDate: new Date(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function isGiftBlockedUser(userId) {
  const blacklistDoc = await db()
    .collection('fraud_blacklist')
    .doc(`user_${userId}`)
    .get();

  if (blacklistDoc.exists) return true;

  const userDoc = await db().collection('users').doc(userId).get();

  if (!userDoc.exists) return true;

  const user = userDoc.data();

  return user.isGiftBlocked === true || user.isPaymentBlocked === true || user.isActive === false;
}

async function computeGiftRiskScore({
  senderId,
  receiverId,
  totalCoins,
  giftId,
}) {
  let score = 0;
  const reasons = [];

  if (!senderId || !receiverId || senderId === receiverId) {
    score += 100;
    reasons.push('invalid_sender_receiver');
  }

  if (!giftId) {
    score += 50;
    reasons.push('missing_gift_id');
  }

  if (!Number.isInteger(totalCoins) || totalCoins <= 0) {
    score += 100;
    reasons.push('invalid_total_coins');
  }

  if (totalCoins >= 250000) {
    score += 20;
    reasons.push('very_large_gift');
  }

  if (totalCoins >= 500000) {
    score += 35;
    reasons.push('extreme_large_gift');
  }

  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const giftsLastMinute = await db()
    .collection('gift_transactions')
    .where('senderId', '==', senderId)
    .where('timestampDate', '>=', oneMinuteAgo)
    .limit(20)
    .get();

  if (giftsLastMinute.size >= 8) {
    score += 55;
    reasons.push('gift_spam_last_minute');
  }

  const giftsLastHour = await db()
    .collection('gift_transactions')
    .where('senderId', '==', senderId)
    .where('timestampDate', '>=', oneHourAgo)
    .limit(120)
    .get();

  if (giftsLastHour.size >= 60) {
    score += 45;
    reasons.push('too_many_gifts_hour');
  }

  const sameReceiverLastHour = await db()
    .collection('gift_transactions')
    .where('senderId', '==', senderId)
    .where('receiverId', '==', receiverId)
    .where('timestampDate', '>=', oneHourAgo)
    .limit(80)
    .get();

  if (sameReceiverLastHour.size >= 40) {
    score += 35;
    reasons.push('too_many_gifts_same_receiver');
  }

  score = Math.min(score, 100);

  return {
    allowed: score < 70,
    score,
    reasons,
  };
}

function calculateGiftAmounts(totalCoins) {
  const totalUsd = totalCoins / COINS_PER_USD;
  const platformCommissionUsd = totalUsd * PLATFORM_COMMISSION_RATE;
  const receiverAmountUsd = totalUsd * CREATOR_SHARE_RATE;

  return {
    totalUsd,
    receiverAmountUsd,
    platformCommissionUsd,
    commissionRate: PLATFORM_COMMISSION_RATE,
  };
}

module.exports = {
  COINS_PER_USD,
  PLATFORM_COMMISSION_RATE,
  CREATOR_SHARE_RATE,
  logGiftFraudEvent,
  isGiftBlockedUser,
  computeGiftRiskScore,
  calculateGiftAmounts,
};