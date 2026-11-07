// Tests de la source Netflix (lib/netflix-trailer.js) : lecture de la page, recherche de l'ID via Wikidata,
// relais vidéo (Range, renouvellement d'un lien expiré). Aucun accès réseau réel : faux serveurs locaux.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const nf = require('../lib/netflix-trailer');

const VIDEO = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(988, 7)]); // 1000 octets

let fake, fakeBase, app, appServer, appBase;
let pageHits, wikiHits, videoHits, validToken, wikiAnswer, pageMode;

// Page Netflix minimale avec netflix.reactContext (même forme que la vraie page).
function netflixPage(nid, videoUrl) {
    const ctx = {
        models: { x: { videos: [{
            videoId: Number(nid), shortSynopsis: 'Synopsis', contentAdvisory: { certificationValue: '16+' },
            trailers: { edges: [{ node: { title: 'Bande-annonce', runtimeSec: 100, playableVideo: { url: videoUrl } } }] },
        }] } },
    };
    return `<html><script>window.netflix = {}; netflix.reactContext = ${JSON.stringify(ctx)};</script></html>`;
}

before(async () => {
    fake = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        if (u.pathname === '/sparql') {
            wikiHits++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ results: { bindings: wikiAnswer ? [{ n: { value: wikiAnswer } }] : [] } }));
        }
        const m = u.pathname.match(/^\/title\/(\d+)$/);
        if (m) {
            pageHits++;
            if (pageMode === 'blocked') { res.writeHead(500); return res.end('nope'); }
            if (pageMode === 'notrailer') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>rien</html>'); }
            const exp = Math.floor(Date.now() / 1000) + 3600;
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(netflixPage(m[1], `${fakeBase}/video.mp4?e=${exp}&t=${validToken}`));
        }
        if (u.pathname === '/video.mp4') {
            videoHits++;
            if (u.searchParams.get('t') !== validToken) { res.writeHead(403); return res.end('expired'); }
            const range = req.headers.range && req.headers.range.match(/bytes=(\d+)-(\d*)/);
            if (range) {
                const a = Number(range[1]); const b = range[2] ? Number(range[2]) : VIDEO.length - 1;
                res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${a}-${b}/${VIDEO.length}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
                return res.end(VIDEO.subarray(a, b + 1));
            }
            res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': VIDEO.length, 'Accept-Ranges': 'bytes' });
            return res.end(VIDEO);
        }
        res.writeHead(404); res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    fakeBase = `http://127.0.0.1:${fake.address().port}`;
    nf._endpoints.wikidata = `${fakeBase}/sparql`;
    nf._endpoints.netflixTitle = (_c, nid) => `${fakeBase}/title/${nid}`;

    app = express();
    app.get('/nf/:nid.mp4', (req, res) => nf.relayTrailer(req, res, req.params.nid));
    app.head('/nf/:nid.mp4', (req, res) => nf.relayTrailer(req, res, req.params.nid));
    await new Promise(r => { appServer = app.listen(0, '127.0.0.1', r); });
    appBase = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => { fake.close(); appServer.close(); });

beforeEach(() => {
    pageHits = 0; wikiHits = 0; videoHits = 0; validToken = 'ok1'; wikiAnswer = null; pageMode = 'normal';
    nf._caches.idCache.clear(); nf._caches.trailerCache.clear();
});

test('parseNetflixId : URL, ID seul, n\'importe quel pays', () => {
    assert.strictEqual(nf.parseNetflixId('https://www.netflix.com/fr/title/81944880'), '81944880');
    assert.strictEqual(nf.parseNetflixId('https://www.netflix.com/title/81944880?trackId=1'), '81944880');
    assert.strictEqual(nf.parseNetflixId('81944880'), '81944880');
    assert.strictEqual(nf.parseNetflixId('https://www.netflix.com/browse'), null);
    assert.strictEqual(nf.parseNetflixId('abc'), null);
    assert.strictEqual(nf.parseNetflixId('123'), null);
});

test('netflixUrlToRelay : page titre Netflix -> /nf/<id>.mp4, le reste inchangé', () => {
    process.env.APP_BASE_URL = 'https://vf.example.org/';
    assert.strictEqual(nf.netflixUrlToRelay('https://www.netflix.com/fr/title/81944880'), 'https://vf.example.org/nf/81944880.mp4');
    assert.strictEqual(nf.netflixUrlToRelay('https://cdn.exemple.fr/video.mp4'), 'https://cdn.exemple.fr/video.mp4');
    assert.strictEqual(nf.netflixUrlToRelay('https://www.netflix.com/browse'), 'https://www.netflix.com/browse');
    assert.strictEqual(nf.netflixUrlToRelay('https://evil.com/?u=netflix.com/title/81944880'), 'https://evil.com/?u=netflix.com/title/81944880');
    delete process.env.APP_BASE_URL;
});

test('extractTrailers : lit les trailers de netflix.reactContext, avec expiration', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const html = netflixPage('81944880', `https://cdn.nflxvideo.net/a.mp4?e=${exp}&v=1`);
    const t = nf.extractTrailers(html, '81944880');
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].title, 'Bande-annonce');
    assert.strictEqual(t[0].runtime, 100);
    assert.strictEqual(t[0].expires, exp * 1000);
    // un autre titre dans la page ne doit pas être pris pour celui demandé
    assert.deepStrictEqual(nf.extractTrailers(html, '99999999'), []);
    // pas de reactContext / JSON cassé -> []
    assert.deepStrictEqual(nf.extractTrailers('<html></html>', '81944880'), []);
    assert.deepStrictEqual(nf.extractTrailers('netflix.reactContext = {oups</script>', '81944880'), []);
});

test('extractTrailers : refuse les liens non https', () => {
    assert.strictEqual(nf._endpoints.allowHttp, false);
    assert.deepStrictEqual(nf.extractTrailers(netflixPage('81944880', 'http://cdn.exemple.fr/a.mp4'), '81944880'), []);
});

test('findNetflixId : Wikidata, mise en cache (succès et échec), IMDB ID invalide ignoré', async () => {
    wikiAnswer = '81944880';
    assert.strictEqual(await nf.findNetflixId('tt1234567'), '81944880');
    assert.strictEqual(await nf.findNetflixId('tt1234567'), '81944880');
    assert.strictEqual(wikiHits, 1, 'la 2e lecture vient du cache');

    wikiAnswer = null;
    assert.strictEqual(await nf.findNetflixId('tt7654321'), null);
    assert.strictEqual(await nf.findNetflixId('tt7654321'), null);
    assert.strictEqual(wikiHits, 2, 'l\'absence est aussi mise en cache');

    assert.strictEqual(await nf.findNetflixId('pas-un-id'), null);
    assert.strictEqual(await nf.findNetflixId('tt1"; DROP'), null);
    assert.strictEqual(wikiHits, 2, 'aucun appel pour un ID invalide');
});

test('findNetflixId : valeur non numérique renvoyée par Wikidata -> null', async () => {
    wikiAnswer = 'title/abc';
    assert.strictEqual(await nf.findNetflixId('tt1111111'), null);
});

// Le faux serveur sert des liens vidéo en http : pour le relais on court-circuite le filtre https en
// pré-remplissant le cache des trailers (le parsing https est testé séparément ci-dessus).
function primeTrailer(nid, tokenInUrl, expiresMs) {
    nf._caches.trailerCache.set(nid, {
        at: Date.now(),
        trailers: [{ title: 'Bande-annonce', runtime: 100, url: `${fakeBase}/video.mp4?t=${tokenInUrl}`, expires: expiresMs || null }],
    });
}

test('relais : GET complet, en-têtes vidéo transmis', async () => {
    primeTrailer('81944880', 'ok1');
    const r = await fetch(`${appBase}/nf/81944880.mp4`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'video/mp4');
    assert.strictEqual(Buffer.from(await r.arrayBuffer()).length, 1000);
});

test('relais : requête Range -> 206 et bon morceau (lecture / seek Stremio)', async () => {
    primeTrailer('81944880', 'ok1');
    const r = await fetch(`${appBase}/nf/81944880.mp4`, { headers: { Range: 'bytes=100-199' } });
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.headers.get('content-range'), 'bytes 100-199/1000');
    assert.strictEqual(Buffer.from(await r.arrayBuffer()).length, 100);
});

test('relais : HEAD répond sans corps', async () => {
    primeTrailer('81944880', 'ok1');
    const r = await fetch(`${appBase}/nf/81944880.mp4`, { method: 'HEAD' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'video/mp4');
});

test('relais : lien périmé (403) -> la page est relue, le lien renouvelé, la lecture réussit', async () => {
    nf._endpoints.allowHttp = true;           // le faux serveur vidéo est en http
    try {
        primeTrailer('81944880', 'perime');   // lien mort en cache : le serveur vidéo répond 403
        validToken = 'ok1';                   // la page (relue) fournira un lien valide
        const r = await fetch(`${appBase}/nf/81944880.mp4`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(Buffer.from(await r.arrayBuffer()).length, 1000);
        assert.strictEqual(pageHits, 1, 'la page a été relue une fois pour renouveler le lien');
        assert.strictEqual(videoHits, 2, 'un essai 403 puis un essai réussi');
    } finally { nf._endpoints.allowHttp = false; }
});

test('relais : lien proche de l\'expiration -> renouvelé avant même d\'essayer', async () => {
    nf._endpoints.allowHttp = true;
    try {
        primeTrailer('81944880', 'ok1', Date.now() + 30 * 1000); // expire dans 30 s (< marge de 2 min)
        const r = await fetch(`${appBase}/nf/81944880.mp4`);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(pageHits, 1);
    } finally { nf._endpoints.allowHttp = false; }
});

test('relais : titre sans bande-annonce -> 404, page bloquée -> 404 sans planter, ID invalide -> 404', async () => {
    pageMode = 'notrailer';
    assert.strictEqual((await fetch(`${appBase}/nf/81944880.mp4`)).status, 404);
    nf._caches.trailerCache.clear();
    pageMode = 'blocked';
    assert.strictEqual((await fetch(`${appBase}/nf/81944881.mp4`)).status, 404);
    assert.strictEqual((await fetch(`${appBase}/nf/abc.mp4`)).status, 404);
});

test('getTrailers : cache (une seule lecture de page), échec mémorisé, force ignore le cache', async () => {
    pageMode = 'notrailer';
    assert.deepStrictEqual(await nf.getTrailers('81944880'), []);
    assert.deepStrictEqual(await nf.getTrailers('81944880'), []);
    assert.strictEqual(pageHits, 1, 'l\'échec est mémorisé, pas de nouvelle lecture');
    await nf.getTrailers('81944880', { force: true });
    assert.strictEqual(pageHits, 2);
});

test('getTrailers : demandes simultanées -> une seule lecture de page', async () => {
    pageMode = 'notrailer';
    await Promise.all([nf.getTrailers('81944880'), nf.getTrailers('81944880'), nf.getTrailers('81944880')]);
    assert.strictEqual(pageHits, 1);
});

test('resolveNetflixTrailer : ID introuvable / pas de trailer / trouvé', async () => {
    let r = await nf.resolveNetflixTrailer('tt1234567');
    assert.strictEqual(r.found, false);
    assert.match(r.reason, /Wikidata/);

    wikiAnswer = '81944880'; pageMode = 'notrailer';
    nf._caches.idCache.clear();
    r = await nf.resolveNetflixTrailer('tt1234567');
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.nid, '81944880');

    primeTrailer('81944880', 'ok1');
    process.env.APP_BASE_URL = 'https://vf.example.org';
    r = await nf.resolveNetflixTrailer('tt1234567');
    assert.strictEqual(r.found, true);
    assert.strictEqual(r.url, 'https://vf.example.org/nf/81944880.mp4');
    delete process.env.APP_BASE_URL;
});
