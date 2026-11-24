const { fetchT } = require('./net');
const { findNuvioTrailer } = require('./aiom-direct');

async function nuvioBaseMeta(type, imdbId, signal) {
    const response = await fetchT(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, {
        signal, size: 8 * 1024 * 1024,
    });
    if (!response.ok) {
        response.body?.destroy?.();
        return null;
    }
    const { meta } = await response.json();
    if (meta?.id !== imdbId || meta.type !== type || !meta.name) return null;
    if (type === 'series' && (!Array.isArray(meta.videos) || !meta.videos.length)) return null;
    return meta;
}

async function buildNuvioMeta(type, imdbId, season, tmdbKey, behavior, { strict, timeoutMs }) {
    const [base, trailer] = await Promise.all([
        nuvioBaseMeta(type, imdbId, AbortSignal.timeout(timeoutMs)),
        findNuvioTrailer(type, imdbId, season, tmdbKey, behavior),
    ]);
    if (!base) return null;
    const ytId = trailer?.ytId;
    const hasTrailer = typeof ytId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(ytId);
    if (!hasTrailer && !strict) return null;

    const name = trailer?.officialTitle || base.name;
    const title = `${name} · ${/^Teaser\b/i.test(trailer?.title || '') ? 'Teaser VF' : 'Bande-annonce VF'}`;
    return {
        ...base,
        name,
        links: (Array.isArray(base.links) ? base.links : []).filter(link => link && !link.trailers && link.category !== 'Trailers'),
        trailers: hasTrailer ? [{ key: ytId, source: ytId, site: 'YouTube', type: 'Trailer', name: title }] : [],
        trailerStreams: hasTrailer ? [{ ytId, title }] : [],
    };
}

module.exports = { buildNuvioMeta };
