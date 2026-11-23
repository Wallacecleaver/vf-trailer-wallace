// Retrouve le titre (et l'année) d'un IMDB ID quand TMDB ne le connaît pas encore.
// Sources, dans l'ordre : Cinemeta (le catalogue de Stremio) puis l'API de suggestion d'IMDb.
// Résilient : toute erreur réseau renvoie null, jamais d'exception.

const { fetchT } = require('./net');

function yearOf(raw) {
    const m = String(raw || '').match(/(?:19|20)\d{2}/);
    return m ? m[0] : null;
}

async function fetchCinemetaMeta(imdbId, type, timeoutMs = 5000) {
    const kind = type === 'movie' ? 'movie' : 'series';
    const res = await fetchT(`https://v3-cinemeta.strem.io/meta/${kind}/${encodeURIComponent(imdbId)}.json`,
        { signal: AbortSignal.timeout(timeoutMs) }, timeoutMs);
    if (!res.ok) return null;
    return (await res.json())?.meta || null;
}

async function fromCinemeta(imdbId, type) {
    const meta = await fetchCinemetaMeta(imdbId, type);
    if (!meta || !meta.name) return null;
    return { title: meta.name, originalTitle: null, year: yearOf(meta.year || meta.releaseInfo || meta.released), source: 'Cinemeta' };
}

async function fromImdbSuggestion(imdbId) {
    const res = await fetchT(`https://v3.sg.media-imdb.com/suggestion/t/${encodeURIComponent(imdbId)}.json`, {}, 5000);
    if (!res.ok) return null;
    const hit = ((await res.json()).d || []).find(d => d && d.id === imdbId);
    if (!hit || !hit.l) return null;
    return { title: hit.l, originalTitle: null, year: yearOf(hit.y), source: 'IMDb' };
}

async function getTitleFromImdb(imdbId, type) {
    for (const source of [() => fromCinemeta(imdbId, type), () => fromImdbSuggestion(imdbId)]) {
        try {
            const found = await source();
            if (found) return found;
        } catch { /* source suivante */ }
    }
    return null;
}

module.exports = { fetchCinemetaMeta, getTitleFromImdb };
