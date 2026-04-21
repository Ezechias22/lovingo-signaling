'use strict';

const express = require('express');
const {
  getStatus,
  registerDevice,
  listDevices,
  deleteDevice,
  sendToToken,
  sendToTokens,
  sendToTopic,
  sendToUser,
  subscribeTopic,
  unsubscribeTopic,
} = require('../services/push.service');
const { deviceTokensByToken } = require('../state/store');

const router = express.Router();

router.get('/status', (req, res) => {
  try {
    return res.status(200).json(getStatus());
  } catch (error) {
    console.error('❌ GET /api/push/status:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur status push',
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/devices/register', (req, res) => {
  try {
    const { token, platform, user_id, username, locale } = req.body || {};

    const result = registerDevice({
      token,
      platform,
      user_id,
      username,
      locale,
    });

    return res.status(200).json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ POST /api/push/devices/register:', error);
    return res.status(400).json({
      ok: false,
      error: error.message || 'Erreur enregistrement device',
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/devices', (req, res) => {
  try {
    const devices = listDevices();

    return res.status(200).json({
      ok: true,
      total: devices.length,
      devices,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ GET /api/push/devices:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur liste devices',
      timestamp: new Date().toISOString(),
    });
  }
});

router.delete('/devices/:token', (req, res) => {
  try {
    const result = deleteDevice(req.params.token);

    return res.status(200).json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ DELETE /api/push/devices/:token:', error);
    return res.status(400).json({
      ok: false,
      error: error.message || 'Erreur suppression device',
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/send', async (req, res) => {
  try {
    const {
      title,
      body,
      image_url,
      target_type,
      target_value,
      data,
    } = req.body || {};

    const normalizedTargetType = String(target_type || '').trim();

    if (!normalizedTargetType) {
      return res.status(400).json({
        ok: false,
        error:
          "Le champ target_type est requis ('broadcast' | 'token' | 'topic' | 'user').",
        timestamp: new Date().toISOString(),
      });
    }

    if (!title && !body) {
      return res.status(400).json({
        ok: false,
        error: 'Le titre ou le body est requis.',
        timestamp: new Date().toISOString(),
      });
    }

    let result;

    switch (normalizedTargetType) {
      case 'broadcast': {
        const tokens = Array.from(deviceTokensByToken.keys());

        if (tokens.length === 0) {
          result = {
            ok: true,
            target_type: 'broadcast',
            target_count: 0,
            skipped: true,
            reason: 'Aucun device enregistré.',
          };
        } else {
          result = await sendToTokens({
            tokens,
            title,
            body,
            image_url,
            data,
          });

          result = {
            ...result,
            target_type: 'broadcast',
          };
        }
        break;
      }

      case 'token': {
        result = await sendToToken({
          token: target_value,
          title,
          body,
          image_url,
          data,
        });
        break;
      }

      case 'topic': {
        result = await sendToTopic({
          topic: target_value,
          title,
          body,
          image_url,
          data,
        });
        break;
      }

      case 'user': {
        result = await sendToUser({
          user_id: target_value,
          title,
          body,
          image_url,
          data,
        });
        break;
      }

      default:
        return res.status(400).json({
          ok: false,
          error:
            "target_type invalide. Valeurs autorisées: 'broadcast', 'token', 'topic', 'user'.",
          timestamp: new Date().toISOString(),
        });
    }

    return res.status(200).json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ POST /api/push/send:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur envoi push',
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/topics/subscribe', async (req, res) => {
  try {
    const { topic, tokens } = req.body || {};

    let resolvedTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : [];

    if (resolvedTokens.length === 0) {
      resolvedTokens = Array.from(deviceTokensByToken.keys());
    }

    const result = await subscribeTopic({
      topic,
      tokens: resolvedTokens,
    });

    return res.status(200).json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ POST /api/push/topics/subscribe:', error);
    return res.status(400).json({
      ok: false,
      error: error.message || 'Erreur abonnement topic',
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/topics/unsubscribe', async (req, res) => {
  try {
    const { topic, tokens } = req.body || {};

    let resolvedTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : [];

    if (resolvedTokens.length === 0) {
      resolvedTokens = Array.from(deviceTokensByToken.keys());
    }

    const result = await unsubscribeTopic({
      topic,
      tokens: resolvedTokens,
    });

    return res.status(200).json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ POST /api/push/topics/unsubscribe:', error);
    return res.status(400).json({
      ok: false,
      error: error.message || 'Erreur désabonnement topic',
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;