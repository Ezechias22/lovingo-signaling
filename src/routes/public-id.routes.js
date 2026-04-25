// signaling_server/src/routes/public-id.routes.js
const express = require('express');

const { admin, getFirestore } = require('../services/firebase.service');
const {
  normalizePublicId,
  isValidPublicId,
  claimPublicIdForUser,
} = require('../services/publicId.service');

const router = express.Router();

function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_MAINTENANCE_SECRET;

  if (!secret) {
    return res.status(500).json({
      error: 'ADMIN_MAINTENANCE_SECRET manquant',
    });
  }

  const provided = req.headers['x-admin-secret'];

  if (provided !== secret) {
    return res.status(403).json({
      error: 'Accès refusé',
    });
  }

  return next();
}

function generatePublicId(userId) {
  const clean = String(userId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);

  return `LOV${clean}`;
}

router.post('/api/admin/repair-public-ids', requireAdminSecret, async (req, res) => {
  try {
    const db = getFirestore();

    const usersSnapshot = await db.collection('users').limit(500).get();

    let repaired = 0;
    let skipped = 0;
    const errors = [];

    for (const doc of usersSnapshot.docs) {
      try {
        const userId = doc.id;
        const user = doc.data();

        const currentPublicId = normalizePublicId(user.publicId || '');
        const finalPublicId = isValidPublicId(currentPublicId)
          ? currentPublicId
          : generatePublicId(userId);

        await claimPublicIdForUser({
          userId,
          publicId: finalPublicId,
        });

        repaired += 1;
      } catch (error) {
        skipped += 1;
        errors.push({
          userId: doc.id,
          error: error.message,
        });
      }
    }

    await db.collection('maintenance_logs').add({
      type: 'repair_public_ids',
      repaired,
      skipped,
      errors: errors.slice(0, 50),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      ok: true,
      repaired,
      skipped,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    console.error('❌ Erreur repair public IDs:', error);

    return res.status(500).json({
      error: 'Erreur réparation public IDs',
      details: error.message,
    });
  }
});

router.post('/api/admin/claim-public-id', requireAdminSecret, async (req, res) => {
  try {
    const { userId, publicId } = req.body;

    const cleanPublicId = await claimPublicIdForUser({
      userId,
      publicId,
    });

    return res.json({
      ok: true,
      userId,
      publicId: cleanPublicId,
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message,
    });
  }
});

module.exports = router;