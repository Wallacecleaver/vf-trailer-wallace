# Bandes-Annonces VF — addon Stremio

Addon [Stremio](https://www.stremio.com/) qui affiche la **bande-annonce officielle française** (et le teaser quand il existe) de n'importe quel film ou série, directement dans la fiche du titre.

- **Sources** : TMDB → Allociné → recherche YouTube (en repli), avec détection VF par liste blanche.
- **Stremio** : teaser (si dispo) puis bande-annonce. Compatible avec l'option « A trailer addon » d'**AIOMetadata** (mode `aiom` : un seul lien `ytId`/`url`, avec délai maximum réglable).
- **Dashboard d'administration** : stats, utilisateurs, mapping manuel des liens, journal des échecs, test des flux, logs, réglages, cache…
- **Pages publiques** : configuration de l'addon (`/`), proposition de liens par la communauté (`/proposer`).

Tout tourne sur ton serveur (VPS, Raspberry Pi, NAS…), avec Docker.

---

## 🏠 Installation (Docker)

Tout tourne chez toi : l'addon + sa base Postgres, dans deux conteneurs. Aucun compte externe requis.

### Prérequis

- Un serveur / VPS / Raspberry Pi 64 bits avec [Docker](https://docs.docker.com/engine/install/) et le plugin Compose (`docker compose version`).
- Une clé API TMDB gratuite : <https://www.themoviedb.org/settings/api>.
- Pour Stremio **hors de chez toi**, un nom de domaine en HTTPS (Stremio refuse les addons HTTP distants). Un sous-domaine gratuit DuckDNS fait très bien l'affaire.

### Installation en une commande (rien à cloner)

```bash
curl -fsSL https://raw.githubusercontent.com/Wallacecleaver/vf-trailer-wallace/main/install.sh | bash
```

Le script télécharge l'image Docker toute faite (`ghcr.io/wallacecleaver/vf-trailer-wallace`, compatible amd64 et arm64) et te pose quelques questions :

1. **Ton nom de domaine** pour le HTTPS automatique (facultatif).
2. **Ta clé TMDB** (facultatif).
3. **Ton mot de passe du dashboard** : tu le choisis (8 caractères minimum, saisi masqué et confirmé), ou tu appuies sur Entrée pour en générer un.
4. **Le port** d'écoute (sans domaine seulement, `3000` par défaut).

Le mot de passe de la base Postgres, lui, est généré automatiquement : il reste interne à Docker, tu n'as jamais à le connaître.

Il crée le dossier `vf-trailers/` (avec `docker-compose.yml`, `Caddyfile` et `.env`), démarre l'addon + la base, puis t'affiche les adresses. **Relançable sans risque** : un `.env` existant est conservé (supprime-le pour refaire la configuration).

Pour une installation sans aucune question, passe les réponses en variables :

```bash
DOMAIN=trailers.mondomaine.fr TMDB_API_KEY=xxxx DASHBOARD_PASSWORD='mon-mot-de-passe' \
  bash <(curl -fsSL https://raw.githubusercontent.com/Wallacecleaver/vf-trailer-wallace/main/install.sh)
```

<details>
<summary>Installation manuelle (sans le script)</summary>

Dans un dossier vide, récupère `docker-compose.yml`, `Caddyfile` et `.env.example` depuis le dépôt, puis :

```bash
cp .env.example .env
nano .env        # remplis au minimum DASHBOARD_PASSWORD, POSTGRES_PASSWORD, APP_BASE_URL
docker compose up -d
docker compose logs -f app     # doit afficher « Addon démarré sur http://0.0.0.0:3000 »
```
</details>

<details>
<summary>Construire l'image toi-même (développement)</summary>

```bash
git clone https://github.com/Wallacecleaver/vf-trailer-wallace.git
cd vf-trailer-wallace
./install.sh                      # construit l'image localement au lieu de la télécharger
# ou, à la main :  docker compose up -d --build
```
</details>

L'addon répond alors sur `http://IP_DU_SERVEUR:3000` :

| Adresse | Rôle |
|---|---|
| `/` | Page de configuration (chaque utilisateur y met sa clé TMDB et obtient son lien d'installation) |
| `/dashboard` | Dashboard admin (mot de passe = `DASHBOARD_PASSWORD`) |
| `/proposer` | Proposition de liens par la communauté |

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
   docker compose --profile https up -d
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
| `TRUST_PROXY` | non | `0` si l'addon est exposé directement sur Internet (ignore `X-Forwarded-For`). `install.sh` le règle selon ton choix. |
| `DASHBOARD_NO_CACHE` | non | `1` pour désactiver le cache de rendu du dashboard pendant que tu le modifies. |

### Ressources utilisées (très légères)

Mesures réelles sur la version actuelle :

| | Au repos | Sous charge (≈ 110 requêtes/s, écritures en base) |
|---|---|---|
| **Addon (Node.js)** | ≈ 85 Mo de RAM, ≈ 0,7 % d'un cœur | ≈ 110 Mo de RAM |
| **Postgres (réglé léger)** | ≈ 10 à 20 Mo de RAM | quelques dizaines de Mo |

Un usage Stremio normal est de l'ordre de quelques requêtes par minute : le CPU reste quasi à zéro. Ce qui est déjà en place pour que ça reste ainsi :

- Postgres est réglé pour les petites machines (`shared_buffers=24MB`, 25 connexions max, pas de parallélisme) au lieu de la config par défaut, bien plus gourmande.
- Plafonds Docker : **256 Mo** pour l'addon, **192 Mo** pour Postgres, **0,5 cœur** chacun. Tourne sans souci sur un Raspberry Pi ou le plus petit VPS.
- Mémoire Node plafonnée (`--max-old-space-size=128`) et pool de connexions limité à 5.
- Les journaux Docker sont limités à 3 × 10 Mo par conteneur (le disque ne se remplit pas).
- Les journaux de l'appli (500 lignes), les échecs (50 titres) et les résolutions (1 h) sont bornés ; les entrées de cache expirées sont purgées toutes les 6 h.
- Aucun processus en tâche de fond : l'addon ne fait rien tant que personne ne lui demande une bande-annonce.

Si tu veux changer les plafonds, modifie `mem_limit` et `cpus` dans `docker-compose.yml`.

### Maintenance

```bash
# Mettre à jour (télécharge la dernière image publiée)
docker compose pull
docker compose up -d                # (ajoute --profile https avant « pull » et « up » si tu utilises Caddy)

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
npm start          # (= node selfhost/server.js) crée les tables au premier lancement
```

Pour le garder en service, utilise par exemple `systemd` ou `pm2 start selfhost/server.js --name vf-trailers`.

### Importer des données depuis un autre Postgres

Si tu as déjà des données (mapping, réglages, stats) sur une autre base Postgres :

```bash
# Export depuis l'ancienne base (remplace l'URL)
pg_dump --data-only --no-owner "postgres://utilisateur:motdepasse@ancien-hote/base" > donnees.sql

# Démarre d'abord la stack (elle crée les tables), puis importe
docker compose exec -T db psql -U vf vf < donnees.sql
```

Si l'import signale des doublons sur les lignes de réglages (`id = 1`), c'est sans gravité : vide d'abord ces tables avec
`TRUNCATE configure_settings, behavior_settings, request_stats_global;` avant d'importer.
Pense ensuite à mettre à jour `APP_BASE_URL` et à réinstaller l'addon dans Stremio avec la nouvelle adresse.

### Dépannage

| Symptôme | Piste |
|---|---|
| `Postgres pas encore prêt` dans les logs | Normal au tout premier démarrage (quelques secondes) ; l'addon réessaie tout seul. |
| Le dashboard refuse le mot de passe / « non configuré » | `DASHBOARD_PASSWORD` absent de `.env`. Après modification : `docker compose up -d`. |
| Stremio refuse d'installer l'addon | Stremio exige du **HTTPS** pour les addons distants : utilise le profil `https` ou un reverse proxy. |
| `pull access denied` / image introuvable au téléchargement | L'image n'est pas encore publique ou pas encore construite : vérifie l'onglet *Actions* du dépôt, puis que le paquet GHCR est en visibilité **Public**. En attendant, clone le dépôt et lance `./install.sh` (construction locale). |
| Le logo ou les liens pointent vers un mauvais domaine | `APP_BASE_URL` mal renseignée. |
| `password authentication failed` | `POSTGRES_PASSWORD` modifié après la création du volume : remets l'ancienne valeur, ou change le mot de passe dans Postgres (`ALTER USER vf PASSWORD '...'`), ou repars de zéro avec `docker compose down -v` (⚠️ efface les données). |

---

## 🧱 Structure du projet

```
api/index.js        Application Express (routes Stremio, API, pages)
selfhost/server.js  Point d'entrée self-host (écoute un port, applique schema.sql, sert public/)
schema.sql          Schéma Postgres complet (idempotent)
lib/                Modules : db, cache, matching des titres, Allociné, YouTube, stats, réglages…
dashboard/          Dashboard découpé en vrais fichiers HTML / CSS / JS (voir dashboard/README.md)
public/             Fichiers statiques (logo)
test/               Tests unitaires
install.sh, Dockerfile, docker-compose.yml, Caddyfile, .env.example   Installation / Docker
.github/workflows/docker.yml   Publication automatique de l'image sur GHCR
```

Toute la persistance (cache, réglages, stats, logs, mapping) est dans Postgres.

### Modifier le dashboard

Chaque page a son HTML et son JS : tout est expliqué dans [`dashboard/README.md`](dashboard/README.md). Pendant tes modifications, mets `DASHBOARD_NO_CACHE=1` pour voir les changements sans redémarrer le cache de rendu.

### Tests

```bash
npm install
npm test
```

---

## 📦 Publication de l'image (mainteneur)

Chaque push sur `main` déclenche `.github/workflows/docker.yml` : tests, puis construction (amd64 + arm64) et publication sur `ghcr.io/wallacecleaver/vf-trailer-wallace` (tags `latest`, numéro de version `vX.Y.Z` et `sha`). Aucun secret à ajouter.

**Une seule fois**, après le premier build : GitHub → ton profil → *Packages* → `vf-trailer-wallace` → *Package settings* → *Change visibility* → **Public**, pour que tout le monde puisse télécharger l'image sans se connecter.

## Sources de données

TMDB (principal) · Allociné (repli) · YouTube (recherche en dernier recours). Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
