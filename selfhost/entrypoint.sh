#!/bin/sh
# Point d'entrée de l'image :
#   (rien) / server   -> démarre l'addon
#   install           -> installeur interactif : écrit docker-compose.yml + .env dans le dossier monté sur /data
set -e
case "${1:-server}" in
  server)  exec node selfhost/server.js ;;
  install) shift; exec node selfhost/install.js "$@" ;;
  *)       exec "$@" ;;
esac
