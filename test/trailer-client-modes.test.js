const { after, before, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-client-modes-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_PASSWORD = 'mot-de-passe-de-test';
process.env.TMDB_API_KEY = '';

const source = 'https://trailers.example/nuvio-strict/manifest.json';
const ytId = 'uXFBBDDvCzk';
const mp4 = 'https://video.example/trailer.mp4';
const episodes = [{ id: 'tt0000001:2:1', season: 2, episode: 1, title: 'Épisode 1' }];
const safeFetch = mock.method(require('../lib/security'), 'safeFetch', async (raw, options, settings) => {
    const url = new URL(raw);
    assert.equal(url.hostname, 'trailers.example');
    assert.equal(settings.allowPrivateUpstream, false);
    assert.equal(settings.maxRedirects, 0);
    assert.ok(options.signal);
    if (url.pathname.endsWith('/manifest.json')) {
        return { ok: true, json: async () => ({
            id: 'io.trailerio.nuvio.strict', resources: url.pathname.startsWith('/nuvio') ? ['meta'] : ['stream'],
            types: ['movie', 'series'], idPrefixes: ['tt'],
        }) };
    }
    const [type, file] = decodeURIComponent(url.pathname).split('/').slice(-2);
    const id = file.slice(0, -5).split(':')[0];
    if (id === 'tt0000003') return { ok: false };
    return { ok: true, json: async () => ({ meta: {
        id, type, name: 'Titre',
        trailers: [{ source: 'abcdefghijk', name: 'Bande-annonce VOSTFR' }],
        trailerStreams: id === 'tt0000001' ? [{ ytId: 'abcdefghijk' }, { ytId, title: 'Bande-annonce VF' }] : [],
    } }) };
});
mock.method(require('../lib/media-link'), 'probeDirectLink', async url => ({ ok: url === mp4, media: 'mp4' }));
mock.method(require('../lib/net'), 'fetchT', async raw => {
    const url = new URL(raw);
    assert.equal(url.hostname, 'v3-cinemeta.strem.io');
    const [, , type, file] = url.pathname.split('/');
    return { ok: true, json: async () => ({ meta: {
        id: file.slice(0, -5), type, name: 'Titre', videos: episodes,
        trailers: [{ source: 'abcdefghijk' }], trailerStreams: [{ ytId: 'abcdefghijk' }],
        links: [{ trailers: 'https://video.example/vo.mp4' }, { category: 'Genres', name: 'Action' }],
    } }) };
});

const app = require('../api');
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { setOverride } = require('../lib/overrides');
let server, base, token;
const request = (pathname, options) => fetch(base + pathname, options);
const getJson = (pathname, options) => request(pathname, options).then(response => response.json());
const postOptions = (data, token) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { 'x-admin-token': token }) },
    body: JSON.stringify(data),
});
const save = sourceManifestUrl => request('/api/settings/aiom-source', postOptions({ sourceManifestUrl }, token));

before(async () => {
    await ensureSchema();
    await setOverride({ imdbId: 'tt0000001', season: 2, title: 'Série VF', links: [{ ytId }, { url: mp4 }] });
    await setOverride({ imdbId: 'tt0000004', hidden: true });
    await setOverride({ imdbId: 'tt0000005', title: 'Film VF', url: mp4 });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    ({ token } = await getJson('/api/login', postOptions({ password: process.env.DASHBOARD_PASSWORD })));
    assert.ok(token);
});

after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Fusion et Nuvio ont des manifests dédiés et des formats lisibles par leurs clients', async () => {
    for (const [mode, suffix] of [['fusion', 'fusion'], ['nuvio', 'nuvio'], ['nuvio-strict', 'nuvio.strict']]) {
        const response = await request('/' + mode + '/manifest.json');
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        const manifest = await response.json();
        assert.equal(manifest.id, 'org.vftrailers.' + suffix);
        assert.deepEqual(manifest.resources, ['meta']);
    }
    const series = '/meta/series/tt0000001%3A2%3A1.json';
    assert.deepEqual((await getJson('/fusion' + series)).meta.links, [{ trailers: mp4, provider: 'VF · Mapping' }]);
    const { meta } = await getJson('/nuvio' + series);
    assert.deepEqual(meta.videos, episodes);
    assert.deepEqual(meta.trailers.map(trailer => trailer.key), [ytId]);
    assert.deepEqual(meta.links, [{ category: 'Genres', name: 'Action' }]);
    assert.deepEqual(await getJson('/nuvio/meta/movie/tt0000002.json'), { meta: null });
    const strict = (await getJson('/nuvio-strict/meta/movie/tt0000002.json')).meta;
    assert.deepEqual(strict.trailers, []);
    assert.deepEqual(strict.trailerStreams, []);
});

test('le dashboard change la source AIOM sans modifier le manifest partagé ni les anciens liens', async () => {
    const manifest = await getJson('/aiom/manifest.json');
    const film = '/stream/movie/tt0000005.json';
    assert.equal((await request('/api/settings/aiom-source', postOptions({ sourceManifestUrl: source }))).status, 401);
    assert.deepEqual((await getJson('/aiom' + film)).streams, [{ title: 'Film VF', url: mp4 }]);
    assert.equal((await save('https://127.0.0.1/manifest.json')).status, 400);
    assert.equal((await save('https://trailers.example/aiom/manifest.json')).status, 400);
    assert.deepEqual(await (await save(source)).json(), { sourceManifestUrl: source });
    assert.deepEqual(await getJson('/aiom/manifest.json'), manifest);
    const dashboard = await getJson('/api/aiom-stats', { headers: { 'x-admin-token': token } });
    assert.equal(dashboard.sourceManifestUrl, source);

    const path = '/aiom/stream/series/tt0000001%3A2%3A4.json';
    assert.deepEqual((await getJson(path)).streams, [{ ytId, title: 'Bande-annonce VF' }]);
    assert.match(safeFetch.mock.calls.at(-1).arguments[0], /\/nuvio-strict\/meta\/series\/tt0000001%3A2\.json$/);
    assert.deepEqual(await getJson('/aiom/stream/movie/tt0000002.json'), { streams: [] });
    assert.deepEqual(await getJson('/aiom/stream/movie/tt0000004.json'), { streams: [] });
    const outage = await request('/aiom/stream/movie/tt0000003.json');
    assert.equal(outage.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await outage.json(), { streams: [] });
    assert.deepEqual(await getJson('/aiom' + film), { streams: [] });
    assert.deepEqual(await (await save('')).json(), { sourceManifestUrl: '' });
    assert.deepEqual((await getJson('/aiom' + film)).streams, [{ title: 'Film VF', url: mp4 }]);
});
