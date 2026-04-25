// signaling_server/src/routes/payment.routes.js
const express = require('express');
const crypto = require('crypto');

const { stripe } = require('../services/stripe.service');
const { admin, getFirestore } = require('../services/firebase.service');
const {
  resolveUserByPublicId,
  normalizePublicId,
} = require('../services/publicId.service');

const router = express.Router();

const COINS_PER_USD = 5000;
const AUTO_BAN_FAILED_ATTEMPTS = 3;

const COIN_PACKAGES = {
  starter: { id: 'starter', name: 'Starter Coins', coins: 25000, usd: 5, currency: 'usd' },
  popular: { id: 'popular', name: 'Popular Coins', coins: 60000, usd: 12, currency: 'usd' },
  mega: { id: 'mega', name: 'Mega Coins', coins: 125000, usd: 25, currency: 'usd' },
  vip: { id: 'vip', name: 'VIP Coins', coins: 275000, usd: 55, currency: 'usd' },
};

function db() {
  return getFirestore();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function ensureWalletExists(userId) {
  const walletRef = db().collection('user_wallets').doc(userId);
  const walletDoc = await walletRef.get();

  if (!walletDoc.exists) {
    await walletRef.set({
      balance: 0,
      totalEarnings: 0,
      pendingWithdrawal: 0,
      coinBalance: 0,
      coinsPurchased: 0,
      coinsSpent: 0,
      totalGiftEarnings: 0,
      paymentMethod: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return walletRef;
}

async function logFraudEvent(data) {
  await db().collection('fraud_logs').add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function isBlacklisted({ userId, ipHash }) {
  const checks = [];

  if (userId) checks.push(db().collection('fraud_blacklist').doc(`user_${userId}`).get());
  if (ipHash) checks.push(db().collection('fraud_blacklist').doc(`ip_${ipHash}`).get());

  const results = await Promise.all(checks);
  return results.some((doc) => doc.exists);
}

async function autoBanIfNeeded({ userId, ipHash, reason }) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const attempts = await db()
    .collection('fraud_logs')
    .where('userId', '==', userId)
    .where('type', 'in', ['blocked_high_risk', 'purchase_blocked', 'blacklist_attempt'])
    .where('createdAtDate', '>=', since)
    .limit(10)
    .get()
    .catch(() => null);

  const count = attempts?.size || 0;

  if (count + 1 >= AUTO_BAN_FAILED_ATTEMPTS) {
    const batch = db().batch();

    batch.set(db().collection('fraud_blacklist').doc(`user_${userId}`), {
      userId,
      reason: reason || 'auto_ban_failed_attempts',
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (ipHash) {
      batch.set(db().collection('fraud_blacklist').doc(`ip_${ipHash}`), {
        ipHash,
        userId,
        reason: reason || 'auto_ban_failed_attempts',
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    batch.set(
      db().collection('users').doc(userId),
      {
        isPaymentBlocked: true,
        paymentBlockedReason: reason || 'auto_ban_failed_attempts',
        paymentBlockedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    await logFraudEvent({
      type: 'auto_ban_applied',
      userId,
      ipHash,
      reason,
      failedAttempts: count + 1,
      createdAtDate: new Date(),
    });
  }
}

async function computeSmartRiskScore({ req, userId, packageId, amountUsd }) {
  let score = 0;
  const reasons = [];

  const ip = getClientIp(req);
  const ipHash = hashValue(ip);
  const userAgentHash = hashValue(req.headers['user-agent'] || 'unknown');

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (await isBlacklisted({ userId, ipHash })) {
    return {
      allowed: false,
      score: 100,
      ipHash,
      userAgentHash,
      reasons: ['blacklisted'],
    };
  }

  const userDoc = await db().collection('users').doc(userId).get();
  const user = userDoc.exists ? userDoc.data() : null;

  if (!userDoc.exists) {
    score += 70;
    reasons.push('user_not_found');
  }

  if (user?.isPaymentBlocked === true) {
    score += 100;
    reasons.push('user_payment_blocked');
  }

  if (user?.isActive === false) {
    score += 90;
    reasons.push('inactive_user');
  }

  if (user?.createdAt) {
    const created = user.createdAt.toDate?.() || new Date(user.createdAt);
    const ageHours = (Date.now() - created.getTime()) / (1000 * 60 * 60);

    if (ageHours < 1) {
      score += 45;
      reasons.push('account_created_less_than_1h');
    } else if (ageHours < 24) {
      score += 25;
      reasons.push('new_account_less_than_24h');
    }
  }

  const userRecent = await db()
    .collection('payment_intent_logs')
    .where('userId', '==', userId)
    .where('createdAtDate', '>=', oneHourAgo)
    .limit(30)
    .get();

  if (userRecent.size >= 5) {
    score += 25;
    reasons.push('many_user_attempts_hour');
  }

  if (userRecent.size >= 10) {
    score += 45;
    reasons.push('excessive_user_attempts_hour');
  }

  const ipRecent = await db()
    .collection('payment_intent_logs')
    .where('ipHash', '==', ipHash)
    .where('createdAtDate', '>=', oneHourAgo)
    .limit(40)
    .get();

  if (ipRecent.size >= 10) {
    score += 30;
    reasons.push('many_ip_attempts_hour');
  }

  if (ipRecent.size >= 20) {
    score += 50;
    reasons.push('excessive_ip_attempts_hour');
  }

  const userDay = await db()
    .collection('payment_intent_logs')
    .where('userId', '==', userId)
    .where('createdAtDate', '>=', oneDayAgo)
    .limit(80)
    .get();

  const totalUsdToday = userDay.docs.reduce((sum, doc) => {
    const data = doc.data();
    return sum + Number(data.usd || 0);
  }, 0);

  if (totalUsdToday >= 150) {
    score += 35;
    reasons.push('high_daily_purchase_volume');
  }

  if (packageId === 'vip' && userDay.size >= 5) {
    score += 40;
    reasons.push('too_many_vip_attempts');
  }

  if (amountUsd >= 50 && userRecent.size >= 2) {
    score += 20;
    reasons.push('repeated_high_value_purchase');
  }

  if (!req.headers['user-agent']) {
    score += 15;
    reasons.push('missing_user_agent');
  }

  score = Math.min(score, 100);

  const allowed = score < 70;

  return {
    allowed,
    score,
    ipHash,
    userAgentHash,
    reasons,
  };
}

async function logPaymentIntent({ paymentIntent, userId, publicId, packageId, selectedPackage, source, req, risk }) {
  await db().collection('payment_intent_logs').doc(paymentIntent.id).set({
    paymentIntentId: paymentIntent.id,
    type: 'coin_purchase',
    userId,
    publicId: publicId || null,
    packageId,
    coins: selectedPackage.coins,
    usd: selectedPackage.usd,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    source,
    ipHash: risk.ipHash,
    userAgentHash: risk.userAgentHash,
    riskScore: risk.score,
    riskReasons: risk.reasons,
    status: paymentIntent.status,
    createdAtDate: new Date(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

router.get('/api/coin-packages', (req, res) => {
  return res.json({
    rate: {
      coinsPerUsd: COINS_PER_USD,
      label: '5000 coins = 1 USD',
    },
    packages: Object.values(COIN_PACKAGES),
  });
});

router.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', userId, metadata = {} } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount)),
      currency: String(currency).toLowerCase(),
      metadata: {
        app: 'lovingo',
        type: metadata.type || 'wallet_recharge',
        userId: userId || 'anonymous',
        createdAt: new Date().toISOString(),
        ...metadata,
      },
      automatic_payment_methods: { enabled: true },
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    console.error('❌ Erreur création PaymentIntent:', error);
    return res.status(400).json({
      error: 'Erreur lors de la création du paiement',
      details: error.message,
    });
  }
});

router.post('/api/create-coin-payment-intent', async (req, res) => {
  try {
    const { userId, publicId, packageId, source = 'app' } = req.body;
    const selectedPackage = COIN_PACKAGES[packageId];

    if (!selectedPackage) {
      return res.status(400).json({ error: 'Package coins invalide' });
    }

    let targetUserId = userId || null;
    let targetPublicId = publicId ? normalizePublicId(publicId) : null;

    if (!targetUserId && targetPublicId) {
      const resolved = await resolveUserByPublicId(targetPublicId);

      if (!resolved) {
        return res.status(404).json({
          error: 'Aucun utilisateur trouvé avec cet ID public',
        });
      }

      targetUserId = resolved.userId;
      targetPublicId = resolved.publicId;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'userId ou publicId requis' });
    }

    await ensureWalletExists(targetUserId);

    const risk = await computeSmartRiskScore({
      req,
      userId: targetUserId,
      packageId,
      amountUsd: selectedPackage.usd,
    });

    await logFraudEvent({
      type: risk.allowed ? 'risk_evaluation' : 'purchase_blocked',
      userId: targetUserId,
      publicId: targetPublicId,
      packageId,
      amountUsd: selectedPackage.usd,
      ipHash: risk.ipHash,
      userAgentHash: risk.userAgentHash,
      riskScore: risk.score,
      riskReasons: risk.reasons,
      createdAtDate: new Date(),
    });

    if (!risk.allowed) {
      await autoBanIfNeeded({
        userId: targetUserId,
        ipHash: risk.ipHash,
        reason: risk.reasons.join(','),
      });

      return res.status(403).json({
        error: 'Transaction bloquée par sécurité',
        riskScore: risk.score,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(selectedPackage.usd * 100),
      currency: selectedPackage.currency,
      metadata: {
        app: 'lovingo',
        type: 'coin_purchase',
        source,
        userId: targetUserId,
        publicId: targetPublicId || '',
        packageId: selectedPackage.id,
        packageName: selectedPackage.name,
        coins: String(selectedPackage.coins),
        usd: String(selectedPackage.usd),
        coinsPerUsd: String(COINS_PER_USD),
        riskScore: String(risk.score),
        createdAt: new Date().toISOString(),
      },
      automatic_payment_methods: { enabled: true },
    });

    await logPaymentIntent({
      paymentIntent,
      userId: targetUserId,
      publicId: targetPublicId,
      packageId,
      selectedPackage,
      source,
      req,
      risk,
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      package: selectedPackage,
      riskScore: risk.score,
      rate: {
        coinsPerUsd: COINS_PER_USD,
        label: '5000 coins = 1 USD',
      },
    });
  } catch (error) {
    console.error('❌ Erreur création achat coins:', error);
    return res.status(400).json({
      error: 'Erreur lors de la création achat coins',
      details: error.message,
    });
  }
});

router.post('/api/purchase-credits', async (req, res) => {
  try {
    const { userId, creditPackage } = req.body;

    const oldToNewPackageMap = {
      small: 'starter',
      medium: 'popular',
      large: 'mega',
      premium: 'vip',
    };

    const packageId = oldToNewPackageMap[creditPackage] || creditPackage;
    const selectedPackage = COIN_PACKAGES[packageId];

    if (!selectedPackage) {
      return res.status(400).json({ error: 'Package de crédits invalide' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    req.body.packageId = packageId;

    return router.handle(
      Object.assign(req, {
        url: '/api/create-coin-payment-intent',
        originalUrl: '/api/create-coin-payment-intent',
        body: {
          userId,
          packageId,
          source: 'legacy_purchase_credits',
        },
      }),
      res
    );
  } catch (error) {
    console.error('❌ Erreur achat crédits:', error);
    return res.status(400).json({ error: error.message });
  }
});

async function stripeWebhookHandler(req, res) {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    if (!endpointSecret) {
      return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET manquant' });
    }

    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      endpointSecret
    );
  } catch (error) {
    console.error('❌ Signature webhook Stripe invalide:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    const eventRef = db().collection('stripe_events').doc(event.id);
    const eventDoc = await eventRef.get();

    if (eventDoc.exists) {
      return res.json({ received: true, duplicated: true });
    }

    await eventRef.set({
      type: event.type,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};

      await db().collection('payment_intent_logs').doc(paymentIntent.id).set(
        {
          status: paymentIntent.status,
          succeededAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (metadata.app === 'lovingo' && metadata.type === 'coin_purchase') {
        const userId = metadata.userId;
        const coins = Number(metadata.coins || 0);
        const packageId = metadata.packageId || '';
        const source = metadata.source || 'unknown';

        if (!userId || coins <= 0) {
          console.error('❌ Metadata coins invalide:', metadata);
          return res.json({ received: true });
        }

        const walletRef = await ensureWalletExists(userId);
        const transactionRef = db().collection('coin_transactions').doc(paymentIntent.id);

        await db().runTransaction(async (transaction) => {
          const transactionDoc = await transaction.get(transactionRef);

          if (transactionDoc.exists) return;

          transaction.update(walletRef, {
            coinBalance: admin.firestore.FieldValue.increment(coins),
            coinsPurchased: admin.firestore.FieldValue.increment(coins),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          });

          transaction.set(transactionRef, {
            userId,
            type: 'coinPurchase',
            direction: 'credit',
            coins,
            packageId,
            source,
            paymentIntentId: paymentIntent.id,
            amountPaid: paymentIntent.amount,
            currency: paymentIntent.currency,
            status: 'completed',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            metadata,
          });

          transaction.set(db().collection('wallet_transactions').doc(), {
            userId,
            type: 'coinPurchase',
            amount: 0,
            description: `Achat coins: ${coins} coins`,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            metadata: {
              coins,
              packageId,
              source,
              paymentIntentId: paymentIntent.id,
              amountPaid: paymentIntent.amount,
              currency: paymentIntent.currency,
            },
          });
        });

        console.log(`✅ Coins crédités: ${coins} coins pour user ${userId}`);
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};

      await logFraudEvent({
        type: 'payment_failed',
        userId: metadata.userId || null,
        publicId: metadata.publicId || null,
        packageId: metadata.packageId || null,
        paymentIntentId: paymentIntent.id,
        reason: paymentIntent.last_payment_error?.message || 'payment_failed',
        createdAtDate: new Date(),
      });
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('❌ Erreur traitement webhook Stripe:', error);
    return res.status(500).json({
      error: 'Erreur traitement webhook',
      details: error.message,
    });
  }
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
module.exports.COIN_PACKAGES = COIN_PACKAGES;
module.exports.COINS_PER_USD = COINS_PER_USD;