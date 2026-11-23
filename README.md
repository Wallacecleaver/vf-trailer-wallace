# Bandes-Annonces VF — addon Stremio

Addon [Stremio](https://www.stremio.com/) qui affiche la **bande-annonce officielle française** (et le teaser quand il existe) de n'importe quel film ou série, directement dans la fiche du titre. Il s'auto-héberge en un seul conteneur Docker (VPS, Raspberry Pi, NAS…), avec une base SQLite intégrée : aucun compte externe requis.

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Comment une bande-annonce est choisie](#comment-une-bande-annonce-est-choisie)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Dashboard d'administration](#dashboard-dadministration)
6. [AIOMetadata](#aiometadata)
7. [Nuvio et Odin](#nuvio-et-odin)
8. [Stockage BD (optionnel)](#stockage-bd-optionnel)
9. [Exploitation](#exploitation)
10. [Développement](#développement)
11. [Sources de données](#sources-de-données)

---

## Fonctionnalités

- **VF stricte** : seules les vidéos reconnues comme françaises sont proposées (langue TMDB + nom de la vidéo, voir plus bas).
- **Plusieurs sources en cascade** : TMDB, TheTVDB, AniList (animés), recherche YouTube VF, Allociné, puis une instance Stockage BD.
- **Teaser puis bande-annonce** dans Stremio, avec options d'extras, de teasers et de nombre de liens.
- **Mode AIOMetadata** : un seul lien (`ytId` ou `url`), avec un manifest partagé et un délai maximum réglable.
- **Dashboard d'administration** : statistiques, utilisateurs, mapping manuel des liens, demandes de la communauté, test des flux, **test aléatoire en masse**, logs, réglages, cache.
- **Pages publiques** : configuration de l'addon (`/configure`) et proposition de liens par la communauté (`/proposer`).
- **Léger** : un seul processus Node, SQLite intégré, aucune tâche de fond.

## Comment une bande-annonce est choisie

Pour chaque titre demandé, l'addon applique cette chaîne et s'arrête à la première source qui donne un résultat :

1. **Override manuel** (mapping créé dans le dashboard), puis cache.
2. **TMDB** : vidéos du titre (ou de la saison pour une série).
3. **TheTVDB** : séries, saisons et films (si une clé est configurée).
4. **AniList** : identification des animés. Leurs trailers ne sont retenus que si YouTube confirme VF/VOSTFR.
5. **Recherche YouTube VF** (désactivable).
6. **Allociné** (désactivable).
7. **Stockage BD** (si une URL est configurée).

Le fournisseur Jikan n'est plus utilisé (l'API publique a été arrêtée le 1er octobre 2026).

### Filtre VF des vidéos TMDB

Chaque vidéo TMDB est jugée en croisant sa **langue** (`iso_639_1`) et son **nom** (`lib/tmdb-video-match.js`) :

| Règle | Effet |
|---|---|
| Signal de langue requis | La vidéo doit être taguée `fr` par TMDB **ou** contenir « VF », « VFF », « VFQ », « français », « doublage »… dans son nom. |
| Rejets immédiats | Nom avec VOST, sous-titres, une autre langue, ou un mot de réaction / critique / film complet ; mots-clés « pas VF » ajoutés dans les réglages. |
| Nom générique (« Bande-annonce officielle ») | Pas de comparaison de titre : TMDB a déjà rattaché la vidéo au bon film. |
| Nom avec un vrai titre (« Prada 2 - Bande-annonce ») | Le titre doit correspondre au film (anti-suite et anti-hors-sujet). |

Les mots-clés sont cherchés comme **mots entiers** (`lib/video-filters.js`) : « Substance » ne déclenche pas « sub », « Davis » ne déclenche pas « avis ».

### Matching strict et chaînes YouTube ciblées

Le matcher partagé (`lib/strict-title-match.js`) exige les mêmes mots significatifs et une année
compatible (±1 an si les deux années sont connues). Les titres de vidéos sont nettoyés pour comparer
le nom du film ou de la série : mentions de bande-annonce, chaînes et crédits sont séparés du titre.
« Lucky Luke » ne correspond donc plus à « Lucky », ni « My Happy Ending » à « Happy End ».
Les nombres qui font partie d’un titre, comme « 1917 » ou « Blade Runner 2049 », sont conservés.

La **recherche YouTube** exige une mention de bande-annonce (« bande-annonce », « trailer » ou « BA »)
et un signal VF dans le titre, avec exclusion de VO/VOSTFR, réactions et critiques.
Le ciblage utilise les identifiants des auteurs YouTube, pas leur seul nom affiché.

- Netflix, Apple TV, Prime Video, Disney+, HBO Max, Paramount+, Crunchyroll et MUBI : chaînes officielles répertoriées dans `lib/youtube-channels.js` en priorité.
- VOD : **FilmsActu**, puis **Allociné | Bandes Annonces** et **Warner Bros. France**.
- En l’absence de résultat officiel exploitable, les mêmes chaînes cinéma françaises servent de repli.
  Une plateforme sans chaîne répertoriée utilise également ce repli ; aucun nom de chaîne n’est deviné.

Si la recherche ciblée ne donne rien de valide, un second passage cherche le titre et la saison
sans imposer de chaîne dans la requête. Les mêmes contrôles de titre, de langue et de chaîne
s'appliquent aux résultats. Si rien ne convient, la résolution continue vers Allociné puis
Stockage BD selon les réglages. Le sélecteur YouTube manuel du dashboard reste non filtré.
Le cache utilise un nouveau périmètre de matching afin de ne pas resservir les anciens faux positifs ;
les anciennes entrées expirent normalement, sans purge des mappings ni des réglages.

---

## Installation

### Prérequis

- Un serveur 64 bits avec [Docker](https://docs.docker.com/engine/install/) et le plugin Compose (`docker compose version`).
- Une clé API TMDB gratuite : <https://www.themoviedb.org/settings/api>.
- TheTVDB est facultatif : une clé de projet côté serveur, ou une clé personnelle par utilisateur dans `/configure`.
- Pour installer l'addon dans Stremio **depuis un autre appareil** : un nom de domaine en HTTPS servi par ton reverse proxy (Stremio refuse les addons HTTP distants).

### Installation rapide (100 % Docker)

Tout est dans l'image Docker, installeur compris. Dans un dossier vide :

```bash
mkdir vf-trailers && cd vf-trailers
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/data <IMAGE> install
docker compose up -d
```

`<IMAGE>` est le nom de l'image publiée (par exemple `monnom/vf-trailers:latest`). L'installeur pose quelques questions puis écrit `docker-compose.yml` et `.env` :

1. **Nom de domaine** (facultatif), pour écrire l'adresse publique (`APP_BASE_URL`).
2. **Clé TMDB** (facultatif).
3. **Mot de passe du dashboard** : longueur libre, saisi masqué et confirmé, ou Entrée pour en générer un.
4. **Port d'écoute** (`3000` par défaut) et, sans domaine, l'adresse du serveur (`localhost` par défaut).

Si un `.env` existe déjà, l'installeur n'y touche pas. Pour un usage sans question (scripts), passe les réponses en variables : `-e DOMAIN=... -e TMDB_API_KEY=... -e DASHBOARD_PASSWORD='...'`.

<details>
<summary>Installation à la main (sans l'installeur)</summary>

Écris un `docker-compose.yml` à partir de `selfhost/deploy/compose.template.yml` (remplace `__IMAGE__` par le nom de l'image) et un `.env` d'après `.env.example`, puis `docker compose up -d`.
</details>

<details>
<summary>Construire l'image toi-même</summary>

```bash
docker build -t vf-trailers:local .
mkdir test-install && cd test-install
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/data vf-trailers:local install
docker compose up -d
```
</details>

### Déploiement depuis le dépôt (WDock, VPS, `git pull`)

- **WDock** : crée le projet depuis le repo GitHub (port `3000`), ajoute `DASHBOARD_PASSWORD`, `APP_BASE_URL` (avec `https://`) et `TMDB_API_KEY`, et monte un volume persistant sur `/data`.
- **VPS en direct** : `cp .env.example .env`, remplis-le, puis `docker compose up -d --build`. Mise à jour : `git pull && docker compose up -d --build` (le volume `data` n'est jamais touché).

> **`/data` doit être un volume persistant.** La base SQLite (`/data/addon.sqlite`) contient réglages, mapping, stats et logs.

### Sans Docker

Node.js 22.13 ou plus récent (SQLite est intégré) :

```bash
npm install
export DATA_DIR=./data
export DASHBOARD_PASSWORD=...
export APP_BASE_URL=http://localhost:3000
export TMDB_API_KEY=...
npm start          # = node selfhost/server.js ; crée la base et les tables au premier lancement
```

Pour le garder en service : `systemd` ou `pm2 start selfhost/server.js --name vf-trailers`.

### HTTPS

L'addon écoute en HTTP. Mets devant lui ton reverse proxy habituel (Nginx, Traefik, Nginx Proxy Manager, Caddy…). Si le proxy tourne sur la même machine, garde `BIND_ADDRESS=127.0.0.1` pour ne pas exposer le port directement.

### Installer dans Stremio

Ouvre `APP_BASE_URL` dans ton navigateur (page `/configure`), renseigne ta clé TMDB, puis clique sur **Installer dans Stremio** (ou copie le lien).

| Adresse | Rôle |
|---|---|
| `/configure` (et `/`) | Configuration de l'addon par chaque utilisateur |
| `/dashboard` | Dashboard admin (mot de passe = `DASHBOARD_PASSWORD`) |
| `/proposer` | Proposition de liens par la communauté |

---

## Configuration

### Variables d'environnement

| Variable | Obligatoire | Description |
|---|:--:|---|
| `DASHBOARD_PASSWORD` | ✅ | Mot de passe du dashboard (longueur libre, non vide). La connexion est refusée s'il est absent. |
| `APP_BASE_URL` | ✅ | URL publique de l'addon, sans slash final (logo, liens `/proposer`…). |
| `TMDB_API_KEY` | conseillé | Clé TMDB du testeur admin, du test aléatoire et du lien AIOMetadata partagé. |
| `TVDB_API_KEY` | non | Clé de projet TheTVDB v4 partagée par défaut ; une clé personnelle sans PIN peut la remplacer dans `/configure`. |
| `TOKEN_SECRET` | non | Secret de signature des sessions. Absent : une clé aléatoire est créée dans `DATA_DIR/dashboard-session-secret` et conservée. |
| `SESSION_VERSION` | non | Changer cette valeur révoque immédiatement toutes les sessions du dashboard. |
| `BIND_ADDRESS` | non | `127.0.0.1` (défaut) pour ne pas exposer le port sur Internet. |
| `HOST_PORT` | non | Port exposé sur la machine (défaut `3000`). |
| `DATA_DIR` | non | Dossier de la base SQLite (défaut `/data` dans l'image : à monter en volume). |
| `TRUST_PROXY` | non | Nombre de reverse proxies de confiance (`0` par défaut). À `1` seulement derrière un proxy de confiance, sinon l'anti brute-force est contournable. L'installeur le règle seul. |
| `ALLOW_PRIVATE_UPSTREAM` | non | `1` pour autoriser une instance Stockage BD sur une adresse privée (réseau Docker). Désactivé par défaut (anti-SSRF). |
| `NETFLIX_CATALOGUE_URL` / `NETFLIX_CATALOGUE_KEY` | non | Instance Stockage BD (voir plus bas). Réglable aussi dans le dashboard. |
| `DASHBOARD_NO_CACHE` | non | `1` pour relire le dashboard à chaque requête pendant que tu le modifies. |

Les sessions du dashboard durent 30 jours et sont renouvelées automatiquement pendant l'utilisation (et tant que l'onglet reste ouvert) ; une panne réseau ou un redéploiement ne déconnecte pas l'utilisateur.

> **Sécurité — identifiants dans le lien d'installation.** La configuration utilisateur (clé TMDB, éventuellement clé TheTVDB) est encodée en base64 dans l'URL `/<config>/manifest.json`. Le base64 n'est pas du chiffrement : ne partage pas ce lien publiquement. Il peut apparaître dans l'historique du navigateur ou les journaux d'un proxy.

### Réglages du dashboard

Dashboard → **Réglages** : interrupteur YouTube, repli Allociné, repli recherche YouTube, nombre de bandes-annonces, teasers, extras, langue (`fr-first` par défaut, ou `fr-only` pour ne demander que les vidéos françaises), mots-clés « pas VF », durée du cache, délai AIOMetadata.

Quand l'interrupteur **YouTube** est coupé, les vidéos YouTube de TMDB et la recherche YouTube sont ignorées : la chaîne devient Allociné → Stockage BD (liens directs). Les overrides avec un ID YouTube restent appliqués.

---

## Dashboard d'administration

Accessible sur `/dashboard`. Chaque page a son HTML et son JS (voir [`dashboard/README.md`](dashboard/README.md)).

| Page | Rôle |
|---|---|
| Vue d'ensemble | Statistiques de requêtes, état des services, cache |
| Utilisateurs | Installations et activité |
| Page Configure | Maintenance de la page de configuration |
| Logs | Journal de l'application (500 lignes) |
| Mapping des liens | Overrides manuels, journal des échecs et des résolutions |
| Demandes | Propositions de la communauté à accepter ou refuser |
| **Test des flux** | Test d'un titre, et **test aléatoire en masse** |
| Réglages | Comportement de la résolution, diagnostics |
| AIOM | Lien partagé AIOMetadata et statistiques |

### Test des flux

Simule la résolution d'un film ou d'une série avec les réglages actuels et affiche la **trace** étape par étape (TMDB, filtre des vidéos, repli…), l'aperçu tel qu'il apparaît dans Stremio, et permet de créer un override en un clic. Un test ne touche ni au cache, ni aux stats, ni aux logs.

### Test aléatoire en masse

Carte « 🎲 Test aléatoire en masse », en bas de **Test des flux**. Elle tire au hasard 25, 50, 100 ou 200 films et/ou séries sur TMDB, passe chacun dans la vraie chaîne de résolution (4 en parallèle) et affiche :

- le pourcentage de bandes-annonces trouvées, les titres sans résultat, les erreurs, le temps moyen ;
- la réussite par type (films / séries) et la répartition par source ;
- la liste des titres sans bande-annonce, avec la raison et un bouton pour les rouvrir dans le testeur ;
- la liste des titres où **TMDB avait une vidéo mais où le filtre VF l'a rejetée** (utile pour régler le filtre) ;
- un export JSON.

Options : type (films, séries ou les deux), échantillon (« populaires » : top 500 ; « large » : top 2000), et « ignorer les overrides » pour tester la chaîne automatique seule. Nécessite `TMDB_API_KEY` côté serveur.

---

## AIOMetadata

Partage `https://ton-domaine/aiom/manifest.json` comme **A trailer addon** dans **AIOMetadata → Meta Providers → Trailers**. Le dashboard propose ce lien dans **AIOM**.

- Il utilise la clé **`TMDB_API_KEY` du serveur** : aucune clé dans le lien ni dans le manifest. Sans clé serveur, les streams répondent `{ "streams": [] }` et AIOMetadata garde son propre trailer.
- Le manifest ne déclare que la ressource `stream`, pour les films et séries. Une seule bande-annonce (YouTube ou vidéo directe) est renvoyée, sans lien externe ni bouton Proposer.
- Le délai maximum est réglable dans **Réglages → AIOMetadata** (1 à 12 s, 5 par défaut). La recherche continue en arrière-plan après un timeout.
- Les manifests classiques et les anciens liens avec configuration gardent leur comportement.

---

## Nuvio et Odin

Le manifest `https://ton-domaine/direct/manifest.json` fournit une bande-annonce VF en MP4 ou HLS (`.m3u8`) selon les sources disponibles. Il reprend le format `meta.links` de [Trailerio Lite](https://github.com/emreyild/trailerio-lite/blob/main/src/index.js) et fournit aussi une URL vidéo dans la ressource `stream`.

- **Nuvio** : ajoute le manifest dans les addons pour retrouver le flux de bande-annonce parmi les flux du titre. Pour l'utiliser comme source du bouton de bande-annonce avec AIOMetadata, ajoute le même manifest dans **Meta Providers → Trailers → A trailer addon**.
- **Odin** : ajoute le manifest comme source de bandes-annonces dans AIOMetadata, puis connecte Odin à [l'interface Jellyfin d'AIOMetadata](https://github.com/cedya77/aiometadata/blob/dev/docs/jellyfin.md) avec l'adresse et les identifiants fournis par AIOMetadata.

Le mode direct utilise les liens vidéo du mapping manuel, puis Stockage BD si configuré, puis Allociné si activé. Renseigne `TMDB_API_KEY` côté serveur pour la recherche Allociné. Si aucune vidéo VF directe n'est disponible, le manifest ne propose aucun flux pour le titre.

---

## Stockage BD (optionnel)

Si tu fais tourner une instance de l'addon **Stockage BD**, l'addon peut lui demander ses bandes-annonces par API : colle son URL (et sa clé si elle en a une) dans **Réglages → API Stockage BD**, ou dans le `.env` :

```env
NETFLIX_CATALOGUE_URL=https://netflix.mondomaine.fr
NETFLIX_CATALOGUE_KEY=la-cle-generee-sur-l-instance
```

- La clé se génère sur l'instance amont : **Paramètres → API de fédération → Générer une clé**. Elle est envoyée en en-tête `x-api-key`. Laisse-la vide si l'instance amont a `API_KEY` vide.
- Les noms techniques des variables et réglages gardent « netflix » pour rester compatibles avec les installations existantes.
- La source est aussi interrogée quand TMDB ne connaît pas du tout le titre. Les URLs renvoyées sont des vidéos directes (relais `/trailer/...`).
- Un résultat est gardé 6 h en mémoire ; un échec est retenté au bout de 30 min.
- Le bouton **Tester** et le diagnostic de la page Réglages vérifient la connexion (`GET /api/status`).

---

## Exploitation

### Maintenance

```bash
docker compose pull && docker compose up -d     # mettre à jour (image publiée)
docker compose logs -f app                      # logs
docker compose restart app                      # redémarrer
docker compose down                             # arrêter (les données sont conservées)
```

### Sauvegarde et restauration

```bash
# Sauvegarde cohérente, même pendant que l'addon tourne
docker compose exec app node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/addon.sqlite').exec(\"VACUUM INTO '/data/sauvegarde.sqlite'\")"
docker compose cp app:/data/sauvegarde.sqlite ./sauvegarde.sqlite

# Restauration
docker compose stop app
docker compose cp ./sauvegarde.sqlite app:/data/addon.sqlite
docker compose start app
```

> ⚠️ `docker compose down -v` supprime aussi le volume : **toutes les données** (mapping, réglages, stats) seraient perdues.

Le schéma ([`schema.sql`](schema.sql)) est appliqué automatiquement à chaque démarrage ; il est idempotent et ne touche jamais aux données existantes.

### Ressources

Mesures faites avant le passage à SQLite (à re-mesurer) : environ 85 Mo de RAM et 0,7 % d'un cœur au repos, 110 Mo sous ≈ 110 requêtes/s.

- SQLite tourne dans le processus de l'addon : cache de 2 Mo, journal WAL borné à 4 Mo.
- Plafonds Docker : **256 Mo** et **0,5 cœur** (modifiables via `mem_limit` et `cpus`). Tourne sur un Raspberry Pi.
- Journaux Docker limités à 3 × 10 Mo ; journaux applicatifs (500 lignes), échecs (50 titres) et résolutions (1 h) bornés ; cache expiré purgé toutes les 6 h.
- Aucune tâche de fond : l'addon ne fait rien tant que personne ne demande de bande-annonce.

### Dépannage

| Symptôme | Piste |
|---|---|
| `Impossible d'ouvrir la base` dans les logs | `DATA_DIR` n'existe pas ou n'est pas inscriptible : vérifie le volume monté sur `/data`. |
| Le dashboard refuse le mot de passe / « non configuré » | `DASHBOARD_PASSWORD` absent du `.env`. Après modification : `docker compose up -d`. |
| Stremio refuse d'installer l'addon | Stremio exige du **HTTPS** pour les addons distants : mets un reverse proxy HTTPS devant. |
| `pull access denied` / image introuvable | L'image n'est pas encore publiée ou pas publique : vérifie la CI, puis la visibilité du dépôt d'images. |
| Logo ou liens vers un mauvais domaine | `APP_BASE_URL` mal renseignée. |
| Une bande-annonce VF existe sur TMDB mais l'addon cherche ailleurs | Lance le titre dans **Test des flux** et lis la ligne « TMDB vidéos » de la trace : `0/n retenue(s)` veut dire que le filtre VF a rejeté la vidéo (langue ou nom, voir [le filtre](#filtre-vf-des-vidéos-tmdb)). |

---

## Développement

### Structure du projet

```
api/index.js          Application Express : assemble les routes sur les modules
selfhost/             Point d'entrée self-host (server.js), installeur (install.js), modèle compose
routes/               stremio.js (manifest, meta, stream) · dashboard.js (API admin) ·
                      public.js (API publiques) · pages.js (pages HTML) · lookups.js
lib/                  Modules : resolver.js, resolve-apis.js (chaîne de résolution), tmdb.js,
                      tmdb-video-match.js + video-filters.js + title-match.js (filtre VF),
                      random-titles.js (test aléatoire), allocine.js, tvdb.js, anime-sources.js,
                      youtube-search.js, netflix-federation.js, db.js, cache.js, settings.js, stats.js…
dashboard/            Dashboard en vrais fichiers HTML / CSS / JS (voir dashboard/README.md)
public/               Fichiers statiques (logo)
schema.sql            Schéma SQLite complet (idempotent)
test/                 Tests unitaires (node:test)
.github/workflows/    Publication automatique de l'image Docker
```

Toute la persistance (cache, réglages, stats, logs, mapping) est dans `DATA_DIR/addon.sqlite`.

### Tests

```bash
npm install
npm test
```

### Modifier le dashboard

Mets `DASHBOARD_NO_CACHE=1` pour voir tes changements sans redémarrer. La correspondance page ↔ fichiers est dans [`dashboard/README.md`](dashboard/README.md).

### Publication de l'image (mainteneur)

Chaque push sur `main` déclenche `.github/workflows/docker.yml` : tests, puis construction (amd64 + arm64) et publication de l'image (tags `latest`, `vX.Y.Z` et `sha`). L'image embarque l'installeur et aucune étiquette qui renvoie au dépôt.

- **Docker Hub** : variable `IMAGE_NAME` = `nom/vf-trailers`, secrets `DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN`. Le dépôt d'images est public par défaut.
- **GHCR (par défaut)** : sans configuration, l'image va sur `ghcr.io/<propriétaire>/<dépôt>` ; le paquet doit être passé en *Public* à la main, une seule fois.

---

## Sources de données

TMDB (principal) · TheTVDB (séries et saisons) · AniList (identification des animés) · YouTube (recherche VF) · Allociné (repli) · instance Stockage BD (optionnelle).

Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
