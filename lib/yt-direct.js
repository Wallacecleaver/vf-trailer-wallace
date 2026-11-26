// ============================================================
// LECTURE DIRECTE DES BANDES-ANNONCES YOUTUBE (optionnel, désactivé par défaut)
//
// Problème : un `ytId` s'ouvre dans l'appli YouTube (Odin, AIOMetadata...) au lieu de se lancer
// dans le lecteur de l'appli. Il faut une vraie URL vidéo (MP4).
//
// Pourquoi pas yt-dlp / ytdl-core sur ce serveur :
//  - YouTube bloque les IP de datacenter (« confirmez que vous n'êtes pas un robot ») ;
//  - le lien extrait est lié à l'IP qui l'a demandé : il ne marcherait pas chez le spectateur ;
//  - il faudrait faire transiter la vidéo par le VPS (bande passante, CPU).
//
// Ici, ce serveur ne fait que :
//  1. un petit appel JSON (quelques Ko) vers une instance publique Invidious ou Piped ;
//  2. un test de lecture de 2 Ko pour vérifier que le lien est bien un MP4 jouable ;
//  3. une redirection 302 au moment de la lecture : /ytd/<id>.<signature>.mp4.
// La vidéo ne passe JAMAIS par ce serveur : elle va de l'instance au lecteur.
//
// Réglage : variable d'environnement YT_DIRECT_INSTANCES (vide = fonction désactivée, rien ne change).
//   YT_DIRECT_INSTANCES=auto
//   YT_DIRECT_INSTANCES=https://invidious.exemple.fr,piped:https://piped-api.exemple.fr
// « auto » = courte liste d'instances publiques (docs.invidious.io/instances), à remplacer par les tiennes
// si elles tombent. Sans préfixe, une instance est de type Invidious.
//
// Garde-fous : cache (20 min si trouvé, 10 min sinon), au plus 3 résolutions simultanées, une instance
// en échec est mise en pause 10 min, et si rien ne marche on retombe sur le comportement d'avant (ytId).
// Qualité : seuls les MP4 « vidéo + son » existent (en général 360p, parfois 720p). Allociné reste prioritaire.
//
// Test depuis le VPS :
//   docker exec <conteneur> node -e "require('./lib/yt-direct').resolveYoutubeDirect('dQw4w9WgXcQ').then(console.log)"
// ============================================================

const crypto = require('crypto');
const { safeFetch } = require('./security');
const { probeDirectLink } = require('./media-link');
const { getCached, setCached } = require('./cache');
const { getTokenSecret } = require('./session-secret');
const { APP_BASE_URL } = require('./config');
const { logEvent } = require('./logs');

// Préfixe couvert par les stats / purges du dashboard (voir TRAILER_SCOPE dans lib/cache.js).
const CACHE_PREFIX = 'cache:aiom-direct:yt:v1:';
const POSITIVE_TTL_SECONDS = 20 * 60;
const NEGATIVE_TTL_SECONDS = 10 * 60;
const COOLDOWN_MS = 10 * 60 * 1000;
const API_TIMEOUT_MS = 3000;
const COBALT_TIMEOUT_MS = 6000;
const COBALT_TTL_SECONDS = 60; // lien « tunnel » de courte durée
const PROBE_TIMEOUT_MS = 3000;
const WAVE_SIZE = 2;          // instances interrogées en même temps
const MAX_ATTEMPTS = 6;       // instances essayées au maximum par vidéo
const MAX_ACTIVE = 3;         // résolutions simultanées au maximum
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Liste « auto » : API Piped publiques (liste officielle docs.piped.video, nov. 2026). Les instances Invidious
// publiques refusent maintenant l'API (HTTP 401/403/530). Beaucoup d'instances sont mortes ou bloquées par
// YouTube selon l'IP du serveur : le bouton « Tester » du dashboard montre celles qui répondent depuis TON
// serveur, et « Garder celles qui fonctionnent » les enregistre.
const AUTO_INSTANCES = [
    'piped:https://pipedapi.kavin.rocks',
    'piped:https://pipedapi-libre.kavin.rocks',
    'piped:https://pipedapi.leptons.xyz',
    'piped:https://api.piped.private.coffee',
    'piped:https://pipedapi.adminforge.de',
    'piped:https://pipedapi.ducks.party',
    'piped:https://pipedapi.darkness.services',
    'piped:https://pipedapi.orangenet.cc',
    'piped:https://pipedapi.reallyaweso.me',
    'piped:https://pipedapi.drgns.space',
    'piped:https://api.piped.yt',
    'piped:https://piped-api.codespace.cz',
];

// Erreur « propre à cette vidéo » (introuvable, pas de MP4 avec son) : l'instance, elle, fonctionne.
class VideoError extends Error {}

// ---- Configuration ----
// settingsRaw : valeur issue des réglages du dashboard ('' = désactivé, 'auto', ou une liste).
// null = réglages pas encore chargés : on lit alors la variable d'environnement.
let settingsRaw = null;
let parsedRaw = null;
let parsedValue = [];

/** Appliquer les réglages du dashboard (appelé à chaque chargement des réglages de comportement). */
function applySettings(behavior) {
    if (!behavior || typeof behavior.ytDirectEnabled !== 'boolean') { settingsRaw = null; return; }
    settingsRaw = behavior.ytDirectEnabled ? (String(behavior.ytDirectInstances || '').trim() || 'auto') : '';
}

function parseItem(item) {
    const match = /^(?:(invidious|piped|cobalt):)?(https:\/\/.+)$/i.exec(item);
    if (!match) return null;
    try {
        const url = new URL(match[2]);
        if (url.username || url.password) return null;
        const type = (match[1] || 'invidious').toLowerCase();
        const provider = { type, base: (url.origin + url.pathname).replace(/\/+$/, '') };
        // cobalt : clé d'API facultative après « # » (cobalt:https://api.exemple.fr#MA_CLE), jamais envoyée dans l'URL.
        if (type === 'cobalt' && url.hash.length > 1) {
            try { provider.key = decodeURIComponent(url.hash.slice(1)).slice(0, 200); } catch { /* clé ignorée */ }
        }
        return provider;
    } catch { return null; }
}

function parseInstances(raw) {
    const value = String(raw || '').trim();
    if (!value || /^(0|off|false|non|no)$/i.test(value)) return [];
    if (value.toLowerCase() === 'auto') return AUTO_INSTANCES.map(parseItem).filter(Boolean);
    const seen = new Set();
    return value.split(/[\s,]+/).filter(Boolean).map(parseItem)
        .filter(item => item && !seen.has(item.base) && seen.add(item.base));
}

function instances() {
    const raw = settingsRaw !== null ? settingsRaw : (process.env.YT_DIRECT_INSTANCES || '');
    if (raw !== parsedRaw) { parsedRaw = raw; parsedValue = parseInstances(raw); }
    return parsedValue;
}

function isEnabled() {
    return instances().length > 0;
}

// ---- État en mémoire ----
const downUntil = new Map();   // base -> horodatage de fin de pause
const inflight = new Map();    // ytId -> promesse en cours
let lastGood = null;           // dernière instance qui a répondu : essayée en premier

function markDown(provider, err) {
    const wasDown = (downUntil.get(provider.base) || 0) > Date.now();
    downUntil.set(provider.base, Date.now() + COOLDOWN_MS);
    if (wasDown) return;
    if (lastGood === provider.base) lastGood = null;
    logEvent({
        level: 'warn', context: 'STREAM', event: 'yt_direct_provider_down',
        message: `Instance YouTube indisponible (${new URL(provider.base).host}) — mise en pause 10 min : ${String(err && err.message).slice(0, 120)}`,
        meta: { provider: provider.base, type: provider.type },
    }).catch(() => {});
}

function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// ---- Fournisseurs ----
function heightOf(entry) {
    const found = String(entry.height || entry.resolution || entry.qualityLabel || entry.quality || '').match(/(\d{3,4})/);
    return found ? Number(found[1]) : 0;
}

async function getJson(url) {
    const res = await safeFetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, size: 1024 * 1024 },
        { timeoutMs: API_TIMEOUT_MS, maxRedirects: 1 });
    if (!res.ok) {
        res.body?.destroy?.();
        if (res.status === 404) throw new VideoError('vidéo introuvable (HTTP 404)');
        throw new Error(`HTTP ${res.status}`);
    }
    try { return await res.json(); } catch { throw new Error('réponse non JSON'); }
}

// Invidious : lien /latest_version?...&local=true. Il est stable (pas d'expiration) et l'instance fait
// elle-même passer la vidéo (local=true), donc il marche depuis n'importe quelle IP.
async function viaInvidious(base, id) {
    const data = await getJson(`${base}/api/v1/videos/${id}?fields=formatStreams`);
    const mp4 = (Array.isArray(data?.formatStreams) ? data.formatStreams : [])
        .filter(f => f && /^\d{1,3}$/.test(String(f.itag)) && (/mp4/i.test(f.container || '') || /^video\/mp4/i.test(f.type || '')))
        .sort((a, b) => heightOf(b) - heightOf(a));
    if (!mp4.length) throw new VideoError('aucun MP4 avec son');
    return { url: `${base}/latest_version?id=${id}&itag=${mp4[0].itag}&local=true`, height: heightOf(mp4[0]) || null };
}

// Piped : flux « vidéo + son ». L'API renvoie des liens googlevideo liés à l'IP de l'instance ; comme le
// fait le site Piped, on les fait passer par le proxy de l'instance (champ proxyUrl, paramètre host) pour
// qu'ils soient lisibles depuis n'importe quelle IP. Sans proxy, le lien est refusé.
function viaPipedProxy(streamUrl, proxyUrl) {
    try {
        const url = new URL(streamUrl);
        if (url.protocol !== 'https:') return null;
        if (!/(^|\.)googlevideo\.com$/i.test(url.hostname)) return url.href; // déjà proxifié par l'instance
        const proxy = new URL(proxyUrl);
        if (proxy.protocol !== 'https:' || /(^|\.)googlevideo\.com$/i.test(proxy.hostname)) return null;
        url.searchParams.set('host', url.host);
        url.host = proxy.host;
        return url.href;
    } catch { return null; }
}

async function viaPiped(base, id) {
    const data = await getJson(`${base}/streams/${id}`);
    const mp4 = (Array.isArray(data?.videoStreams) ? data.videoStreams : [])
        .filter(s => s && s.videoOnly === false && typeof s.url === 'string'
            && (/mp4/i.test(s.mimeType || '') || /^mpeg_4$/i.test(s.format || '')))
        .map(s => ({ s, url: viaPipedProxy(s.url, data.proxyUrl) }))
        .filter(item => item.url)
        .sort((a, b) => heightOf(b.s) - heightOf(a.s));
    if (!mp4.length) throw new VideoError('aucun MP4 avec son');
    return { url: mp4[0].url, height: heightOf(mp4[0].s) || null };
}

// cobalt (github.com/imputnet/cobalt) : POST / avec l'URL YouTube. Réponse « tunnel » (cobalt fait passer la
// vidéo, lien valable peu de temps) ou « redirect » (lien direct). Aucune instance publique n'est ouverte à
// tous : il faut la tienne (docker, sans clé) ou une instance qui te donne une clé d'API.
async function viaCobalt(provider, id) {
    const headers = { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'vf-trailer-addon/1.0' };
    if (provider.key) headers.authorization = `Api-Key ${provider.key}`;
    const res = await safeFetch(provider.base + '/', {
        method: 'POST', headers, size: 256 * 1024,
        body: JSON.stringify({
            url: `https://www.youtube.com/watch?v=${id}`, videoQuality: '720', youtubeVideoCodec: 'h264', downloadMode: 'auto',
        }),
    }, { timeoutMs: COBALT_TIMEOUT_MS, maxRedirects: 0 });
    let data = null;
    try { data = await res.json(); } catch { /* corps non JSON */ }
    if (!res.ok && !data) throw new Error(`HTTP ${res.status}`);
    if (data && (data.status === 'tunnel' || data.status === 'redirect') && typeof data.url === 'string') {
        if (!/^https:\/\//i.test(data.url)) throw new Error('lien cobalt non https');
        return { url: data.url, height: 720, ttl: COBALT_TTL_SECONDS, skipProbe: true };
    }
    const code = data?.error?.code || data?.status || `HTTP ${res.status}`;
    // Erreurs liées à la vidéo : on ne met pas l'instance en pause.
    if (/content\.video\.(unavailable|private|age|live)/i.test(code)) throw new VideoError(String(code).slice(0, 80));
    throw new Error(String(code).slice(0, 80));
}

function fetchCandidate(provider, id) {
    if (provider.type === 'cobalt') return viaCobalt(provider, id);
    return (provider.type === 'piped' ? viaPiped : viaInvidious)(provider.base, id);
}

async function tryProvider(provider, id) {
    try {
        const candidate = await fetchCandidate(provider, id);
        if (!candidate.skipProbe) {
            const check = await probeDirectLink(candidate.url, PROBE_TIMEOUT_MS);
            if (!check.ok || (check.media !== 'mp4' && check.media !== 'video')) {
                throw new Error(check.error || 'lien non lisible');
            }
        }
        downUntil.delete(provider.base);
        lastGood = provider.base;
        return { url: candidate.url, height: candidate.height, provider: provider.base, ...(candidate.ttl ? { ttl: candidate.ttl } : {}) };
    } catch (err) {
        if (!(err instanceof VideoError)) markDown(provider, err);
        return null;
    }
}

// Premier résultat non nul ; null si tous échouent. Les promesses ne rejettent jamais.
function firstSuccess(promises) {
    return new Promise(resolve => {
        let left = promises.length;
        for (const promise of promises) {
            promise.then(value => {
                if (value) resolve(value);
                else if (--left === 0) resolve(null);
            });
        }
    });
}

async function lookup(id) {
    const now = Date.now();
    const healthy = instances().filter(provider => (downUntil.get(provider.base) || 0) <= now);
    const first = healthy.find(provider => provider.base === lastGood);
    const ordered = [...(first ? [first] : []), ...shuffle(healthy.filter(provider => provider !== first))].slice(0, MAX_ATTEMPTS);
    const started = Date.now();
    for (let i = 0; i < ordered.length; i += WAVE_SIZE) {
        if (i > 0 && Date.now() - started > 5000) break;
        const found = await firstSuccess(ordered.slice(i, i + WAVE_SIZE).map(provider => tryProvider(provider, id)));
        if (found) return found;
    }
    return null;
}

/**
 * Résout un ID YouTube en lien vidéo direct : { url, height, provider } ou null.
 * Résultat mis en cache (SQLite) ; null aussi quand la fonction est désactivée ou saturée.
 */
async function resolveYoutubeDirect(ytId) {
    const id = String(ytId || '');
    if (!ID_RE.test(id) || !isEnabled()) return null;
    const key = CACHE_PREFIX + id;
    const hit = await getCached(key);
    if (hit) return hit.url ? hit : null;

    const running = inflight.get(id);
    if (running) return running;
    if (inflight.size >= MAX_ACTIVE) return null; // pas de file d'attente : la prochaine demande réessaiera

    const work = lookup(id)
        .then(async found => {
            await setCached(key, found || { none: true }, found ? (found.ttl || POSITIVE_TTL_SECONDS) : NEGATIVE_TTL_SECONDS);
            return found;
        })
        .catch(() => null)
        .finally(() => inflight.delete(id));
    inflight.set(id, work);
    return work;
}

// ---- Lien public signé : seul un 302 passe par ce serveur ----
function signature(id) {
    return crypto.createHmac('sha256', getTokenSecret()).update('ytd:' + id).digest('base64url').slice(0, 16);
}

function playbackUrl(id) {
    return `${APP_BASE_URL}/ytd/${id}.${signature(id)}.mp4`;
}

function verifySignature(id, given) {
    const expected = Buffer.from(signature(id));
    const received = Buffer.from(String(given || ''));
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/** Lien public stable (…/ytd/<id>.<signature>.mp4) si la vidéo est lisible en direct, sinon null. */
async function resolvePlayableUrl(ytId) {
    const found = await resolveYoutubeDirect(ytId);
    return found ? playbackUrl(String(ytId)) : null;
}

// ---- Diagnostic (bouton « Tester » du dashboard) ----
// Vérifie chaque instance avec une vidéo connue, sans toucher au cache ni à l'état de pause.
const TEST_VIDEO_ID = 'dQw4w9WgXcQ';

async function checkProvider(provider, id = TEST_VIDEO_ID) {
    const started = Date.now();
    try {
        const candidate = await fetchCandidate(provider, id);
        if (!candidate.skipProbe) {
            const check = await probeDirectLink(candidate.url, PROBE_TIMEOUT_MS);
            if (!check.ok || (check.media !== 'mp4' && check.media !== 'video')) throw new Error(check.error || 'lien non lisible');
        }
        return { base: provider.base, type: provider.type, ok: true, ms: Date.now() - started, height: candidate.height };
    } catch (err) {
        return { base: provider.base, type: provider.type, ok: false, ms: Date.now() - started, error: String(err && err.message || err).slice(0, 140) };
    }
}

/** raw : valeur du champ du dashboard ('' ou 'auto' = liste automatique) ; undefined = réglage en vigueur.
 *  id : vidéo à tester (par défaut une vidéo connue). */
async function diagnose(raw, id) {
    const list = raw === undefined ? instances()
        : parseInstances(String(raw).trim() && String(raw).trim().toLowerCase() !== 'auto' ? raw : 'auto');
    return Promise.all(list.map(provider => checkProvider(provider, ID_RE.test(String(id || '')) ? id : TEST_VIDEO_ID)));
}

function resetForTests() {
    settingsRaw = null;
    downUntil.clear();
    inflight.clear();
    lastGood = null;
}

module.exports = {
    isEnabled, applySettings, diagnose, parseInstances, resolveYoutubeDirect, resolvePlayableUrl,
    playbackUrl, verifySignature, resetForTests,
};
