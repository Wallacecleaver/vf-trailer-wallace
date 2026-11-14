// ============================================================
// SOURCE NETFLIX FÉDÉRÉE — bandes-annonces servies par une autre instance.
//
// L'instance amont (projet « Netflix Catalogue ») expose :
//   GET /api/trailers?imdb=tt1234567
//   GET /api/trailers?tmdb=12345&type=movie|series
//   GET /api/status
// protégées par une clé API (en-tête `x-api-key`).
//
// Configuration (variables d'environnement) :
//   NETFLIX_FEDERATION_URL        URL de base de l'instance amont
//   NETFLIX_FEDERATION_API_KEY    sa clé API (facultative si l'amont n'en exige pas)
//   NETFLIX_FEDERATION_TIMEOUT_MS délai maximal d'un appel (6000 ms par défaut)
//
// On interroge d'abord par IMDb, puis par TMDB + type si l'amont ne connaît pas
// l'IMDb. Les résultats (trouvés ET introuvables) sont mémorisés en mémoire pour
// éviter de rappeler l'amont à chaque ouverture de fiche.
// ============================================================

const fetch = require('node-fetch');
const { isImdb } = require('./netflix-common');

const DEFAULT_TIMEOUT_MS = 6000;
const HIT_TTL_MS = 6 * 60 * 60 * 1000;   // une bande-annonce trouvée reste valable 6 h
const MISS_TTL_MS = 30 * 60 * 1000;      // un échec est retenté au bout de 30 min
const CACHE_MAX = 1000;

const cache = new Map(); // clé -> { at, result }

function readConfig() {
    const url = String(process.env.NETFLIX_FEDERATION_URL || '').trim().replace(/\/+$/, '');
    const apiKey = String(process.env.NETFLIX_FEDERATION_API_KEY || '').trim();
    const timeoutMs = Math.min(30000, Math.max(500, Number(process.env.NETFLIX_FEDERATION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
    return { url, apiKey, timeoutMs, configured: !!url };
}

function timeoutSignal(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function remember(key, result) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), result });
}

function cached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    const ttl = hit.result && hit.result.found ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - hit.at > ttl) { cache.delete(key); return null; }
    return hit.result;
}

function cleanTitle(value) {
    return String(value || '').replace(/[\u2066-\u2069\u200E\u200F]/g, '').replace(/\s+/g, ' ').trim();
}

/** Garde uniquement les URLs http(s) lisibles par Stremio. */
function normalizeTrailers(data) {
    const list = Array.isArray(data && data.trailers) ? data.trailers : [];
    return list
        .filter(t => t && /^https?:\/\//i.test(String(t.url || '')))
        .map(t => ({
            title: cleanTitle(t.title) || 'Bande-annonce',
            url: String(t.url),
            runtime: Number.isFinite(Number(t.runtime)) && Number(t.runtime) > 0 ? Number(t.runtime) : null,
            source: 'netflix_federation',
        }));
}

/** Appelle /api/trailers et renvoie le JSON (lève une Error lisible en cas d'échec). */
async function requestTrailers({ imdbId, tmdbId, type }, cfg) {
    const params = new URLSearchParams();
    if (imdbId) params.set('imdb', imdbId);
    if (tmdbId) params.set('tmdb', String(tmdbId));
    if (type) params.set('type', type === 'series' ? 'series' : 'movie');

    const headers = { accept: 'application/json' };
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    const t = timeoutSignal(cfg.timeoutMs);
    let res;
    try {
        res = await fetch(`${cfg.url}/api/trailers?${params.toString()}`, { headers, signal: t.signal });
    } catch (err) {
        const reason = err && err.name === 'AbortError' ? `délai dépassé (${cfg.timeoutMs} ms)` : (err && err.message) || 'appel impossible';
        throw new Error(reason);
    } finally {
        t.done();
    }

    if (res.status === 401 || res.status === 403) throw new Error(`clé API refusée (HTTP ${res.status})`);
    if (res.status === 503) throw new Error('API amont non configurée (HTTP 503)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    try {
        return await res.json();
    } catch {
        throw new Error('réponse JSON invalide');
    }
}

/**
 * Cherche les bandes-annonces d'un titre sur l'instance amont.
 * @returns {Promise<{ found: boolean, trailers: Array, title: object|null, reason: string, configured?: boolean }>}
 * Ne lève jamais : un amont injoignable est un simple « pas trouvé ».
 */
async function resolveFederatedTrailer({ imdbId, tmdbId, type } = {}) {
    const cfg = readConfig();
    if (!cfg.configured) {
        return {
            found: false, trailers: [], title: null, configured: false,
            reason: 'instance Netflix Catalogue non configurée (NETFLIX_FEDERATION_URL)',
        };
    }

    const cleanImdb = isImdb(imdbId) ? String(imdbId).trim() : '';
    const tmdbNum = Number(tmdbId);
    const cleanTmdb = Number.isFinite(tmdbNum) && tmdbNum > 0 ? Math.trunc(tmdbNum) : null;
    if (!cleanImdb && !cleanTmdb) {
        return { found: false, trailers: [], title: null, reason: 'aucun identifiant IMDb/TMDB' };
    }

    const key = cleanImdb ? `imdb:${cleanImdb}` : `tmdb:${cleanTmdb}:${type || ''}`;
    const hit = cached(key);
    if (hit) return hit;

    const attempts = [];
    if (cleanImdb) attempts.push({ imdbId: cleanImdb });
    if (cleanTmdb) attempts.push({ tmdbId: cleanTmdb, type });

    let lastError = null;
    for (const attempt of attempts) {
        try {
            const data = await requestTrailers(attempt, cfg);
            const trailers = normalizeTrailers(data);
            if (trailers.length) {
                const result = { found: true, trailers, title: data.title || null, reason: '' };
                remember(key, result);
                return result;
            }
            // La fiche existe chez l'amont mais sans bande-annonce : inutile d'essayer
            // l'autre identifiant, le résultat serait identique.
            if (data && data.title) {
                const result = { found: false, trailers: [], title: data.title, reason: 'fiche amont sans bande-annonce' };
                remember(key, result);
                return result;
            }
        } catch (err) {
            lastError = err;
        }
    }

    const result = {
        found: false, trailers: [], title: null,
        reason: lastError ? lastError.message : 'aucune fiche trouvée sur l\'instance amont',
    };
    remember(key, result);
    return result;
}

/** Test de joignabilité pour le diagnostic du dashboard. Ne lève jamais. */
async function checkConnection({ timeoutMs } = {}) {
    const cfg = readConfig();
    if (!cfg.configured) {
        return { configured: false, ok: null, url: null, reason: 'NETFLIX_FEDERATION_URL non configurée' };
    }

    const headers = { accept: 'application/json' };
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    const t = timeoutSignal(Math.min(timeoutMs || 4000, 15000));
    try {
        const res = await fetch(`${cfg.url}/api/status`, { headers, signal: t.signal });
        if (!res.ok) {
            return { configured: true, ok: false, url: cfg.url, reason: `HTTP ${res.status}` };
        }
        let data = {};
        try { data = await res.json(); } catch { /* réponse non JSON : on garde juste ok */ }
        return { configured: true, ok: true, url: cfg.url, version: data.version || null };
    } catch (err) {
        return {
            configured: true, ok: false, url: cfg.url,
            reason: err && err.name === 'AbortError' ? 'délai dépassé' : (err && err.message) || 'appel impossible',
        };
    } finally {
        t.done();
    }
}

module.exports = {
    resolveFederatedTrailer,
    checkConnection,
    // pour les tests
    _caches: { cache },
    _constants: { HIT_TTL_MS, MISS_TTL_MS, DEFAULT_TIMEOUT_MS },
};
