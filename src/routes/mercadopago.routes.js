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

function db() { return getFirestore(); }

function getClientIp(req) {
  const f = req.headers['x-forwarded-for'];
  if (f) return String(f).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hashValue(v) {
  return crypto.createHash('sha256').update(String(v || '')).digest('hex');
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

router.get('/api/mercadopago/config', (req, res) => {
  res.json({
    publicKey: mp.getPublicKey(),
    enabled: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
  });
});

// ============================================
// 💳 Achat coins par CARTE
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
        app: 'lovingo', type: 'coin_purchase',
        userId, packageId, coins: String(pkg.coins), usd: String(pkg.usd),
      },
    };

    const payment = await mp.createPayment(paymentBody, idempotencyKey);

    await db().collection('mp_payment_logs').doc(String(payment.id)).set({
      paymentId: payment.id, type: 'coin_purchase', method: 'card',
      userId, packageId, coins: pkg.coins, usd: pkg.usd,
      amount: localAmount, currency: String(currency).toUpperCase(),
      status: payment.status,
      ipHash: hashValue(getClientIp(req)),
      externalReference: paymentBody.external_reference,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payment.status === 'approved') {
      await creditCoins({
        userId, coins: pkg.coins, packageId,
        source: 'mercadopago', externalRef: `mp_${payment.id}`,
        amountPaid: localAmount, currency,
      });
    }

    res.json({
      paymentId: payment.id, status: payment.status,
      statusDetail: payment.status_detail,
      coins: pkg.coins, amount: localAmount,
      currency: String(currency).toUpperCase(),
    });
  } catch (e) {
    console.error('❌ MP create-coin-payment:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 🟢 NOUVEAU : Achat coins par PIX (QR Code)
// ============================================
router.post('/api/mercadopago/create-pix-coin-payment', async (req, res) => {
  try {
    const {
      userId, packageId, currency = 'BRL',
      payerEmail, payerCpf, payerFirstName, payerLastName,
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!payerEmail) return res.status(400).json({ error: 'payerEmail requis' });
    if (!payerCpf) return res.status(400).json({ error: 'CPF requis pour PIX' });

    const cpfClean = String(payerCpf).replace(/\D/g, '');
    if (cpfClean.length !== 11) {
      return res.status(400).json({ error: 'CPF doit contenir 11 chiffres' });
    }

    const pkg = COIN_PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: 'Package invalide' });

    await ensureWalletExists(userId);

    // PIX est uniquement en BRL
    const localAmount = convertUsdTo(pkg.usd, 'BRL');
    const idempotencyKey = crypto.randomUUID();
    const externalRef = `mp_pix_coin_${userId}_${Date.now()}`;

    const paymentBody = {
      transaction_amount: localAmount,
      description: `Lovingo - ${pkg.name} (${pkg.coins} coins)`,
      payment_method_id: 'pix',
      payer: {
        email: payerEmail,
        first_name: payerFirstName || 'Lovingo',
        last_name: payerLastName || 'User',
        identification: { type: 'CPF', number: cpfClean },
      },
      external_reference: externalRef,
      notification_url: `${req.protocol}://${req.get('host')}/api/mercadopago/webhook`,
      date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      metadata: {
        app: 'lovingo', type: 'coin_purchase', method: 'pix',
        userId, packageId, coins: String(pkg.coins), usd: String(pkg.usd),
      },
    };

    const payment = await mp.createPixPayment(paymentBody, idempotencyKey);

    const qrCode = payment.point_of_interaction?.transaction_data?.qr_code || '';
    const qrCodeBase64 = payment.point_of_interaction?.transaction_data?.qr_code_base64 || '';
    const ticketUrl = payment.point_of_interaction?.transaction_data?.ticket_url || '';

    await db().collection('mp_payment_logs').doc(String(payment.id)).set({
      paymentId: payment.id, type: 'coin_purchase', method: 'pix',
      userId, packageId, coins: pkg.coins, usd: pkg.usd,
      amount: localAmount, currency: 'BRL',
      status: payment.status,
      ipHash: hashValue(getClientIp(req)),
      externalReference: externalRef,
      qrCode, ticketUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      paymentId: payment.id,
      status: payment.status,
      statusDetail: payment.status_detail,
      coins: pkg.coins,
      amount: localAmount,
      currency: 'BRL',
      qrCode,
      qrCodeBase64,
      ticketUrl,
      expiresAt: paymentBody.date_of_expiration,
    });
  } catch (e) {
    console.error('❌ MP create-pix-coin-payment:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 🟢 NOUVEAU : Vérifier statut paiement PIX (polling)
// ============================================
router.get('/api/mercadopago/check-payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) return res.status(400).json({ error: 'paymentId requis' });

    const payment = await mp.getPayment(paymentId);
    const meta = payment.metadata || {};

    // Si approuvé et coins pas encore crédités, on crédite ici
    if (payment.status === 'approved' && meta.app === 'lovingo' && meta.type === 'coin_purchase') {
      await creditCoins({
        userId: meta.userId,
        coins: parseInt(meta.coins) || 0,
        packageId: meta.packageId,
        source: 'mercadopago_pix',
        externalRef: `mp_${payment.id}`,
        amountPaid: payment.transaction_amount,
        currency: payment.currency_id,
      });
    }

    res.json({
      paymentId: payment.id,
      status: payment.status,
      statusDetail: payment.status_detail,
      coins: parseInt(meta.coins) || 0,
    });
  } catch (e) {
    console.error('❌ MP check-payment-status:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ============================================
// 💎 Achat Premium par carte
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
        app: 'lovingo', type: 'premium_purchase',
        userId, planId: plan.id, durationDays: String(plan.durationDays),
      },
    };

    const payment = await mp.createPayment(paymentBody, idempotencyKey);

    await db().collection('mp_payment_logs').doc(String(payment.id)).set({
      paymentId: payment.id, type: 'premium_purchase',
      userId, planId: plan.id,
      amount: localAmount, currency: String(currency).toUpperCase(),
      status: payment.status, externalReference: externalRef,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payment.status === 'approved') {
      await premiumService.activatePremium({
        userId, planId: plan.id, source: 'mercadopago',
        durationDays: plan.durationDays,
        externalReference: externalRef,
        amountPaid: localAmount, currency,
      });
    }

    res.json({
      paymentId: payment.id, status: payment.status,
      statusDetail: payment.status_detail,
      planId: plan.id, amount: localAmount,
      currency: String(currency).toUpperCase(),
    });
  } catch (e) {
    console.error('❌ MP create-premium-payment:', e.message, e.body);
    res.status(400).json({ error: e.message, details: e.body });
  }
});

// ============================================
// 🔔 Webhook Mercado Pago
// ============================================
router.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    const sigHeader = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    const dataId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

    const isValid = mp.verifyWebhookSignature({
      signatureHeader: sigHeader, requestId, dataId,
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
      type: req.body?.type, action: req.body?.action, dataId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (req.body?.type === 'payment' && dataId) {
      const payment = await mp.getPayment(dataId);
      const meta = payment.metadata || {};

      await db().collection('mp_payment_logs').doc(String(payment.id)).set({
        status: payment.status,
        statusDetail: payment.status_detail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      if (payment.status === 'approved' && meta.app === 'lovingo') {
        if (meta.type === 'coin_purchase') {
          await creditCoins({
            userId: meta.userId,
            coins: parseInt(meta.coins) || 0,
            packageId: meta.packageId,
            source: meta.method === 'pix' ? 'mercadopago_pix' : 'mercadopago',
            externalRef: `mp_${payment.id}`,
            amountPaid: payment.transaction_amount,
            currency: payment.currency_id,
          });
        } else if (meta.type === 'premium_purchase') {
          await premiumService.activatePremium({
            userId: meta.userId, planId: meta.planId,
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
// 💸 Retrait PIX — TRAITEMENT MANUEL ADMIN
// (Mercado Pago ne fournit pas d'API payout PIX publique)
// ============================================
router.post('/api/mercadopago/payout-pix', async (req, res) => {
  try {
    const {
      userId, withdrawalId, amount, currency = 'BRL',
      pixKey, pixKeyType = 'cpf',
      recipientName, recipientEmail,
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (!pixKey) return res.status(400).json({ error: 'pixKey requis' });

    // Validation des formats de clés PIX
    const cleanKey = String(pixKey).trim();
    if (pixKeyType === 'cpf' && !/^\d{11}$/.test(cleanKey.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'CPF doit contenir 11 chiffres' });
    }
    if (pixKeyType === 'email' && !/^[^@]+@[^@]+\.[^@]+$/.test(cleanKey)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    if (pixKeyType === 'phone' && !/^\+?\d{10,14}$/.test(cleanKey.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'Téléphone invalide' });
    }

    const payoutId = withdrawalId || `pix_${userId}_${Date.now()}`;

    // Enregistrer la demande pour traitement manuel
    await db().collection('mp_payouts').doc(payoutId).set({
      payoutId, userId, withdrawalId,
      amount: Number(amount), currency,
      pixKey: cleanKey, pixKeyType,
      recipientName: recipientName || '',
      recipientEmail: recipientEmail || '',
      status: 'pending_manual_review',
      processingType: 'manual_admin',
      requiresAdminAction: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notification admin (à compléter selon votre setup : email, Slack, etc.)
    await db().collection('admin_notifications').add({
      type: 'pix_payout_pending',
      userId, withdrawalId, payoutId,
      amount: Number(amount), currency,
      pixKey: cleanKey, pixKeyType,
      recipientName,
      message: `Nouvelle demande PIX : ${amount} ${currency} vers ${pixKeyType} ${cleanKey}`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ✅ On retourne success=true car la demande est correctement enregistrée
    // Le statut final dépend du traitement admin manuel
    res.json({
      success: true,
      payoutId,
      status: 'pending',
      message: 'Demande PIX enregistrée, traitement sous 24h ouvrées',
    });
  } catch (e) {
    console.error('❌ MP payout-pix:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 👨‍💼 ADMIN : Marquer un payout PIX comme complété
// (Appelé depuis ton interface admin après transfert manuel)
// ============================================
router.post('/api/mercadopago/admin/complete-pix-payout', async (req, res) => {
  try {
    const { payoutId, adminKey, transactionRef } = req.body;

    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payoutDoc = await db().collection('mp_payouts').doc(payoutId).get();
    if (!payoutDoc.exists) return res.status(404).json({ error: 'Payout introuvable' });

    const payout = payoutDoc.data();

    await db().collection('mp_payouts').doc(payoutId).update({
      status: 'completed',
      transactionRef: transactionRef || null,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payout.withdrawalId) {
      await db().collection('withdrawals').doc(payout.withdrawalId).update({
        status: 'completed',
        mpPayoutId: payoutId,
        completedDate: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('❌ admin complete-pix-payout:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.COIN_PACKAGES = COIN_PACKAGES;