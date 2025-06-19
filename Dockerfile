# signaling_server/Dockerfile - CONTENEUR DOCKER POUR SERVEUR DE SIGNALING
FROM node:18-alpine

# Métadonnées
LABEL name="webrtc-signaling-server"
LABEL version="1.0.0"
LABEL description="Serveur de signaling WebRTC pour live streaming et appels"

# Variables d'environnement
ENV NODE_ENV=production
ENV PORT=8080

# Créer utilisateur non-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S signaling -u 1001

# Répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm ci --only=production && npm cache clean --force

# Copier le code source
COPY --chown=signaling:nodejs . .

# Exposer le port
EXPOSE $PORT

# Vérification de santé
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Changer vers l'utilisateur non-root
USER signaling

# Commande de démarrage
CMD ["node", "server.js"]