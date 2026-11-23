const { after, before, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-direct-trailers-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_KEY = 'fixture-tmdb-key';
process.env.NETFLIX_CATALOGUE_URL = 'https://stockage.example';
process.env.NETFLIX_CATALOGUE_KEY = '';
process.env.AIOM_DIRECT_STOCKAGE_WRITE_KEY = '';

const hls = 'https://video.example/trailer.m3u8?token=fixture';
const mp4 = 'https://video.example/trailer.mp4';
const probe = mock.method(require('../lib/media-link'), 'probeDirectLink', async url => {
    if (url === hls) return { ok: true, media: 'hls' };
    if (url === mp4) return { ok: true, media: 'mp4' };
    return { ok: false };
});
const tmdb = require('../lib/tmdb');
mock.method(tmdb, 'findByImdb', async () => ({ movie_results: [{ id: 1 }] }));
mock.method(tmdb, 'getTitleAndYear', async () => ({ title: 'Film Allociné', year: 2026 }));
mock.method(tmdb, 'getAlternativeTitles', async () => []);
const allocine = require('../lib/allocine');
mock.method(allocine, 'getAllocineTrailerStreams', async (title, _ref, options) => {
    assert.equal(options.directOnly, true);
    return title === 'Film Allociné' ? [{ url: 'https://video.example/player' }, { url: hls }, { url: mp4 }] : [];
});
const stockage = mock.method(require('../lib/security'), 'safeFetch', async raw => {
    const url = new URL(raw);
    assert.equal(url.pathname, '/api/v1/trailers');
    if (url.searchParams.get('imdb') !== 'tt0000002') return { ok: false };
    assert.equal(url.searchParams.get('season'), '2');
    return { ok: true, json: async () => ({
        title: { imdb_id: 'tt0000002', tmdb_type: 'tv', name: 'Série VF' },
        trailers: [
            { title: 'Saison 2 VOSTFR', season: 2, lang: 'fr', url: 'https://video.example/vo.mp4' },
            { title: 'Saison 1 VF', season: 1, lang: 'fr', url: 'https://video.example/s1.mp4' },
            { title: 'Saison 2 VF', season: 2, lang: 'fr', url: hls },
        ],
    }) };
});

const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { setOverride } = require('../lib/overrides');
const app = require('../api');
let server, base;
const get = pathname => fetch(base + pathname);

before(async () => {
    await ensureSchema();
    await setOverride({ imdbId: 'tt0000001', title: 'Film VF', links: [{ ytId: 'abcdefghijk' }, { url: hls }] });
    await setOverride({ imdbId: 'tt0000004', hidden: true });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('le manifest direct expose meta et stream avec CORS et sans clé personnelle', async () => {
    const response = await get('/direct/manifest.json');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const manifest = await response.json();
    assert.equal(manifest.id, 'org.vftrailers.direct');
    assert.deepEqual(manifest.resources, ['stream', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }]);
    assert.equal(manifest.behaviorHints, undefined);
    assert.doesNotMatch(JSON.stringify(manifest), /fixture-tmdb-key/);
});

test('un mapping avec YouTube et HLS renvoie la vidéo directe dans les deux formats', async () => {
    probe.mock.resetCalls();
    const [meta, streams] = await Promise.all([
        get('/direct/meta/movie/tt0000001.json').then(response => response.json()),
        get('/direct/stream/movie/tt0000001.json').then(response => response.json()),
    ]);
    assert.deepEqual(meta, { meta: { id: 'tt0000001', type: 'movie', name: 'Film VF',
        links: [{ trailers: hls, provider: 'VF · Mapping' }] } });
    assert.deepEqual(streams, { streams: [{ title: 'Film VF', url: hls }] });
    assert.ok(probe.mock.callCount() > 0);
    assert.ok(probe.mock.calls.every(call => call.arguments[0] === hls));
});

test('Stockage BD conserve la saison et la VF, avec un cache distinct du mode MP4 AIOM Direct', async () => {
    const url = '/stream/series/tt0000002%3A2%3A4.json';
    assert.deepEqual(await get('/direct' + url).then(response => response.json()),
        { streams: [{ title: 'Saison 2 VF', url: hls }] });
    assert.deepEqual(await get('/aiom-direct' + url).then(response => response.json()), { streams: [] });
});

test('Allociné privilégie un MP4 vérifié et ignore la page du lecteur', async () => {
    const response = await get('/direct/stream/movie/tt0000003.json');
    assert.deepEqual(await response.json(), { streams: [{ title: 'Bande-annonce VF · Film Allociné', url: mp4 }] });
});

test('un titre masqué ou un identifiant invalide ne lance aucun appel amont', async () => {
    stockage.mock.resetCalls();
    const hidden = await get('/direct/meta/movie/tt0000004.json');
    const invalid = await get('/direct/stream/movie/tt0000004:2.json');
    assert.deepEqual(await hidden.json(), { meta: null });
    assert.deepEqual(await invalid.json(), { streams: [] });
    assert.equal(hidden.headers.get('cache-control'), 'no-store');
    assert.equal(invalid.headers.get('cache-control'), 'no-store');
    assert.equal(stockage.mock.callCount(), 0);
});
