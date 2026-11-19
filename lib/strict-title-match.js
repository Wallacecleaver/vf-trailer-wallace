// Matcher partagé, pur : mêmes mots significatifs et année non contradictoire.
// Adaptation CommonJS du matcher fourni, sans dépendance TypeScript.
const STOPWORDS = new Set([
    'le', 'la', 'les', 'l', 'un', 'une', 'de', 'des', 'du', 'the', 'a', 'an', 'of', 'and', 'et',
    'vf', 'vostfr', 'vost', 'vo', 'multi', 'french', 'truefrench', 'saison', 'season', 'episode', 'ep',
]);

function normalizeTokens(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
        .filter(t => t && !STOPWORDS.has(t) && !/^(19|20)\d\d$/.test(t));
}

function titlesMatch(wantedTitles, candidateTitle) {
    const candidate = normalizeTokens(candidateTitle).join(' ');
    return !!candidate && wantedTitles.some(title => normalizeTokens(title).join(' ') === candidate);
}

function expandTitles(titles) {
    const out = new Set();
    for (const title of titles) {
        if (!title) continue;
        out.add(title);
        const base = title.split(/\s*[:–—]\s+|\s+[-–—]\s*/)[0].trim();
        if (base && base.length >= 3) out.add(base);
    }
    return [...out];
}

function yearVerdict(wanted, candidate) {
    if (!wanted || !candidate) return 'unknown';
    const diff = Math.abs(wanted - candidate);
    return diff === 0 ? 'exact' : diff <= 1 ? 'close' : 'mismatch';
}

function accepts(wanted, candidate) {
    return titlesMatch(wanted.titles, candidate.title) && yearVerdict(wanted.year, candidate.year) !== 'mismatch';
}

const YEAR_RANK = { exact: 0, close: 1, unknown: 2, mismatch: 3 };
function pickBest(wanted, candidates) {
    const accepted = candidates.filter(candidate => accepts(wanted, candidate));
    if (!accepted.length) return null;
    const norm = title => normalizeTokens(title).join(' ');
    const wantedNorms = wanted.titles.map(norm);
    accepted.sort((a, b) => {
        const year = YEAR_RANK[yearVerdict(wanted.year, a.year)] - YEAR_RANK[yearVerdict(wanted.year, b.year)];
        return year || Number(!wantedNorms.includes(norm(a.title))) - Number(!wantedNorms.includes(norm(b.title)));
    });
    return accepted[0];
}

function matchesStockageTitle(title, { imdbId, tmdbId, netflixId, type, ref } = {}) {
    if (!title) return false;
    const remoteType = ({ tv: 'series', series: 'series', show: 'series', movie: 'movie', film: 'movie' })[title.tmdb_type || title.type];
    if (type && remoteType && remoteType !== type) return false;
    const ids = [[imdbId, title.imdb_id], [tmdbId, title.tmdb_id], [netflixId, title.netflix_id]]
        .filter(([requested, returned]) => requested && returned);
    if (ids.length) return ids.every(([requested, returned]) => String(requested) === String(returned));
    // Sans identifiant comparable, le titre seul ne suffit pas à distinguer les homonymes.
    return !!(type && remoteType === type && ref?.year && Number(title.year) === Number(ref.year)
        && titlesMatch(ref.titlesNorm || [], title.name));
}

module.exports = { normalizeTokens, titlesMatch, expandTitles, yearVerdict, accepts, pickBest, matchesStockageTitle };
