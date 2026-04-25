// signaling_server/src/routes/fraud-admin.routes.js
const express = require('express');
const { admin, getFirestore } = require('../services/firebase.service');

const router = express.Router();

function db() {
  return getFirestore();
}

function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_MAINTENANCE_SECRET;
  const provided = req.headers['x-admin-secret'];

  if (!secret) {
    return res.status(500).json({ error: 'ADMIN_MAINTENANCE_SECRET manquant' });
  }

  if (provided !== secret) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  return next();
}

router.get('/api/admin/fraud/overview', requireAdminSecret, async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const logs = await db()
      .collection('fraud_logs')
      .where('createdAtDate', '>=', since)
      .limit(300)
      .get();

    let blocked = 0;
    let autoBans = 0;
    let highRisk = 0;

    logs.docs.forEach((doc) => {
      const data = doc.data();

      if (String(data.type || '').includes('blocked')) blocked += 1;
      if (data.type === 'auto_ban_applied') autoBans += 1;
      if (Number(data.riskScore || 0) >= 70) highRisk += 1;
    });

    const blacklist = await db()
      .collection('fraud_blacklist')
      .where('active', '==', true)
      .limit(200)
      .get();

    return res.json({
      period: '24h',
      totalLogs: logs.size,
      blocked,
      autoBans,
      highRisk,
      activeBlacklist: blacklist.size,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Erreur overview fraude',
      details: error.message,
    });
  }
});

router.get('/api/admin/fraud/logs', requireAdminSecret, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 300);

    const snapshot = await db()
      .collection('fraud_logs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return res.json({
      logs: snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Erreur liste fraude',
      details: error.message,
    });
  }
});

router.get('/api/admin/fraud/blacklist', requireAdminSecret, async (req, res) => {
  try {
    const snapshot = await db()
      .collection('fraud_blacklist')
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();

    return res.json({
      blacklist: snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Erreur blacklist',
      details: error.message,
    });
  }
});

router.post('/api/admin/fraud/ban-user', requireAdminSecret, async (req, res) => {
  try {
    const { userId, reason = 'manual_admin_ban' } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const batch = db().batch();

    batch.set(db().collection('fraud_blacklist').doc(`user_${userId}`), {
      userId,
      reason,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    batch.set(
      db().collection('users').doc(userId),
      {
        isPaymentBlocked: true,
        paymentBlockedReason: reason,
        paymentBlockedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(db().collection('fraud_logs').doc(), {
      type: 'manual_user_ban',
      userId,
      reason,
      createdAtDate: new Date(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return res.json({ ok: true, userId, reason });
  } catch (error) {
    return res.status(500).json({
      error: 'Erreur bannissement user',
      details: error.message,
    });
  }
});

router.post('/api/admin/fraud/unban-user', requireAdminSecret, async (req, res) => {
  try {
    const { userId, reason = 'manual_admin_unban' } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const batch = db().batch();

    batch.delete(db().collection('fraud_blacklist').doc(`user_${userId}`));

    batch.set(
      db().collection('users').doc(userId),
      {
        isPaymentBlocked: false,
        paymentBlockedReason: null,
        paymentBlockedAt: null,
      },
      { merge: true }
    );

    batch.set(db().collection('fraud_logs').doc(), {
      type: 'manual_user_unban',
      userId,
      reason,
      createdAtDate: new Date(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return res.json({ ok: true, userId, reason });
  } catch (error) {
    return res.status(500).json({
      error: 'Erreur déblocage user',
      details: error.message,
    });
  }
});

module.exports = router;