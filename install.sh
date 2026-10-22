#!/usr/bin/env bash
# Installation en une commande :  ./install.sh
# Crée .env (mots de passe générés automatiquement), puis lance l'addon avec Docker.
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "❌ Docker n'est pas installé : https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ Le plugin « docker compose » est introuvable."; exit 1; }

rand() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

PROFILE_ARGS=()
if [ -f .env ]; then
  echo "ℹ️  .env existe déjà : je le garde tel quel."
  grep -qE '^DOMAIN=.+' .env && PROFILE_ARGS=(--profile https)
else
  read -r -p "Nom de domaine en HTTPS (ex. trailers.mondomaine.fr) — Entrée pour ignorer : " DOMAIN || true
  read -r -p "Ta clé API TMDB (facultatif, Entrée pour ignorer) : " TMDB || true

  DASH_PASS="$(rand 20)"
  cp .env.example .env
  sed -i "s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=${DASH_PASS}|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 24)|" .env
  [ -n "${TMDB:-}" ] && sed -i "s|^TMDB_API_KEY=.*|TMDB_API_KEY=${TMDB}|" .env

  if [ -n "${DOMAIN:-}" ]; then
    sed -i "s|^APP_BASE_URL=.*|APP_BASE_URL=https://${DOMAIN}|" .env
    sed -i "s|^# DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
    sed -i "s|^# BIND_ADDRESS=.*|BIND_ADDRESS=127.0.0.1|" .env
    PROFILE_ARGS=(--profile https)
  else
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    sed -i "s|^APP_BASE_URL=.*|APP_BASE_URL=http://${IP:-localhost}:3000|" .env
    sed -i "s|^# TRUST_PROXY=.*|TRUST_PROXY=0|" .env   # exposé directement : on ne fait pas confiance à X-Forwarded-For
  fi
  echo
  echo "🔑 Mot de passe du dashboard : ${DASH_PASS}   (noté dans .env)"
fi

docker compose ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} up -d --build

URL="$(grep -E '^APP_BASE_URL=' .env | cut -d= -f2-)"
echo
echo "✅ Addon démarré."
echo "   Configuration / installation Stremio : ${URL}"
echo "   Dashboard                            : ${URL}/dashboard"
echo "   Logs                                 : docker compose logs -f app"
