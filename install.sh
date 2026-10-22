#!/usr/bin/env bash
# Installation guidée de l'addon Bandes-Annonces VF — rien à cloner, juste Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/Wallacecleaver/vf-trailer-wallace/main/install.sh | bash
#
# (ou, depuis le dépôt cloné :  ./install.sh)
#
# Le script pose 3 questions (domaine HTTPS, clé TMDB, mot de passe du dashboard),
# écrit le fichier .env, télécharge l'image Docker et démarre tout.
# Pour une installation sans question, passe les réponses par variables d'environnement :
#   DOMAIN=... TMDB_API_KEY=... DASHBOARD_PASSWORD=... HOST_PORT=... bash install.sh
set -euo pipefail

RAW_BASE="${VF_RAW_BASE:-https://raw.githubusercontent.com/Wallacecleaver/vf-trailer-wallace/main}"

say()  { printf '%s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; exit 1; }

# Lit une réponse au clavier même quand le script arrive par « curl | bash » (stdin = le script).
INTERACTIVE=0
if [ -r /dev/tty ] && [ -w /dev/tty ] && (: </dev/tty) 2>/dev/null; then INTERACTIVE=1; fi
ask()        { local a=""; [ "$INTERACTIVE" = 1 ] && read -r -p "$1" a </dev/tty || true; printf '%s' "$a"; }
ask_secret() { local a=""; if [ "$INTERACTIVE" = 1 ]; then read -rs -p "$1" a </dev/tty || true; printf '\n' >/dev/tty; fi; printf '%s' "$a"; }
rand()       { head -c 128 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

main() {
  command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé : https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || fail "Le plugin « docker compose » est introuvable (mets Docker à jour)."

  # Dossier d'installation : le dépôt s'il est cloné, sinon ./vf-trailers
  local here=""
  [ -n "${BASH_SOURCE[0]:-}" ] && here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
  local repo_mode=0
  if [ -n "$here" ] && [ -f "$here/docker-compose.yml" ] && [ -f "$here/Dockerfile" ]; then
    cd "$here"; repo_mode=1
  else
    mkdir -p vf-trailers && cd vf-trailers
    for f in docker-compose.yml Caddyfile; do
      [ -f "$f" ] || curl -fsSL "$RAW_BASE/$f" -o "$f" || fail "Téléchargement de $f impossible ($RAW_BASE/$f)."
    done
    say "📁 Installation dans : $(pwd)"
  fi

  local profile_args=()
  if [ -f .env ]; then
    say "ℹ️  .env existe déjà : je le garde tel quel (supprime-le pour refaire la configuration)."
    grep -qE '^DOMAIN=.+' .env && profile_args=(--profile https)
  else
    say ""
    say "Quelques questions (Entrée pour passer / valeur par défaut) :"
    say ""

    # 1) Domaine
    local domain="${DOMAIN:-}"
    if [ -z "$domain" ]; then
      say "① Nom de domaine pour l'accès HTTPS (ex. trailers.mondomaine.fr)."
      say "   Nécessaire pour installer l'addon dans Stremio depuis un autre appareil."
      say "   Il doit déjà pointer vers l'IP de ce serveur, ports 80 et 443 ouverts."
    fi
    while true; do
      [ -n "$domain" ] || domain="$(ask '   Domaine : ')"
      domain="$(printf '%s' "$domain" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##')"
      if [ -z "$domain" ] || printf '%s' "$domain" | grep -qE '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'; then break; fi
      say "   ⚠️  « $domain » n'est pas un nom de domaine valide."; domain=""
      [ "$INTERACTIVE" = 1 ] || fail "DOMAIN invalide."
    done

    # 2) Clé TMDB
    local tmdb="${TMDB_API_KEY:-}"
    if [ -z "$tmdb" ]; then
      say ""
      say "② Clé API TMDB (facultatif : sert au testeur du dashboard — https://www.themoviedb.org/settings/api)."
      tmdb="$(ask '   Clé TMDB : ')"
    fi
    if [ -n "$tmdb" ] && ! printf '%s' "$tmdb" | grep -qE '^[A-Za-z0-9]+$'; then
      fail "La clé TMDB ne doit contenir que des lettres et des chiffres."
    fi

    # 3) Mot de passe du dashboard
    local pw="${DASHBOARD_PASSWORD:-}" generated=0
    say ""
    if [ -z "$pw" ] && [ "$INTERACTIVE" = 1 ]; then
      say "③ Mot de passe du dashboard d'administration (8 caractères minimum, sans apostrophe)."
      while true; do
        pw="$(ask_secret '   Mot de passe (Entrée = en générer un) : ')"
        if [ -z "$pw" ]; then break; fi
        if [ "${#pw}" -lt 8 ]; then say "   ⚠️  Trop court (8 minimum)."; continue; fi
        case "$pw" in *\'*) say "   ⚠️  Sans apostrophe, s'il te plaît."; continue ;; esac
        local conf; conf="$(ask_secret '   Confirme le mot de passe : ')"
        [ "$pw" = "$conf" ] && break
        say "   ⚠️  Les deux mots de passe ne correspondent pas."
      done
    fi
    if [ -n "$pw" ]; then
      [ "${#pw}" -ge 8 ] || fail "DASHBOARD_PASSWORD : 8 caractères minimum."
      case "$pw" in *\'*) fail "DASHBOARD_PASSWORD ne doit pas contenir d'apostrophe." ;; esac
    else
      pw="$(rand 20)"; generated=1
    fi

    # 4) Port (seulement sans domaine : avec un domaine, Caddy écoute 80/443)
    local port="${HOST_PORT:-3000}"
    if [ -z "$domain" ] && [ -z "${HOST_PORT:-}" ]; then
      say ""
      port="$(ask '④ Port d'"'"'écoute de l'"'"'addon [3000] : ')"; port="${port:-3000}"
    fi
    printf '%s' "$port" | grep -qE '^[0-9]{2,5}$' || fail "Port invalide : $port"

    # Écriture du .env (mot de passe entre apostrophes : aucun caractère spécial ne pose problème)
    local url
    if [ -n "$domain" ]; then url="https://$domain"; else
      local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; url="http://${ip:-localhost}:$port"
    fi
    {
      echo "# Généré par install.sh — modifie puis relance : docker compose up -d"
      echo "DASHBOARD_PASSWORD='$pw'"
      echo "POSTGRES_PASSWORD=$(rand 24)"
      echo "APP_BASE_URL=$url"
      [ -n "$tmdb" ] && echo "TMDB_API_KEY=$tmdb"
      if [ -n "$domain" ]; then
        echo "DOMAIN=$domain"
        echo "BIND_ADDRESS=127.0.0.1"
      else
        echo "TRUST_PROXY=0"
        [ "$port" != "3000" ] && echo "HOST_PORT=$port"
      fi
    } > .env
    chmod 600 .env
    [ -n "$domain" ] && profile_args=(--profile https)

    if [ "$generated" = 1 ]; then
      say ""
      say "🔑 Mot de passe du dashboard généré : $pw   (conservé dans .env)"
    fi
  fi

  say ""
  say "🚀 Démarrage…"
  if [ "$repo_mode" = 1 ]; then
    docker compose ${profile_args[@]+"${profile_args[@]}"} up -d --build
  else
    docker compose ${profile_args[@]+"${profile_args[@]}"} pull || fail "Impossible de télécharger l'image Docker. Vérifie ta connexion (l'image est publique : ghcr.io/wallacecleaver/vf-trailer-wallace)."
    docker compose ${profile_args[@]+"${profile_args[@]}"} up -d
  fi

  local url port
  url="$(grep -E '^APP_BASE_URL=' .env | cut -d= -f2-)"
  port="$(grep -E '^HOST_PORT=' .env | cut -d= -f2- || true)"; port="${port:-3000}"

  if command -v curl >/dev/null 2>&1; then
    printf '⏳ Attente du démarrage'
    local ok=0
    for _ in $(seq 1 "${VF_WAIT:-45}"); do
      if curl -fsS -o /dev/null -m 2 "http://127.0.0.1:$port/" 2>/dev/null; then ok=1; break; fi
      printf '.'; sleep 2
    done
    printf '\n'
    [ "$ok" = 1 ] || say "⚠️  L'addon ne répond pas encore : regarde  docker compose logs app"
  fi

  say ""
  say "✅ Terminé."
  say "   Installation dans Stremio : $url"
  say "   Dashboard                 : $url/dashboard"
  say ""
  say "Commandes utiles (dans le dossier $(pwd)) :"
  say "   Logs          : docker compose logs -f app"
  say "   Mise à jour   : docker compose ${profile_args[*]:-} pull && docker compose ${profile_args[*]:-} up -d"
  say "   Arrêter       : docker compose down"
}

main "$@"
