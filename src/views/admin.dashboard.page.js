// signaling_server/src/views/admin.dashboard.page.js

function renderAdminDashboardPage() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Admin Lovingo</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0f1020;
      color: white;
    }

    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 28px 16px;
    }

    .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }

    h1 {
      margin: 0;
      font-size: 30px;
    }

    .card {
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 18px;
      padding: 18px;
      margin-bottom: 16px;
    }

    input, button {
      padding: 12px 14px;
      border-radius: 12px;
      border: none;
      font-size: 15px;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      margin-top: 8px;
    }

    button {
      cursor: pointer;
      font-weight: 800;
      background: linear-gradient(90deg,#FFD700,#FFA500);
      color: #1b1240;
      margin-top: 12px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(190px,1fr));
      gap: 14px;
    }

    .stat {
      background: rgba(255,255,255,.09);
      border-radius: 16px;
      padding: 16px;
      border: 1px solid rgba(255,255,255,.12);
    }

    .num {
      font-size: 28px;
      font-weight: 900;
      color: #FFD700;
    }

    .label {
      opacity: .75;
      margin-top: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      overflow: hidden;
      border-radius: 12px;
    }

    th, td {
      text-align: left;
      padding: 10px;
      border-bottom: 1px solid rgba(255,255,255,.1);
      font-size: 13px;
      vertical-align: top;
    }

    th {
      color: #FFD700;
      background: rgba(255,255,255,.06);
    }

    .danger {
      background: #ff4757;
      color: white;
    }

    .ok {
      color: #2ed573;
      font-weight: 800;
    }

    .bad {
      color: #ff6b81;
      font-weight: 800;
    }

    .muted {
      opacity: .65;
    }

    .tabs {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin: 18px 0;
    }

    .tab {
      background: rgba(255,255,255,.1);
      color: white;
    }

    .tab.active {
      background: linear-gradient(90deg,#FFD700,#FFA500);
      color: #1b1240;
    }

    .section {
      display: none;
    }

    .section.active {
      display: block;
    }

    a {
      color: #FFD700;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>🔐 Admin Lovingo</h1>
      <a href="/">Retour site</a>
    </div>

    <div class="card">
      <label>ADMIN_MAINTENANCE_SECRET</label>
      <input id="secret" type="password" placeholder="Entre ton secret admin" />
      <button onclick="loadAll()">Charger dashboard</button>
      <div id="msg" class="muted" style="margin-top:10px;"></div>
    </div>

    <div class="grid">
      <div class="stat"><div class="num" id="logs24h">0</div><div class="label">Logs fraude 24h</div></div>
      <div class="stat"><div class="num" id="blocked">0</div><div class="label">Bloqués</div></div>
      <div class="stat"><div class="num" id="autoBans">0</div><div class="label">Auto bans</div></div>
      <div class="stat"><div class="num" id="highRisk">0</div><div class="label">High risk</div></div>
      <div class="stat"><div class="num" id="blacklist">0</div><div class="label">Blacklist active</div></div>
      <div class="stat"><div class="num" id="coinsSold">0</div><div class="label">Coins vendus</div></div>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="showTab('fraud')">🚨 Fraude</button>
      <button class="tab" onclick="showTab('coins')">🪙 Coins</button>
      <button class="tab" onclick="showTab('payments')">💳 Paiements</button>
      <button class="tab" onclick="showTab('tools')">🛠️ Outils</button>
    </div>

    <div id="fraud" class="section active">
      <div class="card">
        <h2>Derniers logs fraude</h2>
        <table>
          <thead>
            <tr>
              <th>type</th>
              <th>userId</th>
              <th>publicId</th>
              <th>package</th>
              <th>risk</th>
              <th>raison</th>
            </tr>
          </thead>
          <tbody id="fraudLogs"></tbody>
        </table>
      </div>

      <div class="card">
        <h2>Blacklist active</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>userId</th>
              <th>raison</th>
              <th>date</th>
            </tr>
          </thead>
          <tbody id="blacklistRows"></tbody>
        </table>
      </div>
    </div>

    <div id="coins" class="section">
      <div class="card">
        <h2>Derniers achats coins</h2>
        <table>
          <thead>
            <tr>
              <th>userId</th>
              <th>coins</th>
              <th>package</th>
              <th>devise</th>
              <th>montant</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody id="coinRows"></tbody>
        </table>
      </div>
    </div>

    <div id="payments" class="section">
      <div class="card">
        <h2>Logs paiements</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>userId</th>
              <th>publicId</th>
              <th>package</th>
              <th>devise</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody id="paymentRows"></tbody>
        </table>
      </div>
    </div>

    <div id="tools" class="section">
      <div class="card">
        <h2>Bannir / débannir utilisateur</h2>
        <input id="targetUserId" placeholder="Firebase userId" />
        <button class="danger" onclick="banUser()">Bannir</button>
        <button onclick="unbanUser()">Débannir</button>
      </div>

      <div class="card">
        <h2>Réparer publicId</h2>
        <p class="muted">Ajoute ou répare les ID publics manquants pour les utilisateurs.</p>
        <button onclick="repairPublicIds()">Réparer public IDs</button>
      </div>
    </div>
  </div>

<script>
function getSecret() {
  return document.getElementById('secret').value.trim();
}

function setMsg(text) {
  document.getElementById('msg').textContent = text || '';
}

function headers() {
  return { 'x-admin-secret': getSecret(), 'Content-Type': 'application/json' };
}

function showTab(id) {
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  event.target.classList.add('active');
}

function safe(value) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value).replace(/[<>&"]/g, c => ({
    '<':'&lt;',
    '>':'&gt;',
    '&':'&amp;',
    '"':'&quot;'
  }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.details || 'Erreur API');
  }

  return data;
}

async function loadAll() {
  try {
    setMsg('Chargement...');
    const data = await api('/api/admin/overview');

    document.getElementById('logs24h').textContent = data.stats.logs24h || 0;
    document.getElementById('blocked').textContent = data.stats.blocked || 0;
    document.getElementById('autoBans').textContent = data.stats.autoBans || 0;
    document.getElementById('highRisk').textContent = data.stats.highRisk || 0;
    document.getElementById('blacklist').textContent = data.stats.blacklist || 0;
    document.getElementById('coinsSold').textContent = data.stats.coinsSold || 0;

    document.getElementById('fraudLogs').innerHTML = (data.fraudLogs || []).map(row => \`
      <tr>
        <td>\${safe(row.type)}</td>
        <td>\${safe(row.userId)}</td>
        <td>\${safe(row.publicId)}</td>
        <td>\${safe(row.packageId)}</td>
        <td>\${safe(row.riskScore)}</td>
        <td>\${safe((row.riskReasons || row.reason || '').toString())}</td>
      </tr>
    \`).join('') || '<tr><td colspan="6" class="muted">Aucune donnée</td></tr>';

    document.getElementById('blacklistRows').innerHTML = (data.blacklist || []).map(row => \`
      <tr>
        <td>\${safe(row.id)}</td>
        <td>\${safe(row.userId)}</td>
        <td>\${safe(row.reason)}</td>
        <td>\${safe(row.createdAtText)}</td>
      </tr>
    \`).join('') || '<tr><td colspan="4" class="muted">Aucune donnée</td></tr>';

    document.getElementById('coinRows').innerHTML = (data.coinTransactions || []).map(row => \`
      <tr>
        <td>\${safe(row.userId)}</td>
        <td>\${safe(row.coins)}</td>
        <td>\${safe(row.packageId)}</td>
        <td>\${safe(row.currency)}</td>
        <td>\${safe(row.amountPaid)}</td>
        <td>\${safe(row.status)}</td>
      </tr>
    \`).join('') || '<tr><td colspan="6" class="muted">Aucune donnée</td></tr>';

    document.getElementById('paymentRows').innerHTML = (data.paymentLogs || []).map(row => \`
      <tr>
        <td>\${safe(row.id)}</td>
        <td>\${safe(row.userId)}</td>
        <td>\${safe(row.publicId)}</td>
        <td>\${safe(row.packageId)}</td>
        <td>\${safe(row.currency)}</td>
        <td>\${safe(row.status)}</td>
      </tr>
    \`).join('') || '<tr><td colspan="6" class="muted">Aucune donnée</td></tr>';

    setMsg('Dashboard chargé.');
  } catch (e) {
    setMsg(e.message);
  }
}

async function banUser() {
  const userId = document.getElementById('targetUserId').value.trim();
  if (!userId) return setMsg('Entre un userId.');

  try {
    await api('/api/admin/users/' + encodeURIComponent(userId) + '/ban', { method: 'POST' });
    setMsg('Utilisateur banni.');
    loadAll();
  } catch (e) {
    setMsg(e.message);
  }
}

async function unbanUser() {
  const userId = document.getElementById('targetUserId').value.trim();
  if (!userId) return setMsg('Entre un userId.');

  try {
    await api('/api/admin/users/' + encodeURIComponent(userId) + '/unban', { method: 'POST' });
    setMsg('Utilisateur débanni.');
    loadAll();
  } catch (e) {
    setMsg(e.message);
  }
}

async function repairPublicIds() {
  try {
    const data = await api('/api/admin/repair-public-ids', { method: 'POST' });
    setMsg('Réparation terminée. repaired=' + data.repaired + ', skipped=' + data.skipped);
  } catch (e) {
    setMsg(e.message);
  }
}
</script>
</body>
</html>`;
}

module.exports = {
  renderAdminDashboardPage,
};