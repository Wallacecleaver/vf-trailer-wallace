// Tests du remplissage Wikidata (faux serveur SPARQL local, aucun accès réseau réel).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

let dir, sql, store, sync, fake;
let answer;

before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-wd-'));
    process.env.DATA_DIR = dir;
    sql = require('../lib/db');
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
    sync = require('../lib/netflix-wikidata-sync');
    fake = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: { bindings: answer } }));
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    sync._endpoints.wikidata = `http://127.0.0.1:${fake.address().port}/sparql`;
});
after(() => { fake.close(); sql.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const lit = value => ({ value });

test('rowToTitle : film, série, ID invalide', () => {
    const film = sync.rowToTitle({ nid: lit('81000001'), imdb: lit('tt1111111'), tmdbMovie: lit('42'), label: lit('Un film'), year: lit('2020'), isTv: lit('false') });
    assert.deepStrictEqual([film.nid, film.imdb_id, film.tmdb_id, film.type, film.year], ['81000001', 'tt1111111', 42, 'movie', 2020]);
    const serie = sync.rowToTitle({ nid: lit('81000002'), tmdbTv: lit('7'), isTv: lit('true') });
    assert.deepStrictEqual([serie.type, serie.tmdb_id, serie.imdb_id], ['tv', 7, null]);
    assert.strictEqual(sync.rowToTitle({ nid: lit('abc') }), null);
});

test('syncFromWikidata écrit les titres valides et ignore les autres', async () => {
    answer = [
        { nid: lit('81000001'), imdb: lit('tt1111111'), tmdbMovie: lit('42'), isTv: lit('false') },
        { nid: lit('81000002'), imdb: lit('tt2222222'), tmdbTv: lit('7'), isTv: lit('true') },
        { nid: lit('pas-un-id') },
    ];
    const r = await sync.syncFromWikidata();
    assert.deepStrictEqual(r, { fetched: 3, written: 2 });
    assert.strictEqual(await store.findNidByImdb('tt2222222'), '81000002');
    assert.strictEqual(await store.findNidByTmdb(42, 'movie'), '81000001');
});

test('relancer la synchro ne crée pas de doublons', async () => {
    await sync.syncFromWikidata();
    assert.strictEqual(await store.countTitles(), 2);
});

test('findNetflixId lit d\'abord le catalogue local (sans appeler Wikidata)', async () => {
    const nf = require('../lib/netflix-trailer');
    let hits = 0;
    const saved = nf._endpoints.wikidata;
    nf._endpoints.wikidata = 'http://127.0.0.1:1/sparql'; // injoignable : échouerait si appelé
    nf._caches.idCache.clear();
    assert.strictEqual(await nf.findNetflixId('tt2222222'), '81000002');
    nf._endpoints.wikidata = saved;
});
