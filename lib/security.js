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

function parseIpv6Groups(ip) {
    const clean = String(ip).split('%')[0].toLowerCase();
    let work = clean;
    // Convertit un éventuel suffixe IPv4 décimal (ex. ::ffff:127.0.0.1 ou 64:ff9b::1.2.3.4) en 2 groupes hexadécimaux.
    const lastColon = work.lastIndexOf(':');
    if (lastColon !== -1 && work.slice(lastColon + 1).includes('.')) {
        const v4Part = work.slice(lastColon + 1);
        if (!net.isIPv4(v4Part)) return null;
        const octets = v4Part.split('.').map(Number);
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        work = `${work.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
    const halves = work.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const full = halves.length === 2
        ? [...left, ...Array(missing).fill('0'), ...right]
        : left;
    if (full.length !== 8) return null;
    const groups = full.map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return groups.some(Number.isNaN) ? null : groups;
}

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) return BLOCKED_V4.some(([base, bits]) => inCidrV4(ip, base, bits));
    if (net.isIPv6(ip)) {
        const g = parseIpv6Groups(ip);
        if (!g) return true;
        const allZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
        // :: (non spécifiée) et ::1 (loopback, y compris forme étendue 0:0:0:0:0:0:0:1)
        if (allZeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
        if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
        if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
        if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
        if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 (discard)
        if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 (documentation)
        // IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96) et NAT64 (64:ff9b::/96)
        const isV4Mapped = allZeroPrefix && (g[5] === 0xffff || g[5] === 0);
        const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
        if (isV4Mapped || isNat64) {
            const v4 = `${(g[6] >> 8) & 255}.${g[6] & 255}.${(g[7] >> 8) & 255}.${g[7] & 255}`;
            return isPrivateIp(v4);
        }
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
        const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        const now = Date.now();
        let hit = hits.get(key);
        if (!hit || hit.reset <= now) { hit = { n: 0, reset: now + windowMs }; hits.set(key, hit); }
        hit.n++;
        while (hits.size > 10_000) hits.delete(hits.keys().next().value);
        if (hit.n > max) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((hit.reset - now) / 1000))));
            return res.status(429).json({ error: 'Trop de requêtes, réessaie dans un instant' });
        }
        next();
    };
}

module.exports = { isPrivateIp, assertSafeUrl, assertSafeUrlSync, safeFetch, rateLimit };
