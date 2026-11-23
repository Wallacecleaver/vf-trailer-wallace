const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-aiom-shared-'));
const serverKey = 'a'.repeat(32);
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_KEY = serverKey;
process.env.NETFLIX_CATALOGUE_URL = 'https://stockage.example';
process.env.AIOM_DIRECT_STOCKAGE_WRITE_KEY = 'fixture-write-key';
const youtubeMp4 = 'https://stockage.example/aiom-direct/youtube/trailer0000.mp4';
const allocineMp4 = 'https://allocine.example/trailer.mp4';
const storedMp4 = 'https://stockage.example/trailer.mp4';
const state = {};
const apiPath = require.resolve('../lib/resolve-apis');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
    resolveViaApis: async (type, imdbId, season, behavior, key) => {
        const { kind, delay, fail } = state;
        state.calls.push({ type, imdbId, season, key, behavior });
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (fail) throw new Error('Upstream api_key=' + key);
        return { officialTitle: 'Film de test', platform: 'apple',
            source: kind === 'direct' ? 'netflix_catalogue' : 'tmdb',
            pending: kind === 'pending',
            streams: kind === 'none' || kind === 'pending' ? [] : kind === 'direct'
                ? [{ title: 'Bande-annonce\nFilm de test', url: 'https://stockage.example/trailer.mp4' }]
                : [{ title: 'Teaser\nFilm de test', ytId: 'teaser00000' },
                    { title: 'Bande-annonce\nFilm de test', ytId: 'trailer0000' }] };
    },
} };
const { mock } = require('node:test');
mock.method(require('../lib/security'), 'safeFetch', async (raw, options) => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/youtube')) {
        assert.equal(options.headers['x-api-key'], 'fixture-write-key');
        assert.deepEqual(JSON.parse(options.body), { ytId: 'trailer0000' });
        return { ok: state.relayStatus < 400, status: state.relayStatus, json: async () => state.relay };
    }
    if (!state.stored) return { ok: false };
    const imdbId = url.searchParams.get('imdb');
    const season = url.searchParams.get('season');
    state.storageSeason = season;
    return { ok: true, json: async () => ({
        title: { name: 'Titre Stockage', imdb_id: imdbId, type: url.searchParams.get('type') },
        trailers: [{ title: `Bande-annonce${season ? ` saison ${season}` : ''} VF`, lang: 'fr', season, url: storedMp4 }],
    }) };
});
const tmdb = require('../lib/tmdb');
mock.method(tmdb, 'findByImdb', async () => ({ movie_results: [{ id: 1 }], tv_results: [{ id: 2 }] }));
mock.method(tmdb, 'getTitleAndYear', async () => ({ title: 'Titre Allociné', year: 2026 }));
mock.method(tmdb, 'getAlternativeTitles', async () => []);
mock.method(require('../lib/allocine'), 'getAllocineTrailerStreams', async () => state.allocine ? [{ url: allocineMp4 }] : []);
mock.method(require('../lib/media-link'), 'probeDirectLink', async url => ({ ok: url === allocineMp4, media: 'mp4' }));
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { manifest } = require('../lib/config');
const app = require('../api');
let server, base;
const get = pathname => fetch(base + pathname);

before(async () => {
    await ensureSchema();
    await sql(["UPDATE behavior_settings SET aiom_timeout_seconds = 1 WHERE id = 1"]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(() => Object.assign(state, { calls: [], kind: 'youtube', delay: 0, fail: false,
    relay: { url: youtubeMp4, height: 1080 }, relayStatus: 200, allocine: false, stored: false, storageSeason: null }));
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('AIOM partagé : manifest 200, CORS *, stream uniquement et aucun behaviorHints', async () => {
    const response = await get('/aiom/manifest.json');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const data = await response.json();
    assert.deepEqual(data.resources, ['stream']);
    assert.deepEqual(data.types, ['movie', 'series']);
    assert.deepEqual(data.catalogs, []);
    assert.equal(Object.hasOwn(data, 'behaviorHints'), false);
    assert.ok(!JSON.stringify(data).includes(serverKey));
    const preflight = await fetch(base + '/aiom/manifest.json', { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('AIOM partagé : manifest classique inchangé, configuration toujours requise', async () => {
    const data = await get('/manifest.json').then(response => response.json());
    assert.deepEqual(data, manifest);
    assert.equal(data.behaviorHints.configurationRequired, true);
    const config = Buffer.from(JSON.stringify({ tmdbKey: 'person-key' })).toString('base64url');
    const configured = await get('/' + config + '/manifest.json').then(response => response.json());
    assert.equal(configured.behaviorHints.configurationRequired, false);
    assert.deepEqual(configured.resources, manifest.resources);
});

test('AIOM partagé : sans TMDB_API_KEY, réponse vide et manifest toujours disponible', () => {
    const childDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-aiom-no-key-'));
    const child = [
        "const app = require('./api');",
        "const sql = require('./lib/db');",
        "const { ensureSchema } = require('./lib/migrate');",
        "(async () => {",
        " await ensureSchema();",
        " const server = app.listen(0, '127.0.0.1');",
        " await new Promise(resolve => server.once('listening', resolve));",
        " const base = 'http://127.0.0.1:' + server.address().port;",
        " try {",
        "  const response = await fetch(base + '/aiom/stream/movie/tt0900099.json');",
        "  const manifest = await fetch(base + '/aiom/manifest.json');",
        "  const normal = await fetch(base + '/manifest.json').then(r => r.json());",
        "  console.log(JSON.stringify({ status: response.status, streams: await response.json(), manifestStatus: manifest.status, manifest: await manifest.json(), normal }));",
        " } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); sql.close(); }",
        "})().catch(error => { console.error(error); process.exitCode = 1; });",
    ].join('\n');
    try {
        const output = execFileSync(process.execPath, ['-e', child], {
            cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: childDir, TMDB_API_KEY: '', NETFLIX_CATALOGUE_URL: '' },
            encoding: 'utf8', timeout: 10000,
        });
        const data = JSON.parse(output.trim().split('\n').pop());
        assert.equal(data.status, 200);
        assert.deepEqual(data.streams, { streams: [] });
        assert.equal(data.manifestStatus, 200);
        assert.equal(Object.hasOwn(data.manifest, 'behaviorHints'), false);
        assert.equal(data.normal.behaviorHints.configurationRequired, true);
    } finally { fs.rmSync(childDir, { recursive: true, force: true }); }
});

test('AIOM partagé : clé serveur, un seul trailer et pas de statistiques Stremio supplémentaires', async () => {
    state.allocine = state.stored = true;
    const previous = await sql(["SELECT * FROM request_stats_global"]);
    const response = await get('/aiom/stream/movie/tt0900001.json');
    const { streams } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, youtubeMp4);
    assert.equal(streams[0].ytId, undefined);
    assert.ok(!streams[0].externalUrl);
    assert.ok(!('__external' in streams[0]) && !('__quality' in streams[0]));
    assert.equal(state.calls[0].key, serverKey);
    assert.equal(state.calls[0].behavior.trailerLanguage, 'fr-only');
    assert.deepEqual(await sql(["SELECT * FROM request_stats_global"]), previous);
});

test('AIOM partagé : Stockage BD et saison conservés, liste vide sans bande-annonce', async () => {
    state.relay = {};
    state.stored = true;
    const direct = await get('/aiom/stream/series/tt0900002:2:4.json').then(response => response.json());
    assert.equal(direct.streams.length, 1);
    assert.equal(direct.streams[0].url, 'https://stockage.example/trailer.mp4');
    assert.equal(state.calls[0].season, '2');
    assert.equal(state.storageSeason, '2');
    state.kind = 'none';
    state.stored = false;
    const empty = await get('/aiom/stream/movie/tt0900003.json').then(response => response.json());
    assert.deepEqual(empty, { streams: [] });
});

test('AIOM partagé : demandes simultanées regroupées et cache réutilisé', async () => {
    state.delay = 80;
    const results = await Promise.all([get('/aiom/stream/movie/tt0900004.json'), get('/aiom/stream/movie/tt0900004.json')]);
    assert.equal(state.calls.length, 1);
    for (const response of results) assert.equal((await response.json()).streams.length, 1);
    await get('/aiom/stream/movie/tt0900004.json');
    assert.equal(state.calls.length, 1);
});

test('AIOM partagé : délai du dashboard puis résultat disponible dans le cache', async () => {
    state.delay = 1200;
    const response = await get('/aiom/stream/movie/tt0900005.json');
    assert.deepEqual(await response.json(), { streams: [] });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await new Promise(resolve => setTimeout(resolve, 650));
    const next = await get('/aiom/stream/movie/tt0900005.json').then(response => response.json());
    assert.equal(next.streams.length, 1);
    assert.equal(state.calls.length, 1);
});

test('AIOM partagé : ancien profil AIOM avec clé personnelle inchangé', async () => {
    const personalKey = 'b'.repeat(32);
    const config = Buffer.from(JSON.stringify({ aiom: true, tmdbKey: personalKey, pseudo: 'Ancien profil' })).toString('base64url');
    const response = await get('/' + config + '/stream/movie/tt0900006.json');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=600');
    assert.equal((await response.json()).streams.length, 1);
    assert.equal(state.calls[0].key, personalKey);
});

test('AIOM partagé : paramètres invalides et erreur réseau renvoient vide sans exposer la clé', async () => {
    for (const pathname of ['/aiom/stream/tv/tt0900007.json', '/aiom/stream/movie/bad.json', '/aiom/stream/movie/tt0900007:2.json']) {
        assert.deepEqual(await get(pathname).then(response => response.json()), { streams: [] });
    }
    assert.equal(state.calls.length, 0);
    state.fail = true;
    const response = await get('/aiom/stream/movie/tt0900007.json');
    assert.deepEqual(await response.json(), { streams: [] });
    const logs = JSON.stringify(await sql(["SELECT * FROM event_logs"]));
    assert.ok(!logs.includes(serverKey) && !logs.includes('api_key='));
});

test('matching strict : ancien cache conservé mais jamais resservi après changement de politique', async () => {
    const { TVDB_API_KEY } = require('../lib/config');
    const scope = TVDB_API_KEY ? require('node:crypto').createHash('sha256').update(TVDB_API_KEY).digest('hex').slice(0, 12) : 'no-tvdb';
    const key = 'cache:trailers:tt0900008:movie:all:nx:yt:vf:' + scope;
    const previous = JSON.stringify({ officialTitle: 'Ancien faux positif', source: 'youtube_search', streams: [{ ytId: 'wrong000000' }] });
    await sql`INSERT INTO kv_cache (cache_key, value, expires_at) VALUES (${key}, ${previous}, ${Date.now() + 3600000})`;
    const data = await get('/aiom/stream/movie/tt0900008.json').then(response => response.json());
    assert.equal(data.streams[0].url, youtubeMp4);
    assert.equal(state.calls.length, 1);
    assert.equal((await sql`SELECT value FROM kv_cache WHERE cache_key = ${key}`)[0].value, previous);
    assert.equal((await sql`SELECT COUNT(*) AS count FROM kv_cache WHERE cache_key LIKE 'cache:aiom-youtube:v1:movie:tt0900008:%'`)[0].count, 1);
});

test('AIOM partagé : Allociné précède Stockage pendant la préparation et YouTube prend ensuite la priorité', async () => {
    const pathname = '/aiom/stream/movie/tt0900009.json';
    state.relay = { pending: true };
    state.allocine = state.stored = true;
    const first = await get(pathname);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal((await first.json()).streams[0].url, allocineMp4);
    state.relay = { height: 1080, url: youtubeMp4 };
    assert.equal((await get(pathname).then(response => response.json())).streams[0].url, youtubeMp4);
    assert.equal(state.calls.length, 1);
});

test('AIOM partagé : un résultat YouTube sous 1080p passe au repli Allociné', async () => {
    state.relay = { height: 720, url: youtubeMp4 };
    state.allocine = state.stored = true;
    const data = await get('/aiom/stream/movie/tt0900010.json').then(response => response.json());
    assert.equal(data.streams[0].url, allocineMp4);
});

test('AIOM partagé : le refus de Stockage DB apparaît dans le journal sans exposer la clé', async () => {
    state.relayStatus = 403;
    const response = await get('/aiom/stream/movie/tt0900011.json');
    assert.deepEqual(await response.json(), { streams: [] });
    const rows = await sql`SELECT meta, message FROM event_logs WHERE event = 'aiom_request' ORDER BY id DESC LIMIT 1`;
    const meta = JSON.parse(rows[0].meta);
    assert.equal(meta.imdbId, 'tt0900011');
    assert.deepEqual(meta.youtubeRelay, { videoId: 'trailer0000', httpStatus: 403 });
    assert.match(rows[0].message, /YouTube 1080p.*HTTP 403/);
    assert.doesNotMatch(rows[0].meta, /fixture-write-key/);
});
