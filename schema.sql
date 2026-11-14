-- ============================================================
-- Schéma SQLite de l'addon Bandes-Annonces VF
-- Idempotent : peut être relancé sans risque (IF NOT EXISTS partout).
--
-- Appliqué automatiquement à chaque démarrage de l'addon (selfhost/server.js).
--
-- Types : les dates sont du texte ISO 8601 UTC (triable comme du texte), les booléens des
-- entiers 0/1, le JSON du texte.
-- Pour ajouter une colonne plus tard : ALTER TABLE ... ADD COLUMN dans lib/migrate.js (SQLite ne
-- sait pas faire « ADD COLUMN IF NOT EXISTS »).
-- ============================================================

-- Cache clé/valeur avec expiration (résultats TMDB / Allociné / YouTube)
-- value = JSON ; expires_at = millisecondes depuis 1970 (Date.now()).
CREATE TABLE IF NOT EXISTS kv_cache (
    cache_key  TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kv_cache_expires_idx ON kv_cache (expires_at);

-- Installations de l'addon (une ligne par config) + activité quotidienne
CREATE TABLE IF NOT EXISTS installs (
    id            TEXT PRIMARY KEY,
    pseudo        TEXT,
    first_seen    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_seen     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    request_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS install_activity (
    install_id TEXT NOT NULL,
    day        TEXT NOT NULL,
    PRIMARY KEY (install_id, day)
);

-- Journal d'événements du dashboard (borné à ~500 lignes par l'appli)
CREATE TABLE IF NOT EXISTS event_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    level      TEXT NOT NULL DEFAULT 'info',
    context    TEXT NOT NULL DEFAULT 'SYSTEM',
    event      TEXT NOT NULL DEFAULT 'generic',
    message    TEXT NOT NULL DEFAULT '',
    meta       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS event_logs_created_idx ON event_logs (created_at DESC);

-- Mapping manuel IMDB -> bande-annonce forcée (season 0 = pas de saison précise)
CREATE TABLE IF NOT EXISTS overrides (
    imdb_id        TEXT NOT NULL,
    season         INTEGER NOT NULL DEFAULT 0,
    yt_id          TEXT,
    url            TEXT,
    links          TEXT NOT NULL DEFAULT '[]',
    title          TEXT,
    media_type     TEXT,
    hidden         INTEGER NOT NULL DEFAULT 0,
    notes          TEXT,
    contributed_by TEXT,
    uses           INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (imdb_id, season)
);

-- Titres pour lesquels aucune bande-annonce n'a été trouvée
CREATE TABLE IF NOT EXISTS failed_log (
    imdb_id      TEXT NOT NULL,
    season       INTEGER NOT NULL DEFAULT 0,
    type         TEXT,
    title        TEXT,
    fail_count   INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (imdb_id, season)
);

-- Dernières résolutions réussies (conservées 1 h)
CREATE TABLE IF NOT EXISTS resolved_log (
    imdb_id    TEXT NOT NULL,
    season     INTEGER NOT NULL DEFAULT 0,
    type       TEXT,
    title      TEXT,
    source     TEXT,
    streams    TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (imdb_id, season)
);

-- Propositions communautaires (page publique /proposer)
CREATE TABLE IF NOT EXISTS contributions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    imdb_id     TEXT NOT NULL,
    season      INTEGER,
    title       TEXT,
    media_type  TEXT,
    yt_id       TEXT,
    url         TEXT,
    pseudo      TEXT NOT NULL,
    notes       TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    reviewed_at TEXT
);

-- Statistiques de requêtes
CREATE TABLE IF NOT EXISTS request_stats_global (
    id    INTEGER PRIMARY KEY,
    total INTEGER NOT NULL DEFAULT 0
);
INSERT INTO request_stats_global (id, total) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS request_stats_daily (
    day   TEXT PRIMARY KEY,
    total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS request_stats_type (
    type  TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS request_stats_top_titles (
    title   TEXT NOT NULL,
    imdb_id TEXT NOT NULL DEFAULT '',
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (title, imdb_id)
);

-- Suivi des requêtes AIOMetadata
CREATE TABLE IF NOT EXISTS aiom_stats (
    day        TEXT NOT NULL,
    outcome    TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    total_ms   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, outcome)
);

-- Réglages du dashboard : une seule ligne (id = 1) par table.
-- NULL = « valeur par défaut du code » (voir DEFAULT_CONFIGURE / DEFAULT_BEHAVIOR dans lib/settings.js).
CREATE TABLE IF NOT EXISTS configure_settings (
    id                    INTEGER PRIMARY KEY,
    brand_name            TEXT,
    nav_link_text         TEXT,
    nav_link_url          TEXT,
    hero_title_white      TEXT,
    hero_title_red        TEXT,
    hero_subtitle         TEXT,
    accent_color          TEXT,
    section_config_label  TEXT,
    section_profile_label TEXT,
    section_links_label   TEXT,
    tmdb_key_hint         TEXT,
    pseudo_hint           TEXT,
    external_toggle_title TEXT,
    external_toggle_desc  TEXT,
    max_links_label       TEXT,
    max_links_hint        TEXT,
    extras_select_label   TEXT,
    extras_select_hint    TEXT,
    language_select_label TEXT,
    language_select_hint  TEXT,
    install_app_label     TEXT,
    install_web_label     TEXT,
    install_copy_label    TEXT,
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO configure_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS behavior_settings (
    id                             INTEGER PRIMARY KEY,
    allocine_fallback              INTEGER,
    youtube_search_fallback        INTEGER,
    netflix_federation             INTEGER,
    netflix_fallback               INTEGER,
    max_trailers                   INTEGER,
    extra_vf_keywords              TEXT,    -- JSON : ["mot", ...]
    ignore_teasers                 INTEGER,
    include_extras                 INTEGER,
    language_mode                  TEXT,
    trailer_language               TEXT,
    cache_enabled                  INTEGER,
    cache_ttl_hours                REAL,
    allocine_cache_ttl_hours       REAL,
    youtube_search_cache_ttl_hours REAL,
    cache_failures                 INTEGER,
    failure_cache_ttl_minutes      REAL,
    aiom_timeout_seconds           INTEGER,
    updated_at                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO behavior_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Catalogue local des titres Netflix (ID Netflix <-> IMDB / TMDB), rempli par Wikidata puis TMDB.
-- Permet de retrouver l'ID Netflix depuis l'IMDB ID sans interroger Wikidata à chaque requête.
CREATE TABLE IF NOT EXISTS netflix_titles (
    nid                TEXT PRIMARY KEY,
    title              TEXT,
    year               INTEGER,
    type               TEXT,                 -- 'movie' | 'tv'
    tmdb_id            INTEGER,
    imdb_id            TEXT,
    source             TEXT NOT NULL DEFAULT 'manual',  -- wikidata | tmdb | manual
    last_seen          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    trailer_checked_at TEXT,
    raw                TEXT,                 -- JSON : métadonnées brutes de la source
    -- Exploration en arrière-plan (lib/netflix-crawler.js) : NULL = à explorer, 'done' | 'missing' (404) | 'noinfo' | 'error'
    crawl_status       TEXT,
    crawl_attempts     INTEGER NOT NULL DEFAULT 0,
    crawled_at         TEXT,
    discovered_from    TEXT,                 -- ID Netflix de la page où cet ID a été découvert
    has_trailer        INTEGER,              -- 1 = la page Netflix expose une bande-annonce, 0 = aucune, NULL = pas encore lue
    link_status        TEXT,                 -- vérification du lien IMDB/TMDB : ok | weak | mismatch | unknown (NULL = pas vérifié)
    served_count       INTEGER NOT NULL DEFAULT 0,  -- fois où la bande-annonce a été proposée à Stremio/AIOMetadata
    played_count       INTEGER NOT NULL DEFAULT 0,  -- fois où la vidéo a été relayée (/nf/<id>.mp4)
    last_served_at     TEXT
);
CREATE INDEX IF NOT EXISTS netflix_titles_imdb_idx ON netflix_titles (imdb_id);
CREATE INDEX IF NOT EXISTS netflix_titles_tmdb_idx ON netflix_titles (tmdb_id, type);

-- Titres vus par TMDB comme disponibles sur Netflix France (discover, fournisseur Netflix).
-- nid_checked_at : dernière tentative de retrouver l'ID Netflix (Wikidata) ; réessayée après quelques jours.
CREATE TABLE IF NOT EXISTS netflix_tmdb_seen (
    tmdb_id        INTEGER NOT NULL,
    type           TEXT NOT NULL,            -- 'movie' | 'tv'
    imdb_id        TEXT,
    title          TEXT,
    year           INTEGER,
    first_seen     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_seen      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    nid_checked_at TEXT,
    imdb_checked_at TEXT,                    -- dernière tentative de retrouver l'IMDB ID chez TMDB
    PRIMARY KEY (tmdb_id, type)
);

-- État persistant de l'exploration Netflix (activée ou non, cadence, pause après un blocage).
CREATE TABLE IF NOT EXISTS netflix_crawl_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);
