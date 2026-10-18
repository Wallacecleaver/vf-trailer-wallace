// ============================================================
// SOURCES WEB — sites où une bande-annonce VF peut se trouver en lecture directe (.mp4 / .m3u8).
//
// Principe : pour un titre, on retrouve la bonne PAGE du site, on la lit comme un navigateur,
// on en extrait les liens vidéo directs, on VÉRIFIE qu'ils répondent vraiment, et on renvoie le
// meilleur. Rien n'est codé en dur pour un site précis : une source = un domaine (ou une URL de
// recherche) qu'on ajoute depuis le dashboard (onglet « Sources web »), avec un bouton Tester.
//
// Garde-fous :
//  - SSRF : jamais de requête vers localhost / réseau privé / métadonnées cloud, y compris via
//    redirection ou via un lien trouvé dans une page (assertPublicUrl, redirections suivies à la main) ;
//  - la page doit correspondre au titre demandé (même moteur de matching que YouTube/Allociné) ;
//  - un lien vidéo n'est retenu que s'il répond (200/206 + vrai contenu mp4 / playlist HLS) ;
//  - pubs, vidéos d'ambiance (bg.mp4, hero...) et miniatures écartées ;
//  - budget de temps global : une source lente ne retarde jamais la réponse au-delà du budget.
//
// Fragile par nature (HTML de sites tiers) : si un site change, la source ne renvoie rien et
// l'addon continue avec les autres replis.
// ============================================================

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const sql = require('./db');
const { matchVideoTitle } = require('./title-match');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE_TIMEOUT_MS = 3000;
const VERIFY_TIMEOUT_MS = 2500;
const DISCOVERY_TIMEOUT_MS = 3000;
const BUDGET_MS = 5000;             // temps maximum pour TOUTES les sources d'une résolution
const MAX_PAGE_BYTES = 1_500_000;
const MAX_PAGES_PER_SOURCE = 2;
const MAX_REDIRECTS = 4;

// ------------------------------------------------------------
// SSRF
// ------------------------------------------------------------
let allowPrivateForTests = false;
let resolver = host => dns.lookup(host, { all: true });
function _setTestMode({ allowPrivate, lookup } = {}) {
    allowPrivateForTests = !!allowPrivate;
    resolver = lookup || (host => dns.lookup(host, { all: true }));
    dnsCache.clear();
}

// "2001:db8::1" -> 8 groupes de 16 bits (null si invalide).
function expandIPv6(ip) {
    let h = ip.toLowerCase().split('%')[0];
    const v4 = h.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) { const o = v4[1].split('.').map(Number); h = h.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16); }
    const halves = h.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
    const groups = [...head, ...Array(fill).fill('0'), ...tail].map(x => parseInt(x, 16));
    return groups.length === 8 && groups.every(x => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? groups : null;
}

const V4_BLOCKS = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
function v4ToInt(ip) { return ip.split('.').reduce((a, o) => (a * 256) + Number(o), 0); }
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const n = v4ToInt(ip);
        return V4_BLOCKS.some(([base, bits]) => {
            const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
            return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
        });
    }
    if (net.isIPv6(ip)) {
        const g = expandIPv6(ip);
        if (!g) return true;
        // IPv4 cachée dans une IPv6 : ::ffff:a.b.c.d (mappée, que new URL réécrit en ::ffff:7f00:1),
        // ::a.b.c.d (compatible) et 64:ff9b::/96 (NAT64) -> on juge l'IPv4 qu'elle contient.
        const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
        const first5Zero = g.slice(0, 5).every(x => x === 0);
        if ((first5Zero && (g[5] === 0xffff || g[5] === 0)) || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0))) {
            if (g.every(x => x === 0) || (first5Zero && g[5] === 0 && g[6] === 0 && g[7] === 1)) return true; // :: et ::1
            return isPrivateIp(embedded);
        }
        if ((g[0] & 0xfe00) === 0xfc00) return true;   // fc00::/7 (privées)
        if ((g[0] & 0xffc0) === 0xfe80) return true;   // fe80::/10 (lien local)
        if ((g[0] & 0xff00) === 0xff00) return true;   // ff00::/8 (multicast)
        return false;
    }
    return true; // pas une IP valide : on refuse par prudence
}

const dnsCache = new Map(); // host -> { ok, t }
async function assertPublicUrl(urlStr) {
    let u;
    try { u = new URL(urlStr); } catch { throw new Error('url-invalide'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocole-non-http');
    if (u.username || u.password) throw new Error('identifiants-dans-url');
    if (allowPrivateForTests) return u;
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('hote-prive');
    if (net.isIP(host)) {
        if (isPrivateIp(host)) throw new Error('ip-privee');
        return u;
    }
    const cached = dnsCache.get(host);
    if (cached && Date.now() - cached.t < 300000) {
        if (!cached.ok) throw new Error('hote-prive');
        return u;
    }
    const addrs = await resolver(host);
    const ok = addrs.length > 0 && addrs.every(a => !isPrivateIp(a.address));
    dnsCache.set(host, { ok, t: Date.now() });
    if (!ok) throw new Error('hote-prive');
    return u;
}

// ------------------------------------------------------------
// Réseau (redirections suivies à la main : chaque saut est revalidé)
// ------------------------------------------------------------
async function readLimited(res, maxBytes) {
    const chunks = [];
    let n = 0;
    for await (const chunk of res.body) {
        chunks.push(chunk);
        n += chunk.length;
        if (n >= maxBytes) { if (res.body.destroy) res.body.destroy(); break; }
    }
    return Buffer.concat(chunks).slice(0, maxBytes);
}

async function request(url, { headers = {}, timeout, maxBytes }) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertPublicUrl(current);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const res = await fetch(current, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', ...headers }, redirect: 'manual', signal: ctrl.signal });
            const loc = res.headers.get('location');
            if (res.status >= 300 && res.status < 400 && loc) {
                if (res.body && res.body.destroy) res.body.destroy();
                current = new URL(loc, current).toString();
                continue;
            }
            const body = await readLimited(res, maxBytes);
            return { status: res.status, contentType: (res.headers.get('content-type') || '').toLowerCase(), body, finalUrl: current };
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error('trop-de-redirections');
}

const getText = async (url, extra = {}) => {
    const r = await request(url, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...(extra.headers || {}) }, timeout: extra.timeout || PAGE_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES });
    return { ...r, text: r.body.toString('utf8') };
};

// ------------------------------------------------------------
// Extraction des liens vidéo d'une page (fonction pure, testable)
// ------------------------------------------------------------
const MEDIA_URL_RE = /(?:https?:)?\/\/[^\s"'<>\\()[\]{}]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()[\]{}]*)?(?![A-Za-z0-9_-])/gi;
const AD_RE = /(preroll|pre-roll|midroll|postroll|\/ads?\/|[/_.-]ads?[/_.-]|adserver|adservice|doubleclick|googlesyndication|smartadserver|teads|vast|ima3|tracking|pixel|sponsor|publicit)/i;
const DECOR_RE = /(^|[/_.-])(bg|background|loop|hero|banner|logo|header|intro|sample|dummy|blank|placeholder|silent|teaser-home)([/_.-]|$)/i;
const QUALITY_UP_RE = /(2160|1080|720|hd|hq|high|master)/i;
const QUALITY_DOWN_RE = /(240|360|low|mobile|thumb|preview)/i;

function decodeEscapes(s) {
    return s.replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
}

function toAbsolute(raw, base) {
    try {
        let r = raw.trim();
        if (r.startsWith('//')) r = 'https:' + r;
        const u = new URL(r, base);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
    } catch { return null; }
}

function mediaKind(url) { return /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4'; }

function scoreMedia(url, sourceBonus) {
    if (AD_RE.test(url)) return -1;
    const file = url.split('?')[0];
    if (DECOR_RE.test(file.split('/').slice(-1)[0] || '')) return -1;
    let s = sourceBonus;
    if (QUALITY_UP_RE.test(file)) s += 4;
    if (QUALITY_DOWN_RE.test(file)) s -= 4;
    if (/\b(trailer|bande|annonce|ba[-_])/i.test(file)) s += 3;
    if (mediaKind(url) === 'mp4') s += 1; // lecture directe, compatible partout
    return s;
}

function collectJsonLd($, titles, add) {
    const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);
        const type = [].concat(node['@type'] || []).join(' ');
        if (/VideoObject/i.test(type)) {
            if (node.name) titles.push(String(node.name));
            if (typeof node.contentUrl === 'string') add(node.contentUrl, 30, 'json-ld');
        }
        for (const k of Object.keys(node)) if (typeof node[k] === 'object') walk(node[k]);
    };
    $('script[type="application/ld+json"]').each((_, el) => {
        try { walk(JSON.parse($(el).contents().text())); } catch { /* JSON-LD invalide : on ignore */ }
    });
}

function extractMedia(html, pageUrl) {
    const $ = cheerio.load(html);
    const found = new Map(); // url -> { url, kind, score, via }
    const titles = [];
    const add = (raw, bonus, via) => {
        const abs = toAbsolute(decodeEscapes(String(raw || '')), pageUrl);
        if (!abs || !/\.(m3u8|mp4)(\?|$)/i.test(abs)) return;
        const score = scoreMedia(abs, bonus);
        if (score < 0) return;
        const prev = found.get(abs);
        if (!prev || score > prev.score) found.set(abs, { url: abs, kind: mediaKind(abs), score, via });
    };

    collectJsonLd($, titles, add);
    ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream'].forEach(p =>
        $(`meta[property="${p}"], meta[name="${p}"]`).each((_, el) => add($(el).attr('content'), 25, 'og:video')));
    $('meta[itemprop="contentUrl"]').each((_, el) => add($(el).attr('content'), 22, 'microdata'));
    $('video[src], video source[src], source[src]').each((_, el) => add($(el).attr('src'), 20, 'video-tag'));
    $('video[data-src], source[data-src]').each((_, el) => add($(el).attr('data-src'), 18, 'video-tag'));

    // Filet : lecteurs JS qui mettent l'URL dans un script / un attribut data-* / un JSON inline.
    const raw = decodeEscapes(html);
    let m;
    MEDIA_URL_RE.lastIndex = 0;
    while ((m = MEDIA_URL_RE.exec(raw)) !== null) add(m[0], 10, 'script');

    $('meta[property="og:title"], meta[name="twitter:title"]').each((_, el) => titles.push($(el).attr('content') || ''));
    titles.push($('title').first().text());
    $('h1').slice(0, 2).each((_, el) => titles.push($(el).text()));

    const candidates = [...found.values()].sort((a, b) => b.score - a.score);
    return { candidates, titles: titles.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean) };
}

// La page doit parler du bon film (et pas d'une autre version linguistique).
function judgePage(titles, pageUrl, ref, requireVf) {
    let best = null;
    for (const t of titles) {
        const m = matchVideoTitle(t, ref);
        if (m.matches && (!best || m.rank > best.m.rank)) best = { t, m };
    }
    if (!best) return { ok: false, reason: 'titre de la page différent du film demandé' };
    const hay = `${best.t} ${pageUrl}`;
    if (hasNonVfSignal(hay)) return { ok: false, reason: 'page marquée VO / sous-titrée' };
    if (requireVf && !hasVfSignal(hay) && !titles.some(hasVfSignal)) return { ok: false, reason: 'pas de signal VF (option « VF obligatoire »)' };
    return { ok: true, title: best.t };
}

// ------------------------------------------------------------
// Vérification d'un lien vidéo : répond-il vraiment ?
// ------------------------------------------------------------
async function probeMedia(url, kind, referer) {
    const headers = { Range: 'bytes=0-2047', Accept: '*/*' };
    if (referer) headers.Referer = referer;
    try {
        const r = await request(url, { headers, timeout: VERIFY_TIMEOUT_MS, maxBytes: 2048 });
        if (r.status !== 200 && r.status !== 206) return { ok: false, why: `HTTP ${r.status}` };
        if (kind === 'hls') {
            return r.body.toString('utf8').includes('#EXTM3U') ? { ok: true } : { ok: false, why: 'playlist HLS invalide' };
        }
        const isMp4Magic = r.body.length >= 12 && r.body.slice(4, 8).toString('latin1') === 'ftyp';
        const videoType = r.contentType.startsWith('video/') || r.contentType.includes('octet-stream');
        return (isMp4Magic || videoType) && !r.contentType.startsWith('text/') ? { ok: true } : { ok: false, why: `contenu inattendu (${r.contentType || 'inconnu'})` };
    } catch (err) {
        return { ok: false, why: err.name === 'AbortError' ? 'timeout' : err.message };
    }
}

// Sans Referer d'abord ; si seul le Referer de la page passe, on le signale (Stremio sait l'envoyer).
async function verifyMedia(c, pageUrl) {
    const plain = await probeMedia(c.url, c.kind, null);
    if (plain.ok) return { ok: true, needsReferer: false };
    const withRef = await probeMedia(c.url, c.kind, pageUrl);
    if (withRef.ok) return { ok: true, needsReferer: true };
    return { ok: false, why: plain.why };
}

// ------------------------------------------------------------
// Découverte de la page du film
// ------------------------------------------------------------
function hostMatches(host, domain) {
    const h = host.toLowerCase().replace(/^www\./, '');
    const d = String(domain || '').toLowerCase().replace(/^www\./, '').trim();
    return !!d && (h === d || h.endsWith('.' + d));
}

// Résultats DuckDuckGo (version HTML légère) : [{ url, text }]. Les liens sont enveloppés ("uddg=").
function parseDuckDuckGo(html) {
    const $ = cheerio.load(html);
    const out = [];
    $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        let url = null;
        const m = href.match(/[?&]uddg=([^&]+)/);
        if (m) { try { url = decodeURIComponent(m[1]); } catch { url = null; } }
        else if (/^https?:\/\//i.test(href) && !/duckduckgo\.com/i.test(href)) url = href;
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (url && text && $(el).is('.result__a, .result-link, [data-testid="result-title-a"]')) out.push({ url, text });
    });
    return out;
}

async function discoverViaSearchEngine(domains, query) {
    const q = `${query} (${domains.map(d => `site:${d}`).join(' OR ')})`;
    const r = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { timeout: DISCOVERY_TIMEOUT_MS });
    if (r.status !== 200) return { results: [], note: `moteur de recherche : HTTP ${r.status} (bloqué ?)` };
    return { results: parseDuckDuckGo(r.text), note: null };
}

// Source avec sa propre page de recherche : https://site/recherche?q={query}
async function discoverViaSearchUrl(source, query, ref) {
    const searchUrl = source.searchUrl.replace(/\{(?:query|title)\}/g, encodeURIComponent(query));
    const r = await getText(searchUrl, { timeout: DISCOVERY_TIMEOUT_MS });
    if (r.status !== 200) return { results: [], note: `recherche du site : HTTP ${r.status}` };
    const $ = cheerio.load(r.text);
    const base = new URL(r.finalUrl);
    let pattern = null;
    if (source.linkPattern) { try { pattern = new RegExp(source.linkPattern, 'i'); } catch { pattern = null; } }
    const seen = new Set();
    const results = [];
    $('a[href]').each((_, el) => {
        const abs = toAbsolute($(el).attr('href') || '', base);
        if (!abs || seen.has(abs)) return;
        let u; try { u = new URL(abs); } catch { return; }
        if (!hostMatches(u.hostname, base.hostname)) return;
        if (pattern && !pattern.test(abs)) return;
        const text = ($(el).attr('title') || $(el).find('img').first().attr('alt') || $(el).text()).replace(/\s+/g, ' ').trim();
        if (!text) return;
        seen.add(abs);
        results.push({ url: abs, text });
    });
    return { results, note: null };
}

// ------------------------------------------------------------
// Moteur
// ------------------------------------------------------------
async function tryPages(source, pages, ref, trace) {
    for (const p of pages.slice(0, MAX_PAGES_PER_SOURCE)) {
        const t0 = Date.now();
        let page;
        try { page = await getText(p.url); } catch (err) {
            trace.push({ step: `page:${source.name}`, ok: false, detail: `${p.url} → ${err.message}`, ms: Date.now() - t0 });
            continue;
        }
        if (page.status !== 200) {
            trace.push({ step: `page:${source.name}`, ok: false, detail: `${p.url} → HTTP ${page.status}`, ms: Date.now() - t0 });
            continue;
        }
        const { candidates, titles } = extractMedia(page.text, page.finalUrl);
        const verdict = judgePage(titles, page.finalUrl, ref, source.requireVf);
        if (!verdict.ok) {
            trace.push({ step: `page:${source.name}`, ok: false, detail: `${p.url} → ${verdict.reason} (« ${(titles[0] || '').slice(0, 80)} »)`, ms: Date.now() - t0 });
            continue;
        }
        if (!candidates.length) {
            trace.push({ step: `page:${source.name}`, ok: false, detail: `${p.url} → page reconnue mais aucun lien .mp4/.m3u8 dans le HTML (lecteur chargé en JavaScript ?)`, ms: Date.now() - t0 });
            continue;
        }
        for (const c of candidates.slice(0, 4)) {
            const v = await verifyMedia(c, page.finalUrl);
            trace.push({ step: `media:${source.name}`, ok: v.ok, detail: `${c.kind.toUpperCase()} ${c.url.slice(0, 140)} (${c.via})${v.ok ? (v.needsReferer ? ' · Referer requis' : '') : ' → ' + v.why}`, ms: Date.now() - t0 });
            if (v.ok) return { url: c.url, kind: c.kind, pageUrl: page.finalUrl, needsReferer: v.needsReferer, source: source.name, pageTitle: verdict.title };
        }
    }
    return null;
}

// Renvoie { hit, trace } ; hit = { url, kind, pageUrl, needsReferer, source } ou null.
// Les sources sont lues dans l'ordre de la liste (priorité) mais travaillent toutes EN PARALLÈLE.
async function resolveWebSources({ title, year, ref, sources, budgetMs = BUDGET_MS }) {
    const trace = [];
    const enabled = (sources || []).filter(s => s && s.enabled !== false && (s.domain || s.searchUrl));
    if (!enabled.length || !title) return { hit: null, trace };

    const query = `${title}${year ? ' ' + year : ''} bande annonce VF`;
    const domainSources = enabled.filter(s => s.domain && !s.searchUrl);

    // Une seule recherche pour plusieurs domaines (4 par requête) : évite de se faire limiter.
    const discoveries = new Map(); // source.id -> Promise<pages[]>
    const chunks = [];
    for (let i = 0; i < domainSources.length; i += 4) chunks.push(domainSources.slice(i, i + 4));
    for (const chunk of chunks) {
        const p = discoverViaSearchEngine(chunk.map(s => s.domain), query)
            .catch(err => ({ results: [], note: `moteur de recherche : ${err.message}` }));
        for (const s of chunk) {
            discoveries.set(s.id, p.then(({ results, note }) => {
                if (note) trace.push({ step: `découverte:${s.name}`, ok: false, detail: note });
                return results.filter(r => { try { return hostMatches(new URL(r.url).hostname, s.domain); } catch { return false; } });
            }));
        }
    }
    for (const s of enabled.filter(x => x.searchUrl)) {
        discoveries.set(s.id, discoverViaSearchUrl(s, query, ref)
            .then(({ results, note }) => { if (note) trace.push({ step: `découverte:${s.name}`, ok: false, detail: note }); return results; })
            .catch(err => { trace.push({ step: `découverte:${s.name}`, ok: false, detail: err.message }); return []; }));
    }

    const perSource = enabled.map(s => (async () => {
        const t0 = Date.now();
        const raw = await discoveries.get(s.id);
        // On ne lit que les pages dont l'intitulé ressemble au film demandé.
        const pages = raw.filter(r => matchVideoTitle(r.text, ref).matches);
        trace.push({ step: `découverte:${s.name}`, ok: pages.length > 0, detail: `${raw.length} résultat(s), ${pages.length} correspondant au titre`, ms: Date.now() - t0 });
        if (!pages.length) return null;
        return tryPages(s, pages, ref, trace);
    })().catch(err => { trace.push({ step: `source:${s.name}`, ok: false, detail: err.message }); return null; }));

    let timer;
    const budget = new Promise(resolve => { timer = setTimeout(() => resolve('budget'), budgetMs); });
    const all = Promise.all(perSource);
    const winner = await Promise.race([all, budget]);
    clearTimeout(timer);

    if (winner === 'budget') {
        trace.push({ step: 'budget', ok: false, detail: `budget de ${budgetMs} ms dépassé` });
        // On prend ce qui est déjà terminé, dans l'ordre de priorité.
        const settled = await Promise.all(perSource.map(p => Promise.race([p, new Promise(r => setTimeout(() => r(null), 0))])));
        return { hit: settled.find(Boolean) || null, trace };
    }
    return { hit: winner.find(Boolean) || null, trace };
}

// Stream Stremio pour un résultat.
function buildWebStream(hit, title) {
    const stream = { title, url: hit.url };
    if (hit.needsReferer) {
        // Certains CDN refusent la lecture sans Referer : Stremio sait l'envoyer (hors version web).
        stream.behaviorHints = { notWebReady: true, proxyHeaders: { request: { Referer: hit.pageUrl, 'User-Agent': UA } } };
    }
    return stream;
}

// ------------------------------------------------------------
// Stockage des sources (table créée toute seule + quelques suggestions, désactivées)
// ------------------------------------------------------------
const SEED_SOURCES = [
    { id: 'pathe-gaumont', name: 'Pathé Gaumont', domain: 'cinemaspathegaumont.com' },
    { id: 'ugc', name: 'UGC', domain: 'ugc.fr' },
    { id: 'ecran-large', name: 'Écran Large', domain: 'ecranlarge.com' },
    { id: 'premiere', name: 'Première', domain: 'premiere.fr' },
    { id: 'tele-loisirs', name: 'Télé-Loisirs', domain: 'programme-tv.net' },
];

let tableReady = null;
function ensureTable() {
    if (!sql) return Promise.resolve(false);
    if (!tableReady) {
        tableReady = (async () => {
            await sql`
                CREATE TABLE IF NOT EXISTS web_sources (
                    id          text PRIMARY KEY,
                    name        text NOT NULL,
                    domain      text,
                    search_url  text,
                    link_pattern text,
                    require_vf  boolean NOT NULL DEFAULT false,
                    enabled     boolean NOT NULL DEFAULT false,
                    position    integer NOT NULL DEFAULT 0
                )`;
            const marker = await sql`SELECT 1 FROM web_sources WHERE id = '__seeded__'`;
            if (!marker.length) {
                let pos = 0;
                for (const s of SEED_SOURCES) {
                    await sql`INSERT INTO web_sources (id, name, domain, enabled, position) VALUES (${s.id}, ${s.name}, ${s.domain}, false, ${pos++}) ON CONFLICT (id) DO NOTHING`;
                }
                await sql`INSERT INTO web_sources (id, name, enabled, position) VALUES ('__seeded__', '__seeded__', false, 9999) ON CONFLICT (id) DO NOTHING`;
            }
            return true;
        })().catch(err => { tableReady = null; console.error('Erreur table web_sources:', err.message); return false; });
    }
    return tableReady;
}

const rowToSource = r => ({
    id: r.id, name: r.name, domain: r.domain || '', searchUrl: r.search_url || '', linkPattern: r.link_pattern || '',
    requireVf: !!r.require_vf, enabled: !!r.enabled, position: r.position,
});

let enabledCache = { t: 0, v: [] };
const ENABLED_CACHE_MS = 20000;

async function listWebSources() {
    if (!(await ensureTable())) return [];
    const rows = await sql`SELECT * FROM web_sources WHERE id <> '__seeded__' ORDER BY position ASC, name ASC`;
    return rows.map(rowToSource);
}

// Chemin chaud (chaque résolution) : lecture mémoire 20 s, vidée à chaque modification.
async function getEnabledWebSources() {
    if (Date.now() - enabledCache.t < ENABLED_CACHE_MS) return enabledCache.v;
    try {
        const v = (await listWebSources()).filter(s => s.enabled);
        enabledCache = { t: Date.now(), v };
        return v;
    } catch (err) {
        console.error('Erreur lecture sources web:', err.message);
        return [];
    }
}

function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

function cleanDomain(raw) {
    let d = String(raw || '').trim().toLowerCase();
    if (!d) return '';
    try { d = new URL(/^https?:\/\//.test(d) ? d : 'https://' + d).hostname; } catch { return ''; }
    return d.replace(/^www\./, '');
}

async function saveWebSource(input) {
    if (!(await ensureTable())) return { ok: false, error: 'base de données non configurée' };
    const name = String(input.name || '').trim().slice(0, 60);
    const domain = cleanDomain(input.domain);
    const searchUrl = String(input.searchUrl || '').trim();
    if (!name) return { ok: false, error: 'nom requis' };
    if (!domain && !searchUrl) return { ok: false, error: 'un domaine ou une URL de recherche est requis' };
    if (searchUrl) {
        if (!/^https?:\/\//i.test(searchUrl) || !/\{(query|title)\}/.test(searchUrl)) return { ok: false, error: 'URL de recherche : http(s):// et {query} requis' };
    }
    if (input.linkPattern) { try { new RegExp(input.linkPattern); } catch { return { ok: false, error: 'motif de lien invalide (expression régulière)' }; } }
    const id = input.id ? String(input.id) : `${slug(name) || 'source'}-${Date.now().toString(36)}`;
    const existing = await sql`SELECT position FROM web_sources WHERE id = ${id}`;
    let position;
    if (existing.length) position = existing[0].position;
    else { const mx = await sql`SELECT COALESCE(MAX(position), 0) AS m FROM web_sources WHERE id <> '__seeded__'`; position = Number(mx[0].m) + 1; }
    await sql`
        INSERT INTO web_sources (id, name, domain, search_url, link_pattern, require_vf, enabled, position)
        VALUES (${id}, ${name}, ${domain || null}, ${searchUrl || null}, ${input.linkPattern || null}, ${input.requireVf === true}, ${input.enabled === true}, ${position})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, domain = EXCLUDED.domain, search_url = EXCLUDED.search_url,
            link_pattern = EXCLUDED.link_pattern, require_vf = EXCLUDED.require_vf, enabled = EXCLUDED.enabled`;
    enabledCache = { t: 0, v: [] };
    return { ok: true, id };
}

async function deleteWebSource(id) {
    if (!(await ensureTable())) return false;
    await sql`DELETE FROM web_sources WHERE id = ${id} AND id <> '__seeded__'`;
    enabledCache = { t: 0, v: [] };
    return true;
}

module.exports = {
    resolveWebSources, buildWebStream, extractMedia, judgePage, parseDuckDuckGo,
    assertPublicUrl, isPrivateIp, cleanDomain,
    listWebSources, getEnabledWebSources, saveWebSource, deleteWebSource,
    _setTestMode,
};
