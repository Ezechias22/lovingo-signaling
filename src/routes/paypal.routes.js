// signaling_server/src/routes/paypal.routes.js
const express = require('express');
const crypto = require('crypto');

const paypal = require('../services/paypal.service');
const premiumService = require('../services/premium.service');
const { admin, getFirestore } = require('../services/firebase.service');

const router = express.Router();

const COIN_PACKAGES = {
  starter: { id: 'starter', name: 'Starter Coins', coins: 25000, usd: 5 },
  popular: { id: 'popular', name: 'Popular Coins', coins: 60000, usd: 12 },
  mega: { id: 'mega', name: 'Mega Coins', coins: 125000, usd: 25 },
  vip: { id: 'vip', name: 'VIP Coins', coins: 275000, usd: 55 },
};

const FX_USD_TO = {
  USD: 1, EUR: 0.92, BRL: 5.10, MXN: 17.0, ARS: 950,
  CAD: 1.36, AUD: 1.51, GBP: 0.79, JPY: 150,
};

function db() {
  return getFirestore();
}

function fmt(amount, currency) {
  const cur = String(currency || 'USD').toUpperCase();
  const rate = FX_USD_TO[cur] || 1;
  const value = Number(amount) * rate;
  const noDecimal = ['JPY', 'KRW', 'CLP'].includes(cur);
  return {
    currency_code: cur,
    value: noDecimal ? String(Math.round(value)) : value.toFixed(2),
  };
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

async function creditCoins({ userId, coins, packageId, source, externalRef, amountPaid, currency }) {
  const walletRef = await ensureWalletExists(userId);
  const txRef = db().collection('coin_transactions').doc(externalRef);

  await db().runTransaction(async (tx) => {
    const txDoc = await tx.get(txRef);
    if (txDoc.exists) return;

    tx.update(walletRef, {
      coinBalance: admin.firestore.FieldValue.increment(coins),
      coinsPurchased: admin.firestore.FieldValue.increment(coins),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(txRef, {
      userId, type: 'coinPurchase', direction: 'credit',
      coins, packageId, source, externalRef,
      amountPaid: amountPaid || null, currency: currency || null,
      status: 'completed',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(db().collection('wallet_transactions').doc(), {
      userId, type: 'coinPurchase', amount: 0,
      description: `Achat coins (${source}): ${coins} coins`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      metadata: { coins, packageId, source, externalRef, amountPaid, currency },
    });
  });
}

// ============================================
// 📋 GET /api/paypal/config
// ============================================
router.get('/api/paypal/config', (req, res) => {
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    mode: paypal.getMode(),
    enabled: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET),
  });
});

// ============================================
// 🛒 POST /api/paypal/create-coin-order
// ============================================
router.post('/api/paypal/create-coin-order', async (req, res) => {
  try {
    const { userId, packageId, currency = 'USD' } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const pkg = COIN_PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: 'Package invalide' });

    await ensureWalletExists(userId);

    const externalRef = `pp_coin_${userId}_${Date.now()}`;
    const amount = fmt(pkg.usd, currency);

    const order = await paypal.createOrder(
      {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: externalRef,
          description: `Lovingo - ${pkg.name} (${pkg.coins} coins)`,
          custom_id: JSON.stringify({
            app: 'lovingo', type: 'coin_purchase',
            userId, packageId, coins: pkg.coins,
          }),
          amount,
        }],
        application_context: {
          brand_name: 'Lovingo',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      },
      externalRef
    );

    await db().collection('paypal_orders').doc(order.id).set({
      orderId: order.id,
      type: 'coin_purchase',
      userId, packageId,
      coins: pkg.coins, usd: pkg.usd,
      amount: amount.value, currency: amount.currency_code,
      externalReference: externalRef,
      status: order.status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      orderId: order.id,
      status: order.status,
      coins: pkg.coins,
      amount: amount.value,
      currency: amount.currency_code,
    });
  } catch (e) {
    console.error('❌ PayPal create-coin-order:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 💎 POST /api/paypal/create-premium-order
// ============================================
router.post('/api/paypal/create-premium-order', async (req, res) => {
  try {
    const { userId, planId, currency = 'EUR' } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const plan = premiumService.getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Plan invalide' });

    const externalRef = `pp_premium_${userId}_${Date.now()}`;
    const amount = String(currency).toUpperCase() === 'EUR'
      ? { currency_code: 'EUR', value: plan.priceEUR.toFixed(2) }
      : fmt(plan.priceEUR / 0.92, currency);

    const order = await paypal.createOrder(
      {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: externalRef,
          description: `Lovingo Premium - ${plan.name}`,
          custom_id: JSON.stringify({
            app: 'lovingo', type: 'premium_purchase',
            userId, planId: plan.id, durationDays: plan.durationDays,
          }),
          amount,
        }],
        application_context: {
          brand_name: 'Lovingo',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      },
      externalRef
    );

    await db().collection('paypal_orders').doc(order.id).set({
      orderId: order.id,
      type: 'premium_purchase',
      userId, planId: plan.id,
      amount: amount.value, currency: amount.currency_code,
      externalReference: externalRef,
      status: order.status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      orderId: order.id,
      status: order.status,
      planId: plan.id,
      amount: amount.value,
      currency: amount.currency_code,
    });
  } catch (e) {
    console.error('❌ PayPal create-premium-order:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// ✅ POST /api/paypal/capture-order
// Body: { orderId }
// ============================================
router.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requis' });

    const orderDocRef = db().collection('paypal_orders').doc(orderId);
    const orderDoc = await orderDocRef.get();
    if (!orderDoc.exists) return res.status(404).json({ error: 'Order introuvable' });

    const orderData = orderDoc.data();

    if (orderData.captured) {
      return res.json({ status: 'already_captured', orderId });
    }

    const captureResult = await paypal.captureOrder(orderId, orderId);

    await orderDocRef.set({
      captured: true,
      captureResult,
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: captureResult.status,
    }, { merge: true });

    if (captureResult.status === 'COMPLETED') {
      const pu = captureResult.purchase_units?.[0];
      let custom = {};
      try {
        custom = JSON.parse(pu?.payments?.captures?.[0]?.custom_id || pu?.custom_id || '{}');
      } catch (_) {}

      const captureId = pu?.payments?.captures?.[0]?.id || orderId;
      const amountPaid = parseFloat(pu?.payments?.captures?.[0]?.amount?.value || 0);
      const currency = pu?.payments?.captures?.[0]?.amount?.currency_code || 'USD';

      if (custom.type === 'coin_purchase' && custom.userId && custom.coins) {
        await creditCoins({
          userId: custom.userId,
          coins: parseInt(custom.coins),
          packageId: custom.packageId,
          source: 'paypal',
          externalRef: `pp_${captureId}`,
          amountPaid, currency,
        });
      } else if (custom.type === 'premium_purchase' && custom.userId && custom.planId) {
        await premiumService.activatePremium({
          userId: custom.userId,
          planId: custom.planId,
          source: 'paypal',
          durationDays: parseInt(custom.durationDays) || 30,
          externalReference: orderId,
          amountPaid, currency,
        });
      }
    }

    res.json({
      status: captureResult.status,
      orderId,
      captureId: captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id,
    });
  } catch (e) {
    console.error('❌ PayPal capture-order:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 🔔 POST /api/paypal/webhook
// ============================================
router.post('/api/paypal/webhook', async (req, res) => {
  try {
    const headers = {};
    for (const k of Object.keys(req.headers)) headers[k.toLowerCase()] = req.headers[k];

    const isValid = await paypal.verifyWebhook({ headers, rawBody: req.body });
    if (!isValid && process.env.NODE_ENV === 'production') {
      console.warn('⚠️ PayPal webhook invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const eventId = req.body?.id;
    if (!eventId) return res.status(400).json({ error: 'Missing event id' });

    const eventRef = db().collection('paypal_events').doc(eventId);
    const existing = await eventRef.get();
    if (existing.exists) return res.json({ received: true, duplicated: true });

    await eventRef.set({
      type: req.body?.event_type,
      resource: req.body?.resource,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const eventType = req.body?.event_type;
    const resource = req.body?.resource || {};

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      let custom = {};
      try { custom = JSON.parse(resource.custom_id || '{}'); } catch (_) {}

      const amountPaid = parseFloat(resource.amount?.value || 0);
      const currency = resource.amount?.currency_code || 'USD';

      if (custom.type === 'coin_purchase' && custom.userId && custom.coins) {
        await creditCoins({
          userId: custom.userId,
          coins: parseInt(custom.coins),
          packageId: custom.packageId,
          source: 'paypal',
          externalRef: `pp_${resource.id}`,
          amountPaid, currency,
        });
      } else if (custom.type === 'premium_purchase' && custom.userId && custom.planId) {
        await premiumService.activatePremium({
          userId: custom.userId,
          planId: custom.planId,
          source: 'paypal',
          durationDays: parseInt(custom.durationDays) || 30,
          externalReference: resource.id,
          amountPaid, currency,
        });
      }
    }

    if (eventType?.startsWith('PAYMENT.PAYOUTS-ITEM')) {
      const itemId = resource.payout_item_id;
      if (itemId) {
        await db().collection('paypal_payouts').doc(itemId).set(
          {
            status: resource.transaction_status,
            event: eventType,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('❌ PayPal webhook:', e);
    res.status(200).json({ received: true, error: e.message });
  }
});

// ============================================
// 💸 POST /api/paypal/payout
// Body: { userId, withdrawalId, amount, currency, paypalEmail, note }
// ============================================
router.post('/api/paypal/payout', async (req, res) => {
  try {
    const { userId, withdrawalId, amount, currency = 'USD', paypalEmail, note } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (!paypalEmail || !/^[^@]+@[^@]+\.[^@]+$/.test(paypalEmail))
      return res.status(400).json({ error: 'Email PayPal invalide' });

    const requestId = withdrawalId || crypto.randomUUID();
    const senderBatchId = `batch_${requestId}`;

    const payoutBody = {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: 'Lovingo - Retrait de fonds',
        email_message: 'Votre retrait Lovingo a été envoyé.',
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: {
          value: Number(amount).toFixed(2),
          currency: String(currency).toUpperCase(),
        },
        note: note || `Retrait Lovingo (${withdrawalId || requestId})`,
        sender_item_id: requestId,
        receiver: paypalEmail,
      }],
    };

    const result = await paypal.createPayout(payoutBody, requestId);

    await db().collection('paypal_payouts').doc(senderBatchId).set({
      batchId: result.batch_header?.payout_batch_id,
      senderBatchId,
      userId, withdrawalId,
      amount: Number(amount), currency,
      paypalEmail,
      status: result.batch_header?.batch_status || 'PENDING',
      response: result,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      batchId: result.batch_header?.payout_batch_id,
      senderBatchId,
      status: result.batch_header?.batch_status || 'PENDING',
    });
  } catch (e) {
    console.error('❌ PayPal payout:', e.message, e.body);
    res.status(500).json({ error: e.message, details: e.body });
  }
});

module.exports = router;
