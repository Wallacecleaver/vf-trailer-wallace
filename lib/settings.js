// ============================================================
// SETTINGS — réglages éditables depuis le dashboard, stockés dans Postgres
// (une seule ligne, id = 1, dans configure_settings / behavior_settings).
// Toujours fusionnés avec des valeurs par défaut : si la ligne est absente
// ou vide, l'addon garde exactement son comportement d'origine.
// Interface identique à l'ancien lib/settings.js (Redis) -- aucun autre
// fichier n'a besoin de changer.
// ============================================================

const sql = require('./db');

const DEFAULT_CONFIGURE = {
    brandName: 'Bandes-Annonces VF',
    navLinkText: 'TMDB',
    navLinkUrl: 'https://www.themoviedb.org/',
    heroTitleWhite: 'BANDES-ANNONCES',
    heroTitleRed: 'VF',
    heroSubtitle: "Retrouve la bande-annonce officielle française de n'importe quel film ou série, directement dans Stremio, via TMDB · YouTube · Allociné.",
    accentColor: '#e53e3e',
    sectionConfigLabel: 'Ta configuration',
    sectionProfileLabel: 'Ton profil',
    sectionLinksLabel: 'Affichage des liens',
    tmdbKeyHint: 'Obtiens la tienne gratuitement sur themoviedb.org/settings/api (compte gratuit, 2 min).',
    pseudoHint: "Si jamais une bande-annonce manque pour un film que tu ouvres, ton pseudo apparaîtra dans le journal admin — plus facile de savoir qui a eu le souci.",
    externalToggleTitle: "Uniquement les liens d'ouverture externe (YouTube)",
    externalToggleDesc: 'Ne propose que le lien qui ouvre YouTube directement, sans la version lue dans le lecteur intégré de Stremio.',
    maxLinksLabel: 'Nombre maximum de liens affichés',
    maxLinksHint: "Certains films/séries proposent plusieurs bandes-annonces (trailer + teaser, jouable + externe...) : limite le nombre total de liens si tu préfères n'en voir qu'un.",
    extrasSelectLabel: 'Extras (récaps, making-of…)',
    extrasSelectHint: "En plus des bandes-annonces et teasers, certaines fiches TMDB proposent des vidéos dites « extras » : récaps de saison, extraits (clips), making-of, coulisses, bêtisiers, génériques. « Par défaut » suit les réglages admin.",
    languageSelectLabel: 'Langue des bandes-annonces',
    languageSelectHint: "TMDB tague rarement la VO explicitement : le mode VO/VOSTFR retient les vidéos marquées VOST quand elles existent, sinon celles sans aucune indication de langue (le cas le plus fréquent pour une version originale).",
    installAppLabel: 'Installer dans Stremio',
    installWebLabel: 'Web',
    installCopyLabel: 'Copier le lien',
};

const DEFAULT_BEHAVIOR = {
    allocineFallback: true,
    youtubeSearchFallback: true,
    dailymotionFallback: true, // dernier recours après YouTube, via l'API publique Dailymotion
    maxTrailers: 2,
    extraVfKeywords: [],
    ignoreTeasers: false,
    includeExtras: false,
    languageMode: 'vf', // 'vf' | 'vo' | 'both'
    trailerLanguage: 'fr-first',
    cacheEnabled: true,
    cacheTtlHours: 6,
    allocineCacheTtlHours: 2,
    youtubeSearchCacheTtlHours: 1,
    cacheFailures: true,
    failureCacheTtlMinutes: 30,
    aiomTimeoutSeconds: 5, // délai max de réponse en mode AIOMetadata (1 à 12 s)
};

// camelCase (JS) <-> snake_case (colonnes SQL), dans les deux tables singleton.
const CONFIGURE_COLUMNS = {
    brandName: 'brand_name', navLinkText: 'nav_link_text', navLinkUrl: 'nav_link_url',
    heroTitleWhite: 'hero_title_white', heroTitleRed: 'hero_title_red', heroSubtitle: 'hero_subtitle',
    accentColor: 'accent_color', sectionConfigLabel: 'section_config_label',
    sectionProfileLabel: 'section_profile_label', sectionLinksLabel: 'section_links_label',
    tmdbKeyHint: 'tmdb_key_hint', pseudoHint: 'pseudo_hint',
    externalToggleTitle: 'external_toggle_title', externalToggleDesc: 'external_toggle_desc',
    maxLinksLabel: 'max_links_label', maxLinksHint: 'max_links_hint',
    extrasSelectLabel: 'extras_select_label', extrasSelectHint: 'extras_select_hint',
    languageSelectLabel: 'language_select_label', languageSelectHint: 'language_select_hint',
    installAppLabel: 'install_app_label', installWebLabel: 'install_web_label', installCopyLabel: 'install_copy_label',
};

const BEHAVIOR_COLUMNS = {
    allocineFallback: 'allocine_fallback', youtubeSearchFallback: 'youtube_search_fallback',
    dailymotionFallback: 'dailymotion_fallback',
    maxTrailers: 'max_trailers', extraVfKeywords: 'extra_vf_keywords',
    ignoreTeasers: 'ignore_teasers', includeExtras: 'include_extras', languageMode: 'language_mode',
    trailerLanguage: 'trailer_language', cacheEnabled: 'cache_enabled', cacheTtlHours: 'cache_ttl_hours',
    allocineCacheTtlHours: 'allocine_cache_ttl_hours', youtubeSearchCacheTtlHours: 'youtube_search_cache_ttl_hours',
    cacheFailures: 'cache_failures', failureCacheTtlMinutes: 'failure_cache_ttl_minutes',
    aiomTimeoutSeconds: 'aiom_timeout_seconds',
};

// Convertit une ligne SQL (snake_case) en objet JS (camelCase). NULL est traité
// comme "absent" (pas juste undefined) : c'est ce qui permet à resetXSettings()
// de repasser une colonne à NULL et de retomber sur la valeur par défaut au
// prochain get -- exactement le comportement de l'ancien redis.del(clé).
function rowToCamel(row, columnMap) {
    const out = {};
    for (const [camel, col] of Object.entries(columnMap)) {
        if (row[col] !== undefined && row[col] !== null) out[camel] = row[col];
    }
    return out;
}

async function getConfigureSettings() {
    if (!sql) return { ...DEFAULT_CONFIGURE };
    try {
        const rows = await sql`SELECT * FROM configure_settings WHERE id = 1`;
        if (!rows.length) return { ...DEFAULT_CONFIGURE };
        return { ...DEFAULT_CONFIGURE, ...rowToCamel(rows[0], CONFIGURE_COLUMNS) };
    } catch (err) {
        console.error('Erreur lecture settings configure:', err.message);
        return { ...DEFAULT_CONFIGURE };
    }
}

async function setConfigureSettings(settings) {
    if (!sql) return false;
    try {
        // Fusion avec l'état actuel avant écriture : `settings` peut être partiel
        // (l'appelant n'envoie pas forcément tous les champs), et on ne veut pas
        // écraser les colonnes non fournies avec NULL.
        const current = await getConfigureSettings();
        const m = { ...current, ...settings };
        await sql`
            UPDATE configure_settings SET
                brand_name = ${m.brandName}, nav_link_text = ${m.navLinkText}, nav_link_url = ${m.navLinkUrl},
                hero_title_white = ${m.heroTitleWhite}, hero_title_red = ${m.heroTitleRed}, hero_subtitle = ${m.heroSubtitle},
                accent_color = ${m.accentColor}, section_config_label = ${m.sectionConfigLabel},
                section_profile_label = ${m.sectionProfileLabel}, section_links_label = ${m.sectionLinksLabel},
                tmdb_key_hint = ${m.tmdbKeyHint}, pseudo_hint = ${m.pseudoHint},
                external_toggle_title = ${m.externalToggleTitle}, external_toggle_desc = ${m.externalToggleDesc},
                max_links_label = ${m.maxLinksLabel}, max_links_hint = ${m.maxLinksHint},
                extras_select_label = ${m.extrasSelectLabel}, extras_select_hint = ${m.extrasSelectHint},
                language_select_label = ${m.languageSelectLabel}, language_select_hint = ${m.languageSelectHint},
                install_app_label = ${m.installAppLabel}, install_web_label = ${m.installWebLabel},
                install_copy_label = ${m.installCopyLabel}, updated_at = now()
            WHERE id = 1
        `;
        return true;
    } catch (err) {
        console.error('Erreur écriture settings configure:', err.message);
        return false;
    }
}

async function resetConfigureSettings() {
    if (!sql) return false;
    try {
        await sql`
            UPDATE configure_settings SET
                brand_name = NULL, nav_link_text = NULL, nav_link_url = NULL,
                hero_title_white = NULL, hero_title_red = NULL, hero_subtitle = NULL,
                accent_color = NULL, section_config_label = NULL, section_profile_label = NULL,
                section_links_label = NULL, tmdb_key_hint = NULL, pseudo_hint = NULL,
                external_toggle_title = NULL, external_toggle_desc = NULL,
                max_links_label = NULL, max_links_hint = NULL,
                extras_select_label = NULL, extras_select_hint = NULL,
                language_select_label = NULL, language_select_hint = NULL,
                install_app_label = NULL, install_web_label = NULL, install_copy_label = NULL,
                updated_at = now()
            WHERE id = 1
        `;
        return true;
    } catch (err) {
        console.error('Erreur reset settings configure:', err.message);
        return false;
    }
}

async function getBehaviorSettings() {
    if (!sql) return { ...DEFAULT_BEHAVIOR };
    try {
        const rows = await sql`SELECT * FROM behavior_settings WHERE id = 1`;
        if (!rows.length) return { ...DEFAULT_BEHAVIOR };
        return { ...DEFAULT_BEHAVIOR, ...rowToCamel(rows[0], BEHAVIOR_COLUMNS) };
    } catch (err) {
        console.error('Erreur lecture settings behavior:', err.message);
        return { ...DEFAULT_BEHAVIOR };
    }
}

// La colonne du délai AIOMetadata a été ajoutée après coup : on la crée toute seule (une fois par
// process) plutôt que d'obliger à lancer une migration SQL à la main. Idempotent.
let aiomColumnReady = null;
function ensureAiomColumn() {
    if (!sql) return Promise.resolve(false);
    if (!aiomColumnReady) {
        aiomColumnReady = sql`ALTER TABLE behavior_settings ADD COLUMN IF NOT EXISTS aiom_timeout_seconds integer DEFAULT 5`
            .then(() => true)
            .catch(err => { aiomColumnReady = null; console.error('Migration aiom_timeout_seconds impossible :', err.message); return false; });
    }
    return aiomColumnReady;
}

async function setBehaviorSettings(settings) {
    if (!sql) return false;
    try {
        const current = await getBehaviorSettings();
        const m = { ...current, ...settings };
        await sql`
            UPDATE behavior_settings SET
                allocine_fallback = ${m.allocineFallback}, youtube_search_fallback = ${m.youtubeSearchFallback},
                dailymotion_fallback = ${m.dailymotionFallback},
                max_trailers = ${m.maxTrailers}, extra_vf_keywords = ${m.extraVfKeywords},
                ignore_teasers = ${m.ignoreTeasers}, include_extras = ${m.includeExtras}, language_mode = ${m.languageMode},
                trailer_language = ${m.trailerLanguage}, cache_enabled = ${m.cacheEnabled}, cache_ttl_hours = ${m.cacheTtlHours},
                allocine_cache_ttl_hours = ${m.allocineCacheTtlHours}, youtube_search_cache_ttl_hours = ${m.youtubeSearchCacheTtlHours},
                cache_failures = ${m.cacheFailures}, failure_cache_ttl_minutes = ${m.failureCacheTtlMinutes},
                updated_at = now()
            WHERE id = 1
        `;
        // Colonne ajoutée après coup (voir la migration SQL fournie) : écriture SÉPARÉE et tolérante,
        // pour qu'une base pas encore migrée n'empêche JAMAIS d'enregistrer les autres réglages.
        try {
            await ensureAiomColumn();
            const secs = Math.min(12, Math.max(1, Math.round(Number(m.aiomTimeoutSeconds)) || DEFAULT_BEHAVIOR.aiomTimeoutSeconds));
            await sql`UPDATE behavior_settings SET aiom_timeout_seconds = ${secs} WHERE id = 1`;
        } catch (err) {
            console.error('Réglage aiom_timeout_seconds non enregistré (colonne absente ? migration SQL à lancer) :', err.message);
        }
        return true;
    } catch (err) {
        console.error('Erreur écriture settings behavior:', err.message);
        return false;
    }
}

async function resetBehaviorSettings() {
    if (!sql) return false;
    try {
        await sql`
            UPDATE behavior_settings SET
                allocine_fallback = DEFAULT, youtube_search_fallback = DEFAULT,
                dailymotion_fallback = DEFAULT,
                max_trailers = DEFAULT, extra_vf_keywords = DEFAULT,
                ignore_teasers = DEFAULT, include_extras = DEFAULT, language_mode = DEFAULT,
                trailer_language = DEFAULT, cache_enabled = DEFAULT, cache_ttl_hours = DEFAULT,
                allocine_cache_ttl_hours = DEFAULT, youtube_search_cache_ttl_hours = DEFAULT,
                cache_failures = DEFAULT, failure_cache_ttl_minutes = DEFAULT,
                updated_at = now()
            WHERE id = 1
        `;
        try {
            await sql`UPDATE behavior_settings SET aiom_timeout_seconds = DEFAULT WHERE id = 1`;
        } catch (err) {
            console.error('Reset aiom_timeout_seconds ignoré (colonne absente ?) :', err.message);
        }
        return true;
    } catch (err) {
        console.error('Erreur reset settings behavior:', err.message);
        return false;
    }
}

module.exports = {
    DEFAULT_CONFIGURE,
    DEFAULT_BEHAVIOR,
    getConfigureSettings,
    setConfigureSettings,
    resetConfigureSettings,
    getBehaviorSettings,
    setBehaviorSettings,
    resetBehaviorSettings,
};