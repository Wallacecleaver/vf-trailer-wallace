// ============================================================
// THETVDB V4 — récupération des bandes-annonces officielles.
// La clé est une clé de PROJET (TVDB_API_KEY côté serveur ou clé de projet fournie
// dans /configure). Aucun PIN n'est demandé par ce mode d'authentification.
// Les jetons Bearer sont mémorisés en mémoire 28 jours (TVDB annonce 1 mois).
// ============================================================

const crypto = require('crypto');
const { fetchT } = require('./net');
const { hasVfSignal } = require('./video-filters');
const { getAcceptedVideoTypes, formatStreamTitle } = require('./stream-format');
const { matchesSeasonVideo } = require('./season-match');

const API = 'https://api4.thetvdb.com/v4';
const TOKEN_TTL_MS = 28 * 24 * 60 * 60 * 1000;
const tokenCache = new Map();
const tokenInFlight = new Map();

function credentialKey(apiKey) {
    return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

async function authenticateTvdb(apiKey) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) return { valid: false, error: 'Clé API TheTVDB manquante.' };

    try {
        const response = await fetchT(`${API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ apikey: cleanKey }),
        }, 5000);
        const data = await response.json().catch(() => ({}));
        const token = data && data.data && data.data.token;
        if (!response.ok || !token) {
            return {
                valid: false,
                error: response.status === 401
                    ? 'Clé API TheTVDB invalide.'
                    : `TheTVDB a répondu HTTP ${response.status}.`,
            };
        }
        return { valid: true, token };
    } catch {
        return { valid: false, error: 'TheTVDB est momentanément injoignable.' };
    }
}

async function getToken(apiKey, forceRefresh = false) {
    const key = credentialKey(apiKey);
    const cached = tokenCache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
    if (!forceRefresh && tokenInFlight.has(key)) return tokenInFlight.get(key);

    const pending = authenticateTvdb(apiKey).then(result => {
        if (!result.valid) return null;
        tokenCache.set(key, { token: result.token, expiresAt: Date.now() + TOKEN_TTL_MS });
        while (tokenCache.size > 100) tokenCache.delete(tokenCache.keys().next().value);
        return result.token;
    }).finally(() => tokenInFlight.delete(key));
    tokenInFlight.set(key, pending);
    return pending;
}

async function tvdbGet(path, apiKey, retry = true) {
    const token = await getToken(apiKey, !retry);
    if (!token) return null;
    const response = await fetchT(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 5000);
    if (response.status === 401 && retry) return tvdbGet(path, apiKey, false);
    if (!response.ok) return null;
    const json = await response.json().catch(() => null);
    return json && json.data != null ? json.data : null;
}

function extractYoutubeId(value) {
    const raw = String(value || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'youtu.be') {
            const id = url.pathname.split('/').filter(Boolean)[0];
            return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
        }
        if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtube-nocookie.com') return null;
        const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
        return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch {
        return null;
    }
}

function isFrenchTrailerLanguage(trailer) {
    const language = String(trailer && trailer.language || '').trim().toLowerCase();
    const french = ['fr', 'fra', 'fre', 'french', 'français', 'francais'];
    if (language) return french.includes(language);
    return hasVfSignal(trailer && trailer.name);
}

function normalizeTvdbTrailers(records, officialTitle, season, behavior = {}) {
    const accepted = getAcceptedVideoTypes(behavior);
    const output = [];
    for (const trailer of Array.isArray(records) ? records : []) {
        const name = String(trailer && trailer.name || '').trim();
        const type = /teaser/i.test(name) ? 'Teaser' : 'Trailer';
        if (!name || !accepted.includes(type)) continue;
        if (type === 'Teaser' && behavior.ignoreTeasers) continue;
        if (!isFrenchTrailerLanguage(trailer)) continue;
        const ytId = extractYoutubeId(trailer.url);
        if (!ytId) continue;
        output.push({
            title: formatStreamTitle(type, officialTitle, season),
            ytId,
        });
    }
    return output.slice(0, Math.max(1, Math.min(10, Number(behavior.maxTrailers) || 2)));
}

async function getTvdbTrailers({ imdbId, type, season, apiKey, behavior = {} }) {
    const key = String(apiKey || process.env.TVDB_API_KEY || '').trim();
    if (!key || !/^tt\d{6,10}$/.test(String(imdbId || ''))) return { streams: [], title: null, reason: 'TheTVDB non configuré ou IMDb ID invalide.' };

    try {
        const matches = await tvdbGet(`/search/remoteid/${encodeURIComponent(imdbId)}`, key);
        if (!Array.isArray(matches)) return { streams: [], title: null, reason: 'Recherche IMDb TheTVDB indisponible.' };

        const entityKey = type === 'series' ? 'series' : 'movie';
        const match = matches.find(item => item && item[entityKey] && item[entityKey].id);
        if (!match) return { streams: [], title: null, reason: 'Aucun titre correspondant dans TheTVDB.' };

        const basic = match[entityKey];
        const extendedPath = type === 'series'
            ? `/series/${encodeURIComponent(basic.id)}/extended`
            : `/movies/${encodeURIComponent(basic.id)}/extended`;
        const extended = await tvdbGet(extendedPath, key);
        if (!extended) return { streams: [], title: basic.name || null, reason: 'Fiche étendue TheTVDB indisponible.' };

        const officialTitle = extended.name || basic.name || null;
        let seasonRecords = [];
        if (type === 'series' && season != null && Array.isArray(extended.seasons)) {
            const seasonNumber = Number(season);
            const defaultType = Number(extended.defaultSeasonType || 0);
            const candidates = extended.seasons.filter(item =>
                Number(item.number) === seasonNumber &&
                (!defaultType || !item.type || Number(item.type.id) === defaultType)
            );
            const selected = candidates[0] || extended.seasons.find(item => Number(item.number) === seasonNumber);
            if (selected && selected.id) {
                const seasonData = await tvdbGet(`/seasons/${encodeURIComponent(selected.id)}/extended`, key);
                if (seasonData && Array.isArray(seasonData.trailers)) {
                    seasonRecords = seasonData.trailers.filter(t => matchesSeasonVideo(t && t.name, season, { scoped: true }));
                }
            }
        }

        // Pour la saison 1 (ou sans saison), la BA générale de la série sert de repli.
        // Pour une saison >= 2, une BA générale n'est retenue que si son nom mentionne explicitement cette saison.
        const globalRecords = Array.isArray(extended.trailers)
            ? extended.trailers.filter(t => type !== 'series' || matchesSeasonVideo(t && t.name, season, { scoped: false }))
            : [];
        const records = seasonRecords.length ? seasonRecords : globalRecords;
        const streams = normalizeTvdbTrailers(records, officialTitle, season, behavior);
        const teaserFallback = (!streams.length && behavior.ignoreTeasers)
            ? normalizeTvdbTrailers(records, officialTitle, season, { ...behavior, ignoreTeasers: false })
            : [];
        return {
            streams,
            teaserFallback,
            title: officialTitle,
            reason: streams.length ? `${streams.length} bande(s)-annonce(s) française(s) trouvée(s)` : 'Aucune bande-annonce française publiée sur TheTVDB.',
        };
    } catch (err) {
        return { streams: [], title: null, reason: `Erreur TheTVDB : ${String(err.message || err).slice(0, 120)}` };
    }
}

module.exports = {
    authenticateTvdb,
    getTvdbTrailers,
    extractYoutubeId,
    isFrenchTrailerLanguage,
    normalizeTvdbTrailers,
};
