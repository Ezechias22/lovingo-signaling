const express = require('express');
const { stripe } = require('../services/stripe.service');

const router = express.Router();

router.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'eur', userId, metadata = {} } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: 'Montant invalide',
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency.toLowerCase(),
      metadata: {
        app: 'lovingo',
        userId: userId || 'anonymous',
        createdAt: new Date().toISOString(),
        ...metadata,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(
      `💳 PaymentIntent créé: ${paymentIntent.id} pour ${amount}${currency.toUpperCase()}`
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    console.error('❌ Erreur création PaymentIntent:', error);
    res.status(400).json({
      error: 'Erreur lors de la création du paiement',
      details: error.message,
    });
  }
});

router.post('/api/purchase-credits', async (req, res) => {
  try {
    const { userId, creditPackage } = req.body;

    const packages = {
      small: { credits: 100, price: 4.99, currency: 'eur' },
      medium: { credits: 500, price: 19.99, currency: 'eur' },
      large: { credits: 1200, price: 39.99, currency: 'eur' },
      premium: { credits: 3000, price: 89.99, currency: 'eur' },
    };

    const selectedPackage = packages[creditPackage];

    if (!selectedPackage) {
      return res.status(400).json({ error: 'Package de crédits invalide' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(selectedPackage.price * 100),
      currency: selectedPackage.currency,
      metadata: {
        app: 'lovingo',
        userId,
        type: 'credits_purchase',
        creditPackage,
        credits: selectedPackage.credits.toString(),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      package: selectedPackage,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('❌ Erreur achat crédits:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;