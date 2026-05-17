// signaling_server/src/routes/googleplay.routes.js
const express = require('express');

const gp = require('../services/googleplay.service');
const premiumService = require('../services/premium.service');
const { admin, getFirestore } = require('../services/firebase.service');

const router = express.Router();

const COIN_PRODUCTS = {
  coins_starter1: { id: 'coins_starter1', coins: 25000 },
  coins_popular: { id: 'coins_popular', coins: 60000 },
  coins_mega: { id: 'coins_mega', coins: 125000 },
  coins_vip: { id: 'coins_vip', coins: 275000 },
};

const SUBSCRIPTION_TO_PLAN = {
  premium_weekly: 'premium_weekly',
  premium_monthly: 'premium_monthly',
  premium_yearly: 'premium_yearly',
};

function db() {
  return getFirestore();
}

async function ensureWalletExists(userId) {
  const ref = db().collection('user_wallets').doc(userId);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({
      balance: 0, totalEarnings: 0, pendingWithdrawal: 0,
      coinBalance: 0, coinsPurchased: 0, coinsSpent: 0,
      totalGiftEarnings: 0, paymentMethod: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return ref;
}

async function creditCoinsFromGooglePlay({ userId, productId, purchaseToken, orderId }) {
  const product = COIN_PRODUCTS[productId];
  if (!product) throw new Error(`Unknown coin product: ${productId}`);

  const externalRef = `gp_${orderId || purchaseToken}`;
  const walletRef = await ensureWalletExists(userId);
  const txRef = db().collection('coin_transactions').doc(externalRef);

  await db().runTransaction(async (tx) => {
    const txDoc = await tx.get(txRef);
    if (txDoc.exists) return;

    tx.update(walletRef, {
      coinBalance: admin.firestore.FieldValue.increment(product.coins),
      coinsPurchased: admin.firestore.FieldValue.increment(product.coins),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(txRef, {
      userId, type: 'coinPurchase', direction: 'credit',
      coins: product.coins, packageId: productId,
      source: 'google_play', externalRef,
      googlePlayOrderId: orderId || null,
      googlePlayPurchaseToken: purchaseToken,
      status: 'completed',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(db().collection('wallet_transactions').doc(), {
      userId, type: 'coinPurchase', amount: 0,
      description: `Achat coins Google Play: ${product.coins}`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      metadata: { coins: product.coins, productId, source: 'google_play', orderId, externalRef },
    });
  });
}

// ============================================
// 🛒 POST /api/googleplay/verify-product
// Body: { userId, productId, purchaseToken }
// ============================================
router.post('/api/googleplay/verify-product', async (req, res) => {
  try {
    const { userId, productId, purchaseToken } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!productId) return res.status(400).json({ error: 'productId requis' });
    if (!purchaseToken) return res.status(400).json({ error: 'purchaseToken requis' });

    const product = COIN_PRODUCTS[productId];
    if (!product) return res.status(400).json({ error: 'Produit inconnu' });

    const tokenHash = require('crypto')
      .createHash('sha256').update(purchaseToken).digest('hex');
    const dedupeRef = db().collection('gplay_purchase_tokens').doc(tokenHash);
    const dedupeDoc = await dedupeRef.get();

    if (dedupeDoc.exists && dedupeDoc.data().consumed) {
      return res.status(409).json({ error: 'Token déjà utilisé', verified: false });
    }

    const purchase = await gp.verifyProductPurchase({ productId, purchaseToken });

    if (purchase.purchaseState !== 0) {
      return res.json({
        verified: false,
        purchaseState: purchase.purchaseState,
        message: 'Purchase not in PURCHASED state',
      });
    }

    await creditCoinsFromGooglePlay({
      userId, productId, purchaseToken,
      orderId: purchase.orderId,
    });

    if (purchase.acknowledgementState !== 1) {
      try {
        await gp.consumeProduct({ productId, purchaseToken });
      } catch (e) {
        console.warn('⚠️ GP consume failed:', e.message);
      }
    }

    await dedupeRef.set({
      userId, productId,
      orderId: purchase.orderId,
      consumed: true,
      consumedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      verified: true,
      coins: product.coins,
      orderId: purchase.orderId,
      purchaseState: purchase.purchaseState,
    });
  } catch (e) {
    console.error('❌ GP verify-product:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 💎 POST /api/googleplay/verify-subscription
// Body: { userId, subscriptionId, purchaseToken }
// ============================================
router.post('/api/googleplay/verify-subscription', async (req, res) => {
  try {
    const { userId, subscriptionId, purchaseToken } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId requis' });
    if (!purchaseToken) return res.status(400).json({ error: 'purchaseToken requis' });

    const planId = SUBSCRIPTION_TO_PLAN[subscriptionId];
    if (!planId) return res.status(400).json({ error: 'Subscription inconnue' });

    const sub = await gp.verifySubscriptionPurchase({ purchaseToken });

    const lineItem = sub.lineItems?.[0];
    const expiryTime = lineItem?.expiryTime || sub.expiryTime;
    const expiryMs = expiryTime ? new Date(expiryTime).getTime() : 0;

    if (expiryMs < Date.now()) {
      return res.json({
        verified: false,
        state: sub.subscriptionState,
        expiryTime,
        message: 'Subscription expired',
      });
    }

    await premiumService.activatePremium({
      userId,
      planId,
      source: 'google_play',
      externalReference: `gp_sub_${purchaseToken.substring(0, 30)}`,
      expiryTimeMs: expiryMs,
    });

    await db().collection('gplay_subscriptions').doc(purchaseToken).set({
      userId, subscriptionId, planId,
      purchaseToken,
      state: sub.subscriptionState,
      expiryTime,
      autoRenewing: lineItem?.autoRenewingPlan?.autoRenewEnabled ?? null,
      linkedPurchaseToken: sub.linkedPurchaseToken || null,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (sub.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
      try {
        await gp.acknowledgeSubscription({ subscriptionId, purchaseToken });
      } catch (e) {
        console.warn('⚠️ GP ack subscription failed:', e.message);
      }
    }

    res.json({
      verified: true,
      planId,
      expiryTime,
      state: sub.subscriptionState,
    });
  } catch (e) {
    console.error('❌ GP verify-subscription:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 🔔 POST /api/googleplay/rtdn-webhook
// Real-Time Developer Notifications via Pub/Sub push
// ============================================
router.post('/api/googleplay/rtdn-webhook', async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.data) {
      return res.status(200).json({ status: 'no_data' });
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded);

    const messageId = message.messageId;
    const eventRef = db().collection('gplay_events').doc(messageId);
    const existing = await eventRef.get();

    if (existing.exists) {
      return res.status(200).json({ received: true, duplicated: true });
    }

    await eventRef.set({
      payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payload.testNotification) {
      console.log('✅ GP Test notification received');
      return res.status(200).json({ received: true, test: true });
    }

    if (payload.subscriptionNotification) {
      const { notificationType, purchaseToken, subscriptionId } =
        payload.subscriptionNotification;

      const planId = SUBSCRIPTION_TO_PLAN[subscriptionId];
      const subRef = db().collection('gplay_subscriptions').doc(purchaseToken);
      const subDoc = await subRef.get();
      const userId = subDoc.exists ? subDoc.data().userId : null;

      try {
        const sub = await gp.verifySubscriptionPurchase({ purchaseToken });
        const expiry = sub.lineItems?.[0]?.expiryTime || sub.expiryTime;
        const expiryMs = expiry ? new Date(expiry).getTime() : 0;

        if (userId && planId && [1, 2, 4, 7].includes(notificationType) && expiryMs > Date.now()) {
          await premiumService.activatePremium({
            userId, planId,
            source: 'google_play_rtdn',
            externalReference: `gp_sub_${purchaseToken.substring(0, 30)}`,
            expiryTimeMs: expiryMs,
          });
        }

        if (userId && [3, 12, 13].includes(notificationType)) {
          await premiumService.deactivatePremium({
            userId,
            reason: `gp_rtdn_type_${notificationType}`,
          });
        }

        await subRef.set({
          state: sub.subscriptionState,
          expiryTime: expiry,
          lastRtdnType: notificationType,
          lastRtdnAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        console.warn('⚠️ RTDN sub verification failed:', e.message);
      }
    }

    if (payload.oneTimeProductNotification) {
      const { purchaseToken, sku, notificationType } = payload.oneTimeProductNotification;
      console.log(`📦 GP one-time notification: sku=${sku}, type=${notificationType}`);

      if (notificationType === 1) {
        await db().collection('gplay_pending_consumables').add({
          purchaseToken, sku, notificationType,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error('❌ GP RTDN webhook:', e);
    res.status(200).json({ received: true, error: e.message });
  }
});

module.exports = router;
