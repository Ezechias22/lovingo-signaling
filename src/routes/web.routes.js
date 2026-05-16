// signaling_server/src/routes/web.routes.js
const express = require('express');

const { PLAYSTORE_URL } = require('../config');
const { renderHomePage } = require('../views/home.page');
const { renderPricingPage } = require('../views/pricing.page');
const { renderFeaturesPage } = require('../views/features.page');
const { renderSupportPage } = require('../views/support.page');
const { renderCoinsPage, renderCoinsSuccessPage } = require('../views/coins.page');
const { renderFraudPage } = require('../views/fraud.page');
const { renderLiveSharePage } = require('../views/live.page'); // 🆕
const { liveRooms } = require('../state/store'); // 🆕

const router = express.Router();

// 🆕 Configuration
const APP_PACKAGE = 'com.lovingo2.app';
const BASE_URL = process.env.BASE_URL || 'https://lovingosocial.com';

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

router.get('/admin/fraud', (req, res) => {
  res.send(renderFraudPage());
});

// 🆕 Page de partage d'un live
router.get('/live/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = liveRooms.get(roomId);

  res.set('Cache-Control', 'no-store');
  res.send(renderLiveSharePage({
    room: room || null,
    roomId,
    PLAYSTORE_URL,
    APP_PACKAGE,
    BASE_URL,
  }));
});

// 🆕 Android App Links verification
// ⚠️ Remplacez "VOTRE_SHA256_ICI" par votre vrai SHA-256 (voir instructions plus bas)
router.get('/.well-known/assetlinks.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.send(JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: APP_PACKAGE,
        sha256_cert_fingerprints: [
          '09:D6:0E:AE:0D:11:53:4F:0B:6A:B0:6C:6E:E4:F4:C0:1A:4F:9F:D8:FF:EC:ED:0A:30:A8:30:30:D2:4E:CA:97'
        ]
      }
    }
  ], null, 2));
});

// 🆕 iOS Universal Links (sera utilisé quand vous configurerez les entitlements iOS)
router.get('/.well-known/apple-app-site-association', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.send(JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appID: 'VOTRE_TEAM_ID.com.lovingo2.app', // À remplacer
          paths: ['/live/*']
        }
      ]
    }
  }, null, 2));
});

module.exports = router;