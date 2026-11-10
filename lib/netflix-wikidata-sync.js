// Remplissage initial du catalogue Netflix local depuis Wikidata :
// une seule requête SPARQL renvoie tous les éléments qui ont un ID Netflix (P1874),
// avec leur IMDB (P345) et TMDB (P4947 film, P4983 série) quand ils existent. Aucun appel à Netflix.

const fetch = require('node-fetch');
const store = require('./netflix-titles');

const ENDPOINTS = { wikidata: 'https://query.wikidata.org/sparql' };
const TIMEOUT_MS = 120000; // requête volumineuse : on laisse du temps
const UA = 'vf-trailers-addon/3.5 (https://github.com/Wallacecleaver/vf-trailer-wallace)';

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

const val = b => (b && b.value !== undefined ? String(b.value) : null);

/** Transforme une ligne de résultat SPARQL en titre prêt pour netflix_titles (ou null). */
function rowToTitle(row) {
    const nid = val(row.nid);
    if (!nid || !/^\d{5,}$/.test(nid)) return null;
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

async function fetchBindings() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${ENDPOINTS.wikidata}?format=json&query=${encodeURIComponent(QUERY)}`, {
            headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
        const data = await res.json();
        return (data && data.results && data.results.bindings) || [];
    } finally {
        clearTimeout(timer);
    }
}

/** Récupère tout le catalogue Wikidata et l'écrit en base. Renvoie { fetched, written }. */
async function syncFromWikidata() {
    const bindings = await fetchBindings();
    const titles = bindings.map(rowToTitle).filter(Boolean);
    let written = 0;
    for (let i = 0; i < titles.length; i += 500) written += await store.upsertMany(titles.slice(i, i + 500));
    return { fetched: bindings.length, written };
}

module.exports = { syncFromWikidata, rowToTitle, QUERY, _endpoints: ENDPOINTS };
