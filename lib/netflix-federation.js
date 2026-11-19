// ============================================================
// FÉDÉRATION STOCKAGE BD — récupère des bandes-annonces Netflix
// depuis une autre instance de l'addon « Stockage BD ».
//
// URL de l'instance, avec une clé API facultative si l'instance est protégée.
//
// Endpoint amont : GET /api/trailers?imdb=… (ou ?tmdb=…&type=movie|series)
// Réponse : { found, title: {...}, trailers: [{ title, url, runtime, source }] }
// ============================================================

const crypto = require('crypto');
const { safeFetch } = require('./security');
const { extractExplicitSeason, matchesSeasonVideo } = require('./season-match');

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000; // un résultat trouvé est gardé 6 h
const FAILURE_TTL_MS = 30 * 60 * 1000;     // un échec est retenté au bout de 30 min
const TIMEOUT_MS = 8000;

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
    while (cache.size > 500) cache.delete(cache.keys().next().value);
    return result;
}

async function getJson(baseUrl, path, apiKey) {
    const headers = { accept: 'application/json' };
    // Clé facultative : l'instance amont peut être ouverte (API_KEY vide) ou fermée.
    if (apiKey) headers['x-api-key'] = String(apiKey);
    // safeFetch refuse les adresses internes (sauf ALLOW_PRIVATE_UPSTREAM=1 pour une
    // instance locale volontaire) et revalide chaque redirection.
    const res = await safeFetch(baseUrl + path, { headers }, { timeoutMs: TIMEOUT_MS });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    return { status: res.status, ok: res.ok, data };
}

function httpReason(status) {
    if (status === 401 || status === 403) return 'Instance amont protégée par une clé API — renseigne-la dans Réglages → API Stockage BD (ou laisse API_KEY vide sur l’instance amont)';
    if (status === 404) return 'Endpoint introuvable : vérifie l’URL (est-ce bien une instance Stockage BD ?)';
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
            ...(t.lang ? { lang: t.lang } : {}),
            season: Number.isInteger(t.season) ? t.season : extractExplicitSeason(t.title),
            kind: t.kind || null,
        }));
}

function query(baseUrl, params, apiKey) {
    const qs = new URLSearchParams();
    if (params.imdb) qs.set('imdb', params.imdb);
    if (params.tmdb) qs.set('tmdb', String(params.tmdb));
    if (params.type) qs.set('type', params.type);
    if (params.netflix) qs.set('netflix', params.netflix);
    if (params.season) qs.set('season', String(params.season));
    if (params.strictSeason) qs.set('strict_season', '1');
    if (params.includeExtras) qs.set('include_extras', '1');
    return getJson(baseUrl, `/api/trailers?${qs.toString()}`, apiKey);
}

function networkReason(err) {
    return err && err.name === 'AbortError'
        ? 'Délai dépassé (instance injoignable)'
        : `Connexion impossible : ${err && err.message ? err.message : 'erreur réseau'}`;
}

// Retrouve une bande-annonce sur l'instance amont.
// Envoie IMDb + TMDB ensemble quand les deux sont connus (un seul aller-retour),
// et transmet la saison (triée ou stricte) pour récupérer directement un teaser de nouvelle saison.
async function resolveFederatedTrailer({ imdbId, tmdbId, type, netflixId, season, strictSeason = false, includeExtras = false, baseUrl, apiKey } = {}) {
    const url = normalizeBaseUrl(baseUrl);
    if (!url) {
        return { found: false, configured: false, reason: 'URL de l’instance Stockage BD non configurée' };
    }
    const imdb = String(imdbId || '').trim();
    const tmdb = String(tmdbId || '').trim();
    const netflix = String(netflixId || '').trim();
    if (!imdb && !tmdb && !netflix) {
        return { found: false, configured: true, reason: 'Aucun identifiant (IMDb/TMDB/Netflix) à demander' };
    }
    const seasonNum = Number.isInteger(Number(season)) && Number(season) > 0 ? Number(season) : null;
    const strict = !!(strictSeason && seasonNum);
    const extras = !!includeExtras;
    const keyScope = apiKey
        ? crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 10)
        : 'nokey';

    const key = `${url}|${keyScope}|${imdb}|${tmdb}|${type || ''}|${netflix}|${seasonNum || ''}|${strict ? '1' : '0'}|${extras ? '1' : '0'}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const common = {
        ...(type ? { type } : {}),
        ...(seasonNum ? { season: seasonNum } : {}),
        ...(strict ? { strictSeason: true } : {}),
        ...(extras ? { includeExtras: true } : {}),
    };
    const attempts = [];
    if (imdb && tmdb) attempts.push({ imdb, tmdb, ...common });
    else if (imdb) attempts.push({ imdb, ...common });
    else if (tmdb) attempts.push({ tmdb, ...common });
    if (netflix) attempts.push({ netflix, ...common });

    let lastReason = strict
        ? `Aucune bande-annonce de la saison ${seasonNum} sur l’instance Stockage BD`
        : 'Aucune bande-annonce sur l’instance Stockage BD';
    let sawPending = false;
    for (const params of attempts) {
        let response;
        try {
            response = await query(url, params, apiKey);
        } catch (err) {
            return cacheSet(key, { found: false, configured: true, reason: networkReason(err) });
        }
        const { status, ok, data } = response;
        if (!ok) {
            lastReason = httpReason(status);
            if (status === 401 || status === 403) break; // inutile d'essayer un autre identifiant
            continue;
        }
        let trailers = normalizeTrailers(data && data.trailers);
        if (strict) {
            trailers = trailers.filter(t => t.season === seasonNum && (extras || t.kind !== 'extra'));
        } else if (seasonNum) {
            trailers = trailers.filter(t => matchesSeasonVideo(t.title, seasonNum, { scoped: false }) && (extras || t.kind !== 'extra'));
        }
        if (data && data.found && trailers.length) {
            return cacheSet(key, {
                found: true,
                configured: true,
                title: data.title || null,
                trailers,
            });
        }
        if (data && data.pending) {
            sawPending = true;
            lastReason = 'Résolution en cours sur l’instance Stockage BD — réessaie dans quelques secondes';
        } else if (data && data.title) {
            lastReason = strict || (seasonNum && seasonNum >= 2)
                ? `Fiche trouvée (${data.title.name || 'titre'}) mais aucune vidéo pour la saison ${seasonNum}`
                : `Fiche trouvée (${data.title.name || 'titre'}) mais aucune bande-annonce`;
        }
    }
    const miss = { found: false, configured: true, ...(sawPending ? { pending: true } : {}), reason: lastReason };
    return sawPending ? miss : cacheSet(key, miss);
}

// Test de connexion utilisé par le dashboard : GET /api/status sur l'instance amont.
async function checkConnection(baseUrl, apiKey) {
    const url = normalizeBaseUrl(baseUrl);
    if (!url) return { configured: false, ok: false, url: '', reason: 'URL de l’instance Stockage BD non configurée' };
    try {
        const { status, ok, data } = await getJson(url, '/api/status', apiKey);
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
