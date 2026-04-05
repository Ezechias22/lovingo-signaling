function renderFeaturesPage() {
  return `
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
  `;
}

module.exports = {
  renderFeaturesPage,
};