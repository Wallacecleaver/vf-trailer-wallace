// ============================================================
// SÉCURITÉ PARTAGÉE
// - validation d'URL (anti-SSRF) : refuse les adresses internes, y compris via redirection
// - fetch() avec redirections revalidées et résolution DNS contrôlée au moment de la connexion
// - limitation de débit en mémoire (aucune dépendance)
// ============================================================

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const fetch = require('node-fetch');

// ---- Adresses internes / réservées ----
const BLOCKED_V4 = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4ToInt = (ip) => ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

function inCidrV4(ip, base, bits) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) return BLOCKED_V4.some(([base, bits]) => inCidrV4(ip, base, bits));
    if (net.isIPv6(ip)) {
        const low = ip.toLowerCase();
        if (low === '::' || low === '::1') return true;
        if (low.startsWith('fc') || low.startsWith('fd')) return true;   // fc00::/7 (ULA)
        if (/^fe[89ab]/.test(low)) return true;                          // fe80::/10 (link-local)
        const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateIp(mapped[1]);
        return false;
    }
    return false;
}

const INTERNAL_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

/** Contrôles synchrones : schéma, identifiants dans l'URL, IP littérale interne. */
function assertSafeUrlSync(raw) {
    let url;
    try { url = new URL(String(raw)); } catch { throw new Error('URL invalide'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('schéma URL refusé');
    if (url.username || url.password) throw new Error('URL contenant des identifiants refusée');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!host) throw new Error('hôte manquant dans l’URL');
    if (net.isIP(host) && isPrivateIp(host)) throw new Error('adresse interne refusée');
    if (INTERNAL_NAMES.test(host)) throw new Error('hôte interne refusé');
    return url;
}

// Le vrai verrou : la résolution DNS faite AU MOMENT DE LA CONNEXION. Même si un nom
// résout d'abord vers une IP publique puis vers 127.0.0.1 (DNS rebinding), la connexion
// est refusée.
function guardedLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...(options || {}), all: true }, (err, addrs) => {
        if (err) return callback(err);
        const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: 4 }];
        const safe = list.filter((a) => !isPrivateIp(a.address));
        if (!safe.length) return callback(new Error('Adresse interne refusée'));
        if (options && options.all) return callback(null, safe);
        return callback(null, safe[0].address, safe[0].family);
    });
}

const httpAgent = new http.Agent({ keepAlive: false, lookup: guardedLookup });
const httpsAgent = new https.Agent({ keepAlive: false, lookup: guardedLookup });

function agentFor(parsedUrl) {
    return parsedUrl && parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent;
}

function allowPrivate() {
    return process.env.ALLOW_PRIVATE_UPSTREAM === '1';
}

function assertSafeUrl(raw) {
    if (allowPrivate()) return new URL(String(raw));
    return assertSafeUrlSync(raw);
}

/**
 * fetch avec délai maximal, validation d'URL et redirections suivies manuellement
 * (chaque saut est revalidé). Les agents ci-dessus bloquent de toute façon les IP internes.
 */
async function safeFetch(raw, opts = {}, { timeoutMs = 8000, maxRedirects = 3 } = {}) {
    let current = String(raw);
    for (let hop = 0; hop <= maxRedirects; hop++) {
        assertSafeUrl(current);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(current, {
                ...opts,
                redirect: 'manual',
                agent: allowPrivate() ? undefined : agentFor,
                signal: opts.signal || controller.signal,
            });
            const location = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
            if (res.status >= 300 && res.status < 400 && location) {
                if (res.body && res.body.destroy) res.body.destroy();
                current = new URL(location, current).href;
                continue;
            }
            return res;
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error('Trop de redirections');
}

// ---- Limitation de débit en mémoire ----
function rateLimit({ windowMs = 60_000, max = 60, name = 'rl' } = {}) {
    const hits = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, hit] of hits) if (hit.reset <= now) hits.delete(key);
    }, windowMs);
    if (timer.unref) timer.unref();

    return function limiter(req, res, next) {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let hit = hits.get(key);
        if (!hit || hit.reset <= now) { hit = { n: 0, reset: now + windowMs }; hits.set(key, hit); }
        hit.n++;
        if (hits.size > 10_000) hits.clear();
        if (hit.n > max) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((hit.reset - now) / 1000))));
            return res.status(429).json({ error: 'Trop de requêtes, réessaie dans un instant' });
        }
        next();
    };
}

module.exports = { isPrivateIp, assertSafeUrl, assertSafeUrlSync, safeFetch, rateLimit };
