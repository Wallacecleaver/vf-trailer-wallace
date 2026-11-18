// Résolution réservée à /aiom-direct. Le catalogue Stockage BD est consulté en lecture seule.
const { getOverride } = require('./overrides');
const { buildOverrideLinks } = require('./override-links');
const { getCached, setCached } = require('./cache');
const { normalizeBaseUrl } = require('./netflix-federation');
const { safeFetch } = require('./security');
const { probeDirectLink } = require('./media-link');
const { findByImdb, getTitleAndYear, getAlternativeTitles } = require('./tmdb');
const { buildRef } = require('./title-match');
const { getAllocineTrailerStreams } = require('./allocine');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');

const inflight = new Map();
const CACHE_SECONDS = 300;

function publicVideoUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password
            && !/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com)$/i.test(url.hostname)) {
            return url;
        }
    } catch { /* URL absente ou invalide */ }
    return null;
}

async function stockageJson(base, pathname, apiKey, body) {
    const headers = { accept: 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    if (body) headers['content-type'] = 'application/json';
    const options = body ? { method: 'POST', body: JSON.stringify(body) } : {};
    try {
        const res = await safeFetch(base + pathname, { ...options, headers, signal: AbortSignal.timeout(3500), size: 256 * 1024 },
            { maxRedirects: 0 });
        if (res.ok) return await res.json();
        res.body?.destroy?.();
    } catch { /* Source indisponible, le résolveur essaie le repli */ }
    return null;
}

function isFrenchTrailer(trailer) {
    if (!trailer || trailer.kind === 'extra' || hasNonVfSignal(trailer.title || '')) return false;
    const lang = String(trailer.lang || '').trim();
    return lang ? /^fr(?:a|e)?(?:[-_][a-z]+)?$/i.test(lang) : hasVfSignal(trailer.title || '');
}

async function findStoredVideo(base, key, type, imdbId, season, ignoreTeasers) {
    const params = new URLSearchParams({ imdb: imdbId, type, fast: '1' });
    if (season) {
        params.set('season', season);
        if (Number(season) >= 2) params.set('strict_season', '1');
    }
    const data = await stockageJson(base, '/api/v1/trailers?' + params, key);
    const trailers = Array.isArray(data?.trailers) ? data.trailers : [];
    const candidates = trailers.filter(trailer => isFrenchTrailer(trailer)
        && (!season || trailer.season == null && Number(season) === 1 || trailer.season === Number(season)));
    const isTeaser = trailer => trailer.kind === 'teaser' || /\bteaser\b/i.test(trailer.title || '');
    const ordered = [...candidates.filter(t => !isTeaser(t)), ...candidates.filter(t => isTeaser(t))];
    for (const trailer of ordered) {
        if (ignoreTeasers && isTeaser(trailer)) continue;
        const url = publicVideoUrl(trailer.url);
        if (url && /\.mp4$/i.test(url.pathname)) {
            return { title: trailer.title || 'Bande-annonce VF', url: url.href };
        }
    }
    return null;
}

async function pickVideo(candidates, base, writeKey) {
    const urls = [...new Set(candidates.map(value => publicVideoUrl(value)?.href).filter(Boolean))].slice(0, 4);
    const checked = await Promise.all(urls.map(async url => ({ url, ...(await probeDirectLink(url, 3000)) })));
    const mp4 = checked.find(video => video.ok && video.media === 'mp4');
    if (mp4) return mp4.url;

    const hls = checked.find(video => video.ok && video.media === 'hls'
        && /\.m3u8$/i.test(new URL(video.url).pathname));
    if (!hls || !base || !writeKey) return null;
    const result = await stockageJson(base, '/api/v1/aiom-direct/hls', writeKey, { url: hls.url });
    const relay = publicVideoUrl(result?.url);
    return relay && /^\/aiom-direct\/media\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.mp4$/.test(relay.pathname) ? relay.href : null;
}

async function findAllocineVideo(type, imdbId, season, tmdbKey, base, writeKey) {
    if (!tmdbKey || Number(season) >= 2) return null;
    const results = await findByImdb(imdbId, tmdbKey);
    const match = type === 'movie' ? results?.movie_results?.[0] : results?.tv_results?.[0];
    if (!match) return null;

    const mediaType = type === 'movie' ? 'movie' : 'tv';
    const [{ title, originalTitle, year }, alternativeTitles] = await Promise.all([
        getTitleAndYear(mediaType, match.id, tmdbKey),
        getAlternativeTitles(mediaType, match.id, tmdbKey),
    ]);
    if (!title) return null;
    const ref = buildRef({ tmdbId: match.id, year, allTitles: [title, originalTitle, ...alternativeTitles].filter(Boolean), allPosterPaths: [] });
    const candidates = await getAllocineTrailerStreams(title, ref, { mediaType, directOnly: true });
    const url = await pickVideo(candidates.map(stream => stream.url), base, writeKey);
    return url ? { title: 'Bande-annonce VF · ' + title, url } : null;
}

async function resolveDirect(type, imdbId, season, tmdbKey, behavior) {
    const base = normalizeBaseUrl(behavior.netflixCatalogueUrl);
    const key = behavior.netflixCatalogueKey;
    const writeKey = process.env.AIOM_DIRECT_STOCKAGE_WRITE_KEY || key;
    const override = await getOverride(imdbId, season);
    if (override?.hidden) return { streams: [] };

    // L'override peut changer indépendamment du cache des sources.
    if (override) {
        const url = await pickVideo(buildOverrideLinks(override).map(link => link.url), base, writeKey);
        if (url) return { streams: [{ title: override.title || 'Bande-annonce VF', url }] };
    }

    const cacheKey = ['cache:aiom-direct:v1', type, imdbId, season, base,
        !!behavior.allocineFallback, !!behavior.ignoreTeasers].join(':');
    if (behavior.cacheEnabled) {
        const hit = await getCached(cacheKey);
        if (hit) return { streams: [hit] };
    }

    const stored = base && await findStoredVideo(base, key, type, imdbId, season, behavior.ignoreTeasers);
    const stream = stored || (behavior.allocineFallback
        && await findAllocineVideo(type, imdbId, season, tmdbKey, base, writeKey));
    if (stream && behavior.cacheEnabled) await setCached(cacheKey, stream, CACHE_SECONDS);
    return { streams: stream ? [stream] : [] };
}

function resolveAiomDirect(type, imdbId, season, tmdbKey, behavior) {
    const key = [type, imdbId, season].join(':');
    const running = inflight.get(key);
    if (running) return running;
    const work = resolveDirect(type, imdbId, season, tmdbKey, behavior)
        .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
}

module.exports = { resolveAiomDirect };
