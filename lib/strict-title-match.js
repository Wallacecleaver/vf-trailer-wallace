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
    const candidate = new Set(normalizeTokens(candidateTitle));
    if (!candidate.size) return false;
    return wantedTitles.some(title => {
        const wanted = new Set(normalizeTokens(title));
        return wanted.size > 0 && wanted.size === candidate.size && [...wanted].every(word => candidate.has(word));
    });
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

module.exports = { normalizeTokens, titlesMatch, expandTitles, yearVerdict, accepts, pickBest };
