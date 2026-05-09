// signaling_server/src/routes/pk.routes.js
const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const MIN_COINS_DIFF_FOR_REWARD = 5000;
const WINNER_REWARD_COINS = 100;

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE : Vérifie le token Firebase et extrait l'UID
// ═══════════════════════════════════════════════════════════════════════════

async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'missing_token' });
    }

    const idToken = authHeader.substring(7).trim();
    if (!idToken) {
      return res.status(401).json({ ok: false, error: 'empty_token' });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = { uid: decoded.uid, email: decoded.email || null };
    return next();
  } catch (error) {
    console.error('❌ [PK] Erreur verifyIdToken:', error.message);
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 💰 POST /api/pk/claim-reward
// ═══════════════════════════════════════════════════════════════════════════
//
// Body: { battleId: string, winnerUserId: string }
//
// Règles :
// 1. L'utilisateur authentifié DOIT être == winnerUserId (sécurité)
// 2. Le battle doit exister et être en status "ended"
// 3. Le user doit faire partie de winnerUserIds[]
// 4. L'écart final doit être >= 5000 coins
// 5. Un même user ne peut claim qu'UNE SEULE fois (tracking individuel)
// 6. En mode team/multi, CHAQUE membre gagnant claim séparément
//
// Réponse OK : { ok: true, amount: 100, alreadyClaimed?: true }
// Réponse KO : { ok: false, error: '...' }
// ═══════════════════════════════════════════════════════════════════════════

router.post('/api/pk/claim-reward', verifyFirebaseToken, async (req, res) => {
  try {
    const { battleId, winnerUserId } = req.body || {};
    const authUid = req.firebaseUser.uid;

    // ── Validation des inputs ─────────────────────────────────────────────
    if (!battleId || typeof battleId !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid_battleId' });
    }
    if (!winnerUserId || typeof winnerUserId !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid_winnerUserId' });
    }

    // ── Sécurité : l'auth user doit correspondre au winnerUserId ──────────
    if (authUid !== winnerUserId) {
      console.warn(
        `⚠️ [PK] Tentative de claim frauduleuse : auth=${authUid} != winner=${winnerUserId}`
      );
      return res.status(403).json({ ok: false, error: 'auth_mismatch' });
    }

    const firestore = admin.firestore();
    const battleRef = firestore.doc(`pk_battles/${battleId}`);
    const claimRef = firestore.doc(
      `pk_battles/${battleId}/claims/${winnerUserId}`
    );
    const userRef = firestore.doc(`users/${winnerUserId}`);

    // ── Transaction atomique ──────────────────────────────────────────────
    const result = await firestore.runTransaction(async (tx) => {
      const battleSnap = await tx.get(battleRef);
      if (!battleSnap.exists) {
        return { ok: false, status: 404, error: 'battle_not_found' };
      }

      const battle = battleSnap.data() || {};

      // 1️⃣ Status doit être "ended"
      if (battle.status !== 'ended') {
        return { ok: false, status: 409, error: 'battle_not_ended' };
      }

      // 2️⃣ Le user doit faire partie des gagnants
      const winnerIds = Array.isArray(battle.winnerUserIds)
        ? battle.winnerUserIds
        : [];

      // 🔄 Backward compat : ancien format avec "winnerUserId" (string unique)
      const legacyWinnerId =
        typeof battle.winnerUserId === 'string' ? battle.winnerUserId : null;
      const allWinners = legacyWinnerId
        ? [...new Set([...winnerIds, legacyWinnerId])]
        : winnerIds;

      if (!allWinners.includes(winnerUserId)) {
        return { ok: false, status: 403, error: 'not_winner' };
      }

      // 3️⃣ Vérifier l'écart minimum
      const diff = Number(battle.finalCoinsDiff || 0);
      if (diff < MIN_COINS_DIFF_FOR_REWARD) {
        return {
          ok: false,
          status: 400,
          error: 'diff_too_low',
          required: MIN_COINS_DIFF_FOR_REWARD,
          actual: diff,
        };
      }

      // 4️⃣ Empêcher le double-claim PAR USER
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists) {
        return {
          ok: true,
          alreadyClaimed: true,
          amount: WINNER_REWARD_COINS,
        };
      }

      // 5️⃣ Tout OK → enregistrer le claim + créditer le wallet
      tx.set(claimRef, {
        userId: winnerUserId,
        battleId,
        amount: WINNER_REWARD_COINS,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(
        userRef,
        {
          coins: admin.firestore.FieldValue.increment(WINNER_REWARD_COINS),
          lastPkRewardAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Mettre à jour le flag global "rewardClaimed" si TOUS les gagnants ont claim
      // (best-effort : on lit après pour ne pas bloquer la transaction)
      return { ok: true, amount: WINNER_REWARD_COINS };
    });

    // ── Mise à jour du flag global rewardClaimed (hors transaction) ───────
    if (result.ok && !result.alreadyClaimed) {
      try {
        const claimsSnap = await firestore
          .collection(`pk_battles/${battleId}/claims`)
          .get();

        const battleSnap = await battleRef.get();
        const winnerIds = Array.isArray(battleSnap.data()?.winnerUserIds)
          ? battleSnap.data().winnerUserIds
          : [];

        const allClaimed =
          winnerIds.length > 0 &&
          winnerIds.every((uid) =>
            claimsSnap.docs.some((d) => d.id === uid)
          );

        if (allClaimed) {
          await battleRef.update({ rewardClaimed: true });
        }
      } catch (e) {
        console.warn('⚠️ [PK] Maj rewardClaimed flag échouée:', e.message);
      }
    }

    if (!result.ok) {
      return res.status(result.status || 400).json(result);
    }

    console.log(
      `💰 [PK] Reward claimed by ${winnerUserId} on battle ${battleId} (already=${!!result.alreadyClaimed})`
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ [PK] Erreur claim-reward:', error);
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', details: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 GET /api/pk/claim-status/:battleId  (optionnel, pour debug/UI)
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/api/pk/claim-status/:battleId',
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const { battleId } = req.params;
      const authUid = req.firebaseUser.uid;

      const firestore = admin.firestore();
      const claimRef = firestore.doc(
        `pk_battles/${battleId}/claims/${authUid}`
      );
      const claimSnap = await claimRef.get();

      return res.status(200).json({
        ok: true,
        claimed: claimSnap.exists,
        claimedAt: claimSnap.exists
          ? claimSnap.data()?.claimedAt?.toDate?.()?.toISOString() || null
          : null,
      });
    } catch (error) {
      console.error('❌ [PK] Erreur claim-status:', error);
      return res
        .status(500)
        .json({ ok: false, error: 'internal_error', details: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// 🩺 GET /api/pk/health
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/pk/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    minCoinsDiffForReward: MIN_COINS_DIFF_FOR_REWARD,
    winnerRewardCoins: WINNER_REWARD_COINS,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;