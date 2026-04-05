function renderHomePage({ PLAYSTORE_URL }) {
  return `
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
  `;
}

module.exports = {
  renderHomePage,
};