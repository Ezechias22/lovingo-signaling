// signaling_server/src/routes/admin.routes.js
const express = require('express');

const { admin, getFirestore } = require('../services/firebase.service');
const { renderAdminDashboardPage } = require('../views/admin.dashboard.page');

const router = express.Router();

function db() {
  return getFirestore();
}

function requireAdminSecret(req, res, next) {
  const expectedSecret = process.env.ADMIN_MAINTENANCE_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({
      error: 'ADMIN_MAINTENANCE_SECRET manquant sur Render',
    });
  }

  const providedSecret =
    req.headers['x-admin-secret'] ||
    req.query.key ||
    req.body?.key;

  if (!providedSecret || String(providedSecret) !== String(expectedSecret)) {
    return res.status(401).json({
      error: 'Secret admin invalide',
    });
  }

  return next();
}

function timestampToText(value) {
  try {
    if (!value) return '';
    const date = value.toDate ? value.toDate() : new Date(value);
    return date.toISOString();
  } catch (_) {
    return '';
  }
}

async function collectionLimit(name, limit = 20, orderField = 'createdAt') {
  const snapshot = await db()
    .collection(name)
    .orderBy(orderField, 'desc')
    .limit(limit)
    .get()
    .catch(async () => {
      return db().collection(name).limit(limit).get();
    });

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

router.get('/admin', (req, res) => {
  res.send(renderAdminDashboardPage());
});

router.get('/api/admin/overview', requireAdminSecret, async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      fraudLogsSnapshot,
      blacklistSnapshot,
      coinTransactionsSnapshot,
      paymentLogsSnapshot,
      blockedUsersSnapshot,
      autoBansSnapshot,
      highRiskSnapshot,
    ] = await Promise.all([
      db()
        .collection('fraud_logs')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
        .catch(() => db().collection('fraud_logs').limit(50).get()),

      db()
        .collection('fraud_blacklist')
        .limit(100)
        .get(),

      db()
        .collection('coin_transactions')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get()
        .catch(() => db().collection('coin_transactions').limit(50).get()),

      db()
        .collection('payment_intent_logs')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
        .catch(() => db().collection('payment_intent_logs').limit(50).get()),

      db()
        .collection('users')
        .where('isPaymentBlocked', '==', true)
        .limit(100)
        .get()
        .catch(() => null),

      db()
        .collection('fraud_logs')
        .where('type', '==', 'auto_ban_applied')
        .where('createdAtDate', '>=', since24h)
        .limit(100)
        .get()
        .catch(() => null),

      db()
        .collection('fraud_logs')
        .where('riskScore', '>=', 70)
        .where('createdAtDate', '>=', since24h)
        .limit(100)
        .get()
        .catch(() => null),
    ]);

    const fraudLogs = fraudLogsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        type: data.type || '',
        userId: data.userId || '',
        publicId: data.publicId || '',
        packageId: data.packageId || '',
        riskScore: data.riskScore ?? '',
        riskReasons: data.riskReasons || data.reason || '',
        createdAtText: timestampToText(data.createdAt),
      };
    });

    const blacklist = blacklistSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId || '',
          ipHash: data.ipHash || '',
          reason: data.reason || '',
          active: data.active !== false,
          createdAtText: timestampToText(data.createdAt),
        };
      })
      .filter((item) => item.active);

    const coinTransactions = coinTransactionsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId || '',
        coins: data.coins || 0,
        packageId: data.packageId || '',
        source: data.source || '',
        currency: data.currency || '',
        amountPaid: data.amountPaid || 0,
        status: data.status || '',
        createdAtText: timestampToText(data.timestamp),
      };
    });

    const paymentLogs = paymentLogsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId || '',
        publicId: data.publicId || '',
        packageId: data.packageId || '',
        coins: data.coins || 0,
        usd: data.usd || 0,
        amount: data.amount || 0,
        currency: data.currency || '',
        status: data.status || '',
        riskScore: data.riskScore ?? '',
        createdAtText: timestampToText(data.createdAt),
      };
    });

    const coinsSold = coinTransactions.reduce(
      (sum, item) => sum + Number(item.coins || 0),
      0
    );

    return res.json({
      ok: true,
      stats: {
        logs24h: fraudLogs.filter((item) => {
          if (!item.createdAtText) return false;
          return new Date(item.createdAtText) >= since24h;
        }).length,
        blocked: blockedUsersSnapshot?.size || 0,
        autoBans: autoBansSnapshot?.size || 0,
        highRisk: highRiskSnapshot?.size || 0,
        blacklist: blacklist.length,
        coinsSold,
      },
      fraudLogs,
      blacklist,
      coinTransactions,
      paymentLogs,
    });
  } catch (error) {
    console.error('❌ Erreur admin overview:', error);
    return res.status(500).json({
      error: 'Erreur chargement dashboard admin',
      details: error.message,
    });
  }
});

router.post('/api/admin/users/:userId/ban', requireAdminSecret, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const batch = db().batch();

    batch.set(
      db().collection('users').doc(userId),
      {
        isPaymentBlocked: true,
        paymentBlockedReason: 'manual_admin_ban',
        paymentBlockedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(
      db().collection('fraud_blacklist').doc(`user_${userId}`),
      {
        userId,
        reason: 'manual_admin_ban',
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(db().collection('fraud_logs').doc(), {
      type: 'manual_admin_ban',
      userId,
      reason: 'manual_admin_ban',
      createdAtDate: new Date(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return res.json({
      ok: true,
      userId,
      banned: true,
    });
  } catch (error) {
    console.error('❌ Erreur ban user:', error);
    return res.status(500).json({
      error: 'Erreur bannissement utilisateur',
      details: error.message,
    });
  }
});

router.post('/api/admin/users/:userId/unban', requireAdminSecret, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const batch = db().batch();

    batch.set(
      db().collection('users').doc(userId),
      {
        isPaymentBlocked: false,
        paymentBlockedReason: null,
        paymentBlockedAt: null,
      },
      { merge: true }
    );

    batch.set(
      db().collection('fraud_blacklist').doc(`user_${userId}`),
      {
        userId,
        active: false,
        unbannedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(db().collection('fraud_logs').doc(), {
      type: 'manual_admin_unban',
      userId,
      reason: 'manual_admin_unban',
      createdAtDate: new Date(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return res.json({
      ok: true,
      userId,
      banned: false,
    });
  } catch (error) {
    console.error('❌ Erreur unban user:', error);
    return res.status(500).json({
      error: 'Erreur débannissement utilisateur',
      details: error.message,
    });
  }
});

router.post('/api/admin/repair-public-ids', requireAdminSecret, async (req, res) => {
  try {
    const snapshot = await db().collection('users').limit(500).get();

    let repaired = 0;
    let skipped = 0;
    const errors = [];

    const batch = db().batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
      try {
        const userId = doc.id;
        const data = doc.data();
        const currentPublicId = String(data.publicId || '').trim();

        if (currentPublicId) {
          skipped += 1;
          continue;
        }

        const generatedPublicId = userId.slice(0, 8).toUpperCase();

        batch.set(
          db().collection('users').doc(userId),
          {
            publicId: generatedPublicId,
            publicIdUpper: generatedPublicId.toUpperCase(),
            publicIdUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        batch.set(
          db().collection('public_ids').doc(generatedPublicId.toUpperCase()),
          {
            userId,
            publicId: generatedPublicId.toUpperCase(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        repaired += 1;
        batchCount += 1;

        if (batchCount >= 400) {
          await batch.commit();
          batchCount = 0;
        }
      } catch (error) {
        errors.push({
          id: doc.id,
          error: error.message,
        });
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    return res.json({
      ok: true,
      repaired,
      skipped,
      errors,
    });
  } catch (error) {
    console.error('❌ Erreur repair public IDs:', error);
    return res.status(500).json({
      error: 'Erreur réparation public IDs',
      details: error.message,
    });
  }
});

module.exports = router;