// Tests URL Netflix -> TMDB -> IMDB (lib/netflix-url-link.js). Faux serveurs TMDB et Netflix locaux, base temporaire.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

let sql, store, link, nf, tmdbSync, fake;

const netflixPage = (nid, title, year, typename) => {
    const ctx = { models: { x: { videos: [{ videoId: Number(nid), __typename: typename, title, latestYear: year, shortSynopsis: 's', contentAdvisory: {} }] } } };
    return `<html><script>window.netflix = {}; netflix.reactContext = ${JSON.stringify(ctx)};</script></html>`;
};

before(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-url-'));
    sql = require('../lib/db');
    await require('../lib/migrate').ensureSchema();
    store = require('../lib/netflix-titles');
    nf = require('../lib/netflix-trailer');
    tmdbSync = require('../lib/netflix-tmdb-sync');
    link = require('../lib/netflix-url-link');

    fake = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        let m = u.pathname.match(/^\/3\/search\/(movie|tv)$/);
        if (m) {
            const q = u.searchParams.get('query');
            if (q === 'Trouble échange') return json({ results: [{ id: 99, name: 'Trouble échange', first_air_date: '2026-02-01' }] });
            if (q === 'Titre flou') return json({ results: [{ id: 5, name: 'Autre chose', first_air_date: '2000-01-01' }] });
            return json({ results: [] });
        }
        m = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)\/external_ids$/);
        if (m) return json({ imdb_id: { 'tv/99': 'tt1000099', 'tv/10': 'tt1000010' }[`${m[1]}/${m[2]}`] || null });
        m = u.pathname.match(/^\/title\/(\d+)$/);
        if (m) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(m[1] === '81944880' ? netflixPage(m[1], 'Trouble échange', 2026, 'Show') : netflixPage(m[1], 'Titre flou', 2001, 'Movie'));
        }
        res.writeHead(404); res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    tmdbSync._endpoints.tmdb = `${base}/3`;
    nf._endpoints.netflixTitle = (_c, nid) => `${base}/title/${nid}`;
});

after(() => { fake.close(); sql.close(); });

test('extractInfo : titre, année et type lus sur la page Netflix', () => {
    assert.deepStrictEqual(nf.extractInfo(netflixPage('81944880', 'Trouble échange', 2026, 'Show'), '81944880'),
        { title: 'Trouble échange', year: 2026, mediaType: 'tv' });
    assert.strictEqual(nf.extractInfo(netflixPage('1', 'X', 2020, 'Movie'), '1').mediaType, 'movie');
    assert.strictEqual(nf.extractInfo('<html>rien</html>', '1'), null);
});

test('URL Netflix : titre lu, trouvé sur TMDB, relié à son IMDB puis retrouvé par IMDB', async () => {
    const out = await link.addFromNetflixUrl('https://www.netflix.com/fr/title/81944880', 'k');
    assert.strictEqual(out.status, 'linked');
    assert.strictEqual(out.row.imdb_id, 'tt1000099');
    assert.strictEqual(out.row.type, 'tv');
    assert.strictEqual(await store.findNidByImdb('tt1000099'), '81944880');
    assert.strictEqual((await link.addFromNetflixUrl('81944880', 'k')).status, 'exists');
});

test('URL Netflix : titre ambigu -> candidats, puis liaison manuelle ; entrées invalides refusées', async () => {
    const out = await link.addFromNetflixUrl('https://www.netflix.com/title/80999999', 'k');
    assert.strictEqual(out.status, 'ambiguous');
    assert.ok(out.candidates.length > 0);
    const row = await link.linkNetflixToTmdb('80999999', { type: 'tv', tmdbId: 10 }, 'k');
    assert.strictEqual(row.imdb_id, 'tt1000010');
    await assert.rejects(link.addFromNetflixUrl('pas une url', 'k'), /non reconnue/);
    await assert.rejects(link.linkNetflixToTmdb('12', { type: 'tv', tmdbId: 1 }), /invalide/);
});
