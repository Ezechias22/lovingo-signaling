// signaling_server/src/services/publicId.service.js
const { admin, getFirestore } = require('./firebase.service');

function normalizePublicId(publicId) {
  return String(publicId || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

function isValidPublicId(publicId) {
  const clean = normalizePublicId(publicId);
  return clean.length >= 4 && clean.length <= 32;
}

async function resolveUserByPublicId(publicId) {
  const cleanPublicId = normalizePublicId(publicId);

  if (!isValidPublicId(cleanPublicId)) {
    return null;
  }

  const db = getFirestore();

  const publicIdDoc = await db
    .collection('public_user_ids')
    .doc(cleanPublicId)
    .get();

  if (!publicIdDoc.exists) {
    return null;
  }

  const data = publicIdDoc.data();
  const userId = data.userId;

  if (!userId) {
    return null;
  }

  const userDoc = await db.collection('users').doc(userId).get();

  if (!userDoc.exists) {
    return null;
  }

  const userData = userDoc.data();

  if (userData.isActive === false) {
    return null;
  }

  return {
    userId,
    publicId: cleanPublicId,
    user: userData,
  };
}

async function claimPublicIdForUser({ userId, publicId }) {
  const cleanPublicId = normalizePublicId(publicId);

  if (!userId || !isValidPublicId(cleanPublicId)) {
    throw new Error('publicId invalide');
  }

  const db = getFirestore();

  const publicIdRef = db.collection('public_user_ids').doc(cleanPublicId);
  const userRef = db.collection('users').doc(userId);

  await db.runTransaction(async (transaction) => {
    const publicIdDoc = await transaction.get(publicIdRef);
    const userDoc = await transaction.get(userRef);

    if (!userDoc.exists) {
      throw new Error('Utilisateur introuvable');
    }

    if (publicIdDoc.exists) {
      const existing = publicIdDoc.data();

      if (existing.userId !== userId) {
        throw new Error('Cet ID public est déjà utilisé');
      }
    }

    transaction.set(
      publicIdRef,
      {
        userId,
        publicId: cleanPublicId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        publicId: cleanPublicId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return cleanPublicId;
}

module.exports = {
  normalizePublicId,
  isValidPublicId,
  resolveUserByPublicId,
  claimPublicIdForUser,
};