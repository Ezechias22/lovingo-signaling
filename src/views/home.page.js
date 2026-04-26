function renderHomePage({ PLAYSTORE_URL }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lovingo - L'app de rencontres nouvelle génération</title>
    <meta name="description" content="Découvrez l'amour avec Lovingo - Video calls, live streaming, cadeaux virtuels, coins et rencontres authentiques. Téléchargez maintenant !">

    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            overflow-x: hidden;
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
            display: flex;
            align-items: center;
            gap: 0.65rem;
            font-size: 1.5rem;
            font-weight: bold;
            color: #ff6b9d;
            text-decoration: none;
        }

        .logo img {
            width: 42px;
            height: 42px;
            border-radius: 12px;
            object-fit: cover;
            box-shadow: 0 6px 18px rgba(255,107,157,0.22);
        }

        .nav-links {
            display: flex;
            gap: 1.35rem;
            align-items: center;
        }

        .nav a {
            color: #333;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s;
            white-space: nowrap;
        }

        .nav a:hover {
            color: #ff6b9d;
        }

        .cta-btn {
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            color: white !important;
            padding: 0.75rem 1.5rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.3s, box-shadow 0.3s;
        }

        .cta-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 26px rgba(196,69,105,0.28);
        }

        .coins-nav-btn {
            background: linear-gradient(135deg, #ffd700, #ff9f1c);
            color: #2d1b00 !important;
            padding: 0.65rem 1.15rem;
            border-radius: 999px;
            font-weight: 800 !important;
            animation: navCoinPulse 1.9s ease-in-out infinite;
        }

        @keyframes navCoinPulse {
            0%, 100% { box-shadow: 0 0 0 rgba(255,215,0,0.25); transform: translateY(0); }
            50% { box-shadow: 0 0 22px rgba(255,215,0,0.65); transform: translateY(-1px); }
        }

        .mobile-menu-btn {
            display: none;
            width: 44px;
            height: 44px;
            border: none;
            border-radius: 14px;
            background: linear-gradient(135deg, #ff6b9d, #c44569);
            color: white;
            cursor: pointer;
            font-size: 1.45rem;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 22px rgba(196,69,105,0.25);
        }

        .mobile-menu {
            position: fixed;
            top: 0;
            right: -100%;
            width: min(86vw, 360px);
            height: 100vh;
            background: linear-gradient(160deg, #2d1b69, #6a4c93);
            z-index: 2000;
            padding: 1.2rem;
            transition: right 0.28s ease;
            box-shadow: -20px 0 50px rgba(0,0,0,0.25);
        }

        .mobile-menu.open {
            right: 0;
        }

        .mobile-menu-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.4rem;
            color: white;
        }

        .mobile-menu-header strong {
            font-size: 1.25rem;
        }

        .mobile-close {
            width: 40px;
            height: 40px;
            border: none;
            border-radius: 12px;
            background: rgba(255,255,255,0.16);
            color: white;
            font-size: 1.3rem;
            cursor: pointer;
        }

        .mobile-menu a,
        .mobile-menu button.mobile-admin-link {
            display: flex;
            align-items: center;
            gap: 0.7rem;
            width: 100%;
            padding: 1rem;
            margin-bottom: 0.7rem;
            border-radius: 16px;
            color: white;
            text-decoration: none;
            background: rgba(255,255,255,0.12);
            border: 1px solid rgba(255,255,255,0.16);
            font-weight: 700;
            cursor: pointer;
            font-size: 1rem;
            text-align: left;
        }

        .mobile-menu a:hover,
        .mobile-menu button.mobile-admin-link:hover {
            background: rgba(255,255,255,0.2);
        }

        .mobile-coins {
            background: linear-gradient(135deg, #ffd700, #ff9f1c) !important;
            color: #2d1b00 !important;
            box-shadow: 0 14px 34px rgba(255,159,28,0.3);
        }

        .mobile-download {
            background: linear-gradient(135deg, #ff6b9d, #c44569) !important;
        }

        .mobile-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 1500;
        }

        .mobile-overlay.open {
            display: block;
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

        .hero::after {
            content: '';
            position: absolute;
            width: 520px;
            height: 520px;
            border-radius: 999px;
            background: radial-gradient(circle, rgba(255,215,0,0.28), transparent 62%);
            right: -180px;
            bottom: -180px;
            filter: blur(3px);
            animation: floatGlow 5s ease-in-out infinite alternate;
        }

        @keyframes slide {
            0% { transform: translateX(0); }
            100% { transform: translateX(60px); }
        }

        @keyframes floatGlow {
            from { transform: translateY(0) scale(1); opacity: 0.75; }
            to { transform: translateY(-28px) scale(1.08); opacity: 1; }
        }

        .hero-content {
            position: relative;
            z-index: 2;
        }

        .hero-logo {
            width: 96px;
            height: 96px;
            border-radius: 24px;
            object-fit: cover;
            margin: 0 auto 1.2rem;
            display: block;
            box-shadow: 0 20px 50px rgba(0,0,0,0.24);
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.25);
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
            max-width: 680px;
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

        .coins-hero-btn {
            position: relative;
            display: flex;
            align-items: center;
            gap: 0.65rem;
            background: linear-gradient(135deg, #ffd700, #ff9f1c, #ff6b00);
            color: #241500 !important;
            padding: 1rem 1.6rem;
            border-radius: 15px;
            text-decoration: none;
            font-weight: 900;
            border: 1px solid rgba(255,255,255,0.35);
            box-shadow: 0 16px 40px rgba(255,159,28,0.36);
            overflow: hidden;
            transition: transform 0.3s, box-shadow 0.3s;
            animation: coinHeroGlow 2s ease-in-out infinite;
        }

        .coins-hero-btn::before {
            content: '';
            position: absolute;
            top: -60%;
            left: -40%;
            width: 45%;
            height: 220%;
            background: rgba(255,255,255,0.45);
            transform: rotate(25deg);
            animation: coinShine 2.6s ease-in-out infinite;
        }

        .coins-hero-btn:hover {
            transform: translateY(-3px) scale(1.02);
            box-shadow: 0 22px 55px rgba(255,159,28,0.52);
        }

        @keyframes coinHeroGlow {
            0%, 100% { filter: saturate(1); }
            50% { filter: saturate(1.25); }
        }

        @keyframes coinShine {
            0% { left: -60%; opacity: 0; }
            30% { opacity: 1; }
            60%, 100% { left: 130%; opacity: 0; }
        }

        .coin-float {
            display: inline-block;
            animation: coinFloat 1.4s ease-in-out infinite alternate;
            font-size: 1.35rem;
            position: relative;
            z-index: 1;
        }

        @keyframes coinFloat {
            from { transform: translateY(0) rotate(-6deg); }
            to { transform: translateY(-5px) rotate(7deg); }
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
            transition: transform 0.3s, box-shadow 0.3s;
        }

        .feature-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 18px 42px rgba(0,0,0,0.13);
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

        .coins-card {
            border: 2px solid rgba(255,215,0,0.45);
            background: linear-gradient(180deg, #fff, #fff9dc);
        }

        .coins-card .feature-icon {
            background: linear-gradient(135deg, #ffd700, #ff9f1c);
            box-shadow: 0 12px 30px rgba(255,159,28,0.28);
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

        .admin-floating {
            position: fixed;
            right: 14px;
            bottom: 14px;
            z-index: 1001;
            width: 38px;
            height: 38px;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.18);
            background: rgba(17,17,17,0.2);
            color: rgba(255,255,255,0.35);
            cursor: pointer;
            backdrop-filter: blur(8px);
            transition: all 0.25s;
            font-size: 16px;
        }

        .admin-floating:hover {
            background: rgba(17,17,17,0.72);
            color: #ffd700;
            transform: translateY(-2px);
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

        @media (max-width: 980px) {
            .nav-links {
                gap: 0.8rem;
                font-size: 0.9rem;
            }

            .coins-nav-btn {
                padding: 0.55rem 0.8rem;
            }
        }

        @media (max-width: 768px) {
            .hero h1 { font-size: 2.5rem; }
            .hero { padding: 7rem 1rem 3rem; }
            .nav { padding: 0.85rem 1rem; }
            .nav-links, .nav .cta-btn { display: none; }
            .mobile-menu-btn { display: flex; }
            .download-buttons { flex-direction: column; align-items: center; }
            .download-btn,
            .coins-hero-btn {
                width: min(330px, 100%);
                justify-content: center;
            }
            .logo img {
                width: 36px;
                height: 36px;
            }
            .features {
                padding: 4rem 1rem;
            }
            .section-title {
                font-size: 2rem;
            }
            .features-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body>
    <nav class="nav">
        <a class="logo" href="/" aria-label="Accueil Lovingo">
            <img src="/logo.png" alt="Logo Lovingo" onerror="this.style.display='none'">
            <span>💕 Lovingo</span>
        </a>

        <div class="nav-links">
            <a href="/features">Fonctionnalités</a>
            <a href="/pricing">Tarifs</a>
            <a href="/safety">Sécurité</a>
            <a href="/support">Support</a>
            <a href="/coins" class="coins-nav-btn">💰 Coins</a>
        </div>

        <a href="${PLAYSTORE_URL}" target="_blank" rel="noopener noreferrer" class="cta-btn">Télécharger</a>

        <button class="mobile-menu-btn" type="button" onclick="openMobileMenu()" aria-label="Ouvrir le menu">☰</button>
    </nav>

    <div class="mobile-overlay" id="mobileOverlay" onclick="closeMobileMenu()"></div>

    <aside class="mobile-menu" id="mobileMenu">
        <div class="mobile-menu-header">
            <strong>💕 Lovingo</strong>
            <button class="mobile-close" type="button" onclick="closeMobileMenu()" aria-label="Fermer">×</button>
        </div>

        <a href="/features" onclick="closeMobileMenu()">✨ Fonctionnalités</a>
        <a href="/pricing" onclick="closeMobileMenu()">💎 Tarifs</a>
        <a href="/safety" onclick="closeMobileMenu()">🛡️ Sécurité</a>
        <a href="/support" onclick="closeMobileMenu()">🎧 Support</a>
        <a href="/coins" class="mobile-coins" onclick="closeMobileMenu()">🪙 Acheter des coins</a>
        <a href="${PLAYSTORE_URL}" class="mobile-download" target="_blank" rel="noopener noreferrer">📱 Télécharger l'app</a>
        <button class="mobile-admin-link" type="button" onclick="openAdminPanel()">🔐 Admin</button>
    </aside>

    <section class="hero">
        <div class="hero-content">
            <img src="/logo.png" alt="Logo Lovingo" class="hero-logo" onerror="this.style.display='none'">
            <h1>L'amour à portée de clic</h1>
            <p>Découvrez des connexions authentiques avec Lovingo. Video calls HD, live streaming, cadeaux virtuels, coins et bien plus pour trouver votre âme sœur.</p>

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

                <a href="/coins" class="coins-hero-btn">
                    <span class="coin-float">🪙</span>
                    <div style="position:relative;z-index:1;">
                        <div style="font-size: 0.8rem;">Recharger maintenant</div>
                        <div style="font-weight: 900;">Acheter des coins</div>
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
                    <p>Exprimez vos sentiments avec des cadeaux virtuels uniques. Du simple cœur aux animations premium.</p>
                </div>

                <div class="feature-card coins-card">
                    <div class="feature-icon">🪙</div>
                    <h3>Coins Lovingo</h3>
                    <p>Achetez des coins en ligne avec votre ID public, puis utilisez-les dans l'app pour envoyer des cadeaux virtuels.</p>
                    <p style="margin-top:1rem;">
                        <a href="/coins" style="color:#c44569;font-weight:800;text-decoration:none;">Acheter des coins →</a>
                    </p>
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

    <button class="admin-floating" type="button" title="Admin" onclick="openAdminPanel()">⚙️</button>

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
                <a href="/coins">Acheter des coins</a>
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

            <div class="footer-section">
                <h4>Admin</h4>
                <a href="#" onclick="openAdminPanel(); return false;">🔐 Dashboard admin</a>
            </div>
        </div>

        <div class="footer-bottom">
            <p>&copy; 2026 Lovingo. Tous droits réservés. Made with 💕 for love</p>
        </div>
    </footer>

    <script>
        function openMobileMenu() {
            document.getElementById('mobileMenu').classList.add('open');
            document.getElementById('mobileOverlay').classList.add('open');
            document.body.style.overflow = 'hidden';
        }

        function closeMobileMenu() {
            document.getElementById('mobileMenu').classList.remove('open');
            document.getElementById('mobileOverlay').classList.remove('open');
            document.body.style.overflow = '';
        }

        function openAdminPanel() {
            closeMobileMenu();
            var secret = window.prompt('ADMIN_MAINTENANCE_SECRET');
            if (!secret) return;
            window.location.href = '/admin?key=' + encodeURIComponent(secret);
        }

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeMobileMenu();
            }
        });
    </script>
</body>
</html>
  `;
}

module.exports = {
  renderHomePage,
};