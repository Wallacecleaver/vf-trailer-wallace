// ============================================================
// SOURCE NETFLIX — dernier recours quand TMDB / Allociné / YouTube n'ont rien.
//
// Principe :
//  1. retrouver l'ID Netflix du titre (Wikidata, par IMDB ID — propriété P1874 « Netflix ID ») ;
//  2. lire la page netflix.com/<pays>/title/<id> et en extraire le lien vidéo de la bande-annonce
//     (données JSON embarquées dans `netflix.reactContext`) ;
//  3. servir à Stremio / AIOMetadata une URL STABLE de NOTRE serveur (`APP_BASE_URL/nf/<id>.mp4`).
//     Les liens vidéo Netflix sont signés et expirent en quelques heures : la route /nf/ les renouvelle
//     à chaque lecture et relaie la vidéo (avec support des requêtes `Range`).
//
// Le scraping de netflix.com va à l'encontre de leurs CGU et peut casser si la page change :
// la source se coupe dans Réglages > Sources de résolution, et n'est interrogée que si tout le reste a échoué.
// ============================================================

const fetch = require('node-fetch');
const titlesStore = require('./netflix-titles');
const { sparql, bindingValue } = require('./wikidata');
const { isNid, isImdb } = require('./netflix-common');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const NETFLIX_COUNTRY = (process.env.NETFLIX_COUNTRY || 'fr').toLowerCase().replace(/[^a-z]/g, '') || 'fr';
const APP_BASE_URL = () => (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

// Points d'accès réseau (remplaçables uniquement par les tests).
const ENDPOINTS = {
    wikidata: 'https://query.wikidata.org/sparql',
    netflixTitle: (country, nid) => `https://www.netflix.com/${country}/title/${nid}`,
    allowHttp: false, // les liens vidéo doivent être en https (true seulement dans les tests)
};

const PAGE_TIMEOUT_MS = 8000;
const WIKIDATA_TIMEOUT_MS = 4000;
const RELAY_CONNECT_TIMEOUT_MS = 10000;
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;          // on renouvelle un lien qui expire dans moins de 2 min
const ID_CACHE_HIT_MS = 24 * 60 * 60 * 1000;     // correspondance IMDB -> Netflix trouvée
const ID_CACHE_MISS_MS = 6 * 60 * 60 * 1000;     // introuvable : on ne réinterroge pas Wikidata à chaque requête
const TRAILER_MISS_MS = 30 * 60 * 1000;          // page sans bande-annonce / bloquée : on retente dans 30 min
const CACHE_MAX = 2000;

// ---------- utilitaires ----------
function timeoutSignal(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function rememberBounded(map, key, value) {
    if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
    map.set(key, value);
}

const clean = s => (typeof s === 'string'
    ? s.replace(/[\u2066-\u2069\u200E\u200F]/g, '').replace(/[\u00A0\u202F]/g, ' ').trim() : s);

// Les URL vidéo Netflix sont signées (?e=<expiration en secondes>)
function expiryOf(url) {
    try { const e = new URL(url).searchParams.get('e'); return e ? Number(e) * 1000 : null; } catch { return null; }
}

function walk(node, fn, depth = 0, seen = new Set()) {
    if (!node || typeof node !== 'object' || depth > 60 || seen.has(node)) return;
    seen.add(node);
    fn(node);
    for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, fn, depth + 1, seen);
}

// ---------- ID Netflix ----------
/** Extrait un ID Netflix d'une URL (netflix.com/.../title/81944880) ou d'un nombre seul. */
function parseNetflixId(input) {
    const s = String(input || '').trim();
    const m = s.match(/netflix\.com\/(?:[^?#]*\/)?title\/(\d{5,})/i) || s.match(/^(\d{5,})$/);
    return m ? m[1] : null;
}

/** URL stable de notre relais pour un ID Netflix. */
function relayUrl(nid) {
    return `${APP_BASE_URL()}/nf/${nid}.mp4`;
}

/**
 * Si `url` est une page titre Netflix, renvoie l'URL de notre relais (/nf/<id>.mp4), sinon `url` inchangée.
 * Permet de coller une URL Netflix dans le champ « URL directe » d'un override.
 */
function netflixUrlToRelay(url) {
    const s = String(url || '').trim();
    if (!/^https?:\/\/(?:[\w-]+\.)?netflix\.com\//i.test(s)) return url;
    const nid = parseNetflixId(s);
    return nid ? relayUrl(nid) : url;
}

const idCache = new Map(); // imdbId -> { nid, at }

/** ID Netflix d'un titre à partir de son IMDB ID, via Wikidata (P345 IMDb ID -> P1874 Netflix ID). */
async function findNetflixId(imdbId) {
    if (!isImdb(imdbId)) return null;
    const hit = idCache.get(imdbId);
    if (hit && Date.now() - hit.at < (hit.nid ? ID_CACHE_HIT_MS : ID_CACHE_MISS_MS)) return hit.nid;

    // 1. catalogue local (table netflix_titles) : aucune requête réseau
    try {
        const local = await titlesStore.findNidByImdb(imdbId);
        if (local) { rememberBounded(idCache, imdbId, { nid: local, at: Date.now() }); return local; }
    } catch { /* base indisponible : on retombe sur Wikidata */ }

    // 2. repli : Wikidata en direct (puis mémorisation dans le catalogue local)
    try {
        const rows = await sparql(ENDPOINTS.wikidata, `SELECT ?n WHERE { ?i wdt:P345 "${imdbId}"; wdt:P1874 ?n } LIMIT 1`, WIKIDATA_TIMEOUT_MS);
        const value = rows[0] ? bindingValue(rows[0].n) : null;
        const nid = isNid(value) ? value : null;
        rememberBounded(idCache, imdbId, { nid, at: Date.now() });
        if (nid) titlesStore.upsertTitle({ nid, imdb_id: imdbId, source: 'wikidata' }).catch(() => {});
        return nid;
    } catch {
        return null; // erreur transitoire : on ne met rien en cache
    }
}

// ---------- page Netflix ----------
async function fetchNetflixPage(nid, country = NETFLIX_COUNTRY) {
    const url = ENDPOINTS.netflixTitle(country, nid);
    const headers = {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5',
        'upgrade-insecure-requests': '1',
        'sec-ch-ua': '"Chromium";v="130", "Not_A Brand";v="24", "Google Chrome";v="130"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
    };
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
        const t = timeoutSignal(PAGE_TIMEOUT_MS);
        try {
            const res = await fetch(url, { headers, redirect: 'follow', signal: t.signal });
            status = res.status;
            if (res.ok) return await res.text();
            if (status < 500 && status !== 429) break;
        } finally {
            t.done();
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    const err = new Error(`Netflix HTTP ${status} — page bloquée ou introuvable`);
    err.status = status;
    throw err;
}

const edges = c => ((c && c.edges) || []).map(e => e.node).filter(Boolean);

/**
 * Extrait les bandes-annonces de la page titre : [{ title, runtime, url, expires }].
 * Données lues dans `netflix.reactContext` (GraphQL embarqué), comme dans l'addon Netflix Catalogue.
 */
function extractTrailers(html, nid) {
    const m = String(html || '').match(/netflix\.reactContext\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (!m) return [];
    let ctx;
    try { ctx = JSON.parse(m[1].replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1')); } catch { return []; }

    let video = null;
    walk(ctx, o => {
        if (video || Array.isArray(o) || !Array.isArray(o.videos)) return;
        video = o.videos.find(x => x && x.shortSynopsis !== undefined && (x.seasons || x.contentAdvisory || x.primaryGenres)
            && (!nid || String(x.videoId) === String(nid))) || null;
    });
    if (!video) return [];

    let trailers = edges(video.trailers);
    if (!trailers.length && video.promoVideo && video.promoVideo.video && video.promoVideo.video.playableVideo
        && video.promoVideo.video.playableVideo.url) {
        trailers = [{
            title: video.promoVideo.video.title,
            runtimeSec: video.promoVideo.video.displayRuntimeMs / 1000,
            playableVideo: video.promoVideo.video.playableVideo,
        }];
    }
    return trailers
        .map(t => ({
            title: clean(t.title) || null,
            runtime: t.runtimeSec || null,
            url: (t.playableVideo && t.playableVideo.url) || null,
            expires: expiryOf(t.playableVideo && t.playableVideo.url),
        }))
        .filter(t => t.url && (/^https:\/\//.test(t.url) || (ENDPOINTS.allowHttp && /^http:\/\//.test(t.url))));
}

/**
 * Titre, année et type de la page titre Netflix : { title, year, mediaType: 'movie' | 'tv' } ou null.
 * Mêmes données embarquées (`netflix.reactContext`) que pour les bandes-annonces :
 * `title`, `latestYear` et `__typename` ('Show' | 'Movie').
 */
function extractInfo(html, nid) {
    const m = String(html || '').match(/netflix\.reactContext\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (!m) return null;
    let ctx;
    try { ctx = JSON.parse(m[1].replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1')); } catch { return null; }
    let video = null;
    walk(ctx, o => {
        if (video || Array.isArray(o) || !Array.isArray(o.videos)) return;
        video = o.videos.find(x => x && x.shortSynopsis !== undefined && (x.seasons || x.contentAdvisory || x.primaryGenres)
            && (!nid || String(x.videoId) === String(nid))) || null;
    });
    if (!video || !clean(video.title)) return null;
    const year = Number(video.latestYear);
    return {
        title: clean(video.title),
        year: year > 1800 ? year : null,
        mediaType: video.__typename === 'Show' ? 'tv' : video.__typename === 'Movie' ? 'movie' : null,
    };
}

/**
 * ID Netflix des autres titres cités par la page (« titres similaires », liens /title/<id>).
 * Deux sources : les objets `videoId` du JSON embarqué (Show/Movie) et les liens `/title/<id>` du HTML.
 * L'ID de la page elle-même est exclu. Renvoie un tableau d'ID uniques (chaînes).
 */
function extractRelatedIds(html, selfNid) {
    const out = new Set();
    const add = v => { const s = String(v === undefined || v === null ? '' : v); if (isNid(s) && s !== String(selfNid)) out.add(s); };
    const text = String(html || '');
    for (const m of text.matchAll(/\/title\/(\d{5,})/g)) add(m[1]);
    const m = text.match(/netflix\.reactContext\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (m) {
        try {
            const ctx = JSON.parse(m[1].replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1'));
            walk(ctx, o => {
                if (!Array.isArray(o) && (o.__typename === 'Show' || o.__typename === 'Movie') && o.videoId !== undefined) add(o.videoId);
            });
        } catch { /* JSON illisible : on garde les liens du HTML */ }
    }
    return [...out];
}

/** Lit la page Netflix d'un ID et renvoie { title, year, mediaType } (null si illisible). */
async function getPageInfo(nid, country = NETFLIX_COUNTRY) {
    if (!isNid(nid)) return null;
    return extractInfo(await fetchNetflixPage(nid, country), nid);
}

// ---------- bandes-annonces (cache + une seule requête à la fois par titre) ----------
const trailerCache = new Map(); // nid -> { trailers, at }
const inflight = new Map();

const isFresh = t => !t.expires || t.expires > Date.now() + EXPIRY_MARGIN_MS;

/** Bandes-annonces à jour d'un titre Netflix ([] si aucune / page bloquée). `force` ignore le cache. */
async function getTrailers(nid, { force = false } = {}) {
    if (!isNid(nid)) return [];
    const cached = trailerCache.get(nid);
    if (!force && cached) {
        if (cached.trailers.length ? cached.trailers.every(isFresh) : Date.now() - cached.at < TRAILER_MISS_MS) return cached.trailers;
    }
    if (!inflight.has(nid)) {
        inflight.set(nid, (async () => {
            try {
                const trailers = extractTrailers(await fetchNetflixPage(nid), nid);
                rememberBounded(trailerCache, nid, { trailers, at: Date.now() });
                return trailers;
            } catch (err) {
                console.warn('[netflix]', nid, err.message);
                rememberBounded(trailerCache, nid, { trailers: [], at: Date.now() });
                return [];
            }
        })().finally(() => inflight.delete(nid)));
    }
    return inflight.get(nid);
}

/**
 * Résout une bande-annonce Netflix pour un IMDB ID : { nid, url } (url = notre relais) ou null.
 * `manualNid` (optionnel) court-circuite la recherche Wikidata.
 */
async function resolveNetflixTrailer(imdbId, manualNid) {
    const nid = manualNid || await findNetflixId(imdbId);
    if (!nid) return { found: false, reason: 'ID Netflix introuvable (Wikidata)' };
    const trailers = await getTrailers(nid);
    if (!trailers.length) return { found: false, nid, reason: `Aucune bande-annonce sur la page Netflix ${nid}` };
    return { found: true, nid, url: relayUrl(nid), runtime: trailers[0].runtime };
}

// ---------- relais vidéo (route GET/HEAD /nf/:nid.mp4) ----------
/** Relaie la 1re bande-annonce du titre vers `res`, en renouvelant le lien Netflix s'il a expiré. */
async function relayTrailer(req, res, nid) {
    if (!isNid(nid)) return res.status(404).send('bande-annonce inconnue');
    try {
        let trailers = await getTrailers(nid);
        if (!trailers.length) return res.status(404).send('bande-annonce indisponible');

        const headers = { 'user-agent': UA };
        if (req.headers.range) headers.range = req.headers.range;

        const open = async url => {
            const t = timeoutSignal(RELAY_CONNECT_TIMEOUT_MS);
            try { return await fetch(url, { headers, signal: t.signal }); } finally { t.done(); }
        };

        let up = await open(trailers[0].url);
        if (up.status === 403 || up.status === 410) {            // lien périmé côté Netflix : on le renouvelle une fois
            if (up.body && up.body.destroy) up.body.destroy();
            trailers = await getTrailers(nid, { force: true });
            if (!trailers.length) return res.status(502).send('bande-annonce indisponible');
            up = await open(trailers[0].url);
        }

        res.status(up.status);
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
            const v = up.headers.get(h);
            if (v) res.set(h, v);
        }
        if (req.method === 'HEAD' || !up.body) {
            if (up.body && up.body.destroy) up.body.destroy();
            return res.end();
        }
        up.body.on('error', () => res.destroy());
        res.on('close', () => { if (up.body.destroy) up.body.destroy(); });
        up.body.pipe(res);
    } catch (err) {
        console.warn('[netflix] relais', nid, err.message);
        if (!res.headersSent) res.status(502).send('bande-annonce indisponible');
    }
}

module.exports = {
    parseNetflixId, relayUrl, netflixUrlToRelay,
    findNetflixId, fetchNetflixPage, extractTrailers, extractInfo, extractRelatedIds, getPageInfo, getTrailers,
    resolveNetflixTrailer, relayTrailer,
    // pour les tests
    _caches: { idCache, trailerCache }, _endpoints: ENDPOINTS,
};
