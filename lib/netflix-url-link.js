// URL Netflix -> titre lu sur la page -> TMDB -> IMDB, enregistré dans le catalogue local (table netflix_titles).
// Sert aux titres que Wikidata ne connaît pas encore (une nouveauté, par exemple) : on colle l'URL
// `netflix.com/fr/title/<id>` et la chaîne ID Netflix -> TMDB/IMDB -> bande-annonce est complète.

const store = require('./netflix-titles');
const { parseNetflixId, getPageInfo } = require('./netflix-trailer');
const { tmdbGet } = require('./netflix-tmdb-sync');
const { isNid, isImdb, normTitle } = require('./netflix-common');

const nameOf = (type, r) => (type === 'movie' ? r.title : r.name);
const yearOf = (type, r) => {
    const d = type === 'movie' ? r.release_date : r.first_air_date;
    return d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null;
};

/** Meilleur résultat TMDB : titre identique (+2) et année à ±1 (+1) ; 2 points minimum, sinon aucun. */
function pickBest(results, info, type) {
    let best = null;
    let bestScore = 0;
    for (const r of (results || []).slice(0, 8)) {
        let score = 0;
        if ([r.title, r.name, r.original_title, r.original_name].some(n => n && normTitle(n) === normTitle(info.title))) score += 2;
        const y = yearOf(type, r);
        if (info.year && y && Math.abs(y - info.year) <= 1) score += 1;
        if (score > bestScore) { best = r; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
}

/** Cherche le titre lu sur Netflix chez TMDB (le type annoncé par Netflix d'abord). { match, candidates } */
async function searchTmdb(info, key) {
    const types = info.mediaType === 'movie' ? ['movie', 'tv'] : ['tv', 'movie'];
    const candidates = [];
    for (const type of types) {
        const yearParam = type === 'tv' ? 'first_air_date_year' : 'year';
        let data = await tmdbGet(`/search/${type}`, key, { query: info.title, language: 'fr-FR', [yearParam]: info.year });
        if (!(data.results || []).length && info.year) data = await tmdbGet(`/search/${type}`, key, { query: info.title, language: 'fr-FR' });
        const best = pickBest(data.results, info, type);
        if (best) return { match: { type, tmdbId: best.id, title: nameOf(type, best), year: yearOf(type, best) }, candidates };
        for (const r of (data.results || []).slice(0, 3)) {
            candidates.push({ type, tmdbId: r.id, title: nameOf(type, r), year: yearOf(type, r) });
        }
    }
    return { match: null, candidates };
}

/** IMDB ID d'un titre TMDB (null si TMDB ne le connaît pas, ou en cas d'erreur : on enregistre quand même sans IMDB). */
async function imdbOf(type, tmdbId, key) {
    try {
        const d = await tmdbGet(`/${type}/${Number(tmdbId)}/external_ids`, key);
        return isImdb(d && d.imdb_id) ? d.imdb_id : null;
    } catch {
        return null;
    }
}

/** Enregistre « cet ID Netflix = ce titre TMDB » (IMDB récupéré chez TMDB) ; renvoie la ligne du catalogue. */
async function linkNetflixToTmdb(nid, { type, tmdbId, title, year }, key) {
    if (!isNid(nid)) throw new Error('ID Netflix invalide');
    if (type !== 'movie' && type !== 'tv') throw new Error('Type invalide (movie ou tv)');
    if (!(Number(tmdbId) > 0)) throw new Error('ID TMDB invalide');
    const imdb = key ? await imdbOf(type, tmdbId, key) : null;
    await store.upsertTitle({ nid, type, tmdb_id: tmdbId, imdb_id: imdb, title, year, source: 'manual' });
    return store.getTitle(nid);
}

/**
 * Colle une URL (ou un ID) Netflix. Renvoie { status, ... } :
 *   exists    : déjà dans le catalogue avec un IMDB (row)
 *   linked    : trouvé sur TMDB et enregistré (row, info)
 *   preview   : mode `dryRun` — ce qui serait enregistré (match, imdbId), sans rien écrire en base
 *   ambiguous : pas de correspondance sûre -> candidats à confirmer avec linkNetflixToTmdb
 *   no_match  : rien trouvé sur TMDB
 */
async function addFromNetflixUrl(input, key, { dryRun = false } = {}) {
    const nid = parseNetflixId(input);
    if (!nid) throw new Error('URL Netflix non reconnue (attendu : netflix.com/.../title/<id>)');
    const existing = await store.getTitle(nid);
    if (existing && existing.imdb_id) return { status: 'exists', row: existing };
    if (!key) throw new Error('Clé TMDB indisponible (TMDB_API_KEY)');

    const info = await getPageInfo(nid);
    if (!info) throw new Error('Page Netflix illisible (bloquée, introuvable ou format changé)');

    const { match, candidates } = await searchTmdb(info, key);
    if (!match) return { status: candidates.length ? 'ambiguous' : 'no_match', nid, info, candidates };
    if (dryRun) return { status: 'preview', nid, info, match, imdbId: await imdbOf(match.type, match.tmdbId, key) };

    const row = await linkNetflixToTmdb(nid, { type: match.type, tmdbId: match.tmdbId, title: info.title, year: info.year }, key);
    return { status: 'linked', row, info };
}

module.exports = { addFromNetflixUrl, linkNetflixToTmdb, pickBest };
