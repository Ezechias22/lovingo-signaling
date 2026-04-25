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

const COIN_PACKAGES = {
  starter: {
    id: 'starter',
    name: 'Starter Coins',
    coins: 25000,
    usd: 5,
    currency: 'usd',
  },
  popular: {
    id: 'popular',
    name: 'Popular Coins',
    coins: 60000,
    usd: 12,
    currency: 'usd',
  },
  mega: {
    id: 'mega',
    name: 'Mega Coins',
    coins: 125000,
    usd: 25,
    currency: 'usd',
  },
  vip: {
    id: 'vip',
    name: 'VIP Coins',
    coins: 275000,
    usd: 55,
    currency: 'usd',
  },
};

function db() {
  return getFirestore();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function hashValue(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');
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

async function createFraudLog({
  type,
  userId,
  publicId,
  packageId,
  ipHash,
  reason,
  metadata = {},
}) {
  await db().collection('fraud_logs').add({
    type,
    userId: userId || null,
    publicId: publicId || null,
    packageId: packageId || null,
    ipHash: ipHash || null,
    reason,
    metadata,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function checkPurchaseRisk({
  req,
  userId,
  publicId,
  packageId,
  selectedPackage,
}) {
  const ipHash = hashValue(getClientIp(req));
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const purchasesByUserLastHour = await db()
    .collection('payment_intent_logs')
    .where('userId', '==', userId)
    .where('type', '==', 'coin_purchase')
    .where('createdAtDate', '>=', oneHourAgo)
    .limit(20)
    .get();

  if (purchasesByUserLastHour.size >= 10) {
    await createFraudLog({
      type: 'coin_purchase_blocked',
      userId,
      publicId,
      packageId,
      ipHash,
      reason: 'too_many_user_attempts_hour',
    });

    return {
      allowed: false,
      reason: 'Trop de tentatives. Réessayez plus tard.',
    };
  }

  const purchasesByIpLastHour = await db()
    .collection('payment_intent_logs')
    .where('ipHash', '==', ipHash)
    .where('type', '==', 'coin_purchase')
    .where('createdAtDate', '>=', oneHourAgo)
    .limit(30)
    .get();

  if (purchasesByIpLastHour.size >= 20) {
    await createFraudLog({
      type: 'coin_purchase_blocked',
      userId,
      publicId,
      packageId,
      ipHash,
      reason: 'too_many_ip_attempts_hour',
    });

    return {
      allowed: false,
      reason: 'Trop de tentatives depuis ce réseau. Réessayez plus tard.',
    };
  }

  const vipPurchasesByUserDay = await db()
    .collection('payment_intent_logs')
    .where('userId', '==', userId)
    .where('type', '==', 'coin_purchase')
    .where('packageId', '==', 'vip')
    .where('createdAtDate', '>=', oneDayAgo)
    .limit(6)
    .get();

  if (selectedPackage.id === 'vip' && vipPurchasesByUserDay.size >= 5) {
    await createFraudLog({
      type: 'coin_purchase_blocked',
      userId,
      publicId,
      packageId,
      ipHash,
      reason: 'too_many_vip_purchases_day',
    });

    return {
      allowed: false,
      reason: 'Limite de sécurité atteinte pour ce pack aujourd’hui.',
    };
  }

  return {
    allowed: true,
    ipHash,
  };
}

async function logPaymentIntent({
  paymentIntent,
  userId,
  publicId,
  packageId,
  selectedPackage,
  source,
  req,
}) {
  const ipHash = hashValue(getClientIp(req));

  await db().collection('payment_intent_logs').doc(paymentIntent.id).set({
    paymentIntentId: paymentIntent.id,
    type: 'coin_purchase',
    userId,
    publicId: publicId || null,
    packageId,
    coins: selectedPackage.coins,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    source,
    ipHash,
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
      return res.status(400).json({
        error: 'Montant invalide',
      });
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
      automatic_payment_methods: {
        enabled: true,
      },
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
      return res.status(400).json({
        error: 'Package coins invalide',
      });
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
      return res.status(400).json({
        error: 'userId ou publicId requis',
      });
    }

    await ensureWalletExists(targetUserId);

    const risk = await checkPurchaseRisk({
      req,
      userId: targetUserId,
      publicId: targetPublicId,
      packageId,
      selectedPackage,
    });

    if (!risk.allowed) {
      return res.status(429).json({
        error: risk.reason,
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
        createdAt: new Date().toISOString(),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    await logPaymentIntent({
      paymentIntent,
      userId: targetUserId,
      publicId: targetPublicId,
      packageId,
      selectedPackage,
      source,
      req,
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      package: selectedPackage,
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
      return res.status(400).json({
        error: 'Package de crédits invalide',
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: 'userId requis',
      });
    }

    await ensureWalletExists(userId);

    const risk = await checkPurchaseRisk({
      req,
      userId,
      publicId: null,
      packageId,
      selectedPackage,
    });

    if (!risk.allowed) {
      return res.status(429).json({
        error: risk.reason,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(selectedPackage.usd * 100),
      currency: selectedPackage.currency,
      metadata: {
        app: 'lovingo',
        type: 'coin_purchase',
        source: 'legacy_purchase_credits',
        userId,
        publicId: '',
        packageId: selectedPackage.id,
        packageName: selectedPackage.name,
        coins: String(selectedPackage.coins),
        usd: String(selectedPackage.usd),
        coinsPerUsd: String(COINS_PER_USD),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    await logPaymentIntent({
      paymentIntent,
      userId,
      publicId: null,
      packageId,
      selectedPackage,
      source: 'legacy_purchase_credits',
      req,
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      package: selectedPackage,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('❌ Erreur achat crédits:', error);
    return res.status(400).json({
      error: error.message,
    });
  }
});

async function stripeWebhookHandler(req, res) {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (!endpointSecret) {
      return res.status(500).json({
        error: 'STRIPE_WEBHOOK_SECRET manquant',
      });
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
      return res.json({
        received: true,
        duplicated: true,
      });
    }

    await eventRef.set({
      type: event.type,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};

      await db()
        .collection('payment_intent_logs')
        .doc(paymentIntent.id)
        .set(
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
        const transactionRef = db()
          .collection('coin_transactions')
          .doc(paymentIntent.id);

        await db().runTransaction(async (transaction) => {
          const transactionDoc = await transaction.get(transactionRef);

          if (transactionDoc.exists) {
            return;
          }

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

    return res.json({
      received: true,
    });
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