// signaling_server/src/views/coins.page.js

function renderCoinsPage({ PLAYSTORE_URL }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Acheter des coins - Lovingo</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: linear-gradient(160deg, #2D1B69, #6A4C93);
      color: #fff;
    }

    .wrap {
      max-width: 960px;
      margin: 0 auto;
      padding: 32px 18px;
    }

    .card {
      background: rgba(255,255,255,.12);
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,.25);
    }

    h1 {
      font-size: 36px;
      margin: 0 0 10px;
    }

    p {
      color: rgba(255,255,255,.82);
      line-height: 1.55;
    }

    label {
      display: block;
      margin: 18px 0 8px;
      font-weight: 700;
    }

    input, select {
      width: 100%;
      box-sizing: border-box;
      padding: 16px;
      border-radius: 14px;
      border: none;
      outline: none;
      font-size: 18px;
      background: #fff;
      color: #1b1240;
    }

    input {
      text-transform: uppercase;
    }

    .packages {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }

    .package {
      cursor: pointer;
      background: rgba(255,255,255,.14);
      border: 2px solid rgba(255,255,255,.18);
      border-radius: 18px;
      padding: 18px;
      transition: .2s;
    }

    .package:hover,
    .package.active {
      transform: translateY(-2px);
      border-color: #FFD700;
      background: rgba(255,215,0,.18);
    }

    .coins {
      color: #FFD700;
      font-size: 24px;
      font-weight: 900;
    }

    .price {
      margin-top: 6px;
      font-weight: 700;
    }

    .hint {
      margin-top: 8px;
      font-size: 13px;
      color: rgba(255,255,255,.72);
    }

    button {
      width: 100%;
      margin-top: 22px;
      border: none;
      border-radius: 16px;
      padding: 16px;
      font-size: 18px;
      font-weight: 900;
      cursor: pointer;
      background: linear-gradient(90deg, #FFD700, #FFA500);
      color: #1b1240;
    }

    button:disabled {
      opacity: .6;
      cursor: not-allowed;
    }

    .msg {
      margin-top: 16px;
      padding: 14px;
      border-radius: 14px;
      background: rgba(0,0,0,.18);
      display: none;
      white-space: pre-wrap;
    }

    a {
      color: #FFD700;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>💰 Acheter des coins Lovingo</h1>
      <p>
        Entrez l’ID public de l’utilisateur Lovingo, choisissez un pack, puis payez avec Stripe.
        Les coins seront ajoutés automatiquement après confirmation du paiement.
      </p>

      <label for="publicId">ID public Lovingo</label>
      <input id="publicId" placeholder="Ex: LOV123456" />

      <label for="currency">Devise de paiement</label>
      <select id="currency">
        <option value="brl">BRL 🇧🇷 Brésil</option>
        <option value="usd">USD 🌍 International</option>
        <option value="eur">EUR 🇪🇺 Europe</option>
      </select>
      <div class="hint">
        Si votre carte est brésilienne, choisissez BRL. Stripe refuse souvent les cartes brésiliennes en USD.
      </div>

      <div class="packages" id="packages"></div>

      <button id="payBtn">Continuer vers le paiement</button>

      <div class="msg" id="msg"></div>

      <p style="margin-top:22px">
        Vous n’avez pas l’application ?
        <a href="${PLAYSTORE_URL}" target="_blank" rel="noopener">Télécharger Lovingo sur Google Play</a>
      </p>
    </div>
  </div>

  <script>
    let selectedPackageId = 'popular';
    let loadedPackages = [];

    const packagesEl = document.getElementById('packages');
    const payBtn = document.getElementById('payBtn');
    const msg = document.getElementById('msg');
    const currencyEl = document.getElementById('currency');

    const LOCAL_RATES = {
      brl: 5.10,
      usd: 1,
      eur: 0.92
    };

    const CURRENCY_LABELS = {
      brl: 'BRL',
      usd: 'USD',
      eur: 'EUR'
    };

    function showMessage(text) {
      msg.style.display = 'block';
      msg.textContent = text;
    }

    function hideMessage() {
      msg.style.display = 'none';
      msg.textContent = '';
    }

    function getSelectedCurrency() {
      return currencyEl.value || 'brl';
    }

    function formatLocalPrice(usdAmount) {
      const currency = getSelectedCurrency();
      const rate = LOCAL_RATES[currency] || 1;
      const localAmount = Number(usdAmount || 0) * rate;

      if (currency === 'brl') {
        return 'R$ ' + localAmount.toFixed(2).replace('.', ',');
      }

      if (currency === 'eur') {
        return localAmount.toFixed(2) + ' €';
      }

      return '$' + localAmount.toFixed(2);
    }

    function renderPackages(packages) {
      loadedPackages = packages || [];
      packagesEl.innerHTML = '';

      loadedPackages.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'package' + (item.id === selectedPackageId ? ' active' : '');

        div.innerHTML =
          '<div class="coins">' + Number(item.coins).toLocaleString() + ' coins</div>' +
          '<div class="price">' + formatLocalPrice(item.usd) + ' ' + CURRENCY_LABELS[getSelectedCurrency()] + '</div>' +
          '<div class="hint">Base: ' + item.usd + ' USD</div>';

        div.onclick = () => {
          selectedPackageId = item.id;
          renderPackages(loadedPackages);
        };

        packagesEl.appendChild(div);
      });
    }

    async function loadPackages() {
      const res = await fetch('/api/coin-packages');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Impossible de charger les packs coins.');
      }

      renderPackages(data.packages || []);
    }

    currencyEl.addEventListener('change', () => {
      hideMessage();
      renderPackages(loadedPackages);
    });

    payBtn.onclick = async () => {
      const publicId = document.getElementById('publicId').value.trim();
      const currency = getSelectedCurrency();

      if (!publicId) {
        showMessage('Veuillez entrer un ID public Lovingo.');
        return;
      }

      payBtn.disabled = true;
      showMessage('Redirection vers Stripe Checkout...');

      try {
        const res = await fetch('/api/create-coin-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicId,
            packageId: selectedPackageId,
            source: 'web_public_id',
            currency
          })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || data.details || 'Erreur paiement');
        }

        if (!data.url) {
          throw new Error('URL Stripe Checkout manquante.');
        }

        window.location.href = data.url;
      } catch (error) {
        showMessage(error.message || 'Erreur inconnue');
        payBtn.disabled = false;
      }
    };

    loadPackages().catch((error) => {
      showMessage(error.message || 'Impossible de charger les packs coins.');
    });
  </script>
</body>
</html>`;
}

function renderCoinsSuccessPage({ PLAYSTORE_URL }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Paiement réussi - Lovingo</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(160deg, #2D1B69, #6A4C93);
      color: #fff;
      text-align: center;
      padding: 18px;
    }

    .card {
      max-width: 560px;
      background: rgba(255,255,255,.12);
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 24px;
      padding: 28px;
    }

    .icon {
      font-size: 64px;
    }

    a {
      color: #FFD700;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Paiement réussi</h1>
    <p>Les coins seront ajoutés automatiquement au compte Lovingo après confirmation Stripe.</p>
    <p><a href="${PLAYSTORE_URL}" target="_blank" rel="noopener">Ouvrir Lovingo sur Google Play</a></p>
  </div>
</body>
</html>`;
}

module.exports = {
  renderCoinsPage,
  renderCoinsSuccessPage,
};