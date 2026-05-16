// signaling_server/src/views/live.page.js

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLiveSharePage({ room, roomId, PLAYSTORE_URL, APP_PACKAGE, BASE_URL }) {
  const safeRoomId = escapeHtml(roomId);
  const title = escapeHtml(room?.title || 'Live Lovingo');
  const hostName = escapeHtml(room?.hostUsername || 'Lovingo');
  const hostPhoto = escapeHtml(room?.hostPhotoUrl || '');
  const viewers = Number(room?.viewerCount || 0);
  const category = escapeHtml(room?.category || '');
  const isActive = room?.isActive === true;

  // URLs intelligentes
  // Android : intent:// ouvre l'app si installée, sinon redirige vers Play Store
  const androidIntent = `intent://lovingosocial.com/live/${safeRoomId}#Intent;scheme=https;package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAYSTORE_URL)};end`;
  // iOS : custom scheme (Universal Links activera l'app directement quand configuré)
  const iosScheme = `lovingo://live/${safeRoomId}`;
  // Fallback web (cette même page)
  const webUrl = `${BASE_URL}/live/${safeRoomId}`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} • Live Lovingo</title>
<meta name="description" content="Rejoins le live de ${hostName} sur Lovingo">

<!-- Open Graph (pour les aperçus WhatsApp / Facebook / Telegram) -->
<meta property="og:type" content="video.other">
<meta property="og:title" content="${title}">
<meta property="og:description" content="🔴 ${hostName} est en live sur Lovingo">
<meta property="og:url" content="${webUrl}">
${hostPhoto ? `<meta property="og:image" content="${hostPhoto}">` : ''}
<meta name="twitter:card" content="summary_large_image">

<!-- App Links / Smart Banner iOS -->
<meta name="apple-itunes-app" content="app-id=YOUR_APPLE_ID, app-argument=${iosScheme}">
<link rel="alternate" href="android-app://${APP_PACKAGE}/https/lovingosocial.com/live/${safeRoomId}">
<link rel="alternate" href="ios-app://YOUR_APPLE_ID/lovingo/live/${safeRoomId}">

<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  min-height:100vh;
  background:linear-gradient(135deg,#FF375F 0%,#8B5CF6 60%,#3B82F6 100%);
  color:#fff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:20px;
}
.card{
  background:rgba(255,255,255,0.08);
  backdrop-filter:blur(20px);
  -webkit-backdrop-filter:blur(20px);
  border:1px solid rgba(255,255,255,0.18);
  border-radius:28px;
  padding:32px 24px;
  max-width:420px;width:100%;
  box-shadow:0 30px 80px rgba(0,0,0,0.4);
  text-align:center;
  animation:fadeUp 0.6s ease;
}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.live-badge{
  display:inline-flex;align-items:center;gap:6px;
  background:#ff1744;color:#fff;
  padding:6px 14px;border-radius:999px;
  font-weight:900;font-size:12px;letter-spacing:0.5px;
  margin-bottom:18px;
  ${isActive ? 'animation:pulse 1.5s ease-in-out infinite;' : 'background:#666;'}
}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,23,68,0.6)}50%{box-shadow:0 0 0 12px rgba(255,23,68,0)}}
.live-badge .dot{width:8px;height:8px;background:#fff;border-radius:50%}
.avatar{
  width:96px;height:96px;border-radius:50%;
  margin:0 auto 16px;
  background:rgba(255,255,255,0.15) center/cover no-repeat;
  border:3px solid rgba(255,255,255,0.3);
  display:flex;align-items:center;justify-content:center;
  font-size:42px;
  ${hostPhoto ? `background-image:url('${hostPhoto}');` : ''}
}
h1{font-size:24px;font-weight:800;margin-bottom:6px;line-height:1.25}
.host{font-size:15px;opacity:0.85;margin-bottom:18px;font-weight:600}
.stats{
  display:flex;justify-content:center;gap:20px;
  margin-bottom:28px;font-size:14px;
}
.stats .item{display:flex;align-items:center;gap:6px;opacity:0.9}
.stats .item strong{font-weight:800}
.cta{
  display:block;width:100%;
  background:#fff;color:#FF375F;
  padding:16px;border-radius:18px;
  text-decoration:none;font-weight:900;font-size:17px;
  margin-bottom:12px;
  transition:transform 0.2s,box-shadow 0.2s;
  box-shadow:0 14px 36px rgba(0,0,0,0.2);
}
.cta:hover{transform:translateY(-2px);box-shadow:0 18px 44px rgba(0,0,0,0.3)}
.cta-secondary{
  background:rgba(255,255,255,0.12);color:#fff;
  border:1px solid rgba(255,255,255,0.25);
  box-shadow:none;
}
.disclaimer{
  margin-top:20px;
  font-size:12px;opacity:0.7;line-height:1.5;
}
.disclaimer a{color:#fff;font-weight:700}
.ended{
  background:rgba(0,0,0,0.3);
  padding:20px;border-radius:18px;
  margin-bottom:20px;
  font-weight:600;
}
</style>
</head>
<body>
<div class="card">
  <div class="live-badge">
    <span class="dot"></span>
    ${isActive ? 'LIVE' : 'TERMINÉ'}
  </div>

  <div class="avatar">${hostPhoto ? '' : '👤'}</div>

  <h1>${title}</h1>
  <div class="host">@${hostName}</div>

  ${isActive ? `
  <div class="stats">
    <div class="item">👁️ <strong>${viewers}</strong> spectateurs</div>
    ${category ? `<div class="item">🏷️ <strong>${category}</strong></div>` : ''}
  </div>

  <a href="${iosScheme}" id="openApp" class="cta">📱 Ouvrir dans l'app</a>
  <a href="${PLAYSTORE_URL}" class="cta cta-secondary">⬇️ Télécharger Lovingo</a>
  ` : `
  <div class="ended">😔 Ce live est terminé</div>
  <a href="${BASE_URL}" class="cta">Découvrir d'autres lives</a>
  <a href="${PLAYSTORE_URL}" class="cta cta-secondary">⬇️ Télécharger Lovingo</a>
  `}

  <div class="disclaimer">
    En continuant, vous acceptez les <a href="${BASE_URL}/terms">Conditions</a> et la <a href="${BASE_URL}/privacy">Confidentialité</a>.
  </div>
</div>

<script>
(function(){
  ${!isActive ? 'return;' : ''}
  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  var openBtn = document.getElementById('openApp');

  // Sur Android : utiliser intent:// qui ouvre l'app si installée, sinon redirige vers Play Store
  if (isAndroid && openBtn) {
    openBtn.setAttribute('href', '${androidIntent}');
  }
  // Sur iOS : tenter le custom scheme, fallback App Store après 1.5s si rien ne s'ouvre
  if (isIOS && openBtn) {
    openBtn.setAttribute('href', '${iosScheme}');
  }

  // Tentative automatique d'ouvrir l'app au chargement (seulement mobile)
  if (isAndroid || isIOS) {
    setTimeout(function(){
      try {
        if (isAndroid) {
          window.location.href = '${androidIntent}';
        } else {
          window.location.href = '${iosScheme}';
          // Fallback : si après 2s on est toujours là, c'est que l'app n'est pas installée
          setTimeout(function(){
            if (!document.hidden) {
              window.location.href = '${PLAYSTORE_URL}';
            }
          }, 2000);
        }
      } catch(e) {}
    }, 500);
  }
})();
</script>
</body>
</html>`;
}

module.exports = { renderLiveSharePage };