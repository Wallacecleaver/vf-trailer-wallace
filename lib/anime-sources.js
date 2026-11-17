// ============================================================
// SOURCES ANIMÉ — AniList pour identifier précisément les œuvres japonaises.
// Pour les vidéos, on vérifie le trailer YouTube fourni par AniList avec oEmbed.
// Si son titre n'indique pas clairement VF/VOSTFR, le résolveur continue vers
// sa recherche YouTube habituelle (titre français + « bande annonce VF »).
// Aucun appel à Jikan : son API publique a été arrêtée en octobre 2026.
// ============================================================

const { fetchT, youtubeOembedUrl } = require('./net');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');
const { getAcceptedVideoTypes, formatStreamTitle } = require('./stream-format');
const { extractYoutubeId } = require('./tvdb');
const { matchesSeasonVideo } = require('./season-match');

const ANILIST_URL = 'https://graphql.anilist.co';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const searchCache = new Map();
const searchInFlight = new Map();

const ANILIST_QUERY = `
query ($search: String!) {
  Media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
    id
    title { romaji english native userPreferred }
    synonyms
    startDate { year }
    trailer { id site }
  }
}`;

function normalizeAnimeTitle(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, ' ')
        .replace(/\b(?:season|saison|cour)\s+\d+\b/g, ' ')
        .replace(/\b(season|saison|part|partie|cour|tv|the|a|an|le|la|les|un|une|des|l)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function animeTitleMatches(candidate, titles) {
    const aliases = [
        candidate && candidate.title && candidate.title.english,
        candidate && candidate.title && candidate.title.romaji,
        candidate && candidate.title && candidate.title.native,
        candidate && candidate.title && candidate.title.userPreferred,
        ...(candidate && Array.isArray(candidate.synonyms) ? candidate.synonyms : []),
    ].map(normalizeAnimeTitle).filter(Boolean);
    const wanted = (titles || []).map(normalizeAnimeTitle).filter(Boolean);
    return wanted.some(title => aliases.some(alias =>
        alias === title || (Math.min(alias.length, title.length) >= 8 &&
            (alias.startsWith(title + ' ') || title.startsWith(alias + ' ')))
    ));
}

function isFrenchAnimeVideo(name, languageMode = 'vf') {
    const value = String(name || '');
    const vf = hasVfSignal(value) && !hasNonVfSignal(value);
    const vostfr = /\bvostfr\b|\bfr(?:ench)?\s*sub(?:title)?s?\b|\bsous[- ]titres?\s+fran[çc]ais\b/i.test(value);
    if (languageMode === 'vo') return vostfr;
    if (languageMode === 'both') return vf || vostfr;
    return vf;
}

function getAniListTrailerCandidate(anime) {
    const trailer = anime && anime.trailer;
    if (!trailer || String(trailer.site || '').toLowerCase() !== 'youtube') return null;
    const ytId = extractYoutubeId(trailer.id);
    return ytId ? { ytId } : null;
}

async function fetchAniListCandidate(search) {
    const response = await fetchT(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: ANILIST_QUERY, variables: { search } }),
    }, 9000);
    if (!response.ok) return null;
    const json = await response.json().catch(() => null);
    return json && json.data && json.data.Media || null;
}

async function findAnime(titles, year) {
    const candidates = [];
    for (const query of (titles || []).filter(Boolean).slice(0, 4)) {
        try {
            const results = await fetchAniListCandidate(query);
            if (Array.isArray(results)) candidates.push(...results.filter(Boolean));
        } catch {
            // Une recherche AniList en échec ne doit pas empêcher les autres sources.
        }
        const match = candidates.find(item => animeTitleMatches(item, titles));
        if (match) {
            const candidateYear = Number(match.startDate && match.startDate.year);
            if (!year || !candidateYear || Math.abs(candidateYear - Number(year)) <= 1) return match;
        }
    }
    return candidates.find(item => animeTitleMatches(item, titles) &&
        (!year || !item.startDate || !item.startDate.year || Math.abs(Number(item.startDate.year) - Number(year)) <= 1)) || null;
}

async function resolveAnimeTrailers({ titles, officialTitle, year, season, behavior = {} }) {
    const searchTitles = [...new Set((titles || []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
    if (officialTitle && !searchTitles.includes(officialTitle)) searchTitles.unshift(officialTitle);
    if (!searchTitles.length) return { streams: [], title: officialTitle || null, reason: 'Titre d’animé manquant.' };

    const cacheKey = `${searchTitles.slice(0, 3).join('|')}:${year || ''}:${season || ''}:${behavior.languageMode || 'vf'}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (searchInFlight.has(cacheKey)) return searchInFlight.get(cacheKey);

    const pending = (async () => {
        const anime = await findAnime(searchTitles, year);
        if (!anime) return { streams: [], title: officialTitle || null, reason: 'Aucun animé correspondant trouvé sur AniList.' };

        const candidate = getAniListTrailerCandidate(anime);
        if (!candidate) {
            return {
                streams: [],
                title: officialTitle || anime.title && (anime.title.english || anime.title.romaji) || null,
                reason: 'Animé identifié par AniList, mais aucun trailer YouTube fourni.',
                anilistId: anime.id,
            };
        }

        let videoTitle = '';
        try {
            const response = await fetchT(youtubeOembedUrl(candidate.ytId), {}, 8000);
            if (response.ok) {
                const data = await response.json().catch(() => null);
                videoTitle = String(data && data.title || '').trim();
            }
        } catch {
            // Si oEmbed est bloqué, le repli YouTube VF général reste disponible.
        }

        const streams = [];
        const teaserFallback = [];
        const type = /teaser|preview/i.test(videoTitle) ? 'Teaser' : 'Trailer';
        const accepted = getAcceptedVideoTypes(behavior);
        const seasonOk = !season || matchesSeasonVideo(videoTitle, season, { scoped: false });
        if (videoTitle && seasonOk && isFrenchAnimeVideo(videoTitle, behavior.languageMode || 'vf')
            && accepted.includes(type)) {
            const entry = {
                title: formatStreamTitle(type, officialTitle || searchTitles[0], season),
                ytId: candidate.ytId,
            };
            if (type === 'Teaser' && behavior.ignoreTeasers) teaserFallback.push(entry);
            else streams.push(entry);
        }

        const max = Math.max(1, Math.min(10, Number(behavior.maxTrailers) || 2));
        return {
            streams: streams.slice(0, max),
            teaserFallback: teaserFallback.slice(0, max),
            title: officialTitle || anime.title && (anime.title.english || anime.title.romaji) || null,
            reason: streams.length
                ? 'Bande-annonce AniList vérifiée comme française via YouTube'
                : !seasonOk && Number(season) >= 2
                    ? `Le trailer AniList ne mentionne pas la saison ${season}.`
                    : 'Le trailer AniList n’indique pas explicitement une VF/VOSTFR ; recherche YouTube VF utilisée en repli.',
            anilistId: anime.id,
        };
    })().catch(() => ({ streams: [], title: officialTitle || null, reason: 'AniList est momentanément indisponible.' }))
        .then(value => {
            searchCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
            while (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
            return value;
        })
        .finally(() => searchInFlight.delete(cacheKey));

    searchInFlight.set(cacheKey, pending);
    return pending;
}

module.exports = {
    normalizeAnimeTitle,
    animeTitleMatches,
    isFrenchAnimeVideo,
    getAniListTrailerCandidate,
    resolveAnimeTrailers,
};
