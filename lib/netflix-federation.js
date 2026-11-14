// ============================================================
// FÉDÉRATION NETFLIX CATALOGUE — récupère des bandes-annonces Netflix
// depuis une autre instance de l'addon « Netflix Catalogue ».
//
// Une seule information à fournir : l'URL de l'instance. Aucune clé API
// (l'instance amont doit avoir API_KEY vide ; sinon elle répond 401 et on
// l'explique dans le diagnostic).
//
// Endpoint amont : GET /api/trailers?imdb=… (ou ?tmdb=…&type=movie|series)
// Réponse : { found, title: {...}, trailers: [{ title, url, runtime, source }] }
// ============================================================

const fetch = require('node-fetch');

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000; // un résultat trouvé est gardé 6 h
const FAILURE_TTL_MS = 30 * 60 * 1000;     // un échec est retenté au bout de 30 min
const TIMEOUT_MS = 6000;

const cache = new Map(); // clé -> { at, ttl, result }

// « netflix.mondomaine.fr » -> « https://netflix.mondomaine.fr » ; slash final retiré.
function normalizeBaseUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url.replace(/\/+$/, '');
}

function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > hit.ttl) { cache.delete(key); return null; }
    return hit.result;
}

function cacheSet(key, result) {
    cache.set(key, { at: Date.now(), ttl: result.found ? SUCCESS_TTL_MS : FAILURE_TTL_MS, result });
    if (cache.size > 500) cache.clear();
    return result;
}

async function getJson(baseUrl, path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(baseUrl + path, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        let data = null;
        const text = await res.text();
        if (text) { try { data = JSON.parse(text); } catch { data = null; } }
        return { status: res.status, ok: res.ok, data };
    } finally {
        clearTimeout(timer);
    }
}

function httpReason(status) {
    if (status === 401 || status === 403) return 'Instance amont protégée par une clé API — laisse API_KEY vide sur l’instance Netflix Catalogue';
    if (status === 404) return 'Endpoint introuvable : vérifie l’URL (est-ce bien une instance Netflix Catalogue ?)';
    if (status === 503) return 'API amont indisponible (HTTP 503)';
    return `L’instance amont a répondu HTTP ${status}`;
}

function normalizeTrailers(list) {
    return (Array.isArray(list) ? list : [])
        .filter(t => t && /^https?:\/\//i.test(String(t.url || '')))
        .map(t => ({
            title: t.title || 'Bande-annonce',
            url: String(t.url),
            runtime: t.runtime || null,
            source: t.source || 'netflix',
        }));
}

function query(baseUrl, params) {
    const qs = new URLSearchParams();
    if (params.imdb) qs.set('imdb', params.imdb);
    if (params.tmdb) qs.set('tmdb', String(params.tmdb));
    if (params.type) qs.set('type', params.type);
    if (params.netflix) qs.set('netflix', params.netflix);
    return getJson(baseUrl, `/api/trailers?${qs.toString()}`);
}

function networkReason(err) {
    return err && err.name === 'AbortError'
        ? 'Délai dépassé (instance injoignable)'
        : `Connexion impossible : ${err && err.message ? err.message : 'erreur réseau'}`;
}

// Retrouve une bande-annonce sur l'instance amont.
// Essaie d'abord IMDb, puis TMDB (+ type) si l'IMDb ne donne rien.
async function resolveFederatedTrailer({ imdbId, tmdbId, type, netflixId, baseUrl } = {}) {
    const url = normalizeBaseUrl(baseUrl);
    if (!url) {
        return { found: false, configured: false, reason: 'URL de l’instance Netflix Catalogue non configurée' };
    }
    const imdb = String(imdbId || '').trim();
    const tmdb = String(tmdbId || '').trim();
    const netflix = String(netflixId || '').trim();
    if (!imdb && !tmdb && !netflix) {
        return { found: false, configured: true, reason: 'Aucun identifiant (IMDb/TMDB/Netflix) à demander' };
    }

    const key = `${url}|${imdb}|${tmdb}|${type || ''}|${netflix}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const attempts = [];
    if (imdb) attempts.push({ imdb, type });
    if (tmdb) attempts.push({ tmdb, type });
    if (netflix) attempts.push({ netflix });

    let lastReason = 'Aucune bande-annonce sur l’instance Netflix Catalogue';
    for (const params of attempts) {
        let response;
        try {
            response = await query(url, params);
        } catch (err) {
            return cacheSet(key, { found: false, configured: true, reason: networkReason(err) });
        }
        const { status, ok, data } = response;
        if (!ok) {
            lastReason = httpReason(status);
            if (status === 401 || status === 403) break; // inutile d'essayer un autre identifiant
            continue;
        }
        const trailers = normalizeTrailers(data && data.trailers);
        if (data && data.found && trailers.length) {
            return cacheSet(key, {
                found: true,
                configured: true,
                title: data.title || null,
                trailers,
            });
        }
        if (data && data.title) {
            lastReason = `Fiche trouvée (${data.title.name || 'titre'}) mais aucune bande-annonce`;
        }
    }
    return cacheSet(key, { found: false, configured: true, reason: lastReason });
}

// Test de connexion utilisé par le dashboard : GET /api/status sur l'instance amont.
async function checkConnection(baseUrl) {
    const url = normalizeBaseUrl(baseUrl);
    if (!url) return { configured: false, ok: false, url: '', reason: 'URL de l’instance Netflix Catalogue non configurée' };
    try {
        const { status, ok, data } = await getJson(url, '/api/status');
        if (!ok) return { configured: true, ok: false, url, reason: httpReason(status) };
        const titles = data && data.stats ? Number(data.stats.titles) : NaN;
        return {
            configured: true,
            ok: true,
            url,
            version: data && data.version ? String(data.version) : null,
            titles: Number.isFinite(titles) ? titles : null,
        };
    } catch (err) {
        return { configured: true, ok: false, url, reason: networkReason(err) };
    }
}

function clearCache() { cache.clear(); }

module.exports = {
    normalizeBaseUrl,
    resolveFederatedTrailer,
    checkConnection,
    clearCache,
    _cache: cache,
};
