// URL Netflix -> titre lu sur la page -> TMDB -> IMDB, enregistré dans le catalogue local (table netflix_titles).
// Sert aux titres que Wikidata ne connaît pas encore (ex. une nouveauté) : on colle l'URL
// `netflix.com/fr/title/<id>` et la chaîne ID Netflix -> TMDB/IMDB -> bande-annonce est complète.

const fetch = require('node-fetch');
const store = require('./netflix-titles');
const { parseNetflixId, getPageInfo } = require('./netflix-trailer');
const { _endpoints } = require('./netflix-tmdb-sync');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

async function tmdbGet(path, params, key) {
    const url = new URL(_endpoints.tmdb + path);
    const headers = { accept: 'application/json' };
    if (String(key).startsWith('eyJ')) headers.authorization = `Bearer ${key}`; // jeton « lecture » v4
    else url.searchParams.set('api_key', key);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(url.toString(), { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const nameOf = (kind, r) => (kind === 'movie' ? r.title : r.name);
const yearOf = (kind, r) => { const d = kind === 'movie' ? r.release_date : r.first_air_date; return d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null; };

/** Meilleur résultat TMDB : titre identique (+2) et année à ±1 (+1) ; 2 points minimum, sinon aucun. */
function pickBest(results, info, kind) {
    let best = null;
    let bestScore = 0;
    for (const r of (results || []).slice(0, 8)) {
        let score = 0;
        if ([r.title, r.name, r.original_title, r.original_name].some(n => n && norm(n) === norm(info.title))) score += 2;
        const y = yearOf(kind, r);
        if (info.year && y && Math.abs(y - info.year) <= 1) score += 1;
        if (score > bestScore) { best = r; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
}

async function searchTmdb(info, key) {
    const kinds = info.mediaType === 'movie' ? ['movie', 'tv'] : ['tv', 'movie'];
    const candidates = [];
    for (const kind of kinds) {
        const yearKey = kind === 'tv' ? 'first_air_date_year' : 'year';
        let data = await tmdbGet(`/search/${kind}`, { query: info.title, language: 'fr-FR', [yearKey]: info.year || undefined }, key);
        if (!(data.results || []).length && info.year) data = await tmdbGet(`/search/${kind}`, { query: info.title, language: 'fr-FR' }, key);
        const best = pickBest(data.results, info, kind);
        if (best) return { match: { type: kind, tmdbId: best.id }, candidates };
        for (const r of (data.results || []).slice(0, 3)) {
            candidates.push({ type: kind, tmdbId: r.id, title: nameOf(kind, r), year: yearOf(kind, r) });
        }
    }
    return { match: null, candidates };
}

/** Enregistre « cet ID Netflix = ce titre TMDB » (IMDB récupéré chez TMDB) ; renvoie la ligne du catalogue. */
async function linkNetflixToTmdb(nid, { type, tmdbId, title, year }, key) {
    if (!/^\d{5,}$/.test(String(nid))) throw new Error('ID Netflix invalide');
    if (type !== 'movie' && type !== 'tv') throw new Error('Type invalide (movie ou tv)');
    if (!(Number(tmdbId) > 0)) throw new Error('ID TMDB invalide');
    let imdb = null;
    if (key) {
        try { imdb = (await tmdbGet(`/${type}/${Number(tmdbId)}/external_ids`, {}, key)).imdb_id || null; } catch { /* enregistré quand même, sans IMDB */ }
    }
    await store.upsertTitle({ nid, type, tmdb_id: tmdbId, imdb_id: imdb, title, year, source: 'manual' });
    return store.getTitle(nid);
}

/**
 * Colle une URL (ou un ID) Netflix. Renvoie { status, ... } :
 *   exists    : déjà dans le catalogue avec un IMDB (row)
 *   linked    : trouvé sur TMDB et enregistré (row, info)
 *   ambiguous : pas de correspondance sûre -> candidats à confirmer avec linkNetflixToTmdb
 *   no_match  : rien trouvé sur TMDB
 */
async function addFromNetflixUrl(input, key) {
    const nid = parseNetflixId(input);
    if (!nid) throw new Error('URL Netflix non reconnue (attendu : netflix.com/.../title/<id>)');
    const existing = await store.getTitle(nid);
    if (existing && existing.imdb_id) return { status: 'exists', row: existing };
    if (!key) throw new Error('Clé TMDB indisponible (TMDB_API_KEY)');

    const info = await getPageInfo(nid);
    if (!info) throw new Error('Page Netflix illisible (bloquée, introuvable ou format changé)');

    const { match, candidates } = await searchTmdb(info, key);
    if (!match) return { status: candidates.length ? 'ambiguous' : 'no_match', nid, info, candidates };
    const row = await linkNetflixToTmdb(nid, { type: match.type, tmdbId: match.tmdbId, title: info.title, year: info.year }, key);
    return { status: 'linked', row, info };
}

module.exports = { addFromNetflixUrl, linkNetflixToTmdb, pickBest };
