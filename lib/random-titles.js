// Tirage au hasard de films / séries TMDB (avec IMDB ID) pour le test en masse du dashboard.
//
// Une requête = UNE page TMDB "discover" choisie au hasard (≈20 titres) + leurs IMDB IDs.
// Le dashboard rappelle l'endpoint jusqu'à avoir assez de titres : chaque appel reste court
// (pas de timeout serverless) et les doublons sont écartés côté client.

const { fetchT } = require('./net');

const API = 'https://api.themoviedb.org/3';

// "popular" : le haut du classement (ce que les gens regardent vraiment).
// "wide"    : beaucoup plus large, inclut des titres plus confidentiels (cas difficiles).
const POOLS = {
    popular: { maxPage: 25, minVotes: 200 },
    wide: { maxPage: 100, minVotes: 30 },
};

const defaultFetchJson = url => fetchT(url).then(r => r.json());

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function pickRandomTitles({ type, pool = 'popular', tmdbKey, count = 20, rand = Math.random, fetchJson = defaultFetchJson }) {
    if (!['movie', 'tv'].includes(type)) throw new Error('type invalide (movie ou tv)');
    const cfg = POOLS[pool] || POOLS.popular;
    const wanted = Math.max(1, Math.min(20, Number(count) || 20));
    const page = 1 + Math.floor(rand() * cfg.maxPage);

    const list = await fetchJson(`${API}/discover/${type}?api_key=${encodeURIComponent(tmdbKey)}&language=fr-FR&sort_by=popularity.desc&vote_count.gte=${cfg.minVotes}&page=${page}`);
    const candidates = shuffle((list && list.results) || [], rand).slice(0, wanted);

    const withImdb = await mapLimit(candidates, 6, async r => {
        try {
            const ext = await fetchJson(`${API}/${type}/${r.id}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`);
            if (!ext || !/^tt\d{6,9}$/.test(ext.imdb_id || '')) return null;
            const date = type === 'movie' ? r.release_date : r.first_air_date;
            return {
                imdbId: ext.imdb_id,
                tmdbId: r.id,
                type: type === 'tv' ? 'series' : 'movie',
                title: (type === 'movie' ? r.title : r.name) || r.original_title || r.original_name || ext.imdb_id,
                year: date ? date.slice(0, 4) : null,
                originalLanguage: r.original_language || null,
            };
        } catch {
            return null;
        }
    });
    return withImdb.filter(Boolean);
}

module.exports = { pickRandomTitles, POOLS };
