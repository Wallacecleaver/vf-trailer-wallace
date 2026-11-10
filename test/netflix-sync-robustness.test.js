// Robustesse des synchros du catalogue Netflix : colonne ajoutée sur une base existante, titres sans IMDB
// qui ne sont pas réinterrogés à chaque passage, et panne Wikidata qui ne « marque » pas les titres comme vérifiés.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

let sql, store, tmdbSync, wd, fake;
let externalIdCalls, sparqlMode, tmdbMode;

before(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-robust-'));
    sql = require('../lib/db');
    // Ancienne base : la table existe déjà SANS la colonne imdb_checked_at.
    sql.exec(`CREATE TABLE netflix_tmdb_seen (tmdb_id INTEGER NOT NULL, type TEXT NOT NULL, imdb_id TEXT, title TEXT, year INTEGER,
              first_seen TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL DEFAULT '', nid_checked_at TEXT, PRIMARY KEY (tmdb_id, type))`);
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
    tmdbSync = require('../lib/netflix-tmdb-sync');
    wd = require('../lib/netflix-wikidata-sync');

    fake = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        if (u.pathname === '/sparql') {
            if (sparqlMode === 'down') { res.writeHead(500); return res.end(); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ results: { bindings: [{ imdb: { value: 'tt2000001' }, nid: { value: '82000001' } }] } }));
        }
        const m = u.pathname.match(/^\/(movie|tv)\/(\d+)\/external_ids$/);
        if (m) {
            externalIdCalls.push(m[2]);
            if (tmdbMode === 'down') { res.writeHead(500); return res.end(); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ imdb_id: m[2] === '1' ? 'tt2000001' : null })); // seul le titre 1 a un IMDB
        }
        res.writeHead(404); res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    tmdbSync._endpoints.tmdb = base;
    wd._endpoints.wikidata = `${base}/sparql`;
});

after(() => { fake.close(); sql.close(); });

beforeEach(async () => {
    await sql`DELETE FROM netflix_tmdb_seen`;
    await sql`DELETE FROM netflix_titles`;
    externalIdCalls = []; sparqlMode = 'ok'; tmdbMode = 'ok';
});

const seed = async (...ids) => {
    for (const id of ids) await sql`INSERT INTO netflix_tmdb_seen (tmdb_id, type, title, first_seen, last_seen) VALUES (${id}, 'movie', ${'Film ' + id}, 'x', ${'2026-11-0' + id})`;
};

test('migration : la colonne manquante est ajoutée à une table existante, sans perdre de données', async () => {
    const cols = await sql`PRAGMA table_info(netflix_tmdb_seen)`;
    assert.ok(cols.some(c => c.name === 'imdb_checked_at'));
    await require('../lib/migrate').ensureSchema(); // relancé : idempotent
});

test('IMDB : un titre sans IMDB chez TMDB n\'est pas réinterrogé à chaque passage', async () => {
    await seed(1, 2);
    assert.strictEqual(await tmdbSync.fillImdbIds('k'), 1);
    assert.deepStrictEqual(externalIdCalls.sort(), ['1', '2']);
    externalIdCalls = [];
    assert.strictEqual(await tmdbSync.fillImdbIds('k'), 0);
    assert.deepStrictEqual(externalIdCalls, [], 'le titre 2 (sans IMDB) est marqué vérifié, le titre 1 est complet');
});

test('IMDB : une erreur TMDB ne marque rien (le titre est réessayé au passage suivant)', async () => {
    await seed(2);
    tmdbMode = 'down';
    await tmdbSync.fillImdbIds('k');
    tmdbMode = 'ok';
    externalIdCalls = [];
    await tmdbSync.fillImdbIds('k');
    assert.deepStrictEqual(externalIdCalls, ['2']);
});

test('ID Netflix : une panne Wikidata ne marque pas les titres comme vérifiés', async () => {
    await seed(1);
    await sql`UPDATE netflix_tmdb_seen SET imdb_id = 'tt2000001' WHERE tmdb_id = 1`;
    sparqlMode = 'down';
    assert.strictEqual(await tmdbSync.resolveNetflixIds(), 0);
    assert.strictEqual((await sql`SELECT nid_checked_at AS c FROM netflix_tmdb_seen WHERE tmdb_id = 1`)[0].c, null);

    sparqlMode = 'ok';
    assert.strictEqual(await tmdbSync.resolveNetflixIds(), 1);
    assert.strictEqual(await store.findNidByImdb('tt2000001'), '82000001');
    assert.ok((await sql`SELECT nid_checked_at AS c FROM netflix_tmdb_seen WHERE tmdb_id = 1`)[0].c);
});

test('Wikidata : lookupNidsByImdb lève une exception en cas de panne (au lieu de répondre « inconnu »)', async () => {
    sparqlMode = 'down';
    await assert.rejects(wd.lookupNidsByImdb(['tt2000001']), /Wikidata HTTP 500/);
    sparqlMode = 'ok';
    assert.strictEqual((await wd.lookupNidsByImdb(['tt2000001', 'pas-un-id'])).get('tt2000001'), '82000001');
});
