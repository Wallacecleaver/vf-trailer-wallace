# Bandes-Annonces VF — addon Stremio

Addon [Stremio](https://www.stremio.com/) qui affiche la **bande-annonce officielle française** (et le teaser quand il existe) de n'importe quel film ou série, directement dans la fiche du titre.

- **Sources** : TMDB → Allociné → recherche YouTube (en repli), avec détection VF par liste blanche.
- **Stremio** : teaser (si dispo) puis bande-annonce. Compatible avec l'option « A trailer addon » d'**AIOMetadata** (mode `aiom` : un seul lien `ytId`/`url`, avec délai maximum réglable).
- **Dashboard d'administration** : stats, utilisateurs, mapping manuel des liens, journal des échecs, test des flux, logs, réglages, cache…
- **Pages publiques** : configuration de l'addon (`/`), proposition de liens par la communauté (`/proposer`).

Tout tourne sur ton serveur (VPS, Raspberry Pi, NAS…), avec Docker.

---

## 🏠 Installation (Docker)

Tout tourne chez toi : l'addon et sa base SQLite (un simple fichier), dans un seul conteneur. Aucun compte externe requis.

### Prérequis

- Un serveur / VPS / Raspberry Pi 64 bits avec [Docker](https://docs.docker.com/engine/install/) et le plugin Compose (`docker compose version`).
- Une clé API TMDB gratuite : <https://www.themoviedb.org/settings/api>.
- Pour installer l'addon dans Stremio **depuis un autre appareil**, un nom de domaine en HTTPS servi par ton reverse proxy (Stremio refuse les addons HTTP distants).

### Installation (100 % Docker, rien à cloner ni à télécharger)

Tout est dans l'image Docker, **installeur compris**. Dans un dossier vide :

```bash
mkdir vf-trailers && cd vf-trailers
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/data <IMAGE> install
docker compose up -d
```

`<IMAGE>` est le nom de l'image publiée (par exemple `monnom/vf-trailers:latest`). La première commande lance l'installeur, qui pose quelques questions puis écrit `docker-compose.yml` et `.env` dans le dossier ; la seconde démarre l'addon.

L'installeur demande :

1. **Ton nom de domaine** (facultatif), si ton reverse proxy HTTPS le sert déjà. Il sert à écrire l'adresse publique de l'addon (`APP_BASE_URL`).
2. **Ta clé TMDB** (facultatif).
3. **Ton mot de passe du dashboard** : tu le choisis (8 caractères minimum, saisi masqué et confirmé), ou Entrée pour en générer un.
4. **Le port d'écoute** (`3000` par défaut) et, sans domaine, l'adresse du serveur (`localhost` par défaut).

Si un `.env` existe déjà, l'installeur n'y touche pas (supprime-le pour refaire la configuration).

Installation sans question (scripts) : passe les réponses en variables, `-e DOMAIN=... -e TMDB_API_KEY=... -e DASHBOARD_PASSWORD='...'` après `docker run`.

<details>
<summary>Installation à la main (sans l'installeur)</summary>

Écris toi-même un `docker-compose.yml` à partir de `selfhost/deploy/compose.template.yml` (remplace `__IMAGE__` par le nom de l'image) et un `.env` d'après `.env.example`, puis `docker compose up -d`.
</details>

<details>
<summary>Construire l'image toi-même (développement)</summary>

```bash
docker build -t vf-trailers:local .
mkdir test-install && cd test-install
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/data vf-trailers:local install
docker compose up -d
```
</details>

L'addon répond alors sur `http://IP_DU_SERVEUR:3000` :

| Adresse | Rôle |
|---|---|
| `/` | Page de configuration (chaque utilisateur y met sa clé TMDB et obtient son lien d'installation) |
| `/dashboard` | Dashboard admin (mot de passe = `DASHBOARD_PASSWORD`) |
| `/proposer` | Proposition de liens par la communauté |

### HTTPS

L'addon écoute en HTTP sur le port choisi (`3000` par défaut) : mets-y ton reverse proxy habituel (Nginx, Traefik, Nginx Proxy Manager, Caddy…) pour le HTTPS. Si le proxy tourne sur la même machine, ajoute `BIND_ADDRESS=127.0.0.1` dans le `.env` pour ne pas exposer le port directement.

### Déploiement WDock / « git pull » sur VPS

L'addon utilise une **base SQLite** (module `node:sqlite` intégré à Node, aucune dépendance) stockée dans `/data/addon.sqlite` : un seul conteneur, rien d'autre à installer. Tout ce que tu sauvegardes dans le dashboard (réglages, page de config, mapping, stats, logs) est écrit dans ce fichier.

Pour que ça survive aux redéploiements, **`/data` doit être un volume persistant** :

- **WDock** : crée le projet depuis le repo GitHub (port `3000`), ajoute les variables `DASHBOARD_PASSWORD`, `APP_BASE_URL` (l'adresse publique, avec `https://`) et `TMDB_API_KEY`, et monte un volume persistant sur `/data` si WDock le permet.
- **VPS en direct** : `cp .env.example .env`, remplis-le, puis `docker compose up -d --build`. Mise à jour : `git pull && docker compose up -d --build` (le volume `data` n'est jamais touché).

Sauvegarde : copie le fichier `addon.sqlite` du volume `data` (voir « Maintenance » ci-dessous).

### Installer dans Stremio

Ouvre `APP_BASE_URL` dans ton navigateur, renseigne ta clé TMDB, puis clique sur **Installer dans Stremio** (ou copie le lien).

### Variables d'environnement

| Variable | Obligatoire | Description |
|---|:--:|---|
| `DASHBOARD_PASSWORD` | ✅ | Mot de passe du dashboard. Sans lui, le dashboard est inaccessible. |
| `APP_BASE_URL` | ✅ | URL publique de l'addon, sans slash final (logo, liens `/proposer`…). |
| `TMDB_API_KEY` | conseillé | Clé TMDB du testeur de flux du dashboard. |
| `BIND_ADDRESS` | non | `127.0.0.1` pour ne pas exposer le port 3000 sur Internet (défaut `0.0.0.0`). |
| `HOST_PORT` | non | Port exposé sur la machine (défaut `3000`). |
| `DATA_DIR` | non | Dossier de la base SQLite (`addon.sqlite`) (défaut `/data` dans l'image : à monter en volume). |
| `TRUST_PROXY` | non | `0` si l'addon est exposé directement sur Internet (ignore `X-Forwarded-For`). L'installeur le règle selon ton choix. |
| `DASHBOARD_NO_CACHE` | non | `1` pour désactiver le cache de rendu du dashboard pendant que tu le modifies. |

### Ressources utilisées (très légères)

Mesures faites avant le passage à SQLite (la base n'est plus un processus séparé, à re-mesurer) :

| | Au repos | Sous charge (≈ 110 requêtes/s, écritures en base) |
|---|---|---|
| **Addon (Node.js)** | ≈ 85 Mo de RAM, ≈ 0,7 % d'un cœur | ≈ 110 Mo de RAM |

Un usage Stremio normal est de l'ordre de quelques requêtes par minute : le CPU reste quasi à zéro. Ce qui est déjà en place pour que ça reste ainsi :

- SQLite tourne dans le processus de l'addon (pas de second conteneur) : cache de 2 Mo, journal WAL borné à 4 Mo.
- Plafonds Docker : **256 Mo** et **0,5 cœur** pour l'addon. Tourne sans souci sur un Raspberry Pi ou le plus petit VPS.
- Mémoire Node plafonnée (`--max-old-space-size`, voir `Dockerfile`).
- Les journaux Docker sont limités à 3 × 10 Mo (le disque ne se remplit pas).
- Les journaux de l'appli (500 lignes), les échecs (50 titres) et les résolutions (1 h) sont bornés ; les entrées de cache expirées sont purgées toutes les 6 h.
- Aucun processus en tâche de fond : l'addon ne fait rien tant que personne ne lui demande une bande-annonce.

Si tu veux changer les plafonds, modifie `mem_limit` et `cpus` dans `docker-compose.yml`.

### Maintenance

```bash
# Mettre à jour (télécharge la dernière image publiée)
docker compose pull
docker compose up -d

# Voir les logs
docker compose logs -f app

# Redémarrer / arrêter
docker compose restart app
docker compose down                 # les données sont conservées (volume data)

# Sauvegarder la base (copie cohérente, même pendant que l'addon tourne)
docker compose exec app node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/addon.sqlite').exec(\"VACUUM INTO '/data/sauvegarde.sqlite'\")"
docker compose cp app:/data/sauvegarde.sqlite ./sauvegarde.sqlite

# Restaurer : arrête l'addon, remplace le fichier du volume, redémarre
docker compose stop app
docker compose cp ./sauvegarde.sqlite app:/data/addon.sqlite
docker compose start app
```

> ⚠️ `docker compose down -v` supprime aussi le volume : **toutes les données** (mapping, réglages, stats) seraient perdues.

Le schéma SQL ([`schema.sql`](schema.sql)) est appliqué automatiquement à chaque démarrage ; il est idempotent et ne touche jamais aux données existantes.

### Sans Docker (Node.js directement)

Il faut Node.js 22.13 ou plus récent (SQLite est intégré, rien d'autre à installer).

```bash
npm install
export DATA_DIR=./data   # la base y sera créée (addon.sqlite)
export DASHBOARD_PASSWORD=...
export APP_BASE_URL=http://localhost:3000
export TMDB_API_KEY=...
npm start          # (= node selfhost/server.js) crée la base et les tables au premier lancement
```

Pour le garder en service, utilise par exemple `systemd` ou `pm2 start selfhost/server.js --name vf-trailers`.

### Dépannage

| Symptôme | Piste |
|---|---|
| `Impossible d’ouvrir la base` dans les logs | `DATA_DIR` n'existe pas ou n'est pas inscriptible par l'utilisateur de l'addon : vérifie le volume monté sur `/data`. |
| Le dashboard refuse le mot de passe / « non configuré » | `DASHBOARD_PASSWORD` absent de `.env`. Après modification : `docker compose up -d`. |
| Stremio refuse d'installer l'addon | Stremio exige du **HTTPS** pour les addons distants : mets un reverse proxy HTTPS devant le port de l'addon. |
| `pull access denied` / image introuvable au téléchargement | L'image n'est pas encore construite ou pas publique : vérifie la CI, puis la visibilité **Public** du dépôt d'images. |
| Le logo ou les liens pointent vers un mauvais domaine | `APP_BASE_URL` mal renseignée. |

---

## 🧱 Structure du projet

```
api/index.js        Application Express (routes Stremio, API, pages)
selfhost/server.js  Point d'entrée self-host (écoute un port, applique schema.sql, sert public/)
schema.sql          Schéma SQLite complet (idempotent)
lib/                Modules : db, cache, matching des titres, Allociné, YouTube, stats, réglages…
dashboard/          Dashboard découpé en vrais fichiers HTML / CSS / JS (voir dashboard/README.md)
public/             Fichiers statiques (logo)
test/               Tests unitaires
Dockerfile, .env.example   Image Docker (l'installeur est dans selfhost/install.js)
selfhost/deploy/    Modèle du docker-compose.yml écrit par l'installeur
.github/workflows/docker.yml   Publication automatique de l'image
```

Toute la persistance (cache, réglages, stats, logs, mapping) est dans un fichier SQLite (`DATA_DIR/addon.sqlite`).

### Modifier le dashboard

Chaque page a son HTML et son JS : tout est expliqué dans [`dashboard/README.md`](dashboard/README.md). Pendant tes modifications, mets `DASHBOARD_NO_CACHE=1` pour voir les changements sans redémarrer le cache de rendu.

### Tests

```bash
npm install
npm test
```

---

## 📦 Publication de l'image (mainteneur)

Chaque push sur `main` déclenche `.github/workflows/docker.yml` : tests, puis construction (amd64 + arm64) et publication de l'image (tags `latest`, `vX.Y.Z` et `sha`). L'image embarque l'installeur et ne contient ni l'adresse du dépôt ni aucune étiquette qui y renvoie (pas de labels, pas d'attestation de provenance).

- **Docker Hub (recommandé pour rester discret)** : crée un compte / une organisation Docker Hub au nom de ton choix, puis dans le dépôt : variable `IMAGE_NAME` = `nom/vf-trailers`, secrets `DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN` (jeton d'accès en lecture/écriture). Le dépôt d'images Docker Hub est public par défaut.
- **GHCR (par défaut)** : sans configuration, l'image est publiée sur `ghcr.io/<propriétaire>/<dépôt>`. Le nom de l'image contient alors ton identifiant GitHub, et le paquet doit être passé en *Public* à la main (une seule fois).

## Sources de données

TMDB (principal) · Allociné (repli) · YouTube (recherche). Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
