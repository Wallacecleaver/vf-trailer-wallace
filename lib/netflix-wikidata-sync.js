// Remplissage initial du catalogue Netflix local depuis Wikidata :
// une seule requête SPARQL renvoie tous les éléments qui ont un ID Netflix (P1874),
// avec leur IMDB (P345) et TMDB (P4947 film, P4983 série) quand ils existent. Aucun appel à Netflix.

const store = require('./netflix-titles');
const { sparql, bindingValue: val } = require('./wikidata');
const { isNid, isImdb } = require('./netflix-common');

const ENDPOINTS = { wikidata: 'https://query.wikidata.org/sparql' };
const FULL_TIMEOUT_MS = 120000; // requête volumineuse : on laisse du temps
const LOOKUP_TIMEOUT_MS = 30000;

const QUERY = `
SELECT ?item ?nid ?imdb ?tmdbMovie ?tmdbTv ?label ?year ?isTv WHERE {
  ?item wdt:P1874 ?nid .
  OPTIONAL { ?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt")) }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovie }
  OPTIONAL { ?item wdt:P4983 ?tmdbTv }
  OPTIONAL { ?item wdt:P577 ?date . BIND(YEAR(?date) AS ?year) }
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "fr") }
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:Q5398426 } AS ?isTv)
}`;

/** Transforme une ligne de résultat SPARQL en titre prêt pour netflix_titles (ou null). */
function rowToTitle(row) {
    const nid = val(row.nid);
    if (!isNid(nid)) return null;
    const tmdbTv = val(row.tmdbTv), tmdbMovie = val(row.tmdbMovie);
    const isTv = val(row.isTv) === 'true' || (!!tmdbTv && !tmdbMovie);
    const tmdb = isTv ? tmdbTv : tmdbMovie;
    return {
        nid,
        imdb_id: val(row.imdb),
        tmdb_id: tmdb && /^\d+$/.test(tmdb) ? Number(tmdb) : null,
        type: isTv ? 'tv' : (tmdbMovie ? 'movie' : null),
        title: val(row.label),
        year: val(row.year) ? Number(val(row.year)) : null,
        source: 'wikidata',
        raw: { item: val(row.item) },
    };
}

/** Récupère tout le catalogue Wikidata et l'écrit en base. Renvoie { fetched, written }. */
async function syncFromWikidata() {
    const bindings = await sparql(ENDPOINTS.wikidata, QUERY, FULL_TIMEOUT_MS);
    const titles = bindings.map(rowToTitle).filter(Boolean);
    let written = 0;
    for (let i = 0; i < titles.length; i += 500) written += await store.upsertMany(titles.slice(i, i + 500));
    return { fetched: bindings.length, written };
}

/**
 * ID Netflix de plusieurs titres à la fois, par IMDB ID : Map imdb -> nid (les titres inconnus sont absents).
 * Lève une exception si Wikidata ne répond pas : une panne ne doit pas passer pour « titre inconnu ».
 */
async function lookupNidsByImdb(imdbIds) {
    const ids = [...new Set(imdbIds)].filter(isImdb);
    const out = new Map();
    if (!ids.length) return out;
    const query = `SELECT ?imdb ?nid WHERE { VALUES ?imdb { ${ids.map(i => `"${i}"`).join(' ')} } ?i wdt:P345 ?imdb; wdt:P1874 ?nid }`;
    for (const b of await sparql(ENDPOINTS.wikidata, query, LOOKUP_TIMEOUT_MS)) {
        const nid = val(b.nid), imdb = val(b.imdb);
        if (isNid(nid) && imdb && !out.has(imdb)) out.set(imdb, nid);
    }
    return out;
}

module.exports = { syncFromWikidata, lookupNidsByImdb, rowToTitle, QUERY, _endpoints: ENDPOINTS };
