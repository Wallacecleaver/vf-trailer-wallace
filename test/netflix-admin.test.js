// Routes de l'onglet « Catalogue Netflix » du dashboard (routes/netflix-admin.js) : authentification,
// recherche dans le catalogue, test de bande-annonce, URL Netflix -> TMDB -> IMDB (avec et sans enregistrement).
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-admin-'));
process.env.DASHBOARD_PASSWORD = 'secret-test';
process.env.TMDB_API_KEY = 'testkey';
process.env.APP_BASE_URL = 'https://addon.example';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

let sql, store, fakeServer, appServer, api, token;

const netflixPage = (nid, title, year, typename, trailerUrl) => {
    const video = { videoId: Number(nid), __typename: typename, title, latestYear: year, shortSynopsis: 's', contentAdvisory: {} };
    if (trailerUrl) video.trailers = { edges: [{ node: { title: 'Bande-annonce', runtimeSec: 98, playableVideo: { url: trailerUrl } } }] };
    return `<html><script>window.netflix = {}; netflix.reactContext = ${JSON.stringify({ models: { x: { videos: [video] } } })};</script></html>`;
};

before(async () => {
    sql = require('../lib/db');
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
    const nf = require('../lib/netflix-trailer');
    const tmdbSync = require('../lib/netflix-tmdb-sync');

    fakeServer = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        let m = u.pathname.match(/^\/3\/search\/(movie|tv)$/);
        if (m) return json({ results: u.searchParams.get('query') === 'Trouble échange' ? [{ id: 99, name: 'Trouble échange', first_air_date: '2026-02-01' }] : [] });
        m = u.pathname.match(/^\/3\/(movie|tv)\/99\/external_ids$/);
        if (m) return json({ imdb_id: 'tt1000099' });
        m = u.pathname.match(/^\/title\/(\d+)$/);
        if (m) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(netflixPage(m[1], 'Trouble échange', 2026, 'Show', `http://127.0.0.1:${fakeServer.address().port}/v.mp4?e=9999999999`));
        }
        res.writeHead(404); res.end();
    });
    await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fakeServer.address().port}`;
    tmdbSync._endpoints.tmdb = `${base}/3`;
    nf._endpoints.netflixTitle = (_c, nid) => `${base}/title/${nid}`;
    nf._endpoints.allowHttp = true; // le faux serveur est en http

    const app = express();
    app.use(express.json());
    app.post('/api/login', require('../lib/auth').login);
    require('../routes/netflix-admin')(app);
    await new Promise(r => { appServer = app.listen(0, '127.0.0.1', r); });
    api = `http://127.0.0.1:${appServer.address().port}`;
    token = (await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-test' }) })).json()).token;
});

after(() => { fakeServer.close(); appServer.close(); sql.close(); });

const call = (p, body) => fetch(api + p, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

test('toutes les routes exigent la connexion', async () => {
    for (const [method, p] of [['GET', '/api/netflix-catalog'], ['POST', '/api/netflix-catalog/sync'], ['GET', '/api/netflix-catalog/lookup?q=tt1234567'],
        ['POST', '/api/netflix-catalog/trailers'], ['POST', '/api/netflix-catalog/from-url'], ['POST', '/api/netflix-catalog/link']]) {
        const res = await fetch(api + p, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        assert.strictEqual(res.status, 401, `${method} ${p}`);
    }
});

test('URL Netflix en mode test : rien n\'est écrit ; puis enregistrement et recherche dans le catalogue', async () => {
    const url = 'https://www.netflix.com/fr/title/81944880';
    const preview = await (await call('/api/netflix-catalog/from-url', { url, dryRun: true })).json();
    assert.strictEqual(preview.status, 'preview');
    assert.strictEqual(preview.imdbId, 'tt1000099');
    assert.strictEqual(preview.match.title, 'Trouble échange');
    assert.strictEqual(await store.getTitle('81944880'), null, 'dryRun n\'écrit rien');

    const linked = await (await call('/api/netflix-catalog/from-url', { url })).json();
    assert.strictEqual(linked.status, 'linked');
    assert.strictEqual(await store.findNidByImdb('tt1000099'), '81944880');

    const found = await (await call('/api/netflix-catalog/lookup?q=tt1000099')).json();
    assert.strictEqual(found.rows.length, 1);
    assert.strictEqual(found.rows[0].nid, '81944880');
    const byUrl = await (await call('/api/netflix-catalog/lookup?q=' + encodeURIComponent(url))).json();
    assert.strictEqual(byUrl.rows[0].imdb_id, 'tt1000099');
    assert.strictEqual((await call('/api/netflix-catalog/lookup?q=n-importe-quoi')).status, 400);

    const stats = await (await call('/api/netflix-catalog')).json();
    assert.strictEqual(stats.titles, 1);
    assert.strictEqual(stats.titlesWithImdb, 1);
    assert.strictEqual(stats.tmdbKeyConfigured, true);
});

test('bandes-annonces Netflix : listées sans exposer les liens signés', async () => {
    const out = await (await call('/api/netflix-catalog/trailers', { q: 'https://www.netflix.com/fr/title/81944880' })).json();
    assert.strictEqual(out.trailers.length, 1);
    assert.strictEqual(out.trailers[0].runtimeSec, 98);
    assert.strictEqual(out.relayUrl, 'https://addon.example/nf/81944880.mp4');
    assert.ok(!JSON.stringify(out).includes('v.mp4'), 'le lien signé Netflix ne sort pas du serveur');
    assert.strictEqual((await call('/api/netflix-catalog/trailers', { q: 'abc' })).status, 400);
});
