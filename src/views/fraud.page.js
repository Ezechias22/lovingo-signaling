// signaling_server/src/views/fraud.page.js

function renderFraudPage() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Dashboard Fraude - Lovingo</title>
  <style>
    body { margin:0; font-family:Arial,sans-serif; background:#12091f; color:white; }
    .wrap { max-width:1100px; margin:0 auto; padding:24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; }
    .card { background:#24133d; border:1px solid rgba(255,255,255,.12); border-radius:18px; padding:18px; }
    .num { font-size:32px; font-weight:900; color:#FFD700; }
    input { width:100%; padding:12px; border-radius:10px; border:0; box-sizing:border-box; }
    button { padding:12px 14px; border:0; border-radius:10px; font-weight:800; cursor:pointer; }
    .danger { background:#ff4757; color:white; }
    .ok { background:#2ed573; color:#111; }
    table { width:100%; border-collapse:collapse; margin-top:14px; }
    th,td { padding:10px; border-bottom:1px solid rgba(255,255,255,.12); font-size:13px; }
    th { text-align:left; color:#FFD700; }
    .muted { color:rgba(255,255,255,.65); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>🔐 Dashboard Fraude Lovingo</h1>
    <p class="muted">Entrez ton ADMIN_MAINTENANCE_SECRET pour voir les données.</p>

    <div class="card">
      <input id="secret" placeholder="ADMIN_MAINTENANCE_SECRET" type="password" />
      <br><br>
      <button onclick="loadAll()">Charger dashboard</button>
    </div>

    <br>

    <div class="grid" id="overview"></div>

    <br>

    <div class="card">
      <h2>Bannir / débannir utilisateur</h2>
      <input id="userId" placeholder="Firebase userId" />
      <br><br>
      <button class="danger" onclick="banUser()">Bannir</button>
      <button class="ok" onclick="unbanUser()">Débannir</button>
      <p id="actionMsg" class="muted"></p>
    </div>

    <br>

    <div class="card">
      <h2>Derniers logs fraude</h2>
      <div id="logs"></div>
    </div>

    <br>

    <div class="card">
      <h2>Blacklist active</h2>
      <div id="blacklist"></div>
    </div>
  </div>

<script>
function secret() {
  return document.getElementById('secret').value.trim();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret(),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function loadAll() {
  try {
    await Promise.all([loadOverview(), loadLogs(), loadBlacklist()]);
  } catch (e) {
    alert(e.message);
  }
}

async function loadOverview() {
  const data = await api('/api/admin/fraud/overview');
  document.getElementById('overview').innerHTML = [
    ['Logs 24h', data.totalLogs],
    ['Bloqués', data.blocked],
    ['Auto bans', data.autoBans],
    ['High risk', data.highRisk],
    ['Blacklist', data.activeBlacklist],
  ].map(([k,v]) => '<div class="card"><div class="muted">'+k+'</div><div class="num">'+v+'</div></div>').join('');
}

async function loadLogs() {
  const data = await api('/api/admin/fraud/logs?limit=100');
  document.getElementById('logs').innerHTML = table(data.logs, [
    'type','userId','publicId','packageId','riskScore','reason'
  ]);
}

async function loadBlacklist() {
  const data = await api('/api/admin/fraud/blacklist');
  document.getElementById('blacklist').innerHTML = table(data.blacklist, [
    'id','userId','ipHash','reason','active'
  ]);
}

function table(rows, keys) {
  if (!rows || rows.length === 0) return '<p class="muted">Aucune donnée</p>';

  return '<table><thead><tr>' +
    keys.map(k => '<th>'+k+'</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + keys.map(k => '<td>'+safe(row[k])+'</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
}

function safe(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
}

async function banUser() {
  const userId = document.getElementById('userId').value.trim();
  const msg = document.getElementById('actionMsg');

  try {
    const data = await api('/api/admin/fraud/ban-user', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    msg.textContent = 'Utilisateur banni: ' + data.userId;
    await loadAll();
  } catch (e) {
    msg.textContent = e.message;
  }
}

async function unbanUser() {
  const userId = document.getElementById('userId').value.trim();
  const msg = document.getElementById('actionMsg');

  try {
    const data = await api('/api/admin/fraud/unban-user', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    msg.textContent = 'Utilisateur débanni: ' + data.userId;
    await loadAll();
  } catch (e) {
    msg.textContent = e.message;
  }
}
</script>
</body>
</html>`;
}

module.exports = {
  renderFraudPage,
};