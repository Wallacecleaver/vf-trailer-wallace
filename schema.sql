-- ============================================================
-- Schéma Postgres de l'addon Bandes-Annonces VF
-- Idempotent : peut être relancé sans risque (IF NOT EXISTS partout).
--
-- Appliqué automatiquement à chaque démarrage de l'addon (selfhost/server.js).
-- ============================================================

-- Cache clé/valeur avec expiration (résultats TMDB / Allociné / YouTube)
CREATE TABLE IF NOT EXISTS kv_cache (
    cache_key  text PRIMARY KEY,
    value      jsonb NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS kv_cache_expires_idx ON kv_cache (expires_at);

-- Installations de l'addon (une ligne par config) + activité quotidienne
CREATE TABLE IF NOT EXISTS installs (
    id            text PRIMARY KEY,
    pseudo        text,
    first_seen    timestamptz NOT NULL DEFAULT now(),
    last_seen     timestamptz NOT NULL DEFAULT now(),
    request_count integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS install_activity (
    install_id text NOT NULL,
    day        date NOT NULL,
    PRIMARY KEY (install_id, day)
);

-- Journal d'événements du dashboard (borné à ~500 lignes par l'appli)
CREATE TABLE IF NOT EXISTS event_logs (
    id         bigserial PRIMARY KEY,
    level      text NOT NULL DEFAULT 'info',
    context    text NOT NULL DEFAULT 'SYSTEM',
    event      text NOT NULL DEFAULT 'generic',
    message    text NOT NULL DEFAULT '',
    meta       jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_logs_created_idx ON event_logs (created_at DESC);

-- Mapping manuel IMDB -> bande-annonce forcée (season 0 = pas de saison précise)
CREATE TABLE IF NOT EXISTS overrides (
    imdb_id        text NOT NULL,
    season         integer NOT NULL DEFAULT 0,
    yt_id          text,
    url            text,
    links          jsonb NOT NULL DEFAULT '[]'::jsonb,
    title          text,
    media_type     text,
    hidden         boolean NOT NULL DEFAULT false,
    notes          text,
    contributed_by text,
    uses           integer NOT NULL DEFAULT 0,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (imdb_id, season)
);

-- Titres pour lesquels aucune bande-annonce n'a été trouvée
CREATE TABLE IF NOT EXISTS failed_log (
    imdb_id      text NOT NULL,
    season       integer NOT NULL DEFAULT 0,
    type         text,
    title        text,
    fail_count   integer NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (imdb_id, season)
);

-- Dernières résolutions réussies (conservées 1 h)
CREATE TABLE IF NOT EXISTS resolved_log (
    imdb_id    text NOT NULL,
    season     integer NOT NULL DEFAULT 0,
    type       text,
    title      text,
    source     text,
    streams    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (imdb_id, season)
);

-- Propositions communautaires (page publique /proposer)
CREATE TABLE IF NOT EXISTS contributions (
    id          serial PRIMARY KEY,
    imdb_id     text NOT NULL,
    season      integer,
    title       text,
    media_type  text,
    yt_id       text,
    url         text,
    pseudo      text NOT NULL,
    notes       text,
    status      text NOT NULL DEFAULT 'pending',
    created_at  timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);

-- Statistiques de requêtes
CREATE TABLE IF NOT EXISTS request_stats_global (
    id    integer PRIMARY KEY,
    total bigint NOT NULL DEFAULT 0
);
INSERT INTO request_stats_global (id, total) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS request_stats_daily (
    day   date PRIMARY KEY,
    total bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS request_stats_type (
    type  text PRIMARY KEY,
    count bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS request_stats_top_titles (
    title   text NOT NULL,
    imdb_id text NOT NULL DEFAULT '',
    count   bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (title, imdb_id)
);

-- Suivi des requêtes AIOMetadata
CREATE TABLE IF NOT EXISTS aiom_stats (
    day        date NOT NULL,
    outcome    text NOT NULL,
    count      integer NOT NULL DEFAULT 0,
    cache_hits integer NOT NULL DEFAULT 0,
    total_ms   bigint  NOT NULL DEFAULT 0,
    PRIMARY KEY (day, outcome)
);

-- Réglages du dashboard : une seule ligne (id = 1) par table.
-- NULL = « valeur par défaut du code ».
CREATE TABLE IF NOT EXISTS configure_settings (
    id                    integer PRIMARY KEY,
    brand_name            text,
    nav_link_text         text,
    nav_link_url          text,
    hero_title_white      text,
    hero_title_red        text,
    hero_subtitle         text,
    accent_color          text,
    section_config_label  text,
    section_profile_label text,
    section_links_label   text,
    tmdb_key_hint         text,
    pseudo_hint           text,
    external_toggle_title text,
    external_toggle_desc  text,
    max_links_label       text,
    max_links_hint        text,
    extras_select_label   text,
    extras_select_hint    text,
    language_select_label text,
    language_select_hint  text,
    install_app_label     text,
    install_web_label     text,
    install_copy_label    text,
    updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO configure_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS behavior_settings (
    id                             integer PRIMARY KEY,
    allocine_fallback              boolean NOT NULL DEFAULT true,
    youtube_search_fallback        boolean NOT NULL DEFAULT true,
    max_trailers                   integer NOT NULL DEFAULT 2,
    extra_vf_keywords              text[]  NOT NULL DEFAULT '{}',
    ignore_teasers                 boolean NOT NULL DEFAULT false,
    include_extras                 boolean NOT NULL DEFAULT false,
    language_mode                  text    NOT NULL DEFAULT 'vf',
    trailer_language               text    NOT NULL DEFAULT 'fr-first',
    cache_enabled                  boolean NOT NULL DEFAULT true,
    cache_ttl_hours                double precision NOT NULL DEFAULT 6,
    allocine_cache_ttl_hours       double precision NOT NULL DEFAULT 2,
    youtube_search_cache_ttl_hours double precision NOT NULL DEFAULT 1,
    cache_failures                 boolean NOT NULL DEFAULT true,
    failure_cache_ttl_minutes      double precision NOT NULL DEFAULT 30,
    aiom_timeout_seconds           integer NOT NULL DEFAULT 5,
    updated_at                     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO behavior_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
