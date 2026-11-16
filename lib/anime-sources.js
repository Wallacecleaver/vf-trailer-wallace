// ============================================================
// SOURCES ANIMÉ — AniList pour identifier l'œuvre, Jikan pour ses vidéos.
// Les deux API publiques fonctionnent sans clé personnelle.
// Important : on ne renvoie pas de bande-annonce japonaise/VO comme de la VF.
// Une vidéo n'est retenue que si son titre indique explicitement VF, français,
// French ou VOSTFR (selon le mode de langue choisi dans les réglages).
// ============================================================

const { fetchT } = require('./net');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');
const { getAcceptedVideoTypes, formatStreamTitle } = require('./stream-format');
const { extractYoutubeId } = require('./tvdb');

const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL = 'https://api.jikan.moe/v4';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const searchCache = new Map();
const searchInFlight = new Map();

const ANILIST_QUERY = `
query ($search: String!) {
  Media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
    id
    idMal
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
        .replace(/\b(season|saison|part|partie|cour|tv|the|a|an|le|la|les|un|une|des)\b/g, ' ')
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

function getJikanVideoCandidates(payload) {
    const data = payload && payload.data || {};
    const candidates = [];
    const direct = data.trailer;
    if (direct && (direct.youtube_id || direct.url)) {
        candidates.push({
            name: direct.title || '',
            url: direct.url || direct.youtube_id,
        });
    }
    for (const item of Array.isArray(data.promo) ? data.promo : []) {
        if (item && item.trailer && (item.trailer.youtube_id || item.trailer.url)) {
            candidates.push({
                name: item.title || item.trailer.title || '',
                url: item.trailer.url || item.trailer.youtube_id,
            });
        }
    }
    return candidates;
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
        if (!anime.idMal) return { streams: [], title: officialTitle || null, reason: 'Animé identifié sur AniList, mais sans identifiant MyAnimeList pour récupérer ses vidéos Jikan.' };

        let payload = null;
        try {
            const response = await fetchT(`${JIKAN_URL}/anime/${encodeURIComponent(anime.idMal)}/videos`, {}, 9000);
            if (response.ok) payload = await response.json().catch(() => null);
        } catch {
            // Jikan peut être momentanément limité ; on laisse la suite du résolveur travailler.
        }

        const accepted = getAcceptedVideoTypes(behavior);
        const streams = [];
        const seen = new Set();
        for (const item of getJikanVideoCandidates(payload)) {
            const name = String(item.name || '').trim();
            if (!name || !isFrenchAnimeVideo(name, behavior.languageMode || 'vf')) continue;
            const type = /teaser|preview/i.test(name) ? 'Teaser' : 'Trailer';
            if (!accepted.includes(type) || (type === 'Teaser' && behavior.ignoreTeasers)) continue;
            const ytId = extractYoutubeId(item.url);
            if (!ytId || seen.has(ytId)) continue;
            seen.add(ytId);
            streams.push({
                title: formatStreamTitle(type, officialTitle || searchTitles[0], season),
                ytId,
            });
        }

        return {
            streams: streams.slice(0, Math.max(1, Math.min(10, Number(behavior.maxTrailers) || 2))),
            title: officialTitle || anime.title && (anime.title.english || anime.title.romaji) || null,
            reason: streams.length
                ? `${streams.length} vidéo(s) explicitement française(s) trouvée(s) via Jikan`
                : 'Animé trouvé sur AniList, mais aucune vidéo promotionnelle explicitement VF/VOSTFR disponible sur Jikan.',
            anilistId: anime.id,
            malId: anime.idMal,
        };
    })().catch(() => ({ streams: [], title: officialTitle || null, reason: 'Sources animés temporairement indisponibles.' }))
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
    getJikanVideoCandidates,
    resolveAnimeTrailers,
};
