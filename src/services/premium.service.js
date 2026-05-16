// signaling_server/src/services/premium.service.js
const { admin, getFirestore } = require('./firebase.service');

const PREMIUM_PLANS = {
  premium_weekly: { id: 'premium_weekly', name: 'Weekly Premium', durationDays: 7, priceEUR: 4.99 },
  premium_monthly: { id: 'premium_monthly', name: 'Monthly Premium', durationDays: 30, priceEUR: 14.99 },
  premium_yearly: { id: 'premium_yearly', name: 'Yearly Premium', durationDays: 365, priceEUR: 89.99 },

  // Aliases for legacy IDs
  weekly: { id: 'premium_weekly', name: 'Weekly Premium', durationDays: 7, priceEUR: 4.99 },
  monthly: { id: 'premium_monthly', name: 'Monthly Premium', durationDays: 30, priceEUR: 14.99 },
  yearly: { id: 'premium_yearly', name: 'Yearly Premium', durationDays: 365, priceEUR: 89.99 },
};

function db() {
  return getFirestore();
}

function getPlan(planId) {
  return PREMIUM_PLANS[planId] || null;
}

async function activatePremium({
  userId,
  planId,
  source,
  durationDays,
  externalReference,
  amountPaid,
  currency,
  expiryTimeMs,
}) {
  if (!userId) throw new Error('userId required');

  const plan = getPlan(planId);
  const days =
    durationDays || (plan ? plan.durationDays : null) || 30;

  const now = Date.now();
  const userRef = db().collection('users').doc(userId);
  const userDoc = await userRef.get();
  const user = userDoc.exists ? userDoc.data() : {};

  let baseTime = now;

  if (user.premiumExpiry) {
    const currentExpiry =
      user.premiumExpiry.toDate?.()?.getTime() ||
      new Date(user.premiumExpiry).getTime();

    if (currentExpiry > now) {
      baseTime = currentExpiry;
    }
  }

  const computedExpiry =
    expiryTimeMs && expiryTimeMs > now
      ? expiryTimeMs
      : baseTime + days * 24 * 60 * 60 * 1000;

  const update = {
    isPremium: true,
    premiumPlan: plan ? plan.id : planId,
    premiumStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    premiumExpiry: new Date(computedExpiry),
    premiumLastSource: source || 'unknown',
    premiumLastUpdate: admin.firestore.FieldValue.serverTimestamp(),
  };

  await userRef.set(update, { merge: true });

  if (externalReference) {
    await db()
      .collection('premium_subscriptions')
      .doc(externalReference)
      .set(
        {
          userId,
          planId: plan ? plan.id : planId,
          source: source || 'unknown',
          status: 'active',
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiry: new Date(computedExpiry),
          amountPaid: amountPaid || null,
          currency: currency || null,
          externalReference,
        },
        { merge: true }
      );
  }

  return { ...update, expiryTime: computedExpiry };
}

async function deactivatePremium({ userId, reason }) {
  if (!userId) return;

  await db()
    .collection('users')
    .doc(userId)
    .set(
      {
        isPremium: false,
        premiumDeactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        premiumDeactivationReason: reason || 'unknown',
      },
      { merge: true }
    );
}

module.exports = {
  PREMIUM_PLANS,
  getPlan,
  activatePremium,
  deactivatePremium,
};
