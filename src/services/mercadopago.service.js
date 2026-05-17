// signaling_server/src/services/mercadopago.service.js
const crypto = require('crypto');
const fetch = require('node-fetch');

const MP_API_BASE = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN missing');
  return token;
}

function getPublicKey() {
  return process.env.MERCADOPAGO_PUBLIC_KEY || '';
}

function getWebhookSecret() {
  return process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
}

async function mpRequest(method, path, body, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${getAccessToken()}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${MP_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (_) { data = { raw: text }; }

  if (!response.ok) {
    const error = new Error(`Mercado Pago API error ${response.status}: ${data.message || text}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

async function createPayment(paymentBody, idempotencyKey) {
  return mpRequest('POST', '/v1/payments', paymentBody, idempotencyKey);
}

async function getPayment(paymentId) {
  return mpRequest('GET', `/v1/payments/${paymentId}`);
}

async function createPreference(preferenceBody) {
  return mpRequest('POST', '/checkout/preferences', preferenceBody);
}

/// ✅ NOUVEAU : Création paiement PIX (QR Code + copia e cola)
async function createPixPayment(paymentBody, idempotencyKey) {
  const body = {
    ...paymentBody,
    payment_method_id: 'pix',
  };
  return mpRequest('POST', '/v1/payments', body, idempotencyKey);
}

/// ⚠️ NOTE : Mercado Pago ne fournit PAS d'API publique pour les payouts PIX
/// sortants pour les comptes standards. Les retraits PIX doivent être traités
/// manuellement via le dashboard MP par un admin, ou via une intégration
/// spéciale "Money Out" qui requiert une autorisation explicite de MP.
async function createPixPayout(_payoutBody, _idempotencyKey) {
  throw new Error(
    'PIX payout automatique non disponible. ' +
    'Requiert une autorisation Money Out de Mercado Pago. ' +
    'Le retrait sera traité manuellement par un administrateur.'
  );
}

function verifyWebhookSignature({ signatureHeader, requestId, dataId }) {
  const secret = getWebhookSecret();
  if (!secret || !signatureHeader || !requestId || !dataId) return false;
  try {
    const parts = signatureHeader.split(',').map((p) => p.trim());
    const tsPart = parts.find((p) => p.startsWith('ts='));
    const sigPart = parts.find((p) => p.startsWith('v1='));
    if (!tsPart || !sigPart) return false;
    const timestamp = tsPart.split('=')[1];
    const providedSig = sigPart.split('=')[1];
    const template = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
    const expectedSig = crypto.createHmac('sha256', secret).update(template).digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(providedSig, 'utf8'),
      Buffer.from(expectedSig, 'utf8')
    );
  } catch (e) {
    console.error('MP signature verification error:', e);
    return false;
  }
}

module.exports = {
  getAccessToken,
  getPublicKey,
  createPayment,
  getPayment,
  createPreference,
  createPixPayment,
  createPixPayout,
  verifyWebhookSignature,
};