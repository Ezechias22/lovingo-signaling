// signaling_server/src/routes/gift.routes.js
const express = require('express');

const { admin, getFirestore } = require('../services/firebase.service');
const {
  logGiftFraudEvent,
  isGiftBlockedUser,
  computeGiftRiskScore,
  calculateGiftAmounts,
  PLATFORM_COMMISSION_RATE,
} = require('../services/giftSecurity.service');

const router = express.Router();

function db() {
  return getFirestore();
}

function cleanString(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const safe = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const safeKey = cleanString(key, 80);
    if (!safeKey) continue;

    if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean'
    ) {
      safe[safeKey] =
        typeof rawValue === 'string' ? cleanString(rawValue, 500) : rawValue;
    }
  }

  return safe;
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

router.post('/api/gifts/send', async (req, res) => {
  try {
    const {
      senderId,
      senderName,
      receiverId,
      giftId,
      giftName,
      giftIcon,
      giftPriceCoins,
      quantity = 1,
      chatRoomId,
      liveRoomId,
      roomId,
      animationPath,
      rarity,
      message,
      metadata = {},
    } = req.body;

    const safeMetadata = cleanObject(metadata);

    const cleanSenderId = cleanString(senderId, 128);
    const cleanSenderName =
      cleanString(senderName || safeMetadata.senderName, 120) || 'Utilisateur';

    const cleanReceiverId = cleanString(receiverId, 128);
    const cleanGiftId = cleanString(giftId, 128);
    const cleanGiftName = cleanString(giftName, 120) || 'Cadeau';
    const cleanGiftIcon = cleanString(giftIcon, 20) || '🎁';
    const cleanAnimationPath = cleanString(animationPath, 300);
    const cleanRarity = cleanString(rarity, 40) || 'common';
    const cleanChatRoomId = chatRoomId ? cleanString(chatRoomId, 160) : null;

    const cleanLiveRoomId =
      cleanString(
        liveRoomId ||
          roomId ||
          safeMetadata.liveRoomId ||
          safeMetadata.roomId,
        160
      ) || null;

    const cleanMessage = message ? cleanString(message, 500) : null;

    const priceCoins = Number(giftPriceCoins);
    const giftQuantity = Number(quantity);
    const totalCoins = priceCoins * giftQuantity;

    if (!cleanSenderId || !cleanReceiverId || cleanSenderId === cleanReceiverId) {
      return res.status(400).json({
        error: 'Expéditeur ou destinataire invalide',
      });
    }

    if (!cleanGiftId || !Number.isInteger(priceCoins) || priceCoins <= 0) {
      return res.status(400).json({
        error: 'Cadeau invalide',
      });
    }

    if (
      !Number.isInteger(giftQuantity) ||
      giftQuantity <= 0 ||
      giftQuantity > 99
    ) {
      return res.status(400).json({
        error: 'Quantité invalide',
      });
    }

    if (await isGiftBlockedUser(cleanSenderId)) {
      await logGiftFraudEvent({
        type: 'gift_blocked_sender_blacklisted',
        senderId: cleanSenderId,
        receiverId: cleanReceiverId,
        giftId: cleanGiftId,
        totalCoins,
      });

      return res.status(403).json({
        error: 'Envoi de cadeau bloqué par sécurité',
      });
    }

    if (await isGiftBlockedUser(cleanReceiverId)) {
      await logGiftFraudEvent({
        type: 'gift_blocked_receiver_invalid',
        senderId: cleanSenderId,
        receiverId: cleanReceiverId,
        giftId: cleanGiftId,
        totalCoins,
      });

      return res.status(403).json({
        error: 'Destinataire non disponible',
      });
    }

    const risk = await computeGiftRiskScore({
      senderId: cleanSenderId,
      receiverId: cleanReceiverId,
      totalCoins,
      giftId: cleanGiftId,
    });

    await logGiftFraudEvent({
      type: risk.allowed ? 'gift_risk_evaluation' : 'gift_blocked_high_risk',
      senderId: cleanSenderId,
      receiverId: cleanReceiverId,
      giftId: cleanGiftId,
      totalCoins,
      riskScore: risk.score,
      riskReasons: risk.reasons,
      liveRoomId: cleanLiveRoomId,
      chatRoomId: cleanChatRoomId,
    });

    if (!risk.allowed) {
      return res.status(403).json({
        error: 'Cadeau bloqué par sécurité',
        riskScore: risk.score,
      });
    }

    const amounts = calculateGiftAmounts(totalCoins);

    const senderWalletRef = await ensureWalletExists(cleanSenderId);
    const receiverWalletRef = await ensureWalletExists(cleanReceiverId);

    const giftTransactionRef = db().collection('gift_transactions').doc();
    const senderWalletTxRef = db().collection('wallet_transactions').doc();
    const receiverWalletTxRef = db().collection('wallet_transactions').doc();
    const senderCoinTxRef = db().collection('coin_transactions').doc();
    const animationRef = db().collection('gift_animations').doc();

    await db().runTransaction(async (transaction) => {
      const senderWalletDoc = await transaction.get(senderWalletRef);
      const senderWallet = senderWalletDoc.data() || {};
      const currentCoinBalance = Number(senderWallet.coinBalance || 0);
      const currentCoinsSpent = Number(senderWallet.coinsSpent || 0);
      const senderTotalCoinsAfterGift = currentCoinsSpent + totalCoins;

      if (currentCoinBalance < totalCoins) {
        throw new Error('Solde coins insuffisant');
      }

      transaction.update(senderWalletRef, {
        coinBalance: admin.firestore.FieldValue.increment(-totalCoins),
        coinsSpent: admin.firestore.FieldValue.increment(totalCoins),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(receiverWalletRef, {
        balance: admin.firestore.FieldValue.increment(amounts.receiverAmountUsd),
        totalEarnings: admin.firestore.FieldValue.increment(
          amounts.receiverAmountUsd
        ),
        totalGiftEarnings: admin.firestore.FieldValue.increment(
          amounts.receiverAmountUsd
        ),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      const baseGiftData = {
        giftId: cleanGiftId,
        giftName: cleanGiftName,
        giftIcon: cleanGiftIcon,
        giftPriceCoins: priceCoins,
        quantity: giftQuantity,
        totalCoins,
        totalUsd: amounts.totalUsd,
        senderId: cleanSenderId,
        senderName: cleanSenderName,
        senderCoins: senderTotalCoinsAfterGift,
        receiverId: cleanReceiverId,
        chatRoomId: cleanChatRoomId,
        liveRoomId: cleanLiveRoomId,
        receiverAmountUsd: amounts.receiverAmountUsd,
        platformCommissionUsd: amounts.platformCommissionUsd,
        commissionRate: PLATFORM_COMMISSION_RATE,
        message: cleanMessage,
        animationPath: cleanAnimationPath,
        rarity: cleanRarity,
        status: 'completed',
        timestampDate: new Date(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          ...safeMetadata,
          source: safeMetadata.source || (cleanLiveRoomId ? 'live' : 'gift'),
          processedBy: 'render_server',
          riskScore: risk.score,
          riskReasons: risk.reasons,
          senderCoins: senderTotalCoinsAfterGift,
        },
      };

      transaction.set(giftTransactionRef, baseGiftData);

      transaction.set(senderCoinTxRef, {
        userId: cleanSenderId,
        type: 'giftSent',
        direction: 'debit',
        coins: -totalCoins,
        giftId: cleanGiftId,
        receiverId: cleanReceiverId,
        giftTransactionId: giftTransactionRef.id,
        status: 'completed',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          giftName: cleanGiftName,
          quantity: giftQuantity,
          liveRoomId: cleanLiveRoomId,
          chatRoomId: cleanChatRoomId,
          senderCoins: senderTotalCoinsAfterGift,
        },
      });

      transaction.set(senderWalletTxRef, {
        userId: cleanSenderId,
        type: 'giftSent',
        amount: 0,
        description: `Cadeau envoyé: ${cleanGiftName} x${giftQuantity}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          giftId: cleanGiftId,
          giftName: cleanGiftName,
          quantity: giftQuantity,
          totalCoins,
          toUserId: cleanReceiverId,
          giftTransactionId: giftTransactionRef.id,
          liveRoomId: cleanLiveRoomId,
          chatRoomId: cleanChatRoomId,
          senderCoins: senderTotalCoinsAfterGift,
        },
      });

      transaction.set(receiverWalletTxRef, {
        userId: cleanReceiverId,
        type: 'giftReceived',
        amount: amounts.receiverAmountUsd,
        description: `Cadeau reçu: ${cleanGiftName} x${giftQuantity}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          giftId: cleanGiftId,
          giftName: cleanGiftName,
          quantity: giftQuantity,
          fromUserId: cleanSenderId,
          fromUserName: cleanSenderName,
          originalCoins: totalCoins,
          originalAmountUsd: amounts.totalUsd,
          receiverAmountUsd: amounts.receiverAmountUsd,
          platformCommissionUsd: amounts.platformCommissionUsd,
          giftTransactionId: giftTransactionRef.id,
          liveRoomId: cleanLiveRoomId,
          chatRoomId: cleanChatRoomId,
          senderCoins: senderTotalCoinsAfterGift,
        },
      });

      const animationData = {
        id: animationRef.id,
        giftTransactionId: giftTransactionRef.id,
        giftId: cleanGiftId,
        giftName: cleanGiftName,
        giftIcon: cleanGiftIcon,
        animationPath: cleanAnimationPath,
        rarity: cleanRarity,
        quantity: giftQuantity,
        senderId: cleanSenderId,
        senderName: cleanSenderName,
        senderCoins: senderTotalCoinsAfterGift,
        receiverId: cleanReceiverId,
        chatRoomId: cleanChatRoomId,
        liveRoomId: cleanLiveRoomId,
        totalCoins,
        timestampDate: new Date(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(animationRef, animationData);

      if (cleanChatRoomId) {
        const chatAnimationRef = db()
          .collection('chat_rooms')
          .doc(cleanChatRoomId)
          .collection('gift_animations')
          .doc(animationRef.id);

        transaction.set(chatAnimationRef, animationData);
      }

      if (cleanLiveRoomId) {
        const liveAnimationRef = db()
          .collection('live_rooms')
          .doc(cleanLiveRoomId)
          .collection('gift_animations')
          .doc(animationRef.id);

        transaction.set(liveAnimationRef, animationData);

        const liveMessageRef = db()
          .collection('live_rooms')
          .doc(cleanLiveRoomId)
          .collection('messages')
          .doc(animationRef.id);

        transaction.set(liveMessageRef, {
          id: animationRef.id,
          type: 'gift',
          text: `${cleanSenderName} a envoyé ${cleanGiftName} x${giftQuantity}`,
          senderId: cleanSenderId,
          senderName: cleanSenderName,
          senderCoins: senderTotalCoinsAfterGift,
          receiverId: cleanReceiverId,
          giftId: cleanGiftId,
          giftName: cleanGiftName,
          giftIcon: cleanGiftIcon,
          quantity: giftQuantity,
          totalCoins,
          createdAtDate: new Date(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      const platformStatsRef = db()
        .collection('platform_stats')
        .doc(`daily_${today}`);

      transaction.set(
        platformStatsRef,
        {
          totalCommissions: admin.firestore.FieldValue.increment(
            amounts.platformCommissionUsd
          ),
          giftTransactions: admin.firestore.FieldValue.increment(1),
          giftCoinsVolume: admin.firestore.FieldValue.increment(totalCoins),
          giftUsdVolume: admin.firestore.FieldValue.increment(amounts.totalUsd),
          liveGiftTransactions: cleanLiveRoomId
            ? admin.firestore.FieldValue.increment(1)
            : admin.firestore.FieldValue.increment(0),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return res.json({
      ok: true,
      giftTransactionId: giftTransactionRef.id,
      totalCoins,
      totalUsd: amounts.totalUsd,
      receiverAmountUsd: amounts.receiverAmountUsd,
      platformCommissionUsd: amounts.platformCommissionUsd,
      commissionRate: PLATFORM_COMMISSION_RATE,
      riskScore: risk.score,
    });
  } catch (error) {
    console.error('❌ Erreur envoi cadeau sécurisé:', error);

    return res.status(400).json({
      error: error.message || 'Erreur lors de l’envoi du cadeau',
    });
  }
});

module.exports = router;