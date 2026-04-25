// signaling_server/src/routes/web.routes.js
const express = require('express');

const { PLAYSTORE_URL } = require('../config');
const { renderHomePage } = require('../views/home.page');
const { renderPricingPage } = require('../views/pricing.page');
const { renderFeaturesPage } = require('../views/features.page');
const { renderSupportPage } = require('../views/support.page');
const {
  renderCoinsPage,
  renderCoinsSuccessPage,
} = require('../views/coins.page');

const router = express.Router();

router.get('/', (req, res) => {
  res.send(renderHomePage({ PLAYSTORE_URL }));
});

router.get('/pricing', (req, res) => {
  res.send(renderPricingPage({ PLAYSTORE_URL }));
});

router.get('/features', (req, res) => {
  res.send(renderFeaturesPage());
});

router.get('/support', (req, res) => {
  res.send(renderSupportPage());
});

router.get('/coins', (req, res) => {
  res.send(renderCoinsPage({ PLAYSTORE_URL }));
});

router.get('/coins/success', (req, res) => {
  res.send(renderCoinsSuccessPage({ PLAYSTORE_URL }));
});

module.exports = router;