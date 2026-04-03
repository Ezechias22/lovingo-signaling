const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');

// Ajout de Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  clientTracking: true,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024,
});

// Configuration
const PORT = process.env.PORT || 8080;
const MAX_CLIENTS_PER_ROOM = 100;
const RENDER_URL =
  process.env.RENDER_EXTERNAL_URL || 'https://lovingo-signaling.onrender.com';
const PLAYSTORE_URL =
  'https://play.google.com/store/apps/details?id=com.lovingo2.app&pcampaignid=web_share';

// LiveKit config
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

// État du serveur
const rooms = new Map();
const clients = new Map();
const liveRooms = new Map();
const liveJoinRequests = new Map();

// Middleware
app.use(
  cors({
    origin: [
      'https://lovingo.app',
      'https://www.lovingo.app',
      'http://localhost:3000',
      'http://localhost:8080',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =================== HELPERS ===================

function generateClientId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

function sendMessage(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('❌ Erreur envoi message:', error);
    }
  }
}

function sendError(ws, error) {
  sendMessage(ws, {
    type: 'error',
    from: 'server',
    to: 'client',
    data: {
      error,
      timestamp: new Date().toISOString(),
    },
  });
}

function broadcastToRoom(roomId, message, excludeWs = null) {
  if (!rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  let sentCount = 0;

  room.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      sendMessage(ws, message);
      sentCount++;
    }
  });

  console.log(`📡 Message broadcast dans ${roomId} à ${sentCount} clients`);
}

function findClientByUserId(userId) {
  for (const [ws, client] of clients.entries()) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      return { ws, client };
    }
  }
  return null;
}

function getUserIdFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const fakeUserId = req.headers['x-user-id'];

  if (fakeUserId) return String(fakeUserId);

  if (authHeader.startsWith('Bearer ')) {
    return 'authenticated_user';
  }

  return null;
}

function ensureLiveRoom(roomId) {
  if (!liveRooms.has(roomId)) {
    liveRooms.set(roomId, {
      roomId,
      hostId: null,
      title: 'Live Stream',
      maxGuests: 8,
      guests: new Set(),
      viewers: new Set(),
      requests: new Set(),
      startTime: new Date(),
      stats: {
        totalViewers: 0,
        peakViewers: 0,
        totalGifts: 0,
        totalHearts: 0,
      },
      isActive: true,
    });
  }

  if (!liveJoinRequests.has(roomId)) {
    liveJoinRequests.set(roomId, []);
  }

  return liveRooms.get(roomId);
}

function requireLiveKitConfig() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error(
      'LIVEKIT_URL, LIVEKIT_API_KEY ou LIVEKIT_API_SECRET manquant dans les variables d’environnement'
    );
  }
}

async function createLiveKitToken({
  roomId,
  identity,
  name,
  role = 'audience',
}) {
  requireLiveKitConfig();

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '2h',
  });

  const canPublish = role === 'host' || role === 'guest';

  at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return {
    token,
    url: LIVEKIT_URL,
  };
}

// =================== ENDPOINTS STRIPE ===================

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'eur', userId, metadata = {} } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: 'Montant invalide',
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency.toLowerCase(),
      metadata: {
        app: 'lovingo',
        userId: userId || 'anonymous',
        createdAt: new Date().toISOString(),
        ...metadata,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(
      `💳 PaymentIntent créé: ${paymentIntent.id} pour ${amount}${currency.toUpperCase()}`
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    console.error('❌ Erreur création PaymentIntent:', error);
    res.status(400).json({
      error: 'Erreur lors de la création du paiement',
      details: error.message,
    });
  }
});

app.post('/api/purchase-credits', async (req, res) => {
  try {
    const { userId, creditPackage } = req.body;

    const packages = {
      small: { credits: 100, price: 4.99, currency: 'eur' },
      medium: { credits: 500, price: 19.99, currency: 'eur' },
      large: { credits: 1200, price: 39.99, currency: 'eur' },
      premium: { credits: 3000, price: 89.99, currency: 'eur' },
    };

    const selectedPackage = packages[creditPackage];

    if (!selectedPackage) {
      return res.status(400).json({ error: 'Package de crédits invalide' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(selectedPackage.price * 100),
      currency: selectedPackage.currency,
      metadata: {
        app: 'lovingo',
        userId: userId,
        type: 'credits_purchase',
        creditPackage: creditPackage,
        credits: selectedPackage.credits.toString(),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      package: selectedPackage,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('❌ Erreur achat crédits:', error);
    res.status(400).json({ error: error.message });
  }
});

// =================== PAGES WEB ===================

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lovingo - L'app de rencontres nouvelle génération</title>
    <meta name="description" content="Découvrez l'amour avec Lovingo - Video calls, live streaming, et rencontres authentiques. Téléchargez maintenant !">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
        }
        .nav {
            position: fixed;
            top: 0;
            width: 100%;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
            box-shadow: 0 2px 20px rgba(0,0,0,0.1);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #ff6b9d;
        }
        .nav-links {
            display: flex;
            gap: 2rem;
        }
        .nav a {
            color: #333;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s;
        }
        .nav a:hover {
            color: #ff6b9d;
        }
        .cta-btn {
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.3s;
        }
        .cta-btn:hover {
            transform: translateY(-2px);
        }
        .hero {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 8rem 2rem 4rem;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            overflow: hidden;
        }
        .hero::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(45deg, rgba(255,255,255,0.1) 25%, transparent 25%),
                        linear-gradient(-45deg, rgba(255,255,255,0.1) 25%, transparent 25%);
            background-size: 60px 60px;
            animation: slide 20s linear infinite;
        }
        @keyframes slide {
            0% { transform: translateX(0); }
            100% { transform: translateX(60px); }
        }
        .hero-content {
            position: relative;
            z-index: 2;
        }
        .hero h1 {
            font-size: 3.5rem;
            margin-bottom: 1rem;
            font-weight: 700;
            animation: fadeInUp 1s ease;
        }
        .hero p {
            font-size: 1.25rem;
            margin-bottom: 2rem;
            opacity: 0.9;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
            animation: fadeInUp 1s ease 0.2s both;
        }
        .download-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            animation: fadeInUp 1s ease 0.4s both;
        }
        .download-btn {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.3);
            color: white !important;
            padding: 1rem 1.5rem;
            border-radius: 15px;
            text-decoration: none;
            transition: all 0.3s;
            font-weight: 500;
        }
        .download-btn:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
            color: white !important;
        }
        .features {
            padding: 5rem 2rem;
            background: #f8f9fa;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .section-title {
            text-align: center;
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 3rem;
            color: #333;
        }
        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }
        .feature-card {
            background: white;
            padding: 2rem;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            text-align: center;
            transition: transform 0.3s;
        }
        .feature-card:hover {
            transform: translateY(-5px);
        }
        .feature-icon {
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1rem;
            font-size: 1.5rem;
        }
        .stats {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 3rem 2rem;
            text-align: center;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 2rem;
            max-width: 800px;
            margin: 0 auto;
        }
        .stat-number {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }
        .footer {
            background: #1a1a1a;
            color: white;
            padding: 3rem 2rem 1rem;
        }
        .footer-content {
            max-width: 1200px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
        }
        .footer-section h4 {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
        }
        .footer-section a {
            color: #ccc;
            text-decoration: none;
            display: block;
            margin-bottom: 0.5rem;
            transition: color 0.3s;
        }
        .footer-section a:hover {
            color: #ff6b9d;
        }
        .footer-bottom {
            text-align: center;
            padding-top: 2rem;
            margin-top: 2rem;
            border-top: 1px solid #333;
            color: #999;
        }
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        @media (max-width: 768px) {
            .hero h1 { font-size: 2.5rem; }
            .nav-links { display: none; }
            .download-buttons { flex-direction: column; align-items: center; }
        }
    </style>
</head>
<body>
    <nav class="nav">
        <div class="logo">💕 Lovingo</div>
        <div class="nav-links">
            <a href="/features">Fonctionnalités</a>
            <a href="/pricing">Tarifs</a>
            <a href="/safety">Sécurité</a>
            <a href="/support">Support</a>
        </div>
        <a href="${PLAYSTORE_URL}" target="_blank" rel="noopener noreferrer" class="cta-btn">Télécharger</a>
    </nav>

    <section class="hero">
        <div class="hero-content">
            <h1>L'amour à portée de clic</h1>
            <p>Découvrez des connexions authentiques avec Lovingo. Video calls HD, live streaming, et bien plus pour trouver votre âme sœur.</p>
            <div class="download-buttons">
                <a href="${PLAYSTORE_URL}" target="_blank" rel="noopener noreferrer" class="download-btn">
                    <span>🤖</span>
                    <div>
                        <div style="font-size: 0.8rem;">Disponible sur</div>
                        <div style="font-weight: 600;">Google Play</div>
                    </div>
                </a>
                <a href="${PLAYSTORE_URL}" target="_blank" rel="noopener noreferrer" class="download-btn">
                    <span>📱</span>
                    <div>
                        <div style="font-size: 0.8rem;">Télécharger sur</div>
                        <div style="font-weight: 600;">Google Play</div>
                    </div>
                </a>
            </div>
        </div>
    </section>

    <section class="features">
        <div class="container">
            <h2 class="section-title">Pourquoi choisir Lovingo ?</h2>
            <div class="features-grid">
                <div class="feature-card">
                    <div class="feature-icon">📹</div>
                    <h3>Video Calls HD</h3>
                    <p>Rencontrez-vous face à face avec une qualité vidéo crystal clear. Créez des connexions authentiques dès le premier regard.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🔴</div>
                    <h3>Live Streaming</h3>
                    <p>Partagez vos moments en direct avec votre communauté. Recevez des gifts virtuels et construisez votre audience.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🎁</div>
                    <h3>Virtual Gifts</h3>
                    <p>Exprimez vos sentiments avec des cadeaux virtuels uniques. Du simple cœur aux roses premium.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🤖</div>
                    <h3>IA Matchmaking</h3>
                    <p>Notre algorithme intelligent vous propose des profils compatibles basés sur vos préférences et comportements.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🛡️</div>
                    <h3>Sécurité 24/7</h3>
                    <p>Modération automatique et humaine pour garantir un environnement sûr et respectueux pour tous.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🌍</div>
                    <h3>Global Community</h3>
                    <p>Connectez-vous avec des personnes du monde entier. Plus de 50 pays supportés.</p>
                </div>
            </div>
        </div>
    </section>

    <section class="stats">
        <div class="container">
            <h2 class="section-title" style="color: white; margin-bottom: 2rem;">Lovingo en chiffres</h2>
            <div class="stats-grid">
                <div>
                    <div class="stat-number">500K+</div>
                    <div>Utilisateurs actifs</div>
                </div>
                <div>
                    <div class="stat-number">1.2M</div>
                    <div>Matches réalisés</div>
                </div>
                <div>
                    <div class="stat-number">50</div>
                    <div>Pays supportés</div>
                </div>
                <div>
                    <div class="stat-number">98%</div>
                    <div>Satisfaction</div>
                </div>
            </div>
        </div>
    </section>

    <footer class="footer">
        <div class="footer-content">
            <div class="footer-section">
                <h4>Lovingo</h4>
                <a href="/about">À propos</a>
                <a href="/careers">Carrières</a>
                <a href="/press">Presse</a>
                <a href="/blog">Blog</a>
            </div>
            <div class="footer-section">
                <h4>Produit</h4>
                <a href="/features">Fonctionnalités</a>
                <a href="/pricing">Tarifs</a>
                <a href="/safety">Sécurité</a>
                <a href="/api">API</a>
            </div>
            <div class="footer-section">
                <h4>Support</h4>
                <a href="/help">Centre d'aide</a>
                <a href="/contact">Contact</a>
                <a href="/community">Communauté</a>
                <a href="/status">Statut</a>
            </div>
            <div class="footer-section">
                <h4>Légal</h4>
                <a href="/privacy">Confidentialité</a>
                <a href="/terms">Conditions</a>
                <a href="/cookies">Cookies</a>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; 2025 Lovingo. Tous droits réservés. Made with 💕 for love</p>
        </div>
    </footer>
</body>
</html>
  `);
});

app.get('/pricing', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tarifs - Lovingo</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
        }
        .nav {
            position: fixed;
            top: 0;
            width: 100%;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
            box-shadow: 0 2px 20px rgba(0,0,0,0.1);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #ff6b9d;
        }
        .nav a {
            color: #333;
            text-decoration: none;
            margin: 0 1rem;
            font-weight: 500;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 6rem 2rem 2rem;
        }
        .hero {
            text-align: center;
            margin-bottom: 4rem;
        }
        .hero h1 {
            font-size: 3rem;
            font-weight: 700;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .plans-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin-bottom: 4rem;
        }
        .plan-card {
            background: white;
            padding: 2rem;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            text-align: center;
            position: relative;
            transition: transform 0.3s;
        }
        .plan-card:hover {
            transform: translateY(-5px);
        }
        .plan-card.popular {
            border: 3px solid #ff6b9d;
            transform: scale(1.05);
        }
        .popular-badge {
            position: absolute;
            top: -15px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff6b9d;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 15px;
            font-size: 0.9rem;
            font-weight: 600;
        }
        .plan-price {
            font-size: 3rem;
            font-weight: 700;
            color: #ff6b9d;
            margin: 1rem 0;
        }
        .plan-features {
            list-style: none;
            margin: 2rem 0;
        }
        .plan-features li {
            padding: 0.5rem 0;
            display: flex;
            align-items: center;
        }
        .plan-features li::before {
            content: '✓';
            color: #28a745;
            font-weight: bold;
            margin-right: 0.5rem;
        }
        .plan-btn {
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            color: white;
            padding: 1rem 2rem;
            border: none;
            border-radius: 25px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: all 0.3s;
        }
        .plan-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(255, 107, 157, 0.4);
        }
        .plan-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .credits-section {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .credits-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
        }
        .credit-card {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 15px;
            text-align: center;
            transition: transform 0.3s;
        }
        .credit-card:hover {
            transform: translateY(-3px);
        }
        @media (max-width: 768px) {
            .hero h1 { font-size: 2rem; }
            .plans-grid { grid-template-columns: 1fr; }
            .plan-card.popular { transform: none; }
        }
    </style>
</head>
<body>
    <nav class="nav">
        <a href="/" class="logo">💕 Lovingo</a>
        <div>
            <a href="/">Accueil</a>
            <a href="/features">Fonctionnalités</a>
            <a href="/pricing">Tarifs</a>
            <a href="/support">Support</a>
        </div>
    </nav>

    <div class="container">
        <div class="hero">
            <h1>Choisissez votre plan</h1>
            <p>Débloquez toutes les fonctionnalités de Lovingo et trouvez l'amour plus rapidement</p>
        </div>

        <div class="plans-grid">
            <div class="plan-card">
                <h3>Gratuit</h3>
                <div class="plan-price">0€</div>
                <p>Parfait pour commencer</p>
                <ul class="plan-features">
                    <li>5 likes par jour</li>
                    <li>Messages illimités</li>
                    <li>Profil de base</li>
                    <li>Support communautaire</li>
                </ul>
                <button class="plan-btn" onclick="handleSubscription('Gratuit', 0)">
                    Commencer gratuitement
                </button>
            </div>

            <div class="plan-card popular">
                <div class="popular-badge">Le plus populaire</div>
                <h3>Premium</h3>
                <div class="plan-price">9.99€<small>/mois</small></div>
                <p>Le plus populaire</p>
                <ul class="plan-features">
                    <li>Likes illimités</li>
                    <li>Video calls HD</li>
                    <li>Filtres avancés</li>
                    <li>Voir qui vous a liké</li>
                    <li>Support prioritaire</li>
                </ul>
                <button class="plan-btn" onclick="handleSubscription('Premium', 9.99)" id="premium-btn">
                    Devenir Premium
                </button>
            </div>

            <div class="plan-card">
                <h3>VIP</h3>
                <div class="plan-price">19.99€<small>/mois</small></div>
                <p>Expérience ultime</p>
                <ul class="plan-features">
                    <li>Tout Premium inclus</li>
                    <li>Live streaming</li>
                    <li>Gifts virtuels premium</li>
                    <li>Profil en vedette</li>
                    <li>Conseiller personnel</li>
                    <li>Badge VIP</li>
                </ul>
                <button class="plan-btn" onclick="handleSubscription('VIP', 19.99)" id="vip-btn">
                    Devenir VIP
                </button>
            </div>
        </div>

        <div class="credits-section">
            <h2 style="text-align: center; margin-bottom: 2rem;">Packages de crédits</h2>
            <div class="credits-grid">
                <div class="credit-card">
                    <h4>Starter</h4>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #ff6b9d; margin: 1rem 0;">100 crédits</div>
                    <div style="font-size: 1.2rem; font-weight: bold;">4.99€</div>
                    <button class="plan-btn" style="margin-top: 1rem;" onclick="handleCreditPurchase('small', 4.99)">
                        Acheter
                    </button>
                </div>
                <div class="credit-card">
                    <h4>Popular</h4>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #ff6b9d; margin: 1rem 0;">550 crédits</div>
                    <div style="color: green; font-size: 0.9rem;">+50 bonus!</div>
                    <div style="font-size: 1.2rem; font-weight: bold;">19.99€</div>
                    <button class="plan-btn" style="margin-top: 1rem;" onclick="handleCreditPurchase('medium', 19.99)">
                        Acheter
                    </button>
                </div>
                <div class="credit-card">
                    <h4>Power</h4>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #ff6b9d; margin: 1rem 0;">1400 crédits</div>
                    <div style="color: green; font-size: 0.9rem;">+200 bonus!</div>
                    <div style="font-size: 1.2rem; font-weight: bold;">39.99€</div>
                    <button class="plan-btn" style="margin-top: 1rem;" onclick="handleCreditPurchase('large', 39.99)">
                        Acheter
                    </button>
                </div>
                <div class="credit-card">
                    <h4>Ultimate</h4>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #ff6b9d; margin: 1rem 0;">3700 crédits</div>
                    <div style="color: green; font-size: 0.9rem;">+700 bonus!</div>
                    <div style="font-size: 1.2rem; font-weight: bold;">89.99€</div>
                    <button class="plan-btn" style="margin-top: 1rem;" onclick="handleCreditPurchase('premium', 89.99)">
                        Acheter
                    </button>
                </div>
            </div>

            <div style="text-align:center; margin-top: 2rem;">
                <a href="${PLAYSTORE_URL}" target="_blank" rel="noopener noreferrer" class="plan-btn" style="display:inline-block; width:auto; text-decoration:none;">
                    Télécharger l'application sur Google Play
                </a>
            </div>
        </div>
    </div>

    <script>
        async function handleSubscription(planName, price) {
            if (price === 0) {
                window.open('${PLAYSTORE_URL}', '_blank');
                return;
            }

            const button = document.getElementById(planName.toLowerCase() + '-btn');
            if (button) {
                button.disabled = true;
                button.textContent = 'Traitement...';
            }

            try {
                const response = await fetch('/api/create-payment-intent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        amount: price,
                        currency: 'eur',
                        userId: 'website_user',
                        metadata: {
                            plan: planName,
                            type: 'subscription'
                        }
                    }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error('Erreur HTTP ' + response.status + ': ' + errorText);
                }

                const data = await response.json();
                alert('✅ PaymentIntent créé avec succès !\\nClient Secret: ' + data.clientSecret.substring(0, 20) + '...');
            } catch (error) {
                alert('❌ Erreur: ' + error.message);
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Devenir ' + planName;
                }
            }
        }

        async function handleCreditPurchase(packageType, price) {
            try {
                const response = await fetch('/api/purchase-credits', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: 'website_user',
                        creditPackage: packageType
                    }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error('Erreur HTTP ' + response.status + ': ' + errorText);
                }

                const data = await response.json();
                alert('✅ Package créé avec succès !\\nClient Secret: ' + data.clientSecret.substring(0, 20) + '...');
            } catch (error) {
                alert('❌ Erreur: ' + error.message);
            }
        }
    </script>
</body>
</html>
  `);
});

app.get('/features', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fonctionnalités - Lovingo</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
        }
        .nav {
            position: fixed;
            top: 0;
            width: 100%;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
            box-shadow: 0 2px 20px rgba(0,0,0,0.1);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #ff6b9d;
        }
        .nav a {
            color: #333;
            text-decoration: none;
            margin: 0 1rem;
            font-weight: 500;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 6rem 2rem 2rem;
        }
        .hero {
            text-align: center;
            margin-bottom: 4rem;
        }
        .hero h1 {
            font-size: 3rem;
            font-weight: 700;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .features-detailed {
            display: grid;
            gap: 4rem;
        }
        .feature {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3rem;
            align-items: center;
        }
        .feature:nth-child(even) {
            direction: rtl;
        }
        .feature:nth-child(even) .feature-content {
            direction: ltr;
        }
        .feature-content h3 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 1rem;
            color: #333;
        }
        .feature-content p {
            font-size: 1.1rem;
            color: #666;
            margin-bottom: 1.5rem;
        }
        .feature-list {
            list-style: none;
        }
        .feature-list li {
            padding: 0.5rem 0;
            display: flex;
            align-items: center;
        }
        .feature-list li::before {
            content: '✓';
            color: #28a745;
            font-weight: bold;
            margin-right: 0.5rem;
        }
        .feature-image {
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            border-radius: 20px;
            height: 300px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 4rem;
            color: white;
        }
        @media (max-width: 768px) {
            .feature {
                grid-template-columns: 1fr;
                text-align: center;
            }
            .feature:nth-child(even) {
                direction: ltr;
            }
        }
    </style>
</head>
<body>
    <nav class="nav">
        <a href="/" class="logo">💕 Lovingo</a>
        <div>
            <a href="/">Accueil</a>
            <a href="/features">Fonctionnalités</a>
            <a href="/pricing">Tarifs</a>
            <a href="/support">Support</a>
        </div>
    </nav>

    <div class="container">
        <div class="hero">
            <h1>Fonctionnalités innovantes</h1>
            <p>Découvrez tout ce qui rend Lovingo unique pour vos rencontres</p>
        </div>

        <div class="features-detailed">
            <div class="feature">
                <div class="feature-content">
                    <h3>Video Calls HD</h3>
                    <p>Rencontrez-vous face à face avec une qualité vidéo exceptionnelle. Notre technologie WebRTC garantit des appels fluides et crystal clear.</p>
                    <ul class="feature-list">
                        <li>Qualité HD 1080p</li>
                        <li>Audio stéréo haute définition</li>
                        <li>Connexion stable et sécurisée</li>
                        <li>Compatible tous appareils</li>
                    </ul>
                </div>
                <div class="feature-image">📹</div>
            </div>

            <div class="feature">
                <div class="feature-content">
                    <h3>Live Streaming</h3>
                    <p>Partagez vos moments en direct avec votre communauté. Construisez votre audience et recevez des gifts de vos admirateurs.</p>
                    <ul class="feature-list">
                        <li>Streaming en temps réel</li>
                        <li>Chat interactif en direct</li>
                        <li>Système de gifts virtuels</li>
                        <li>Analytics détaillées</li>
                    </ul>
                </div>
                <div class="feature-image">🔴</div>
            </div>

            <div class="feature">
                <div class="feature-content">
                    <h3>IA Matchmaking</h3>
                    <p>Notre intelligence artificielle avancée analyse vos préférences et comportements pour vous proposer des profils ultra-compatibles.</p>
                    <ul class="feature-list">
                        <li>Algorithme d'apprentissage adaptatif</li>
                        <li>Analyse des compatibilités</li>
                        <li>Suggestions personnalisées</li>
                        <li>Amélioration continue</li>
                    </ul>
                </div>
                <div class="feature-image">🤖</div>
            </div>

            <div class="feature">
                <div class="feature-content">
                    <h3>Sécurité 24/7</h3>
                    <p>Votre sécurité est notre priorité. Modération automatique et humaine pour garantir un environnement sain et respectueux.</p>
                    <ul class="feature-list">
                        <li>Vérification des profils</li>
                        <li>Détection automatique de spam</li>
                        <li>Modération humaine 24/7</li>
                        <li>Signalement facile</li>
                    </ul>
                </div>
                <div class="feature-image">🛡️</div>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

app.get('/support', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Support - Lovingo</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
        }
        .nav {
            position: fixed;
            top: 0;
            width: 100%;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
            box-shadow: 0 2px 20px rgba(0,0,0,0.1);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #ff6b9d;
        }
        .nav a {
            color: #333;
            text-decoration: none;
            margin: 0 1rem;
            font-weight: 500;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 6rem 2rem 2rem;
        }
        .hero {
            text-align: center;
            margin-bottom: 4rem;
        }
        .hero h1 {
            font-size: 3rem;
            font-weight: 700;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .contact-form {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-bottom: 3rem;
        }
        .form-group {
            margin-bottom: 1.5rem;
        }
        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #333;
        }
        .form-group input,
        .form-group textarea,
        .form-group select {
            width: 100%;
            padding: 1rem;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 1rem;
            transition: border-color 0.3s;
        }
        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
            outline: none;
            border-color: #ff6b9d;
        }
        .submit-btn {
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            color: white;
            padding: 1rem 2rem;
            border: none;
            border-radius: 25px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: transform 0.3s;
        }
        .submit-btn:hover {
            transform: translateY(-2px);
        }
        .faq-section {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .faq-item {
            border-bottom: 1px solid #e1e5e9;
            padding: 1.5rem 0;
        }
        .faq-item:last-child {
            border-bottom: none;
        }
        .faq-question {
            font-weight: 600;
            font-size: 1.1rem;
            margin-bottom: 0.5rem;
            color: #333;
        }
        .faq-answer {
            color: #666;
        }
    </style>
</head>
<body>
    <nav class="nav">
        <a href="/" class="logo">💕 Lovingo</a>
        <div>
            <a href="/">Accueil</a>
            <a href="/features">Fonctionnalités</a>
            <a href="/pricing">Tarifs</a>
            <a href="/support">Support</a>
        </div>
    </nav>

    <div class="container">
        <div class="hero">
            <h1>Nous sommes là pour vous aider</h1>
            <p>Contactez notre équipe ou consultez notre FAQ</p>
        </div>

        <div class="contact-form">
            <h2 style="margin-bottom: 2rem;">Contactez-nous</h2>
            <form onsubmit="handleSubmit(event)">
                <div class="form-group">
                    <label for="name">Nom complet</label>
                    <input type="text" id="name" name="name" required>
                </div>

                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" name="email" required>
                </div>

                <div class="form-group">
                    <label for="subject">Sujet</label>
                    <select id="subject" name="subject" required>
                        <option value="">Sélectionnez un sujet</option>
                        <option value="technical">Problème technique</option>
                        <option value="billing">Facturation</option>
                        <option value="account">Compte utilisateur</option>
                        <option value="feature">Demande de fonctionnalité</option>
                        <option value="other">Autre</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="message">Message</label>
                    <textarea id="message" name="message" rows="5" required placeholder="Décrivez votre problème ou question..."></textarea>
                </div>

                <button type="submit" class="submit-btn">
                    Envoyer le message
                </button>
            </form>
        </div>

        <div class="faq-section">
            <h2 style="margin-bottom: 2rem; text-align: center;">Questions fréquentes</h2>

            <div class="faq-item">
                <div class="faq-question">Comment puis-je supprimer mon compte ?</div>
                <div class="faq-answer">Vous pouvez supprimer votre compte depuis les paramètres de l'application. Cette action est irréversible et supprimera toutes vos données.</div>
            </div>

            <div class="faq-item">
                <div class="faq-question">Puis-je annuler mon abonnement à tout moment ?</div>
                <div class="faq-answer">Oui, vous pouvez annuler votre abonnement à tout moment. L'annulation prendra effet à la fin de votre période de facturation actuelle.</div>
            </div>

            <div class="faq-item">
                <div class="faq-question">Comment signaler un utilisateur inapproprié ?</div>
                <div class="faq-answer">Utilisez le bouton "Signaler" sur le profil de l'utilisateur. Notre équipe de modération examinera votre signalement dans les plus brefs délais.</div>
            </div>

            <div class="faq-item">
                <div class="faq-question">Mes données sont-elles sécurisées ?</div>
                <div class="faq-answer">Absolument. Nous utilisons un chiffrement de niveau bancaire et respectons toutes les réglementations de protection des données (RGPD).</div>
            </div>

            <div class="faq-item">
                <div class="faq-question">Comment fonctionne l'algorithme de matching ?</div>
                <div class="faq-answer">Notre IA analyse vos préférences, votre activité et vos interactions pour vous proposer des profils compatibles. Plus vous utilisez l'app, plus les suggestions s'améliorent.</div>
            </div>
        </div>
    </div>

    <script>
        function handleSubmit(event) {
            event.preventDefault();
            alert('Merci pour votre message ! Nous vous répondrons dans les plus brefs délais.');
            event.target.reset();
        }
    </script>
</body>
</html>
  `);
});

// =================== ENDPOINTS LIVE ROOM API ===================

app.get('/live/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    liveRooms: liveRooms.size,
    liveJoinRequests: liveJoinRequests.size,
    livekitConfigured: Boolean(
      LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
    ),
    timestamp: new Date().toISOString(),
  });
});

app.post('/live/rooms', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req) || req.body.hostId || 'host_demo';
    const { title = 'Live Lovingo', maxGuests = 20 } = req.body || {};

    const roomId = crypto.randomUUID();

    const room = {
      roomId,
      hostId: userId,
      title,
      maxGuests: Number(maxGuests) > 0 ? Number(maxGuests) : 20,
      guests: new Set(),
      viewers: new Set(),
      requests: new Set(),
      startTime: new Date(),
      stats: {
        totalViewers: 0,
        peakViewers: 0,
        totalGifts: 0,
        totalHearts: 0,
      },
      isActive: true,
    };

    liveRooms.set(roomId, room);
    liveJoinRequests.set(roomId, []);

    console.log(`🔴 Live room créée: ${roomId} par ${userId}`);

    res.status(201).json({
      roomId,
      hostId: userId,
      title,
      maxGuests: room.maxGuests,
      isActive: true,
      createdAt: room.startTime.toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur create live room:', error);
    res.status(500).json({
      error: 'Impossible de créer la room live',
      details: error.message,
    });
  }
});

app.get('/live/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    res.json({
      roomId: room.roomId,
      hostId: room.hostId,
      title: room.title,
      maxGuests: room.maxGuests,
      isActive: room.isActive,
      createdAt: room.startTime?.toISOString?.() || new Date().toISOString(),
      viewerCount: room.viewers.size,
      guestCount: room.guests.size,
      stats: room.stats,
    });
  } catch (error) {
    console.error('❌ Erreur get room:', error);
    res.status(500).json({
      error: 'Impossible de récupérer la room',
      details: error.message,
    });
  }
});

app.post('/live/rooms/:roomId/token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { role = 'audience', userName } = req.body || {};
    const userId =
      getUserIdFromRequest(req) || req.body.userId || `${role}_${Date.now()}`;

    const room = liveRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const safeRole = ['host', 'guest', 'audience'].includes(role)
      ? role
      : 'audience';

    const identity = String(userId);
    const displayName = userName || identity;

    const tokenData = await createLiveKitToken({
      roomId,
      identity,
      name: displayName,
      role: safeRole,
    });

    res.json({
      roomId,
      role: safeRole,
      userId: identity,
      userName: displayName,
      token: tokenData.token,
      url: tokenData.url,
      livekitUrl: tokenData.url,
    });
  } catch (error) {
    console.error('❌ Erreur get room token:', error);
    res.status(500).json({
      error: 'Impossible de générer le token LiveKit',
      details: error.message,
    });
  }
});

app.post('/live/rooms/:roomId/requests', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { message = '' } = req.body || {};
    const userId =
      getUserIdFromRequest(req) || req.body.userId || `guest_${Date.now()}`;

    const room = liveRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    const existing = requests.find(
      (r) => r.userId === userId && r.status === 'pending'
    );

    if (existing) {
      return res.status(200).json({
        success: true,
        alreadyPending: true,
        requestId: existing.requestId,
      });
    }

    const requestId = crypto.randomUUID();
    const joinRequest = {
      requestId,
      userId,
      message,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    requests.push(joinRequest);
    liveJoinRequests.set(roomId, requests);

    room.requests.add(userId);

    broadcastToRoom(roomId, {
      type: 'liveJoinRequest',
      from: 'server',
      to: roomId,
      data: joinRequest,
    });

    console.log(`🙋 Join request: ${userId} -> ${roomId}`);

    res.status(201).json({
      success: true,
      requestId,
      roomId,
      userId,
      status: 'pending',
    });
  } catch (error) {
    console.error('❌ Erreur requestToJoin:', error);
    res.status(500).json({
      error: 'Impossible d’envoyer la demande',
      details: error.message,
    });
  }
});

app.get('/live/rooms/:roomId/requests', async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!liveRooms.has(roomId)) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    res.json({
      roomId,
      requests,
    });
  } catch (error) {
    console.error('❌ Erreur list requests:', error);
    res.status(500).json({
      error: 'Impossible de récupérer les demandes',
      details: error.message,
    });
  }
});

app.post('/live/rooms/:roomId/requests/:requestId/accept', async (req, res) => {
  try {
    const { roomId, requestId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    const request = requests.find((r) => r.requestId === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    request.status = 'accepted';
    room.guests.add(request.userId);
    room.requests.delete(request.userId);

    broadcastToRoom(roomId, {
      type: 'liveJoinRequestAccepted',
      from: 'server',
      to: roomId,
      data: {
        requestId,
        userId: request.userId,
      },
    });

    console.log(`✅ Demande acceptée: ${request.userId} dans ${roomId}`);

    res.json({
      success: true,
      roomId,
      requestId,
      userId: request.userId,
      status: 'accepted',
    });
  } catch (error) {
    console.error('❌ Erreur accept request:', error);
    res.status(500).json({
      error: 'Impossible d’accepter la demande',
      details: error.message,
    });
  }
});

app.post('/live/rooms/:roomId/requests/:requestId/reject', async (req, res) => {
  try {
    const { roomId, requestId } = req.params;
    const room = liveRooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    const requests = liveJoinRequests.get(roomId) || [];
    const request = requests.find((r) => r.requestId === requestId);

    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    request.status = 'rejected';
    room.requests.delete(request.userId);

    broadcastToRoom(roomId, {
      type: 'liveJoinRequestRejected',
      from: 'server',
      to: roomId,
      data: {
        requestId,
        userId: request.userId,
      },
    });

    console.log(`❌ Demande rejetée: ${request.userId} dans ${roomId}`);

    res.json({
      success: true,
      roomId,
      requestId,
      userId: request.userId,
      status: 'rejected',
    });
  } catch (error) {
    console.error('❌ Erreur reject request:', error);
    res.status(500).json({
      error: 'Impossible de rejeter la demande',
      details: error.message,
    });
  }
});

app.post('/live/rooms/:roomId/moderation/mute', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, muted } = req.body || {};

    if (!liveRooms.has(roomId)) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    broadcastToRoom(roomId, {
      type: 'liveModerationMute',
      from: 'server',
      to: roomId,
      data: {
        userId,
        muted: Boolean(muted),
      },
    });

    res.json({
      success: true,
      roomId,
      userId,
      muted: Boolean(muted),
    });
  } catch (error) {
    console.error('❌ Erreur mute user:', error);
    res.status(500).json({
      error: 'Impossible de mute user',
      details: error.message,
    });
  }
});

app.post('/live/rooms/:roomId/moderation/kick', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body || {};

    if (!liveRooms.has(roomId)) {
      return res.status(404).json({ error: 'Room introuvable' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }

    const room = liveRooms.get(roomId);
    room.guests.delete(userId);
    room.viewers.delete(userId);
    room.requests.delete(userId);

    broadcastToRoom(roomId, {
      type: 'liveModerationKick',
      from: 'server',
      to: roomId,
      data: { userId },
    });

    res.json({
      success: true,
      roomId,
      userId,
      kicked: true,
    });
  } catch (error) {
    console.error('❌ Erreur kick user:', error);
    res.status(500).json({
      error: 'Impossible de kick user',
      details: error.message,
    });
  }
});

// =================== ENDPOINTS API EXISTANTS ===================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    clients: clients.size,
    rooms: rooms.size,
    website: 'integrated',
  });
});

app.get('/keepalive', (req, res) => res.status(204).end());
app.get('/ping', (req, res) => res.json({ pong: Date.now() }));

app.get('/stats', (req, res) => {
  const roomStats = Array.from(rooms.entries()).map(([id, roomClients]) => ({
    roomId: id,
    participants: roomClients.size,
  }));

  res.json({
    server: {
      uptime: Math.floor(process.uptime()),
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      environment: process.env.NODE_ENV || 'development',
      website: 'integrated',
    },
    connections: {
      totalClients: clients.size,
      totalRooms: rooms.size,
      totalLiveRooms: liveRooms.size,
      rooms: roomStats,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

app.get('/test', (req, res) => {
  res.json({
    message: 'Serveur Lovingo actif!',
    website: 'integrated',
    timestamp: new Date().toISOString(),
  });
});

// =================== WEBSOCKET ===================

wss.on('connection', (ws, req) => {
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const clientIP =
    req.connection.remoteAddress ||
    req.headers['x-forwarded-for'] ||
    'Unknown';

  console.log(
    `📱 Nouvelle connexion: ${clientIP} (${userAgent.substring(0, 50)})`
  );

  const clientInfo = {
    id: generateClientId(),
    userId: null,
    roomId: null,
    connectedAt: new Date(),
    isHost: false,
    lastHeartbeat: new Date(),
    userAgent,
    ip: clientIP,
  };

  clients.set(ws, clientInfo);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    const client = clients.get(ws);
    if (client) {
      client.lastHeartbeat = new Date();
    }
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      await handleMessage(ws, message);
    } catch (error) {
      console.error('❌ Erreur parsing message:', error);
      sendError(ws, 'Message invalide');
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`📱 Connexion fermée: ${code} - ${reason}`);
    handleDisconnection(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error);
    handleDisconnection(ws);
  });

  sendMessage(ws, {
    type: 'connected',
    from: 'server',
    to: clientInfo.id,
    data: {
      clientId: clientInfo.id,
      serverTime: new Date().toISOString(),
      version: '2.1.0',
    },
  });
});

// =================== MESSAGE HANDLERS ===================

async function handleMessage(ws, message) {
  const client = clients.get(ws);
  if (!client) return;

  console.log(
    `📨 Message reçu: ${message.type} de ${message.from || 'anonymous'}`
  );

  if (message.from && message.from !== 'server') {
    client.userId = message.from;
  }

  try {
    switch (message.type) {
      case 'joinRoom':
        await handleJoinRoom(ws, message);
        break;
      case 'leaveRoom':
        await handleLeaveRoom(ws, message);
        break;
      case 'offer':
      case 'answer':
      case 'iceCandidate':
        await handleWebRTCSignaling(ws, message);
        break;
      case 'liveControl':
        await handleLiveControl(ws, message);
        break;
      case 'liveChat':
        await handleLiveChat(ws, message);
        break;
      case 'virtualGift':
        await handleVirtualGift(ws, message);
        break;
      case 'heartbeat':
        handleHeartbeat(ws, message);
        break;
      case 'initiateCall':
        await handleInitiateCall(ws, message);
        break;
      case 'ping':
        sendMessage(ws, {
          type: 'pong',
          from: 'server',
          to: client.userId,
          data: { timestamp: new Date().toISOString() },
        });
        break;
      default:
        console.warn(`⚠️ Type de message non géré: ${message.type}`);
        sendError(ws, `Type de message non supporté: ${message.type}`);
    }
  } catch (error) {
    console.error(`❌ Erreur handling message ${message.type}:`, error);
    sendError(ws, 'Erreur serveur lors du traitement du message');
  }
}

async function handleJoinRoom(ws, message) {
  const client = clients.get(ws);
  const { roomId, callType, metadata } = message.data || {};

  if (!roomId) {
    sendError(ws, 'Room ID requis');
    return;
  }

  if (client.roomId) {
    await handleLeaveRoom(ws, { to: client.roomId });
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    console.log(`🏠 Nouvelle room créée: ${roomId}`);
  }

  const room = rooms.get(roomId);

  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    sendError(ws, `Room pleine (max ${MAX_CLIENTS_PER_ROOM} participants)`);
    return;
  }

  room.add(ws);
  client.roomId = roomId;
  client.isHost = metadata?.isHost || false;

  broadcastToRoom(
    roomId,
    {
      type: 'userJoined',
      from: 'server',
      to: roomId,
      data: {
        userId: client.userId,
        isHost: client.isHost,
        callType,
        participantCount: room.size,
        joinedAt: new Date().toISOString(),
      },
    },
    ws
  );

  sendMessage(ws, {
    type: 'roomJoined',
    from: 'server',
    to: client.userId,
    data: {
      roomId,
      participantCount: room.size,
      isHost: client.isHost,
      callType,
    },
  });

  if (callType === 'live') {
    await handleLiveRoomJoin(ws, roomId, metadata);
  }

  console.log(
    `✅ ${client.userId || client.id} a rejoint la room ${roomId} (${room.size} participants)`
  );
}

async function handleLeaveRoom(ws, message) {
  const client = clients.get(ws);
  const roomId = message?.to || client?.roomId;

  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  room.delete(ws);

  broadcastToRoom(roomId, {
    type: 'userLeft',
    from: 'server',
    to: roomId,
    data: {
      userId: client.userId,
      participantCount: room.size,
      leftAt: new Date().toISOString(),
    },
  });

  if (room.size === 0) {
    rooms.delete(roomId);
    liveRooms.delete(roomId);
    liveJoinRequests.delete(roomId);
    console.log(`🗑️ Room ${roomId} supprimée (vide)`);
  }

  client.roomId = null;
  client.isHost = false;

  console.log(`👋 ${client.userId || client.id} a quitté la room ${roomId}`);
}

async function handleWebRTCSignaling(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room pour le signaling');
    return;
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      timestamp: new Date().toISOString(),
      fromUserId: client.userId,
    },
  };

  broadcastToRoom(roomId, enrichedMessage, ws);
  console.log(
    `🔄 Signal ${message.type} relayé dans ${roomId} par ${client.userId}`
  );
}

async function handleLiveRoomJoin(ws, roomId, metadata) {
  const liveRoom = ensureLiveRoom(roomId);

  if (metadata?.isHost) {
    liveRoom.hostId = clients.get(ws).userId;
    liveRoom.title = metadata?.title || liveRoom.title;
  } else if (metadata?.isGuest) {
    liveRoom.guests.add(clients.get(ws).userId);
  } else {
    liveRoom.viewers.add(clients.get(ws).userId);
    liveRoom.stats.totalViewers++;
    liveRoom.stats.peakViewers = Math.max(
      liveRoom.stats.peakViewers,
      liveRoom.viewers.size
    );
  }

  broadcastToRoom(roomId, {
    type: 'liveStats',
    from: 'server',
    to: roomId,
    data: {
      viewerCount: liveRoom.viewers.size,
      guestCount: liveRoom.guests.size,
      stats: liveRoom.stats,
      hostId: liveRoom.hostId,
    },
  });
}

async function handleLiveControl(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId || !liveRooms.has(roomId)) {
    sendError(ws, 'Live room introuvable');
    return;
  }

  const liveRoom = liveRooms.get(roomId);
  const { controlType, data } = message.data;

  switch (controlType) {
    case 'inviteGuest':
      if (client.userId === liveRoom.hostId) {
        broadcastToRoom(roomId, message);
      } else {
        sendError(ws, "Seul l'hôte peut inviter des invités");
      }
      break;
    case 'acceptInvite':
      liveRoom.guests.add(data.guestId);
      broadcastToRoom(roomId, message);
      break;
    case 'removeGuest':
      if (client.userId === liveRoom.hostId) {
        liveRoom.guests.delete(data.guestId);
        broadcastToRoom(roomId, message);
      } else {
        sendError(ws, "Seul l'hôte peut retirer des invités");
      }
      break;
    default:
      broadcastToRoom(roomId, message, ws);
  }
}

async function handleLiveChat(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
      id: generateClientId(),
    },
  };

  broadcastToRoom(roomId, enrichedMessage);
  console.log(
    `💬 Message chat de ${client.userId} dans ${roomId}: ${message.data.text?.substring(0, 50)}...`
  );
}

async function handleVirtualGift(ws, message) {
  const client = clients.get(ws);
  const roomId = client.roomId;

  if (!roomId) {
    sendError(ws, 'Pas dans une room');
    return;
  }

  if (liveRooms.has(roomId)) {
    const liveRoom = liveRooms.get(roomId);
    liveRoom.stats.totalGifts += message.data.quantity || 1;
    if (message.data.giftId === 'heart') {
      liveRoom.stats.totalHearts += message.data.quantity || 1;
    }
  }

  const enrichedMessage = {
    ...message,
    data: {
      ...message.data,
      senderId: client.userId,
      timestamp: new Date().toISOString(),
      id: generateClientId(),
    },
  };

  broadcastToRoom(roomId, enrichedMessage);
  console.log(`🎁 Cadeau ${message.data.giftId} de ${client.userId} dans ${roomId}`);
}

async function handleInitiateCall(ws, message) {
  const client = clients.get(ws);
  const { targetUserId, callerName, callType, roomId } = message.data;

  console.log(`📞 Tentative d'appel de ${client.userId} vers ${targetUserId}`);

  const targetClient = findClientByUserId(targetUserId);

  if (targetClient) {
    sendMessage(targetClient.ws, {
      type: 'incomingCall',
      from: 'server',
      to: targetUserId,
      data: {
        callerId: client.userId,
        callerName: callerName || client.userId,
        roomId,
        callType,
        timestamp: new Date().toISOString(),
      },
    });

    sendMessage(ws, {
      type: 'callInitiated',
      from: 'server',
      to: client.userId,
      data: {
        targetUserId,
        roomId,
        status: 'ringing',
      },
    });

    console.log(`✅ Notification d'appel envoyée à ${targetUserId} de ${client.userId}`);
  } else {
    sendError(ws, `Utilisateur ${targetUserId} hors ligne`);
    console.log(`❌ Utilisateur ${targetUserId} introuvable pour appel`);
  }
}

function handleHeartbeat(ws, message) {
  const client = clients.get(ws);
  if (client) {
    client.lastHeartbeat = new Date();
  }

  sendMessage(ws, {
    type: 'heartbeatAck',
    from: 'server',
    to: client?.userId || 'client',
    data: {
      timestamp: new Date().toISOString(),
      serverUptime: Math.floor(process.uptime()),
    },
  });
}

function handleDisconnection(ws) {
  const client = clients.get(ws);
  if (!client) return;

  console.log(`📱 Déconnexion: ${client.userId || client.id}`);

  if (client.roomId) {
    handleLeaveRoom(ws, { to: client.roomId });
  }

  clients.delete(ws);
}

// =================== KEEP-ALIVE SYSTEM ===================

if (process.env.NODE_ENV === 'production') {
  console.log(`🏥 Activation du keep-alive avancé pour: ${RENDER_URL}`);

  setInterval(async () => {
    try {
      const fetch = require('node-fetch');
      const endpoints = ['/health', '/ping', '/keepalive', '/', '/test', '/live/health'];

      for (const endpoint of endpoints) {
        const url = `${RENDER_URL}${endpoint}`;
        try {
          const response = await fetch(url, { timeout: 5000 });
          console.log(`🏥 Keep-alive ${endpoint}: ${response.status}`);
        } catch (e) {
          console.error(`❌ Keep-alive ${endpoint} failed:`, e.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('❌ Keep-alive system error:', error);
    }
  }, 4 * 60 * 1000);

  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
    console.log(`♻️ Ping WebSocket envoyé à ${wss.clients.size} clients`);
  }, 30000);
}

// =================== CLEANUP & MONITORING ===================

setInterval(() => {
  const now = new Date();
  let cleanedClients = 0;

  clients.forEach((client, ws) => {
    const timeSinceHeartbeat = now - client.lastHeartbeat;
    if (timeSinceHeartbeat > 120000) {
      console.log(`🧹 Nettoyage client inactif: ${client.userId || client.id}`);
      ws.terminate();
      handleDisconnection(ws);
      cleanedClients++;
    }
  });

  if (cleanedClients > 0) {
    console.log(`🧹 ${cleanedClients} clients inactifs nettoyés`);
  }
}, 60000);

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('💀 Connexion WebSocket morte détectée, terminaison...');
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

setInterval(() => {
  const stats = {
    clients: clients.size,
    rooms: rooms.size,
    lives: liveRooms.size,
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };

  console.log(
    `📊 Stats: ${stats.clients} clients, ${stats.rooms} rooms, ${stats.lives} lives, ${stats.memory}MB RAM, ${stats.uptime}s uptime`
  );
}, 5 * 60 * 1000);

// =================== SERVER STARTUP ===================

server.listen(PORT, () => {
  console.log('🚀 ===============================================');
  console.log('🚀 Serveur Lovingo Complet v2.2.0');
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 WebSocket: ws://localhost:${PORT}`);
  console.log(`🚀 Website: http://localhost:${PORT}`);
  console.log(`🚀 API: http://localhost:${PORT}/api/*`);
  console.log(`🚀 Live API: http://localhost:${PORT}/live/*`);
  console.log(`🚀 Health: ${RENDER_URL}/health`);
  console.log(`🚀 Live Health: ${RENDER_URL}/live/health`);
  console.log(`🚀 Stats: ${RENDER_URL}/stats`);
  console.log(`🚀 Play Store: ${PLAYSTORE_URL}`);
  console.log(
    `🚀 LiveKit configuré: ${
      LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? 'OUI' : 'NON'
    }`
  );
  if (LIVEKIT_URL) {
    console.log(`🚀 LiveKit URL: ${LIVEKIT_URL}`);
  }
  console.log('🚀 ===============================================');
});

// =================== ERROR HANDLING ===================

process.on('uncaughtException', (error) => {
  console.error('❌ Erreur non gérée:', error);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promesse rejetée non gérée:', reason);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  console.log('🛑 Signal SIGINT reçu, arrêt du serveur...');
  gracefulShutdown();
});

process.on('SIGTERM', () => {
  console.log('🛑 Signal SIGTERM reçu, arrêt du serveur...');
  gracefulShutdown();
});

function gracefulShutdown() {
  console.log('🛑 Démarrage arrêt gracieux...');

  wss.clients.forEach((ws) => {
    sendMessage(ws, {
      type: 'serverShutdown',
      from: 'server',
      data: { message: 'Serveur en cours de redémarrage' },
    });
    ws.close();
  });

  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('❌ Force quit après timeout');
    process.exit(1);
  }, 10000);
}

module.exports = { app, server, wss };