// Complément du catalogue Netflix local via TMDB « discover » (fournisseur Netflix, France) :
//  1. liste les titres disponibles sur Netflix FR (table netflix_tmdb_seen) ;
//  2. complète leur IMDB ID (external_ids) ;
//  3. cherche leur ID Netflix sur Wikidata (par lots) et les ajoute à netflix_titles.
// Les titres que Wikidata ne connaît pas restent dans netflix_tmdb_seen ; leur ID Netflix s'ajoute
// à la demande (URL Netflix collée dans le dashboard) ou à un prochain passage.

const fetch = require('node-fetch');
const sql = require('./db');
const store = require('./netflix-titles');
const { lookupNidsByImdb } = require('./netflix-wikidata-sync');

const ENDPOINTS = { tmdb: 'https://api.themoviedb.org/3' };
const NETFLIX_PROVIDER_ID = 8;
const REGION = (process.env.NETFLIX_COUNTRY || 'fr').toUpperCase().replace(/[^A-Z]/g, '') || 'FR';
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const SORT = { movie: 'primary_release_date.desc', tv: 'first_air_date.desc' };

async function tmdbGet(pathAndQuery, key) {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(`${ENDPOINTS.tmdb}${pathAndQuery}${sep}api_key=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const yearOf = d => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

/** Parcourt `pages` pages de discover pour un type et enregistre les titres vus. Renvoie le nombre de titres lus. */
async function discoverType(type, key, { pages = 3, sortBy = SORT[type] } = {}) {
    let seen = 0;
    for (let page = 1; page <= pages; page++) {
        const q = `/discover/${type}?watch_region=${REGION}&with_watch_providers=${NETFLIX_PROVIDER_ID}`
            + `&with_watch_monetization_types=flatrate&language=fr-FR&sort_by=${sortBy}&page=${page}`;
        const data = await tmdbGet(q, key);
        const results = (data && data.results) || [];
        const now = sql.nowIso();
        for (const r of results) {
            if (!Number.isInteger(r.id)) continue;
            await sql`
                INSERT INTO netflix_tmdb_seen (tmdb_id, type, title, year, first_seen, last_seen)
                VALUES (${r.id}, ${type}, ${r.title || r.name || null}, ${yearOf(r.release_date || r.first_air_date)}, ${now}, ${now})
                ON CONFLICT (tmdb_id, type) DO UPDATE SET last_seen = excluded.last_seen,
                    title = COALESCE(excluded.title, netflix_tmdb_seen.title),
                    year = COALESCE(excluded.year, netflix_tmdb_seen.year)`;
            seen++;
        }
        if (!data || page >= (data.total_pages || 1)) break;
    }
    return seen;
}

/** Complète l'IMDB ID des titres vus qui n'en ont pas (par petits groupes en parallèle). */
async function fillImdbIds(key, { limit = 500, concurrency = 5 } = {}) {
    const rows = await sql`SELECT tmdb_id, type FROM netflix_tmdb_seen WHERE imdb_id IS NULL LIMIT ${limit}`;
    let filled = 0;
    for (let i = 0; i < rows.length; i += concurrency) {
        await Promise.all(rows.slice(i, i + concurrency).map(async r => {
            try {
                const d = await tmdbGet(`/${r.type}/${r.tmdb_id}/external_ids`, key);
                if (d && /^tt\d{5,10}$/.test(d.imdb_id || '')) {
                    await sql`UPDATE netflix_tmdb_seen SET imdb_id = ${d.imdb_id} WHERE tmdb_id = ${r.tmdb_id} AND type = ${r.type}`;
                    filled++;
                }
            } catch { /* titre ignoré, réessayé au prochain passage */ }
        }));
    }
    return filled;
}

/** Cherche sur Wikidata l'ID Netflix des titres qui ont un IMDB ID mais pas encore d'ID Netflix connu. */
async function resolveNetflixIds({ limit = 300 } = {}) {
    const cutoff = new Date(Date.now() - RECHECK_MS).toISOString();
    const rows = await sql`
        SELECT s.tmdb_id, s.type, s.imdb_id, s.title, s.year FROM netflix_tmdb_seen s
        WHERE s.imdb_id IS NOT NULL
          AND (s.nid_checked_at IS NULL OR s.nid_checked_at < ${cutoff})
          AND NOT EXISTS (SELECT 1 FROM netflix_titles t WHERE t.imdb_id = s.imdb_id)
        LIMIT ${limit}`;
    let resolved = 0;
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const map = await lookupNidsByImdb(batch.map(r => r.imdb_id)); // imdb -> nid
        const now = sql.nowIso();
        for (const r of batch) {
            const nid = map.get(r.imdb_id);
            if (nid && await store.upsertTitle({ nid, imdb_id: r.imdb_id, tmdb_id: r.tmdb_id, type: r.type, title: r.title, year: r.year, source: 'tmdb' })) resolved++;
            await sql`UPDATE netflix_tmdb_seen SET nid_checked_at = ${now} WHERE tmdb_id = ${r.tmdb_id} AND type = ${r.type}`;
        }
    }
    return resolved;
}

/** Passage complet : discover (films + séries), IMDB IDs, ID Netflix. `pages` = profondeur de discover par type. */
async function syncFromTmdb(key, { pages = 3 } = {}) {
    if (!key) return { skipped: 'TMDB_API_KEY absente' };
    const discovered = (await discoverType('movie', key, { pages })) + (await discoverType('tv', key, { pages }));
    const imdb = await fillImdbIds(key);
    const resolved = await resolveNetflixIds();
    return { discovered, imdb, resolved };
}

module.exports = { syncFromTmdb, discoverType, fillImdbIds, resolveNetflixIds, _endpoints: ENDPOINTS };
