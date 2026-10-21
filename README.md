# Bandes-Annonces VF — addon Stremio

Addon [Stremio](https://www.stremio.com/) qui affiche la **bande-annonce officielle française** (et le teaser quand il existe) de n'importe quel film ou série, directement dans la fiche du titre.

- **Sources** : TMDB → Allociné → recherche YouTube (en repli), avec détection VF par liste blanche.
- **Stremio** : teaser (si dispo) puis bande-annonce. Compatible avec l'option « A trailer addon » d'**AIOMetadata** (mode `aiom` : un seul lien `ytId`/`url`, avec délai maximum réglable).
- **Dashboard d'administration** : stats, utilisateurs, mapping manuel des liens, journal des échecs, test des flux, logs, réglages, cache…
- **Pages publiques** : configuration de l'addon (`/`), proposition de liens par la communauté (`/proposer`), récupération de config (`/recuperation`).

Deux façons de l'héberger : **[self-host avec Docker](#-self-host-docker-recommandé)** (tout sur ton serveur) ou **[Vercel + Neon](#-variante--vercel--neon)**.

---

## 🏠 Self-host (Docker, recommandé)

Tout tourne chez toi : l'addon + sa base Postgres, dans deux conteneurs. Aucun compte externe requis.

### Prérequis

- Un serveur / VPS / Raspberry Pi 64 bits avec [Docker](https://docs.docker.com/engine/install/) et le plugin Compose (`docker compose version`).
- Une clé API TMDB gratuite : <https://www.themoviedb.org/settings/api>.
- Pour Stremio **hors de chez toi**, un nom de domaine en HTTPS (Stremio refuse les addons HTTP distants). Un sous-domaine gratuit DuckDNS fait très bien l'affaire.

### Installation en 4 étapes

```bash
# 1. Récupérer le code
git clone https://github.com/Wallacecleaver/vf-trailer-wallace.git
cd vf-trailer-wallace

# 2. Créer ta configuration
cp .env.example .env
nano .env        # remplis au minimum DASHBOARD_PASSWORD, POSTGRES_PASSWORD, APP_BASE_URL

# 3. Démarrer (la base et ses tables sont créées automatiquement)
docker compose up -d --build

# 4. Vérifier
docker compose logs -f app     # doit afficher « Addon démarré sur http://0.0.0.0:3000 »
```

L'addon répond alors sur `http://IP_DU_SERVEUR:3000` :

| Adresse | Rôle |
|---|---|
| `/` | Page de configuration (chaque utilisateur y met sa clé TMDB et obtient son lien d'installation) |
| `/dashboard` | Dashboard admin (mot de passe = `DASHBOARD_PASSWORD`) |
| `/proposer` | Proposition de liens par la communauté |
| `/recuperation` | Récupération de configuration |

### HTTPS automatique avec Caddy (inclus)

1. Fais pointer ton domaine (enregistrement DNS `A`) vers l'IP de ton serveur et ouvre les ports **80** et **443**.
2. Dans `.env` :
   ```env
   DOMAIN=trailers.mondomaine.fr
   APP_BASE_URL=https://trailers.mondomaine.fr
   BIND_ADDRESS=127.0.0.1
   ```
3. Démarre avec le profil `https` :
   ```bash
   docker compose --profile https up -d --build
   ```

Caddy obtient et renouvelle tout seul le certificat Let's Encrypt. Si tu as déjà un reverse proxy (Nginx, Traefik, Nginx Proxy Manager…), n'utilise pas ce profil : fais simplement pointer ton proxy vers `127.0.0.1:3000` (et garde `BIND_ADDRESS=127.0.0.1`).

### Installer dans Stremio

Ouvre `APP_BASE_URL` dans ton navigateur, renseigne ta clé TMDB, puis clique sur **Installer dans Stremio** (ou copie le lien).

### Variables d'environnement

| Variable | Obligatoire | Description |
|---|:--:|---|
| `DASHBOARD_PASSWORD` | ✅ | Mot de passe du dashboard. Sans lui, le dashboard est inaccessible. |
| `POSTGRES_PASSWORD` | ✅ | Mot de passe de la base (lettres et chiffres uniquement). |
| `APP_BASE_URL` | ✅ | URL publique de l'addon, sans slash final (logo, liens `/proposer`…). |
| `TMDB_API_KEY` | conseillé | Clé TMDB du testeur de flux du dashboard. |
| `DOMAIN` | pour HTTPS | Domaine utilisé par Caddy (profil `https`). |
| `BIND_ADDRESS` | non | `127.0.0.1` pour ne pas exposer le port 3000 sur Internet (défaut `0.0.0.0`). |
| `HOST_PORT` | non | Port exposé sur la machine (défaut `3000`). |
| `DATABASE_URL` | non | Postgres externe à la place de celui du compose. |
| `DATABASE_SSL` | non | `true` si ton Postgres externe impose le SSL. |
| `DB_DRIVER` | non | Force le driver : `pg` (Postgres classique) ou `neon` (Neon hébergé). Détecté automatiquement sinon. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | non | Redis facultatif : dédoublonnage des recherches dans les logs et cache du statut des services. Tout fonctionne sans. |
| `DASHBOARD_NO_CACHE` | non | `1` pour désactiver le cache de rendu du dashboard pendant que tu le modifies. |

### Maintenance

```bash
# Mettre à jour
git pull
docker compose up -d --build        # (ajoute --profile https si tu utilises Caddy)

# Voir les logs
docker compose logs -f app

# Redémarrer / arrêter
docker compose restart app
docker compose down                 # les données sont conservées (volume pgdata)

# Sauvegarder la base
docker compose exec -T db pg_dump -U vf vf > sauvegarde.sql

# Restaurer
docker compose exec -T db psql -U vf vf < sauvegarde.sql
```

> ⚠️ `docker compose down -v` supprime aussi le volume : **toutes les données** (mapping, réglages, stats) seraient perdues.

Le schéma SQL ([`schema.sql`](schema.sql)) est appliqué automatiquement à chaque démarrage ; il est idempotent et ne touche jamais aux données existantes.

### Sans Docker (Node.js directement)

Il faut Node.js 20+ et un Postgres accessible.

```bash
npm install
export DATABASE_URL=postgres://utilisateur:motdepasse@localhost:5432/base
export DASHBOARD_PASSWORD=...
export APP_BASE_URL=http://localhost:3000
export TMDB_API_KEY=...
npm start          # crée les tables au premier lancement
```

Pour le garder en service, utilise par exemple `systemd` ou `pm2 start server.js --name vf-trailers`.

### Migrer depuis Vercel + Neon

```bash
# Export depuis Neon (remplace par ta DATABASE_URL Neon)
pg_dump --data-only --no-owner "postgres://...neon.tech/neondb?sslmode=require" > donnees.sql

# Démarre d'abord la stack self-host (crée les tables), puis importe
docker compose exec -T db psql -U vf vf < donnees.sql
```

Si l'import signale des doublons sur les lignes de réglages (`id = 1`), c'est sans gravité : vide d'abord ces deux tables avec
`TRUNCATE configure_settings, behavior_settings, request_stats_global;` avant d'importer.
Pense ensuite à mettre à jour `APP_BASE_URL` et, côté utilisateurs, à réinstaller l'addon avec la nouvelle adresse (la page `/recuperation` est faite pour ça).

### Dépannage

| Symptôme | Piste |
|---|---|
| `Postgres pas encore prêt` dans les logs | Normal au tout premier démarrage (quelques secondes) ; l'addon réessaie tout seul. |
| Le dashboard refuse le mot de passe / « non configuré » | `DASHBOARD_PASSWORD` absent de `.env`. Après modification : `docker compose up -d`. |
| Stremio refuse d'installer l'addon | Stremio exige du **HTTPS** pour les addons distants : utilise le profil `https` ou un reverse proxy. |
| Le logo ou les liens pointent vers un mauvais domaine | `APP_BASE_URL` mal renseignée. |
| `password authentication failed` | `POSTGRES_PASSWORD` modifié après la création du volume : remets l'ancienne valeur, ou change le mot de passe dans Postgres (`ALTER USER vf PASSWORD '...'`), ou repars de zéro avec `docker compose down -v` (⚠️ efface les données). |

---

## ☁️ Variante : Vercel + Neon

1. Crée un projet [Neon](https://neon.tech) gratuit, copie sa `DATABASE_URL`, puis colle le contenu de [`schema.sql`](schema.sql) dans l'éditeur SQL de Neon (une seule fois).
2. Importe le repo dans [Vercel](https://vercel.com) et ajoute les variables d'environnement : `DATABASE_URL`, `DASHBOARD_PASSWORD`, `TMDB_API_KEY`, `APP_BASE_URL` (et éventuellement `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
3. Déploie. Vercel utilise `api/index.js` (voir `vercel.json`) ; `server.js` n'est pas utilisé.

Pour tester en local avec la CLI Vercel : copie `.env.local.example` en `.env.local`, puis `vercel dev`.

---

## 🧱 Structure du projet

```
api/index.js        Application Express (routes Stremio, API, pages) — partagée Vercel / self-host
server.js           Point d'entrée self-host (écoute un port, applique schema.sql, sert public/)
schema.sql          Schéma Postgres complet (idempotent)
lib/                Modules : db, cache, matching des titres, Allociné, YouTube, stats, réglages…
dashboard/          Dashboard découpé en vrais fichiers HTML / CSS / JS (voir dashboard/README.md)
public/             Fichiers statiques (logo)
test/               Tests unitaires
Dockerfile, docker-compose.yml, Caddyfile, .env.example   Self-host
```

`lib/db.js` choisit automatiquement le driver : Neon (HTTP) si l'URL contient `neon.tech`, Postgres classique (`pg`) sinon.

### Modifier le dashboard

Chaque page a son HTML et son JS : tout est expliqué dans [`dashboard/README.md`](dashboard/README.md). Pendant tes modifications, mets `DASHBOARD_NO_CACHE=1` pour voir les changements sans redémarrer le cache de rendu.

### Tests

```bash
npm install
npm test
```

---

## Sources de données

TMDB (principal) · Allociné (repli) · YouTube (recherche en dernier recours). Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
