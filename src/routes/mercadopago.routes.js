// signaling_server/src/routes/mercadopago.routes.js
const express = require('express');
const crypto = require('crypto');

const mp = require('../services/mercadopago.service');
const premiumService = require('../services/premium.service');
const { admin, getFirestore } = require('../services/firebase.service');

const router = express.Router();

const COIN_PACKAGES = {
  starter: { id: 'starter', name: 'Starter Coins', coins: 25000, usd: 5 },
  popular: { id: 'popular', name: 'Popular Coins', coins: 60000, usd: 12 },
  mega: { id: 'mega', name: 'Mega Coins', coins: 125000, usd: 25 },
  vip: { id: 'vip', name: 'VIP Coins', coins: 275000, usd: 55 },
};

const FX_FROM_USD = {
  USD: 1, EUR: 0.92, BRL: 5.10, ARS: 950, MXN: 17.0,
  CLP: 920, COP: 4000, PEN: 3.7, UYU: 39.5, CAD: 1.36,
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

function convertUsdTo(usd, currency) {
  const rate = FX_FROM_USD[String(currency || 'USD').toUpperCase()] || 1;
  return Math.round(Number(usd) * rate * 100) / 100;
}

async function ensureWalletExists(userId) {
  const ref = db().collection('user_wallets').doc(userId);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({
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
      userId,
      type: 'coinPurchase',
      direction: 'credit',
      coins,
      packageId,
      source,
      externalRef,
      amountPaid: amountPaid || null,
      currency: currency || null,
      status: 'completed',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(db().collection('wallet_transactions').doc(), {
      userId,
      type: 'coinPurchase',
      amount: 0,
      description: `Achat coins (${source}): ${coins} coins`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      metadata: { coins, packageId, source, externalRef, amountPaid, currency },
    });
  });
}

// ============================================
// 📋 GET /api/mercadopago/config
// ============================================
router.get('/api/mercadopago/config', (req, res) => {
  res.json({
    publicKey: mp.getPublicKey(),
    enabled: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
  });
});

// ============================================
// 💳 POST /api/mercadopago/create-coin-payment
// Body: { userId, packageId, currency, cardToken, paymentMethodId, installments, payerEmail, payerCpf, issuerId }
// ============================================
router.post('/api/mercadopago/create-coin-payment', async (req, res) => {
  try {
    const {
      userId, packageId, currency = 'USD',
      cardToken, paymentMethodId, installments = 1,
      payerEmail, payerCpf, issuerId,
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!cardToken) return res.status(400).json({ error: 'cardToken requis' });
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId requis' });
    if (!payerEmail) return res.status(400).json({ error: 'payerEmail requis' });

    const pkg = COIN_PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: 'Package invalide' });

    await ensureWalletExists(userId);

    const localAmount = convertUsdTo(pkg.usd, currency);
    const idempotencyKey = crypto.randomUUID();

    const paymentBody = {
      transaction_amount: localAmount,
      token: cardToken,
      description: `Lovingo - ${pkg.name} (${pkg.coins} coins)`,
      installments: parseInt(installments) || 1,
      payment_method_id: paymentMethodId,
      issuer_id: issuerId || undefined,
      payer: {
        email: payerEmail,
        identification: payerCpf
          ? { type: 'CPF', number: String(payerCpf).replace(/\D/g, '') }
          : undefined,
      },
      external_reference: `mp_coin_${userId}_${Date.now()}`,
      notification_url: `${req.protocol}://${req.get('host')}/api/mercadopago/webhook`,
      metadata: {
        app: 'lovingo',
        type: 'coin_purchase',
        userId,
        packageId,
        coins: String(pkg.coins),
        usd: String(pkg.usd),
      },
    };

    const payment = await mp.createPayment(paymentBody, idempotencyKey);

    await db().collection('mp_payment_logs').doc(String(payment.id)).set({
      paymentId: payment.id,
      type: 'coin_purchase',
      userId,
      packageId,
      coins: pkg.coins,
      usd: pkg.usd,
      amount: localAmount,
      currency: String(currency).toUpperCase(),
      status: payment.status,
      ipHash: hashValue(getClientIp(req)),
      externalReference: paymentBody.external_reference,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payment.status === 'approved') {
      await creditCoins({
        userId,
        coins: pkg.coins,
        packageId,
        source: 'mercadopago',
        externalRef: `mp_${payment.id}`,
        amountPaid: localAmount,
        currency,
      });
    }

    res.json({
      paymentId: payment.id,
      status: payment.status,
      statusDetail: payment.status_detail,
      coins: pkg.coins,
      amount: localAmount,
      currency: String(currency).toUpperCase(),
    });
  } catch (e) {
    console.error('❌ MP create-coin-payment:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 💎 POST /api/mercadopago/create-premium-payment
// Body: { userId, planId, currency, cardToken, paymentMethodId, installments, payerEmail, payerCpf }
// ============================================
router.post('/api/mercadopago/create-premium-payment', async (req, res) => {
  try {
    const {
      userId, planId, currency = 'USD',
      cardToken, paymentMethodId, installments = 1,
      payerEmail, payerCpf, issuerId,
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const plan = premiumService.getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Plan invalide' });

    const usdPrice = plan.priceEUR / 0.92;
    const localAmount = convertUsdTo(usdPrice, currency);
    const idempotencyKey = crypto.randomUUID();
    const externalRef = `mp_premium_${userId}_${Date.now()}`;

    const paymentBody = {
      transaction_amount: localAmount,
      token: cardToken,
      description: `Lovingo Premium - ${plan.name}`,
      installments: parseInt(installments) || 1,
      payment_method_id: paymentMethodId,
      issuer_id: issuerId || undefined,
      payer: {
        email: payerEmail,
        identification: payerCpf
          ? { type: 'CPF', number: String(payerCpf).replace(/\D/g, '') }
          : undefined,
      },
      external_reference: externalRef,
      notification_url: `${req.protocol}://${req.get('host')}/api/mercadopago/webhook`,
      metadata: {
        app: 'lovingo',
        type: 'premium_purchase',
        userId,
        planId: plan.id,
        durationDays: String(plan.durationDays),
      },
    };

    const payment = await mp.createPayment(paymentBody, idempotencyKey);

    await db().collection('mp_payment_logs').doc(String(payment.id)).set({
      paymentId: payment.id,
      type: 'premium_purchase',
      userId,
      planId: plan.id,
      amount: localAmount,
      currency: String(currency).toUpperCase(),
      status: payment.status,
      externalReference: externalRef,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payment.status === 'approved') {
      await premiumService.activatePremium({
        userId,
        planId: plan.id,
        source: 'mercadopago',
        durationDays: plan.durationDays,
        externalReference: externalRef,
        amountPaid: localAmount,
        currency,
      });
    }

    res.json({
      paymentId: payment.id,
      status: payment.status,
      statusDetail: payment.status_detail,
      planId: plan.id,
      amount: localAmount,
      currency: String(currency).toUpperCase(),
    });
  } catch (e) {
    console.error('❌ MP create-premium-payment:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 🔔 POST /api/mercadopago/webhook
// ============================================
router.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    const sigHeader = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    const dataId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

    const isValid = mp.verifyWebhookSignature({
      signatureHeader: sigHeader,
      requestId,
      dataId,
    });

    if (!isValid && process.env.NODE_ENV === 'production') {
      console.warn('⚠️ MP webhook signature invalid');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const eventId = `${requestId}_${dataId}`;
    const eventRef = db().collection('mp_events').doc(eventId);
    const existing = await eventRef.get();

    if (existing.exists) {
      return res.json({ received: true, duplicated: true });
    }

    await eventRef.set({
      type: req.body?.type,
      action: req.body?.action,
      dataId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (req.body?.type === 'payment' && dataId) {
      const payment = await mp.getPayment(dataId);
      const meta = payment.metadata || {};

      await db().collection('mp_payment_logs').doc(String(payment.id)).set(
        {
          status: payment.status,
          statusDetail: payment.status_detail,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (payment.status === 'approved' && meta.app === 'lovingo') {
        if (meta.type === 'coin_purchase') {
          await creditCoins({
            userId: meta.userId,
            coins: parseInt(meta.coins) || 0,
            packageId: meta.packageId,
            source: 'mercadopago',
            externalRef: `mp_${payment.id}`,
            amountPaid: payment.transaction_amount,
            currency: payment.currency_id,
          });
        } else if (meta.type === 'premium_purchase') {
          await premiumService.activatePremium({
            userId: meta.userId,
            planId: meta.planId,
            source: 'mercadopago',
            durationDays: parseInt(meta.durationDays) || 30,
            externalReference: payment.external_reference,
            amountPaid: payment.transaction_amount,
            currency: payment.currency_id,
          });
        }
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('❌ MP webhook:', e);
    res.status(200).json({ received: true, error: e.message });
  }
});

// ============================================
// 💸 POST /api/mercadopago/payout-pix
// Body: { userId, withdrawalId, amount, currency, pixKey, pixKeyType, recipientName, recipientEmail, recipientCpf }
// ============================================
router.post('/api/mercadopago/payout-pix', async (req, res) => {
  try {
    const {
      userId, withdrawalId, amount, currency = 'BRL',
      pixKey, pixKeyType = 'cpf',
      recipientName, recipientEmail, recipientCpf,
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (!pixKey) return res.status(400).json({ error: 'pixKey requis' });

    if (pixKeyType === 'cpf' && !/^\d{11}$/.test(String(pixKey).replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'CPF doit contenir 11 chiffres' });
    }

    const idempotencyKey = withdrawalId || crypto.randomUUID();

    const payoutBody = {
      transaction_amount: Number(amount),
      description: `Lovingo - Retrait ${userId}`,
      external_reference: withdrawalId || `pix_${userId}_${Date.now()}`,
      receiver: {
        identification: {
          type: pixKeyType.toUpperCase(),
          number: String(pixKey).replace(/\D/g, ''),
        },
        first_name: recipientName || '',
        email: recipientEmail || '',
      },
      payer: {
        type: 'collector',
      },
      metadata: {
        app: 'lovingo',
        type: 'pix_payout',
        userId,
        withdrawalId,
      },
    };

    let result;
    try {
      result = await mp.createPixPayout(payoutBody, idempotencyKey);
    } catch (e) {
      console.error('❌ MP PIX payout error:', e.message, e.body);
      return res.status(400).json({
        error: 'PIX payout failed',
        details: e.body || e.message,
      });
    }

    await db().collection('mp_payouts').doc(idempotencyKey).set({
      payoutId: result.id || idempotencyKey,
      userId,
      withdrawalId,
      amount: Number(amount),
      currency,
      pixKey,
      pixKeyType,
      status: result.status || 'pending',
      response: result,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      payoutId: result.id || idempotencyKey,
      status: result.status || 'pending',
    });
  } catch (e) {
    console.error('❌ MP payout-pix:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.COIN_PACKAGES = COIN_PACKAGES;
