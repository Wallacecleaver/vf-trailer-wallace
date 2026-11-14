// Tests d'intégration : resolveViaApis doit utiliser l'API de fédération Netflix
// quand TMDB n'a pas de bande-annonce (ou ne connaît pas le titre), et la couper
// quand le réglage netflixFederation est désactivé.
// Le réseau TMDB est simulé en remplaçant lib/net.fetchT AVANT de charger les modules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let upstream, upstreamBase, upstreamHits = 0;
let tmdbFind = 'hit'; // 'hit' | 'miss'

// ---- Faux TMDB : toutes les URLs TMDB passent par fetchT (lib/net.js) ----
const net = require('../lib/net');
net.fetchT = async (url) => {
    const json = data => ({ ok: true, json: async () => data });
    if (url.includes('/find/')) {
        return json(tmdbFind === 'hit'
            ? { movie_results: [{ id: 42, title: 'Film TMDB' }], tv_results: [] }
            : { movie_results: [], tv_results: [] });
    }
    if (url.includes('/alternative_titles')) return json({ titles: [] });
    if (url.includes('/videos')) return json({ results: [] });
    if (/\/movie\/42\?/.test(url)) return json({ title: 'Film TMDB', original_title: 'Film TMDB', release_date: '2024-01-01' });
    return json({});
};

const { resolveViaApis } = require('../lib/resolve-apis');

const BEHAVIOR = {
    allocineFallback: false,
    youtubeSearchFallback: false,
    netflixFederation: true,
    netflixFallback: false,
    maxTrailers: 2,
    trailerLanguage: 'fr-only',
    extraVfKeywords: [],
};

before(async () => {
    upstream = http.createServer((req, res) => {
        upstreamHits++;
        const u = new URL(req.url, 'http://x');
        if (u.pathname !== '/api/trailers') { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            found: true,
            title: { id: 'nflx:42', name: 'Film amont', type: 'movie' },
            trailers: [{ title: 'Bande-annonce', url: `${upstreamBase}/trailer/81944880/0.mp4`, runtime: 120 }],
        }));
    });
    await new Promise(r => upstream.listen(0, '127.0.0.1', r));
    upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
});

after(() => {
    delete process.env.NETFLIX_FEDERATION_URL;
    delete process.env.NETFLIX_FEDERATION_API_KEY;
    if (upstream.closeAllConnections) upstream.closeAllConnections();
    upstream.close();
});

beforeEach(() => {
    tmdbFind = 'hit';
    upstreamHits = 0;
    process.env.NETFLIX_FEDERATION_URL = upstreamBase;
    process.env.NETFLIX_FEDERATION_API_KEY = 'secret';
    process.env.NETFLIX_FEDERATION_TIMEOUT_MS = '2000';
    require('../lib/netflix-federation')._caches.cache.clear();
});

test('TMDB ne connaît pas le titre : l\'API de fédération est interrogée par IMDb', async () => {
    tmdbFind = 'miss';
    const trace = [];
    const r = await resolveViaApis('movie', 'tt1234567', null, { ...BEHAVIOR }, 'fausse-cle', trace);

    assert.strictEqual(r.source, 'netflix_federation');
    assert.strictEqual(r.officialTitle, 'Film amont');
    assert.strictEqual(r.streams.length, 1);
    assert.strictEqual(r.streams[0].url, `${upstreamBase}/trailer/81944880/0.mp4`);
    assert.strictEqual(upstreamHits, 1);
    const step = trace.find(t => t.step === 'netflix-federation');
    assert.ok(step && step.ok, 'la trace doit mentionner la fédération');
});

test('TMDB connaît le titre mais n\'a aucune vidéo : fédération en repli', async () => {
    const r = await resolveViaApis('movie', 'tt1234567', null, { ...BEHAVIOR }, 'fausse-cle');

    assert.strictEqual(r.source, 'netflix_federation');
    assert.strictEqual(r.officialTitle, 'Film TMDB');
    assert.strictEqual(r.streams.length, 1);
    assert.match(r.streams[0].title, /Bande-annonce/);
    assert.strictEqual(upstreamHits, 1);
});

test('réglage netflixFederation désactivé : aucun appel à l\'instance amont', async () => {
    tmdbFind = 'miss';
    const r = await resolveViaApis('movie', 'tt1234567', null, { ...BEHAVIOR, netflixFederation: false }, 'fausse-cle');

    assert.deepStrictEqual(r.streams, []);
    assert.strictEqual(upstreamHits, 0);
});
