FROM node:22-alpine

LABEL org.opencontainers.image.description="Addon Stremio Bandes-Annonces VF"

# Nom complet de cette image (renseigné par la CI) : l'installeur l'écrit dans le docker-compose.yml généré.
ARG IMAGE_REF=vf-trailers:local
ENV VF_IMAGE=$IMAGE_REF

ENV NODE_ENV=production
# Plafonne le tas V8 : le ramasse-miettes travaille plus tôt, la RAM reste basse (~100 Mo).
# --disable-warning : masque l'avertissement « expérimental » de node:sqlite (la base SQLite intégrée à Node).
ENV NODE_OPTIONS="--max-old-space-size=192 --disable-warning=ExperimentalWarning"
WORKDIR /app

# Dépendances d'abord (meilleur cache Docker)
# yt-dlp (option « ytdlp » de la lecture directe YouTube) : script autonome + Python. Il se met à jour tout seul
# (yt-dlp -U, une fois par jour) car YouTube change souvent.
RUN apk add --no-cache python3 \
 && wget -q -O /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp && chown node:node /usr/local/bin/yt-dlp

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Données (base SQLite : /data/addon.sqlite) : monte un volume sur /data
# pour que réglages du dashboard, mapping et stats survivent aux mises à jour / redéploiements.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data

USER node
ENV PORT=3000
EXPOSE 3000

# Le manifest reste disponible pendant la maintenance de /configure (qui renvoie alors 503).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-3000}/manifest.json || exit 1

ENTRYPOINT ["sh", "/app/selfhost/entrypoint.sh"]
CMD ["server"]
