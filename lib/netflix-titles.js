// Stockage du catalogue local des titres Netflix (table netflix_titles).
// Une ligne = un ID Netflix, relié à son IMDB ID et/ou TMDB ID quand on les connaît.

const sql = require('./db');
const { isNid, isImdb } = require('./netflix-common');

const SOURCE_RANK = { manual: 4, tmdb: 3, wikidata: 2, crawl: 1 };

function normalize(t) {
    const nid = String(t && t.nid || '').trim();
    if (!isNid(nid)) return null;
    const imdb = isImdb(t.imdb_id) ? t.imdb_id : null;
    const tmdb = Number.isInteger(Number(t.tmdb_id)) && Number(t.tmdb_id) > 0 ? Number(t.tmdb_id) : null;
    const year = Number.isInteger(Number(t.year)) && Number(t.year) > 1800 ? Number(t.year) : null;
    const type = t.type === 'movie' || t.type === 'tv' ? t.type : null;
    return {
        nid, imdb, tmdb, year, type,
        title: t.title ? String(t.title).trim() || null : null,
        source: SOURCE_RANK[t.source] ? t.source : 'manual',
        raw: t.raw === undefined || t.raw === null ? null : (typeof t.raw === 'string' ? t.raw : JSON.stringify(t.raw)),
    };
}

/**
 * Ajoute ou met à jour un titre. Les champs déjà connus ne sont jamais écrasés par une valeur vide ;
 * la source ne « descend » jamais (une saisie manuelle reste manuelle). Renvoie true si la ligne a été écrite.
 */
async function upsertTitle(t) {
    const n = normalize(t);
    if (!n) return false;
    const now = sql.nowIso();
    await sql`
        INSERT INTO netflix_titles (nid, title, year, type, tmdb_id, imdb_id, source, last_seen, raw)
        VALUES (${n.nid}, ${n.title}, ${n.year}, ${n.type}, ${n.tmdb}, ${n.imdb}, ${n.source}, ${now}, ${n.raw})
        ON CONFLICT (nid) DO UPDATE SET
            title   = COALESCE(excluded.title, netflix_titles.title),
            year    = COALESCE(excluded.year, netflix_titles.year),
            type    = COALESCE(excluded.type, netflix_titles.type),
            tmdb_id = COALESCE(excluded.tmdb_id, netflix_titles.tmdb_id),
            imdb_id = COALESCE(excluded.imdb_id, netflix_titles.imdb_id),
            raw     = COALESCE(excluded.raw, netflix_titles.raw),
            source  = CASE
                WHEN (CASE excluded.source WHEN 'manual' THEN 4 WHEN 'tmdb' THEN 3 WHEN 'wikidata' THEN 2 ELSE 1 END)
                   > (CASE netflix_titles.source WHEN 'manual' THEN 4 WHEN 'tmdb' THEN 3 WHEN 'wikidata' THEN 2 ELSE 1 END)
                THEN excluded.source ELSE netflix_titles.source END,
            last_seen = excluded.last_seen`;
    return true;
}

/** Ajoute plusieurs titres d'un coup (transaction unique). Renvoie le nombre de lignes écrites. */
async function upsertMany(titles) {
    let written = 0;
    sql.exec('BEGIN');
    try {
        for (const t of titles) if (await upsertTitle(t)) written++;
        sql.exec('COMMIT');
    } catch (err) {
        sql.exec('ROLLBACK');
        throw err;
    }
    return written;
}

/** ID Netflix pour un IMDB ID (le plus récemment vu s'il y en a plusieurs), ou null. */
async function findNidByImdb(imdbId) {
    if (!isImdb(imdbId)) return null;
    const rows = await sql`SELECT nid FROM netflix_titles WHERE imdb_id = ${imdbId} ORDER BY last_seen DESC LIMIT 1`;
    return rows[0] ? rows[0].nid : null;
}

/** ID Netflix pour un ID TMDB + type ('movie' | 'tv'), ou null. */
async function findNidByTmdb(tmdbId, type) {
    const id = Number(tmdbId);
    if (!Number.isInteger(id) || (type !== 'movie' && type !== 'tv')) return null;
    const rows = await sql`SELECT nid FROM netflix_titles WHERE tmdb_id = ${id} AND type = ${type} ORDER BY last_seen DESC LIMIT 1`;
    return rows[0] ? rows[0].nid : null;
}

async function getTitle(nid) {
    const rows = await sql`SELECT * FROM netflix_titles WHERE nid = ${String(nid)}`;
    return rows[0] || null;
}

async function markTrailerChecked(nid) {
    await sql`UPDATE netflix_titles SET trailer_checked_at = ${sql.nowIso()} WHERE nid = ${String(nid)}`;
}

/**
 * Enregistre des ID Netflix découverts (ils restent « à explorer »). Les ID déjà connus ne sont pas touchés.
 * Renvoie le nombre de NOUVEAUX ID.
 */
async function addDiscovered(nids, fromNid) {
    const now = sql.nowIso();
    let added = 0;
    // Pas de transaction explicite : d'autres synchros (Wikidata, TMDB) peuvent écrire en même temps.
    for (const nid of nids) {
        if (!isNid(nid)) continue;
        const before = await sql`SELECT 1 AS x FROM netflix_titles WHERE nid = ${String(nid)}`;
        if (before.length) continue;
        await sql`INSERT OR IGNORE INTO netflix_titles (nid, source, last_seen, discovered_from) VALUES (${String(nid)}, 'crawl', ${now}, ${fromNid ? String(fromNid) : null})`;
        added++;
    }
    return added;
}

/** Prochain ID à explorer : jamais explorés d'abord, puis les erreurs (3 essais max, 6 h entre deux). */
async function nextToCrawl() {
    const retryBefore = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const rows = await sql`
        SELECT nid FROM netflix_titles
        WHERE crawl_status IS NULL OR (crawl_status = 'error' AND crawl_attempts < 3 AND crawled_at < ${retryBefore})
        ORDER BY (crawl_status IS NULL) DESC, crawl_attempts ASC, rowid ASC LIMIT 1`;
    return rows[0] ? rows[0].nid : null;
}

/** Note le résultat de l'exploration d'un ID ('done' | 'missing' | 'noinfo' | 'error'). */
async function markCrawled(nid, status) {
    await sql`UPDATE netflix_titles SET crawl_status = ${status}, crawled_at = ${sql.nowIso()}, crawl_attempts = crawl_attempts + 1 WHERE nid = ${String(nid)}`;
}

/** Répartition de la table par état d'exploration. */
async function crawlCounts() {
    const rows = await sql`SELECT COALESCE(crawl_status, 'pending') AS st, COUNT(*) AS n FROM netflix_titles GROUP BY st`;
    const out = { pending: 0, done: 0, missing: 0, noinfo: 0, error: 0 };
    for (const r of rows) out[r.st] = Number(r.n);
    return out;
}

const FILTERS = {
    all: '',
    imdb: 'imdb_id IS NOT NULL',
    noimdb: 'imdb_id IS NULL',
    pending: 'crawl_status IS NULL',
    done: "crawl_status = 'done'",
    error: "crawl_status IN ('error', 'missing', 'noinfo')",
};

/** Page de la table pour le dashboard : { rows, total }. `filter` ∈ all|imdb|noimdb|pending|done|error. */
async function listTitles({ q = '', filter = 'all', page = 1, size = 25 } = {}) {
    const where = [];
    const params = [];
    if (FILTERS[filter]) where.push(FILTERS[filter]);
    const term = String(q || '').trim().slice(0, 100);
    if (term) {
        where.push("(title LIKE ? ESCAPE '\\' OR nid = ? OR imdb_id = ?)");
        params.push('%' + term.replace(/[\\%_]/g, c => '\\' + c) + '%', term, term);
    }
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const limit = Math.max(1, Math.min(100, Number(size) || 25));
    const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
    const run = (text, p) => sql(text.split('?'), ...p);
    const [{ n }] = await run('SELECT COUNT(*) AS n FROM netflix_titles' + w, params);
    const rows = await run(
        'SELECT nid, title, year, type, tmdb_id, imdb_id, source, last_seen, crawl_status, crawled_at, discovered_from FROM netflix_titles'
        + w + ' ORDER BY last_seen DESC, rowid DESC LIMIT ? OFFSET ?', [...params, limit, offset]);
    return { rows, total: Number(n), page: Math.floor(offset / limit) + 1, size: limit };
}

async function countTitles() {
    const rows = await sql`SELECT COUNT(*) AS n FROM netflix_titles`;
    return Number(rows[0].n);
}

module.exports = { upsertTitle, upsertMany, findNidByImdb, findNidByTmdb, getTitle, markTrailerChecked, countTitles,
    addDiscovered, nextToCrawl, markCrawled, crawlCounts, listTitles };
