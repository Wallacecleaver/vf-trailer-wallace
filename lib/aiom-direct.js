// Résolution des liens vidéo directs pour /aiom-direct et /direct.
const { getOverride } = require('./overrides');
const { buildOverrideLinks } = require('./override-links');
const { getCached, setCached } = require('./cache');
const { normalizeBaseUrl } = require('./netflix-federation');
const { safeFetch } = require('./security');
const { probeDirectLink } = require('./media-link');
const { findByImdb, getTitleAndYear, getAlternativeTitles } = require('./tmdb');
const { buildRef } = require('./title-match');
const { ALLOCINE_CACHE_VERSION, getAllocineTrailerStreams } = require('./allocine');
const { getTitleFromImdb } = require('./imdb-title');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');
const { matchesStockageTitle } = require('./strict-title-match');
const { matchesStockageSeason } = require('./season-match');
const { fillStockageAudioLanguages } = require('./mp4-audio');
const { resolveViaApis } = require('./resolve-apis');
const { toAiomStreams } = require('./stream-format');
const { withDeadline } = require('./aiom');

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

async function stockageResponse(base, pathname, apiKey, body) {
    const headers = { accept: 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    if (body) headers['content-type'] = 'application/json';
    const options = body ? { method: 'POST', body: JSON.stringify(body) } : {};
    try {
        const res = await safeFetch(base + pathname, { ...options, headers, signal: AbortSignal.timeout(3500), size: 256 * 1024 },
            { maxRedirects: 0 });
        if (res.ok) return { data: await res.json().catch(() => null), status: res.status };
        res.body?.destroy?.();
        return { data: null, status: res.status };
    } catch { /* Source indisponible, le résolveur essaie le repli */ }
    return { data: null, status: null };
}

async function stockageJson(base, pathname, apiKey, body) {
    return (await stockageResponse(base, pathname, apiKey, body)).data;
}

function isFrenchTrailer(trailer) {
    if (!trailer || trailer.kind === 'extra' || hasNonVfSignal(trailer.title || '')) return false;
    const lang = String(trailer.lang || '').trim();
    return lang ? /^fr(?:a|e)?(?:[-_][a-z]+)?$/i.test(lang) : hasVfSignal(trailer.title || '');
}

async function findStoredVideo(base, key, type, imdbId, season, ignoreTeasers, allowHls) {
    const params = new URLSearchParams({ imdb: imdbId, type, fast: '1' });
    if (season) {
        params.set('season', season);
        if (Number(season) >= 2) params.set('strict_season', '1');
    }
    const data = await stockageJson(base, '/api/v1/trailers?' + params, key);
    if (!matchesStockageTitle(data?.title, { imdbId, type })) return null;
    const trailers = Array.isArray(data?.trailers) ? data.trailers : [];
    const matchingSeason = trailers.filter(trailer => trailer && matchesStockageSeason(trailer, season));
    const candidates = (await fillStockageAudioLanguages(matchingSeason)).filter(isFrenchTrailer);
    const isTeaser = trailer => trailer.kind === 'teaser' || /\bteaser\b/i.test(trailer.title || '');
    const ordered = [...candidates.filter(t => !isTeaser(t)), ...candidates.filter(t => isTeaser(t))];
    for (const trailer of ordered) {
        if (ignoreTeasers && isTeaser(trailer)) continue;
        const url = publicVideoUrl(trailer.url);
        if (url && (/\.mp4$/i.test(url.pathname) || (allowHls && /\.m3u8$/i.test(url.pathname)))) {
            return { title: trailer.title || 'Bande-annonce VF', url: url.href,
                officialTitle: data.title.name, provider: 'Stockage BD' };
        }
    }
    return null;
}

async function pickVideo(candidates, base, writeKey, allowHls) {
    const urls = [...new Set(candidates.map(value => publicVideoUrl(value)?.href).filter(Boolean))].slice(0, 4);
    const checked = await Promise.all(urls.map(async url => ({ url, ...(await probeDirectLink(url, 3000)) })));
    const mp4 = checked.find(video => video.ok && video.media === 'mp4');
    if (mp4) return mp4.url;

    const hls = checked.find(video => video.ok && video.media === 'hls'
        && /\.m3u8$/i.test(new URL(video.url).pathname));
    if (!hls) return null;
    if (allowHls) return hls.url;
    if (!base || !writeKey) return null;
    const result = await stockageJson(base, '/api/v1/aiom-direct/hls', writeKey, { url: hls.url });
    const relay = publicVideoUrl(result?.url);
    return relay && /^\/aiom-direct\/media\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.mp4$/.test(relay.pathname) ? relay.href : null;
}

async function findAllocineVideo(type, imdbId, season, tmdbKey, base, writeKey, allowHls, matchLaterSeasons = false) {
    if (!tmdbKey || (!matchLaterSeasons && Number(season) >= 2)) return null;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    const results = await findByImdb(imdbId, tmdbKey);
    const match = type === 'movie' ? results?.movie_results?.[0] : results?.tv_results?.[0];

    let title, ref;
    if (match) {
        const [{ title: tmdbTitle, originalTitle, year }, alternativeTitles] = await Promise.all([
            getTitleAndYear(mediaType, match.id, tmdbKey),
            getAlternativeTitles(mediaType, match.id, tmdbKey),
        ]);
        if (!tmdbTitle) return null;
        title = tmdbTitle;
        ref = buildRef({ tmdbId: match.id, year, allTitles: [title, originalTitle, ...alternativeTitles].filter(Boolean), allPosterPaths: [] });
    } else {
        // Titre trop récent pour TMDB (IMDB ID pas encore relié) : on retrouve le nom via Cinemeta / IMDb.
        const meta = await getTitleFromImdb(imdbId, type);
        if (!meta) return null;
        title = meta.title;
        ref = buildRef({ tmdbId: null, year: meta.year, allTitles: [meta.title], allPosterPaths: [] });
    }
    const candidates = await getAllocineTrailerStreams(title, ref, { mediaType, season, directOnly: true });
    const url = await pickVideo(candidates.map(stream => stream.url), base, writeKey, allowHls);
    return url ? { title: 'Bande-annonce VF · ' + title, url, officialTitle: title, provider: 'Allociné',
        allocineCacheVersion: ALLOCINE_CACHE_VERSION } : null;
}

function directResult(video) {
    if (!video) return { streams: [] };
    const { title, url, officialTitle, provider } = video;
    return { streams: [{ title, url }], officialTitle, provider };
}

async function resolveDirect(type, imdbId, season, tmdbKey, behavior, allowHls) {
    const base = normalizeBaseUrl(behavior.netflixCatalogueUrl);
    const key = behavior.netflixCatalogueKey;
    const writeKey = process.env.AIOM_DIRECT_STOCKAGE_WRITE_KEY || key;
    const override = await getOverride(imdbId, season);
    if (override?.hidden) return { streams: [] };

    // L'override peut changer indépendamment du cache des sources.
    if (override) {
        const url = await pickVideo(buildOverrideLinks(override).map(link => link.url), base, writeKey, allowHls);
        if (url) return directResult({ title: override.title || 'Bande-annonce VF', url,
            officialTitle: override.title, provider: 'Mapping' });
    }

    const cacheScope = allowHls ? 'cache:direct:v1' : 'cache:aiom-direct:v3';
    const cacheKey = [cacheScope, type, imdbId, season, base,
        !!behavior.allocineFallback, !!behavior.ignoreTeasers].join(':');
    if (behavior.cacheEnabled) {
        const hit = await getCached(cacheKey);
        if (hit && (hit.provider !== 'Allociné' || hit.allocineCacheVersion === ALLOCINE_CACHE_VERSION)) return directResult(hit);
    }

    const stored = base && await findStoredVideo(base, key, type, imdbId, season, behavior.ignoreTeasers, allowHls);
    const stream = stored || (behavior.allocineFallback
        && await findAllocineVideo(type, imdbId, season, tmdbKey, base, writeKey, allowHls));
    if (stream && behavior.cacheEnabled) await setCached(cacheKey, stream, CACHE_SECONDS);
    return directResult(stream);
}

function resolveAiomDirect(type, imdbId, season, tmdbKey, behavior, { allowHls = false } = {}) {
    const key = [type, imdbId, season, allowHls].join(':');
    const running = inflight.get(key);
    if (running) return running;
    const work = resolveDirect(type, imdbId, season, tmdbKey, behavior, allowHls)
        .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
}

const youtubeLookups = new Map();
function findYoutube(type, imdbId, season, tmdbKey, behavior) {
    if (!tmdbKey) return Promise.resolve(null);
    const key = ['cache:aiom-youtube:v1', type, imdbId, season, !!behavior.youtubeSearchFallback,
        !!behavior.ignoreTeasers, JSON.stringify(behavior.extraVfKeywords || [])].join(':');
    const current = youtubeLookups.get(key);
    if (current) return current;
    const work = (async () => {
        const hit = behavior.cacheEnabled && await getCached(key);
        if (hit) return hit.stream;
        const { streams, officialTitle } = await resolveViaApis(type, imdbId, season, {
            ...behavior, trailerLanguage: 'fr-only', includeExtras: false,
            allocineFallback: false, netflixCatalogueUrl: '',
        }, tmdbKey);
        const eligible = streams.filter(stream => stream.ytId && (!behavior.ignoreTeasers || !/^Teaser\b/i.test(stream.title || '')));
        const [stream] = toAiomStreams(eligible);
        const candidate = stream ? { ytId: stream.ytId, title: stream.title, officialTitle } : null;
        if (behavior.cacheEnabled) await setCached(key, { stream: candidate }, candidate ? 900 : 60);
        return candidate;
    })().finally(() => youtubeLookups.delete(key));
    youtubeLookups.set(key, work);
    return work;
}

async function findNuvioTrailer(type, imdbId, season, tmdbKey, behavior) {
    const override = await getOverride(imdbId, season);
    if (override?.hidden || behavior.youtubeEnabled === false) return null;
    const manual = override && buildOverrideLinks(override).find(link => link.ytId);
    if (manual) return { ytId: manual.ytId, officialTitle: override.title };
    return findYoutube(type, imdbId, season, tmdbKey, behavior);
}

async function findYoutubeVideo(base, key, candidate) {
    const id = candidate?.ytId;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { youtubeRelay: { reason: 'Aucun candidat YouTube VF' } };
    const { data: result, status } = await stockageResponse(base, '/api/v1/aiom-direct/youtube', key, { ytId: id });
    const youtubeRelay = { videoId: id, httpStatus: status };
    if (status == null) youtubeRelay.reason = 'Stockage DB ne répond pas';
    if (result?.pending) return { pending: true, youtubeRelay };
    const url = publicVideoUrl(result?.url);
    if (result?.height !== 1080 || url?.pathname !== `/aiom-direct/youtube/${id}.mp4`) {
        if (status >= 200 && status < 300) youtubeRelay.reason = 'MP4 1080p absent de la réponse';
        return { youtubeRelay };
    }
    return { video: { title: 'Bande-annonce VF · YouTube 1080p', url: url.href,
        officialTitle: candidate.officialTitle, provider: 'youtube_1080p' }, youtubeRelay };
}

async function resolveAiomSources(type, imdbId, season, tmdbKey, behavior, timeoutMs) {
    const base = normalizeBaseUrl(behavior.netflixCatalogueUrl);
    const readKey = behavior.netflixCatalogueKey;
    const writeKey = process.env.AIOM_DIRECT_STOCKAGE_WRITE_KEY || readKey;
    const override = await getOverride(imdbId, season);
    if (override?.hidden) return { streams: [], hidden: true, officialTitle: override.title };
    const links = override ? buildOverrideLinks(override) : [];
    const manualUrls = links.map(link => link.url).filter(Boolean);
    const fallbackKey = ['cache:aiom-fallback:v1', type, imdbId, season, base,
        !!behavior.allocineFallback, !!tmdbKey, !!writeKey, !!behavior.ignoreTeasers].join(':');
    const fallback = behavior.cacheEnabled && await getCached(fallbackKey);
    const cached = fallback && (fallback.source !== 'allocine' || fallback.video?.allocineCacheVersion === ALLOCINE_CACHE_VERSION)
        ? fallback : null;
    const failed = { pending: true };
    const youtube = base && writeKey && behavior.youtubeEnabled !== false
        ? withDeadline((async () => {
            const mapped = links.find(link => link.ytId);
            const candidate = mapped ? { ytId: mapped.ytId, officialTitle: override.title }
                : await findYoutube(type, imdbId, season, tmdbKey, behavior);
            return findYoutubeVideo(base, writeKey, candidate);
        })().catch(() => ({ youtubeRelay: { reason: 'Recherche YouTube VF en échec' } })), timeoutMs * 0.65,
        { pending: true, youtubeRelay: { reason: 'Délai YouTube dépassé' } })
        : { youtubeRelay: { reason: behavior.youtubeEnabled === false ? 'YouTube désactivé'
            : !base ? 'URL Stockage DB absente' : 'Clé Stockage DB absente' } };

    // Démarre les replis ensemble pour que les sources lentes ne consomment pas le délai l'une après l'autre.
    const manual = manualUrls.length && withDeadline(pickVideo(manualUrls, base, writeKey, false).catch(() => null), timeoutMs * 0.7, null);
    const allocine = !cached && behavior.allocineFallback && withDeadline(
        findAllocineVideo(type, imdbId, season, tmdbKey, base, writeKey, false, true).catch(() => null), timeoutMs * 0.85, failed);
    const stored = !cached && base && withDeadline(
        findStoredVideo(base, readKey, type, imdbId, season, behavior.ignoreTeasers, false).catch(() => null), timeoutMs * 0.9, failed);

    const manualUrl = await manual;
    if (manualUrl) return { ...directResult({ title: override.title || 'Bande-annonce VF', url: manualUrl,
        officialTitle: override.title }), source: 'override' };
    const preferred = await youtube;
    const { youtubeRelay } = preferred;
    if (preferred.video) return { ...directResult(preferred.video), source: 'youtube_1080p', youtubeRelay };
    if (cached) return { ...directResult(cached.video), source: cached.source, fromCache: true, pending: !!preferred.pending, youtubeRelay };

    const first = await allocine;
    const last = !first || first.pending ? await stored : null;
    const video = first && !first.pending ? first : last && !last.pending ? last : null;
    const source = video ? (video === first ? 'allocine' : 'netflix_catalogue') : null;
    if (video && !first?.pending && behavior.cacheEnabled) await setCached(fallbackKey, { video, source }, CACHE_SECONDS);
    const pending = !!(preferred.pending || first?.pending || last?.pending);
    return { ...directResult(video), source, pending, timedOut: !video && !!(first?.pending || last?.pending), youtubeRelay };
}

function resolveSharedAiom(type, imdbId, season, tmdbKey, behavior, timeoutMs) {
    const key = ['aiom', type, imdbId, season].join(':');
    const running = inflight.get(key);
    if (running) return running;
    const work = resolveAiomSources(type, imdbId, season, tmdbKey, behavior, timeoutMs)
        .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
}

module.exports = { resolveAiomDirect, resolveSharedAiom, findNuvioTrailer };
