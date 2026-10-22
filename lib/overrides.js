// ============================================================
// OVERRIDES — mapping manuel IMDB -> bande-annonce forcée, + journal des
// échecs et des résolutions réussies.
//
// Le compteur `uses` est directement une colonne de la table `overrides`.
// `getOverrideUses()` est reconstruit à la volée depuis cette colonne.
//
// `season` n'est jamais NULL en base (toujours 0 = "pas de saison précise"),
// pour que la clé primaire (imdb_id, season) protège vraiment contre les
// doublons -- voir schema.sql. La conversion 0 <-> null se fait ici, aux
// frontières des fonctions exportées : le reste de l'app continue de voir
// `season: null` exactement comme avant.
// ============================================================

const sql = require('./db');
const { logEvent } = require('./logs');
const { getCached } = require('./cache');

const FAILED_LOG_MAX = 50;      // titres distincts, comme l'original
const RESOLVED_LOG_MAX = 300;   // garde-fou dur, en plus du TTL 1h

function overrideKey(imdbId, season) {
    return `${imdbId}:${season || ''}`;
}

function toDbSeason(season) {
    return season ? Number(season) : 0;
}

function fromDbSeason(season) {
    return season === 0 ? null : season;
}

function rowToOverride(row) {
    return {
        imdbId: row.imdb_id,
        season: fromDbSeason(row.season),
        title: row.title,
        mediaType: row.media_type,
        hidden: row.hidden === true,
        ytId: row.yt_id,
        url: row.url,
        links: row.links || [],
        notes: row.notes,
        contributedBy: row.contributed_by || null,
    };
}

// Invalide toutes les entrées de cache trailer pour un imdbId donné (tous types/saisons/qualités
// confondus), ainsi que le cache "lien de repli actuellement vivant" -- sans ça, une correction
// manuelle sur un override à liens multiples resterait invisible jusqu'à expiration du TTL au
// lieu de s'appliquer immédiatement. Best-effort : si ça échoue, l'override reste appliqué au
// prochain TTL, rien de cassé. Un simple DELETE ... LIKE suffit, pas besoin de lister les clés avant.
// Cache mémoire très court des lectures d'override (le chemin chaud : chaque requête de stream en fait une,
// et AIOMetadata en envoie des centaines d'un coup, presque toujours pour des titres SANS override).
// Vidé à chaque écriture faite ici (setOverride / deleteOverride passent par invalidateCache) ;
// un changement fait ailleurs met au plus OVERRIDE_CACHE_MS à être pris en compte.
const OVERRIDE_CACHE_MS = 20000;
const OVERRIDE_CACHE_MAX = 5000;
const _overrideCache = new Map();

async function invalidateCache(imdbId) {
    _overrideCache.clear();
    if (!sql || !imdbId) return;
    try {
        await sql`
            DELETE FROM kv_cache
            WHERE cache_key LIKE ${'cache:trailers:' + imdbId + ':%'}
               OR cache_key LIKE ${'cache:override-link:' + imdbId + ':%'}
        `;
    } catch (err) {
        console.error('Erreur invalidation cache:', err.message);
    }
}

// Liste tous les overrides configurés (pour l'affichage dashboard). Pour les overrides à
// plusieurs liens de repli, ajoute `activeLinkIndex` : quel lien est ACTUELLEMENT servi
// aux visiteurs Stremio d'après le cache de resolveOverrideLinks (index.js) -- lecture
// seule du cache existant, donc gratuit (pas de nouvel appel réseau déclenché ici). Vaut
// `null` tant qu'aucun visiteur n'a encore déclenché cette résolution depuis le dernier TTL.
async function getOverrides() {
    if (!sql) return [];
    try {
        const rows = await sql`SELECT * FROM overrides ORDER BY imdb_id ASC`;
        const withActiveLink = await Promise.all(rows.map(async row => {
            const o = rowToOverride(row);
            const linkCount = Array.isArray(o.links) ? o.links.length : (o.ytId || o.url ? 1 : 0);
            let activeLinkIndex = null;
            if (linkCount > 1) {
                const cached = await getCached(`cache:override-link:${overrideKey(o.imdbId, o.season)}`);
                if (cached && typeof cached.index === 'number') activeLinkIndex = cached.index;
            }
            return { ...o, uses: row.uses || 0, activeLinkIndex };
        }));
        return withActiveLink;
    } catch (err) {
        console.error('Erreur lecture overrides:', err.message);
        return [];
    }
}

// Cherche un override applicable : priorité à l'override spécifique à la saison,
// sinon repli sur un override général pour ce titre.
async function getOverride(imdbId, season) {
    if (!sql) return null;
    const ck = `${imdbId}:${season || ''}`;
    const hit = _overrideCache.get(ck);
    if (hit && Date.now() - hit.t < OVERRIDE_CACHE_MS) return hit.v;
    try {
        // Saison précise prioritaire, sinon l'override général (saison 0) : une seule requête.
        const rows = season
            ? await sql`SELECT * FROM overrides WHERE imdb_id = ${imdbId} AND season IN (${Number(season)}, 0) ORDER BY season DESC LIMIT 1`
            : await sql`SELECT * FROM overrides WHERE imdb_id = ${imdbId} AND season = 0`;
        const value = rows.length ? rowToOverride(rows[0]) : null;
        if (_overrideCache.size >= OVERRIDE_CACHE_MAX) _overrideCache.clear();
        _overrideCache.set(ck, { t: Date.now(), v: value });
        return value;
    } catch (err) {
        console.error('Erreur lecture override:', err.message);
        return null;
    }
}

// Retire du journal des échecs toutes les entrées couvertes par l'override posé :
// - un override GÉNÉRAL (saison vide) couvre le titre entier -> purge tout l'imdbId ;
// - un override saison-spécifique ne purge que les échecs de cette saison (les autres
//   saisons du titre restent potentiellement en échec et méritent de rester visibles).
// Best-effort : un échec de purge ne casse rien.
async function pruneFailureLogForOverride(imdbId, season) {
    if (!sql || !imdbId) return;
    try {
        if (season == null || season === '') {
            await sql`DELETE FROM failed_log WHERE imdb_id = ${imdbId}`;
        } else {
            await sql`DELETE FROM failed_log WHERE imdb_id = ${imdbId} AND season = ${Number(season)}`;
        }
    } catch (err) {
        console.error('Erreur purge journal échecs:', err.message);
    }
}

// Normalise un lien stocké : { ytId } ou { url } (un seul des deux).
// Une URL YouTube collée dans le champ "URL directe" n'est PAS une vidéo jouable par Stremio (c'est une page) :
// on en tire l'identifiant pour que le lien fonctionne quand même.
function youtubeIdFromUrl(url) {
    const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
    return m ? m[1] : null;
}

function normalizeLink(l) {
    if (!l || typeof l !== 'object') return null;
    const ytId = typeof l.ytId === 'string' ? l.ytId.trim() : '';
    const url = typeof l.url === 'string' ? l.url.trim() : '';
    if (ytId) return { ytId };
    if (url) {
        const fromUrl = youtubeIdFromUrl(url);
        return fromUrl ? { ytId: fromUrl } : { url };
    }
    return null;
}

// Construit la liste prioritaire de liens d'un override. Retrocompat : les anciens
// overrides n'avaient que ytId/url -> on les convertit en links = [premier lien].
function buildLinks(entry) {
    const links = Array.isArray(entry.links) ? entry.links.map(normalizeLink).filter(Boolean) : [];
    const primary = normalizeLink({ ytId: entry.ytId, url: entry.url });
    if (!links.length && primary) return [primary];
    return links;
}

// Reflète le premier lien de la liste sur ytId/url (pour le dashboard et l'export).
function linksToLegacy(links) {
    const first = links[0];
    return {
        ytId: first && first.ytId ? first.ytId : null,
        url: first && first.url ? first.url : null,
    };
}

// entry = { imdbId, season, title, ytId, url, links, mediaType }
async function setOverride(entry) {
    if (!sql) return false;
    try {
        const links = buildLinks(entry);
        const legacy = linksToLegacy(links);
        const season = toDbSeason(entry.season);
        await sql`
            INSERT INTO overrides (imdb_id, season, yt_id, url, links, title, media_type, hidden, notes, contributed_by, updated_at)
            VALUES (
                ${entry.imdbId}, ${season}, ${legacy.ytId}, ${legacy.url}, ${JSON.stringify(links)}::jsonb,
                ${entry.title || null}, ${entry.mediaType || null}, ${entry.hidden === true},
                ${typeof entry.notes === 'string' ? entry.notes : null}, ${entry.contributedBy || null}, now()
            )
            ON CONFLICT (imdb_id, season) DO UPDATE SET
                yt_id = EXCLUDED.yt_id, url = EXCLUDED.url, links = EXCLUDED.links,
                title = EXCLUDED.title, media_type = EXCLUDED.media_type, hidden = EXCLUDED.hidden,
                notes = EXCLUDED.notes,
                -- Sticky : si cet appel ne fournit pas contributedBy (édition admin classique
                -- depuis le dashboard, qui ne connaît pas ce champ), on garde l'attribution
                -- existante plutôt que de l'effacer. Elle n'est écrasée que si explicitement
                -- fournie (ex: une nouvelle acceptation de contribution sur le même titre).
                contributed_by = COALESCE(${entry.contributedBy || null}, overrides.contributed_by),
                updated_at = now()
        `;
        await invalidateCache(entry.imdbId);
        // Un override résout (ou masque délibérément) un échec : l'entrée associée du
        // journal des échecs ne doit plus rester affichée comme "à traiter".
        await pruneFailureLogForOverride(entry.imdbId, entry.season);
        return true;
    } catch (err) {
        console.error('Erreur écriture override:', err.message);
        return false;
    }
}

async function deleteOverride(imdbId, season) {
    if (!sql) return false;
    try {
        await sql`DELETE FROM overrides WHERE imdb_id = ${imdbId} AND season = ${toDbSeason(season)}`;
        await invalidateCache(imdbId);
        return true;
    } catch (err) {
        console.error('Erreur suppression override:', err.message);
        return false;
    }
}

// ---- Compteur d'utilisations par override ----
// Simple colonne sur `overrides` (voir note en tête de fichier) -- incrémenté à chaque
// override_used, jamais touché par setOverride() (préserve le compteur à travers les éditions).
async function incrementOverrideUse(imdbId, season) {
    if (!sql) return;
    try {
        await sql`UPDATE overrides SET uses = uses + 1 WHERE imdb_id = ${imdbId} AND season = ${toDbSeason(season)}`;
    } catch (err) {
        console.error('Erreur incrément usages override:', err.message);
    }
}

// Conservé pour compatibilité d'interface (aucun appelant connu en dehors de ce fichier,
// mais exporté par l'ancienne version) -- reconstruit le même format { "imdbId:season": "N" }.
async function getOverrideUses() {
    if (!sql) return {};
    try {
        const rows = await sql`SELECT imdb_id, season, uses FROM overrides`;
        const out = {};
        for (const r of rows) out[overrideKey(r.imdb_id, fromDbSeason(r.season))] = String(r.uses || 0);
        return out;
    } catch (err) {
        console.error('Erreur lecture usages override:', err.message);
        return {};
    }
}

// ---- Journal des échecs (aucun trailer trouvé) ----
// Une entrée par titre (imdb_id, season), avec un compteur d'occurrences -- pas une entrée
// par requête, sinon un même titre qui échoue en boucle (rechargements Stremio, plusieurs
// visiteurs) noierait le journal sous des doublons identiques. Bornée à FAILED_LOG_MAX
// TITRES DISTINCTS, les plus anciens (par dernière apparition) purgés en premier au dépassement.
async function logFailure({ imdbId, type, season, title }) {
    if (!sql) return;
    try {
        const s = toDbSeason(season);
        const existing = await sql`SELECT title, fail_count FROM failed_log WHERE imdb_id = ${imdbId} AND season = ${s}`;
        const prevTitle = existing.length ? existing[0].title : null;
        const prevCount = existing.length ? existing[0].fail_count : 0;
        await sql`
            INSERT INTO failed_log (imdb_id, season, type, title, fail_count, last_seen_at)
            VALUES (${imdbId}, ${s}, ${type || null}, ${title || prevTitle || null}, ${prevCount + 1}, now())
            ON CONFLICT (imdb_id, season) DO UPDATE SET
                type = EXCLUDED.type, title = EXCLUDED.title, fail_count = EXCLUDED.fail_count, last_seen_at = now()
        `;
        const countRows = await sql`SELECT COUNT(*)::int AS n FROM failed_log`;
        const count = countRows[0]?.n || 0;
        if (count > FAILED_LOG_MAX) {
            await sql`
                DELETE FROM failed_log WHERE (imdb_id, season) IN (
                    SELECT imdb_id, season FROM failed_log ORDER BY last_seen_at ASC LIMIT ${count - FAILED_LOG_MAX}
                )
            `;
        }
    } catch (err) {
        console.error('Erreur log échec:', err.message);
    }
}

async function getFailedLog() {
    if (!sql) return [];
    try {
        const rows = await sql`SELECT * FROM failed_log ORDER BY last_seen_at DESC`;
        return rows.map(r => ({
            imdbId: r.imdb_id,
            type: r.type,
            season: fromDbSeason(r.season),
            title: r.title,
            count: r.fail_count,
            firstSeen: r.created_at,
            lastSeen: r.last_seen_at,
        }));
    } catch (err) {
        console.error('Erreur lecture journal échecs:', err.message);
        return [];
    }
}

async function clearFailedLog() {
    if (!sql) return false;
    try {
        await sql`DELETE FROM failed_log`;
        return true;
    } catch (err) {
        console.error('Erreur purge journal échecs:', err.message);
        return false;
    }
}

// ---- Journal des résolutions réussies (trailer trouvé) ----
// Permet à l'admin de retrouver un titre déjà résolu (même sans échec) pour forcer un
// override dessus, ex: la bande-annonce trouvée est la bonne mais en mauvaise langue/qualité.
// Dédup par (imdb_id, season) via la clé primaire (ON CONFLICT DO UPDATE) : une nouvelle
// résolution du même titre remplace l'ancienne entrée plutôt que d'en empiler une deuxième.
// Expire après 1h (filtre à la lecture/écriture, voir schema.sql), + garde-fou dur
// RESOLVED_LOG_MAX en cas de pic d'activité (beaucoup de titres différents en peu de temps).
async function logResolution({ imdbId, season, type, title, source, streams }) {
    if (!sql) return;
    try {
        const s = toDbSeason(season);
        await sql`
            INSERT INTO resolved_log (imdb_id, season, type, title, source, streams, created_at)
            VALUES (${imdbId}, ${s}, ${type || null}, ${title || null}, ${source || null}, ${JSON.stringify(streams || [])}::jsonb, now())
            ON CONFLICT (imdb_id, season) DO UPDATE SET
                type = EXCLUDED.type, title = EXCLUDED.title, source = EXCLUDED.source,
                streams = EXCLUDED.streams, created_at = now()
        `;
        await sql`DELETE FROM resolved_log WHERE created_at < now() - interval '1 hour'`;
        const countRows = await sql`SELECT COUNT(*)::int AS n FROM resolved_log`;
        const count = countRows[0]?.n || 0;
        if (count > RESOLVED_LOG_MAX) {
            await sql`
                DELETE FROM resolved_log WHERE (imdb_id, season) IN (
                    SELECT imdb_id, season FROM resolved_log ORDER BY created_at ASC LIMIT ${count - RESOLVED_LOG_MAX}
                )
            `;
        }
    } catch (err) {
        console.error('Erreur log résolution:', err.message);
        logEvent({ level: 'error', context: 'SYSTEM', event: 'resolved_log_write_error', message: err.message }).catch(() => {});
    }
}

async function getResolvedLog() {
    if (!sql) return [];
    try {
        const rows = await sql`
            SELECT * FROM resolved_log WHERE created_at > now() - interval '1 hour' ORDER BY created_at DESC
        `;
        return rows.map(r => ({
            imdbId: r.imdb_id,
            season: fromDbSeason(r.season),
            type: r.type,
            title: r.title,
            source: r.source,
            streams: r.streams || [],
            time: r.created_at,
        }));
    } catch (err) {
        console.error('Erreur lecture résolutions:', err.message);
        logEvent({ level: 'error', context: 'SYSTEM', event: 'resolved_log_read_error', message: err.message }).catch(() => {});
        return [];
    }
}

async function clearResolvedLog() {
    if (!sql) return false;
    try {
        await sql`DELETE FROM resolved_log`;
        return true;
    } catch (err) {
        console.error('Erreur purge résolutions:', err.message);
        return false;
    }
}

module.exports = {
    youtubeIdFromUrl,
    getOverrides,
    getOverride,
    setOverride,
    deleteOverride,
    logFailure,
    getFailedLog,
    clearFailedLog,
    logResolution,
    getResolvedLog,
    clearResolvedLog,
    invalidateCache,
    incrementOverrideUse,
    getOverrideUses,
    normalizeLink,
    buildLinks,
    linksToLegacy,
};