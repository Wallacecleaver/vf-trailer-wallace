// Tests du complément TMDB (faux serveur TMDB + faux Wikidata locaux, aucun accès réseau réel).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

let dir, sql, store, tmdbSync, wd, fake, calls;

before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-tmdb-'));
    process.env.DATA_DIR = dir;
    sql = require('../lib/db');
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
    tmdbSync = require('../lib/netflix-tmdb-sync');
    wd = require('../lib/netflix-wikidata-sync');
    calls = { discover: [], sparql: 0 };
    fake = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (u.pathname === '/sparql') {
            calls.sparql++;
            const q = u.searchParams.get('query');
            const bindings = q.includes('"tt1000001"') ? [{ imdb: { value: 'tt1000001' }, nid: { value: '81000010' } }] : [];
            return res.end(JSON.stringify({ results: { bindings } }));
        }
        let m = u.pathname.match(/^\/discover\/(movie|tv)$/);
        if (m) {
            calls.discover.push(req.url);
            const page = Number(u.searchParams.get('page'));
            const results = m[1] === 'movie'
                ? [{ id: 11, title: 'Film A', release_date: '2024-05-01' }, { id: 12, title: 'Film B', release_date: '2023-01-01' }]
                : [{ id: 21, name: 'Série A', first_air_date: '2022-03-03' }];
            return res.end(JSON.stringify({ page, total_pages: 2, results }));
        }
        m = u.pathname.match(/^\/(movie|tv)\/(\d+)\/external_ids$/);
        if (m) {
            const imdb = { '11': 'tt1000001', '12': 'tt1000002' }[m[2]] || null;
            return res.end(JSON.stringify({ imdb_id: imdb }));
        }
        res.writeHead(404); res.end('{}');
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    tmdbSync._endpoints.tmdb = base;
    wd._endpoints.wikidata = `${base}/sparql`;
});
after(() => { fake.close(); sql.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('sans clé TMDB : rien n\'est fait', async () => {
    assert.deepStrictEqual(await tmdbSync.syncFromTmdb(''), { skipped: 'TMDB_API_KEY absente' });
});

test('discover France / Netflix, IMDB IDs puis ID Netflix via Wikidata', async () => {
    const r = await tmdbSync.syncFromTmdb('clef', { pages: 2 });
    assert.strictEqual(r.discovered, 2 * 2 + 2); // films : 2 pages x 2 ; séries : 2 pages x 1 -> 6 lectures
    assert.strictEqual(r.imdb, 2);
    assert.strictEqual(r.resolved, 1);
    assert.ok(calls.discover.every(u => u.includes('watch_region=FR') && u.includes('with_watch_providers=8')));
    assert.strictEqual(await store.findNidByImdb('tt1000001'), '81000010');
    assert.strictEqual(await store.findNidByTmdb(11, 'movie'), '81000010');
    assert.strictEqual(await store.findNidByImdb('tt1000002'), null); // inconnu de Wikidata
});

test('les introuvables ne sont pas redemandés à Wikidata avant 7 jours', async () => {
    const before = calls.sparql;
    const r = await tmdbSync.resolveNetflixIds();
    assert.strictEqual(r, 0);
    assert.strictEqual(calls.sparql, before);
    await sql`UPDATE netflix_tmdb_seen SET nid_checked_at = '2000-01-01T00:00:00.000Z'`;
    await tmdbSync.resolveNetflixIds();
    assert.ok(calls.sparql > before);
});

test('un nouveau passage ne duplique rien', async () => {
    await tmdbSync.syncFromTmdb('clef', { pages: 1 });
    const rows = await sql`SELECT COUNT(*) AS n FROM netflix_tmdb_seen`;
    assert.strictEqual(Number(rows[0].n), 3);
});
