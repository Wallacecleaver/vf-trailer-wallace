// Tests du catalogue Netflix (lib/netflix-catalog.js) : fusion des sources, synchro Wikidata / TMDB,
// recherche locale, URL Netflix -> TMDB -> IMDB. Aucun accès réseau réel : faux serveurs locaux + base temporaire.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nfcat-'));
process.env.TMDB_API_KEY = 'testkey';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const nf = require('../lib/netflix-trailer');
const cat = require('../lib/netflix-catalog');

let fake, base, wikiRows, wikiQueries, tmdbCalls, pageMode;

// Titres « Netflix FR » du faux TMDB (2 pages de films, 1 page de séries).
const MOVIES = [
    { id: 1, title: 'Film A', release_date: '2020-01-01' },
    { id: 2, title: 'Film B', release_date: '2019-05-05' },
];
const SHOWS = [{ id: 10, name: 'Série X', first_air_date: '2021-03-03' }];
const IMDB = { 'movie/1': 'tt1000001', 'movie/2': 'tt1000002', 'tv/10': 'tt1000010', 'tv/99': 'tt1000099' };

function netflixPage(nid, title, year, typename) {
    const ctx = { models: { x: { videos: [{ videoId: Number(nid), __typename: typename, title, latestYear: year, shortSynopsis: 's', contentAdvisory: {} }] } } };
    return `<html><script>window.netflix = {}; netflix.reactContext = ${JSON.stringify(ctx)};</script></html>`;
}

before(async () => {
    await ensureSchema();
    fake = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const json = obj => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (u.pathname === '/sparql') {
            wikiQueries.push(u.searchParams.get('query'));
            return json({ results: { bindings: wikiRows } });
        }
        if (u.pathname === '/3/discover/movie' || u.pathname === '/3/discover/tv') {
            tmdbCalls.push(u.pathname + u.search);
            if (pageMode === 'tmdb-down') { res.writeHead(500); return res.end(); }
            const movie = u.pathname.endsWith('movie');
            const page = Number(u.searchParams.get('page'));
            if (movie) return json({ total_pages: 2, results: [MOVIES[page - 1]] });
            return json({ total_pages: 1, results: SHOWS });
        }
        let m = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)\/external_ids$/);
        if (m) return json({ imdb_id: IMDB[`${m[1]}/${m[2]}`] || null });
        m = u.pathname.match(/^\/3\/search\/(movie|tv)$/);
        if (m) {
            const q = u.searchParams.get('query');
            if (q === 'Trouble échange') return json({ results: [{ id: 99, name: 'Trouble échange', first_air_date: '2026-02-01' }] });
            if (q === 'Titre flou') return json({ results: [{ id: 5, name: 'Autre chose', first_air_date: '2000-01-01' }] });
            return json({ results: [] });
        }
        m = u.pathname.match(/^\/title\/(\d+)$/);
        if (m) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(m[1] === '81944880' ? netflixPage(m[1], 'Trouble échange', 2026, 'Show') : netflixPage(m[1], 'Titre flou', 2001, 'Movie'));
        }
        res.writeHead(404); res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${fake.address().port}`;
    cat._endpoints.wikidata = `${base}/sparql`;
    cat._endpoints.tmdb = `${base}/3`;
    nf._endpoints.netflixTitle = (_c, nid) => `${base}/title/${nid}`;
});

after(() => { fake.close(); sql.close(); });

beforeEach(async () => {
    await sql`DELETE FROM netflix_titles`;
    await sql`DELETE FROM netflix_sync_state`;
    wikiRows = []; wikiQueries = []; tmdbCalls = []; pageMode = 'ok';
});

const wd = (n, extra = {}) => ({ n: { value: n }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])) });

test('Wikidata : importe nid + IMDB + TMDB, ignore les valeurs invalides', async () => {
    wikiRows = [wd('80001', { imdb: 'tt1000001', tm: '1', l: 'Film A' }), wd('80002', { imdb: 'tt1000010', tt: '10' }), wd('abc')];
    const out = await cat.syncWikidata();
    assert.strictEqual(out.rows, 2);
    assert.strictEqual(await cat.findNidByImdb('tt1000001'), '80001');
    const row = await cat.getByNid('80002');
    assert.strictEqual(row.media_type, 'tv');
    assert.strictEqual(row.tmdb_id, 10);
    assert.strictEqual(await cat.findNidByImdb('tt9999999'), null);
    assert.strictEqual(await cat.findNidByImdb('pas-un-id'), null);
});

test('Wikidata : la requête incrémentale filtre sur la date de modification', async () => {
    await cat.syncWikidata({ since: '2026-11-01T00:00:00.000Z' });
    assert.match(wikiQueries[0], /schema:dateModified/);
    assert.match(wikiQueries[0], /2026-11-01T00:00:00\.000Z/);
    wikiQueries = [];
    await cat.syncWikidata({ since: '2026"; DROP' }); // valeur douteuse : ignorée, pas injectée
    assert.doesNotMatch(wikiQueries[0], /DROP|dateModified/);
});

test('TMDB : catalogue FR marqué, IMDB complété et fusionné avec la ligne Wikidata', async () => {
    wikiRows = [wd('80001', { imdb: 'tt1000001' })]; // Wikidata connaît l'IMDB mais pas le TMDB
    const report = await cat.runSync();
    assert.strictEqual(report.wikidata.ok, true);
    assert.strictEqual(report.tmdb.ok, true);
    assert.strictEqual(report.tmdb.seen, 3);
    // film 1 : la ligne TMDB (nid NULL) a trouvé son IMDB puis a été fusionnée avec la ligne Wikidata
    const row = await cat.getByNid('80001');
    assert.strictEqual(row.tmdb_id, 1);
    assert.strictEqual(row.on_netflix_fr, 1);
    assert.strictEqual((await sql`SELECT COUNT(*) AS n FROM netflix_titles WHERE imdb_id = 'tt1000001'`)[0].n, 1);
    const stats = await cat.getCatalogStats();
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.onFr, 3);
    assert.strictEqual(stats.onFrWithoutNid, 2); // film B et série X : dispo en France, ID Netflix pas encore connu
    assert.ok(tmdbCalls.every(c => c.includes('with_watch_providers=8') && c.includes('watch_region=FR')));
});

test('TMDB : un titre qui quitte le catalogue FR est démarqué (synchro complète seulement)', async () => {
    await cat.runSync();
    await sql`UPDATE netflix_titles SET tmdb_id = 777, on_netflix_fr = 1 WHERE tmdb_id = 2 AND media_type = 'movie'`;
    await cat.runSync();
    assert.strictEqual((await sql`SELECT on_netflix_fr AS f FROM netflix_titles WHERE tmdb_id = 777`)[0].f, 0);

    // TMDB en panne : rien n'est démarqué
    await sql`UPDATE netflix_titles SET on_netflix_fr = 1 WHERE tmdb_id = 777`;
    pageMode = 'tmdb-down';
    const report = await cat.runSync();
    assert.strictEqual(report.tmdb.ok, false);
    assert.strictEqual((await sql`SELECT on_netflix_fr AS f FROM netflix_titles WHERE tmdb_id = 777`)[0].f, 1);
});

test('runSync : une seule synchro à la fois, et les rapports sont enregistrés', async () => {
    const [a, b] = await Promise.all([cat.runSync(), cat.runSync()]);
    assert.ok(a.startedAt && b.skipped);
    const stats = await cat.getCatalogStats();
    assert.strictEqual(stats.lastReport.wikidata.ok, true);
    assert.strictEqual(stats.running, false);
});

test('Resolver : findNetflixId utilise le catalogue local avant Wikidata', async () => {
    nf._hooks.localLookup = cat.findNidByImdb; // branchement réel (le test netflix-trailer le neutralise)
    nf._caches.idCache.clear();
    await cat.upsertTitle({ nid: '80123456', imdbId: 'tt1234567', source: 'manual' });
    const before = wikiQueries.length;
    assert.strictEqual(await nf.findNetflixId('tt1234567'), '80123456');
    assert.strictEqual(wikiQueries.length, before, 'aucun appel Wikidata nécessaire');
});

test('URL Netflix : titre lu sur la page, trouvé sur TMDB, relié à son IMDB', async () => {
    const out = await cat.addFromNetflixUrl('https://www.netflix.com/fr/title/81944880', 'testkey');
    assert.strictEqual(out.status, 'linked');
    assert.deepStrictEqual(out.info, { title: 'Trouble échange', year: 2026, mediaType: 'tv' });
    assert.strictEqual(out.row.imdb_id, 'tt1000099');
    assert.strictEqual(await cat.findNidByImdb('tt1000099'), '81944880');
    // second collage : déjà connu, rien à refaire
    assert.strictEqual((await cat.addFromNetflixUrl('81944880', 'testkey')).status, 'exists');
});

test('URL Netflix : titre ambigu -> candidats à confirmer, puis liaison manuelle', async () => {
    const out = await cat.addFromNetflixUrl('https://www.netflix.com/title/80999999', 'testkey');
    assert.strictEqual(out.status, 'ambiguous');
    assert.ok(out.candidates.length > 0);
    const row = await cat.linkNetflixToTmdb('80999999', { mediaType: 'tv', tmdbId: 10 }, 'testkey');
    assert.strictEqual(row.imdb_id, 'tt1000010');
    await assert.rejects(cat.addFromNetflixUrl('pas une url', 'testkey'), /non reconnue/);
    await assert.rejects(cat.linkNetflixToTmdb('12', { mediaType: 'tv', tmdbId: 1 }), /invalide/);
});
