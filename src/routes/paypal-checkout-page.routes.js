// signaling_server/src/routes/paypal-checkout-page.routes.js
const express = require('express');
const router = express.Router();

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCheckoutPage({ orderId, currency, amount, label, mode, clientId }) {
  const safeOrderId = escapeHtml(orderId);
  const safeAmount = escapeHtml(amount);
  const safeCurrency = escapeHtml(currency);
  const safeLabel = escapeHtml(label);
  const safeClientId = escapeHtml(clientId);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lovingo - Paiement PayPal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #1a1a1a;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      padding: 32px 24px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 8px;
      text-align: center;
      color: #1a1a1a;
    }
    .subtitle {
      font-size: 14px;
      color: #666;
      text-align: center;
      margin-bottom: 24px;
    }
    .amount-box {
      background: #f7f9fc;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      margin-bottom: 24px;
    }
    .amount {
      font-size: 36px;
      font-weight: 900;
      color: #003087;
    }
    .label {
      font-size: 14px;
      color: #555;
      margin-top: 4px;
    }
    #paypal-button-container { min-height: 200px; }
    .status {
      margin-top: 16px;
      padding: 14px;
      border-radius: 10px;
      font-size: 14px;
      text-align: center;
      display: none;
    }
    .status.success { background: #d1fae5; color: #047857; display: block; }
    .status.error { background: #fee2e2; color: #b91c1c; display: block; }
    .status.loading { background: #dbeafe; color: #1e40af; display: block; }
    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Paiement Lovingo</h1>
    <p class="subtitle">Paiement sécurisé via PayPal</p>
    <div class="amount-box">
      <div class="amount">${safeAmount} ${safeCurrency}</div>
      <div class="label">${safeLabel}</div>
    </div>
    <div id="paypal-button-container"></div>
    <div id="status" class="status"></div>
    <div class="footer">🔒 Transaction sécurisée • PayPal ${escapeHtml(mode)}</div>
  </div>

  <script src="https://www.paypal.com/sdk/js?client-id=${safeClientId}&currency=${safeCurrency}&intent=capture&disable-funding=credit"></script>
  <script>
    var statusEl = document.getElementById('status');
    function setStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.className = 'status ' + type;
    }
    function notifyFlutter(payload) {
      try {
        if (window.LovingoBridge && window.LovingoBridge.postMessage) {
          window.LovingoBridge.postMessage(JSON.stringify(payload));
        }
      } catch (e) {}
      try {
        window.location.href = 'lovingo://paypal-result?data=' + encodeURIComponent(JSON.stringify(payload));
      } catch (e) {}
    }

    paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'paypal', height: 48 },
      createOrder: function() { return '${safeOrderId}'; },
      onApprove: function(data, actions) {
        setStatus('Validation du paiement...', 'loading');
        return fetch('/api/paypal/capture-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orderID })
        })
        .then(function(r) { return r.json(); })
        .then(function(json) {
          if (json.status === 'COMPLETED' || json.status === 'already_captured') {
            setStatus('✅ Paiement réussi !', 'success');
            notifyFlutter({ status: 'success', orderId: data.orderID });
          } else {
            setStatus('Statut: ' + (json.status || 'inconnu'), 'error');
            notifyFlutter({ status: 'pending', orderId: data.orderID, raw: json });
          }
        })
        .catch(function(err) {
          setStatus('Erreur: ' + err.message, 'error');
          notifyFlutter({ status: 'error', error: err.message });
        });
      },
      onCancel: function() {
        setStatus('Paiement annulé.', 'error');
        notifyFlutter({ status: 'cancelled' });
      },
      onError: function(err) {
        console.error(err);
        setStatus('Erreur PayPal: ' + (err && err.message ? err.message : 'inconnue'), 'error');
        notifyFlutter({ status: 'error', error: String(err) });
      }
    }).render('#paypal-button-container');
  </script>
</body>
</html>`;
}

router.get('/paypal-checkout', async (req, res) => {
  try {
    const { orderId, currency, amount, label } = req.query;

    if (!orderId) {
      return res.status(400).send('orderId manquant');
    }

    const clientId = process.env.PAYPAL_CLIENT_ID || '';
    if (!clientId) {
      return res.status(500).send('PAYPAL_CLIENT_ID non configuré côté serveur');
    }

    const html = renderCheckoutPage({
      orderId,
      currency: currency || 'USD',
      amount: amount || '0.00',
      label: label || 'Paiement Lovingo',
      mode: (process.env.PAYPAL_MODE || 'live').toLowerCase(),
      clientId,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.send(html);
  } catch (e) {
    console.error('❌ paypal-checkout page:', e);
    res.status(500).send('Erreur serveur');
  }
});

module.exports = router;
