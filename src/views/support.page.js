function renderSupportPage() {
  return `
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
  `;
}

module.exports = {
  renderSupportPage,
};