// Exploration Netflix en arrière-plan : découverte des ID cités par les pages, états de la table, liaison TMDB sûre,
// pause sur blocage (403), 404 définitif, et routes du dashboard (table paginée, pilotage).
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-crawl-'));
process.env.DASHBOARD_PASSWORD = 'secret-test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

let sql, store, crawler, nf, tmdbSync, fake, appServer, api, token;

// Page Netflix factice : titre + titres « similaires » (dans le JSON embarqué et en lien /title/<id>).
const page = (nid, title, year, typename, similar) => {
    const video = { videoId: Number(nid), __typename: typename, title, latestYear: year, shortSynopsis: 's', contentAdvisory: {} };
    const rows = { trifectaRows: { collections: [{ videos: similar.map(id => ({ __typename: 'Show', videoId: Number(id), title: 'x' })) }] } };
    return `<html><script>netflix.reactContext = ${JSON.stringify({ models: { a: { videos: [video], ...rows } } })};</script></html>`;
};

before(async () => {
    sql = require('../lib/db');
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
    crawler = require('../lib/netflix-crawler');
    nf = require('../lib/netflix-trailer');
    tmdbSync = require('../lib/netflix-tmdb-sync');

    fake = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        let m = u.pathname.match(/^\/3\/search\/(movie|tv)$/);
        if (m) return json({ results: u.searchParams.get('query') === 'Lupin' ? [{ id: 7, name: 'Lupin', first_air_date: '2021-01-08' }] : [] });
        m = u.pathname.match(/^\/3\/(movie|tv)\/7\/external_ids$/);
        if (m) return json({ imdb_id: 'tt1000007' });
        m = u.pathname.match(/^\/title\/(\d+)$/);
        if (m) {
            const nid = m[1];
            if (nid === '80000003') { res.writeHead(404); return res.end(); }
            if (nid === '80000004') { res.writeHead(403); return res.end(); }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            if (nid === '80000010' || nid === '80000011') return res.end(page(nid, nid === '80000010' ? 'Lupin' : 'Lupin', nid === '80000010' ? 2021 : 1999, 'Show', []));
            if (nid === '80000001') return res.end(page(nid, 'Lupin', 2021, 'Show', ['80000002', '80000003', '80000004']));
            return res.end(page(nid, 'Autre titre', 2020, 'Movie', ['80000001']));
        }
        res.writeHead(404); res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    tmdbSync._endpoints.tmdb = `${base}/3`;
    nf._endpoints.netflixTitle = (_c, nid) => `${base}/title/${nid}`;

    const app = express();
    app.use(express.json());
    app.post('/api/login', require('../lib/auth').login);
    require('../routes/netflix-admin')(app);
    await new Promise(r => { appServer = app.listen(0, '127.0.0.1', r); });
    api = `http://127.0.0.1:${appServer.address().port}`;
    token = (await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-test' }) })).json()).token;
});

after(() => { crawler.stop(); fake.close(); appServer.close(); sql.close(); });

const call = (p, body) => fetch(api + p, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
}).then(async r => ({ status: r.status, data: await r.json() }));

test('extractRelatedIds : liens /title/ et videoId du JSON, sans l\'ID de la page', () => {
    const ids = nf.extractRelatedIds(page('80000001', 'Lupin', 2021, 'Show', ['80000002', '80000003']) + '<a href="/fr/title/80000009">', '80000001');
    assert.deepStrictEqual(ids.sort(), ['80000002', '80000003', '80000009']);
});

test('explorer un ID : titre enregistré, ID cités ajoutés « à explorer »', async () => {
    await store.upsertTitle({ nid: '80000001', source: 'manual' });
    const r = await crawler.exploreOne('80000001');
    assert.strictEqual(r, 'done');
    const row = await store.getTitle('80000001');
    assert.strictEqual(row.title, 'Lupin');
    assert.strictEqual(row.crawl_status, 'done');
    assert.strictEqual(row.source, 'manual', 'une saisie manuelle reste manuelle');
    const counts = await store.crawlCounts();
    assert.strictEqual(counts.pending, 3); // 80000002, 80000003, 80000004
    const child = await store.getTitle('80000002');
    assert.strictEqual(child.source, 'crawl');
    assert.strictEqual(child.discovered_from, '80000001');
});

test('sans TMDB_API_KEY connue du crawler : pas de liaison automatique ; 404 = missing', async () => {
    assert.strictEqual(await crawler.exploreOne('80000003'), 'missing');
    assert.strictEqual((await store.getTitle('80000003')).crawl_status, 'missing');
});

test('403 : erreur « blocked » (la pause est gérée par la boucle), la ligne reste à explorer', async () => {
    await assert.rejects(() => crawler.exploreOne('80000004'), e => e.blocked === true);
    assert.strictEqual((await store.getTitle('80000004')).crawl_status, null);
});

test('nextToCrawl : jamais explorés d\'abord ; une page déjà explorée n\'est pas reprise', async () => {
    const next = await store.nextToCrawl();
    assert.ok(['80000002', '80000004'].includes(next));
    assert.notStrictEqual(next, '80000001');
});

test('route /titles : pagination, filtre et recherche', async () => {
    const all = await call('/api/netflix-catalog/titles?size=2');
    assert.strictEqual(all.status, 200);
    assert.strictEqual(all.data.total, 4);
    assert.strictEqual(all.data.rows.length, 2);
    const done = await call('/api/netflix-catalog/titles?filter=done');
    assert.strictEqual(done.data.total, 1);
    const q = await call('/api/netflix-catalog/titles?q=lup');
    assert.strictEqual(q.data.rows[0].nid, '80000001');
    const evil = await call('/api/netflix-catalog/titles?q=' + encodeURIComponent("%' OR 1=1 --"));
    assert.strictEqual(evil.status, 200);
    assert.strictEqual(evil.data.total, 0);
});

test('route /crawler : désactivé par défaut, activation, cadence bornée à 1,5 s', async () => {
    const s0 = await call('/api/netflix-catalog/crawler');
    assert.strictEqual(s0.data.enabled, false);
    const s1 = await call('/api/netflix-catalog/crawler', { enabled: true, delayMs: 10 });
    assert.strictEqual(s1.data.enabled, true);
    assert.strictEqual(s1.data.delayMs, 1500);
    assert.strictEqual(s1.data.counts.pending, 2);
    const s2 = await call('/api/netflix-catalog/crawler', { enabled: false });
    assert.strictEqual(s2.data.enabled, false);
});

test('routes protégées : 401 sans session', async () => {
    assert.strictEqual((await fetch(`${api}/api/netflix-catalog/titles`)).status, 401);
    assert.strictEqual((await fetch(`${api}/api/netflix-catalog/crawler`)).status, 401);
});

test('liaison TMDB automatique : seulement si titre ET année concordent', async () => {
    crawler._setTmdbKey('k');
    await store.upsertTitle({ nid: '80000010', source: 'crawl' });
    await store.upsertTitle({ nid: '80000011', source: 'crawl' });
    await crawler.exploreOne('80000010');   // Lupin 2021 = TMDB Lupin 2021 -> lié
    await crawler.exploreOne('80000011');   // Lupin 1999 : même titre, année différente -> pas de liaison automatique
    const ok = await store.getTitle('80000010');
    assert.strictEqual(ok.imdb_id, 'tt1000007');
    assert.strictEqual(ok.tmdb_id, 7);
    assert.strictEqual(ok.source, 'crawl'); // la liaison automatique reste moins fiable qu'une saisie ou la synchro TMDB
    assert.strictEqual((await store.getTitle('80000011')).imdb_id, null);
    crawler._setTmdbKey('');
});
