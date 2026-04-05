function renderPricingPage({ PLAYSTORE_URL }) {
  return `
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

        async function handleCreditPurchase(packageType) {
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
  `;
}

module.exports = {
  renderPricingPage,
};