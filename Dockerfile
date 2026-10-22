FROM node:22-alpine

LABEL org.opencontainers.image.description="Addon Stremio Bandes-Annonces VF"

# Nom complet de cette image (renseigné par la CI) : l'installeur l'écrit dans le docker-compose.yml généré.
ARG IMAGE_REF=vf-trailers:local
ENV VF_IMAGE=$IMAGE_REF

ENV NODE_ENV=production
# Plafonne le tas V8 : le ramasse-miettes travaille plus tôt, la RAM reste basse (~100 Mo).
ENV NODE_OPTIONS="--max-old-space-size=128"
WORKDIR /app

# Dépendances d'abord (meilleur cache Docker)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["sh", "/app/selfhost/entrypoint.sh"]
CMD ["server"]
