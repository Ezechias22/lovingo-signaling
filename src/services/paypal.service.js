// signaling_server/src/services/paypal.service.js
const fetch = require('node-fetch');

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getMode() {
  return (process.env.PAYPAL_MODE || 'live').toLowerCase();
}

function getApiBase() {
  return getMode() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

function getClientId() {
  const id = process.env.PAYPAL_CLIENT_ID;
  if (!id) throw new Error('PAYPAL_CLIENT_ID missing');
  return id;
}

function getSecret() {
  const secret = process.env.PAYPAL_SECRET;
  if (!secret) throw new Error('PAYPAL_SECRET missing');
  return secret;
}

function getWebhookId() {
  return process.env.PAYPAL_WEBHOOK_ID || '';
}

async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && now < cachedTokenExpiresAt - 60000) {
    return cachedToken;
  }

  const credentials = Buffer.from(
    `${getClientId()}:${getSecret()}`
  ).toString('base64');

  const response = await fetch(`${getApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `PayPal OAuth failed: ${data.error_description || JSON.stringify(data)}`
    );
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + data.expires_in * 1000;

  return cachedToken;
}

async function ppRequest(method, path, body, extraHeaders = {}) {
  const token = await getAccessToken();

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(
      `PayPal API error ${response.status}: ${
        data.message || data.error_description || text
      }`
    );
    err.status = response.status;
    err.body = data;
    throw err;
  }

  return data;
}

async function createOrder(orderBody, paypalRequestId) {
  return ppRequest('POST', '/v2/checkout/orders', orderBody, {
    'PayPal-Request-Id': paypalRequestId || '',
  });
}

async function captureOrder(orderId, paypalRequestId) {
  return ppRequest('POST', `/v2/checkout/orders/${orderId}/capture`, {}, {
    'PayPal-Request-Id': paypalRequestId || '',
  });
}

async function getOrder(orderId) {
  return ppRequest('GET', `/v2/checkout/orders/${orderId}`);
}

async function createPayout(payoutBody, requestId) {
  return ppRequest('POST', '/v1/payments/payouts', payoutBody, {
    'PayPal-Request-Id': requestId || '',
  });
}

async function getPayoutBatch(batchId) {
  return ppRequest('GET', `/v1/payments/payouts/${batchId}`);
}

async function verifyWebhook({ headers, rawBody }) {
  const webhookId = getWebhookId();
  if (!webhookId) {
    console.warn('PAYPAL_WEBHOOK_ID missing, skipping verification');
    return false;
  }

  const verifyBody = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody,
  };

  try {
    const result = await ppRequest(
      'POST',
      '/v1/notifications/verify-webhook-signature',
      verifyBody
    );
    return result.verification_status === 'SUCCESS';
  } catch (e) {
    console.error('PayPal webhook verify error:', e.message);
    return false;
  }
}

module.exports = {
  getMode,
  getApiBase,
  getClientId,
  getAccessToken,
  createOrder,
  captureOrder,
  getOrder,
  createPayout,
  getPayoutBatch,
  verifyWebhook,
};
