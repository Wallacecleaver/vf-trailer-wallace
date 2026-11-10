// Tests du stockage netflix_titles (SQLite temporaire, aucun accès réseau).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let dir, sql, store;

before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-titles-'));
    process.env.DATA_DIR = dir;
    sql = require('../lib/db');
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
});
after(() => { sql.close(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { await sql`DELETE FROM netflix_titles`; });

test('insère puis retrouve par IMDB et par TMDB', async () => {
    assert.ok(await store.upsertTitle({ nid: '81944880', title: 'Test', year: 2024, type: 'tv', tmdb_id: 123, imdb_id: 'tt1234567', source: 'wikidata' }));
    assert.strictEqual(await store.findNidByImdb('tt1234567'), '81944880');
    assert.strictEqual(await store.findNidByTmdb(123, 'tv'), '81944880');
    assert.strictEqual(await store.findNidByTmdb(123, 'movie'), null);
    assert.strictEqual(await store.findNidByImdb('tt0000000'), null);
});

test('rejette les ID invalides', async () => {
    assert.strictEqual(await store.upsertTitle({ nid: 'abc' }), false);
    assert.strictEqual(await store.upsertTitle({ nid: '123' }), false);
    assert.strictEqual(await store.countTitles(), 0);
});

test('un upsert ne remplace pas une valeur connue par du vide et la source ne descend pas', async () => {
    await store.upsertTitle({ nid: '70000001', title: 'Titre', imdb_id: 'tt7654321', source: 'manual' });
    await store.upsertTitle({ nid: '70000001', tmdb_id: 55, type: 'movie', source: 'wikidata' });
    const row = await store.getTitle('70000001');
    assert.strictEqual(row.title, 'Titre');
    assert.strictEqual(row.imdb_id, 'tt7654321');
    assert.strictEqual(row.tmdb_id, 55);
    assert.strictEqual(row.type, 'movie');
    assert.strictEqual(row.source, 'manual');
    await store.upsertTitle({ nid: '70000001', source: 'tmdb' });
    assert.strictEqual((await store.getTitle('70000001')).source, 'manual');
});

test('une source plus fiable remplace une moins fiable', async () => {
    await store.upsertTitle({ nid: '70000002', source: 'wikidata' });
    await store.upsertTitle({ nid: '70000002', source: 'tmdb' });
    assert.strictEqual((await store.getTitle('70000002')).source, 'tmdb');
});

test('upsertMany et raw JSON', async () => {
    const n = await store.upsertMany([
        { nid: '70000003', raw: { a: 1 }, source: 'tmdb' },
        { nid: 'bad' },
        { nid: '70000004', source: 'tmdb' },
    ]);
    assert.strictEqual(n, 2);
    assert.deepStrictEqual(JSON.parse((await store.getTitle('70000003')).raw), { a: 1 });
});

test('markTrailerChecked', async () => {
    await store.upsertTitle({ nid: '70000005' });
    assert.strictEqual((await store.getTitle('70000005')).trailer_checked_at, null);
    await store.markTrailerChecked('70000005');
    assert.ok((await store.getTitle('70000005')).trailer_checked_at);
});
