// Stockage du catalogue local des titres Netflix (table netflix_titles).
// Une ligne = un ID Netflix, relié à son IMDB ID et/ou TMDB ID quand on les connaît.

const sql = require('./db');

const NID_RE = /^\d{5,}$/;
const IMDB_RE = /^tt\d{5,10}$/;
const SOURCE_RANK = { manual: 3, tmdb: 2, wikidata: 1 };

function normalize(t) {
    const nid = String(t && t.nid || '').trim();
    if (!NID_RE.test(nid)) return null;
    const imdb = IMDB_RE.test(String(t.imdb_id || '')) ? t.imdb_id : null;
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
                WHEN (CASE excluded.source WHEN 'manual' THEN 3 WHEN 'tmdb' THEN 2 ELSE 1 END)
                   > (CASE netflix_titles.source WHEN 'manual' THEN 3 WHEN 'tmdb' THEN 2 ELSE 1 END)
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
    if (!IMDB_RE.test(String(imdbId || ''))) return null;
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

async function countTitles() {
    const rows = await sql`SELECT COUNT(*) AS n FROM netflix_titles`;
    return Number(rows[0].n);
}

module.exports = { upsertTitle, upsertMany, findNidByImdb, findNidByTmdb, getTitle, markTrailerChecked, countTitles };
