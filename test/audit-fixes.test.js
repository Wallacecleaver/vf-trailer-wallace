const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-audit-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_KEY = 'tmdb-audit-key';
process.env.DASHBOARD_PASSWORD = 'audit-secret-password';

const netStubState = { handler: null };
const netPath = path.join(__dirname, '..', 'lib', 'net.js');
const realNet = require(netPath);
require.cache[netPath] = {
    id: netPath,
    filename: netPath,
    loaded: true,
    exports: {
        ...realNet,
        fetchT: async (url, opts, timeoutMs) => {
            if (netStubState.handler) return netStubState.handler(url, opts, timeoutMs);
            return realNet.fetchT(url, opts, timeoutMs);
        },
    },
};

const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { getAlternativeTitles } = require('../lib/tmdb');
const { resolveAnimeTrailers } = require('../lib/anime-sources');
const { applyDisplayMode, buildExternalYoutubeStream } = require('../lib/stream-format');
const { setOverride, getFailedLog, getOverrideUses } = require('../lib/overrides');
const { getInstallStats } = require('../lib/install-stats');
const { setCached, getCached } = require('../lib/cache');
const federation = require('../lib/netflix-federation');
const app = require('../api/index');

let server, base;

before(async () => {
    await ensureSchema();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

const jsonRes = (data, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

test('TMDB getAlternativeTitles : lit data.results pour les séries TV et data.titles pour les films', async () => {
    netStubState.handler = async (url) => {
        if (url.includes('/tv/100/alternative_titles')) {
            return jsonRes({
                results: [
                    { iso_3166_1: 'FR', title: 'La Chronique des Bridgerton' },
                    { iso_3166_1: 'DE', title: 'Bridgerton DE' },
                ],
            });
        }
        return jsonRes({
            titles: [
                { iso_3166_1: 'FR', title: 'Dune : Deuxième partie' },
            ],
        });
    };

    const tvAlt = await getAlternativeTitles('tv', 100, 'k');
    assert.deepEqual(tvAlt, ['La Chronique des Bridgerton']);

    const movieAlt = await getAlternativeTitles('movie', 200, 'k');
    assert.deepEqual(movieAlt, ['Dune : Deuxième partie']);
});

test('AniList resolveAnimeTrailers : accepte la réponse GraphQL Page.media et extrait le trailer VF', async () => {
    netStubState.handler = async (url) => {
        if (url.includes('graphql.anilist.co')) {
            return jsonRes({
                data: {
                    Page: {
                        media: [
                            {
                                id: 16498,
                                title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
                                synonyms: ['L’Attaque des Titans'],
                                startDate: { year: 2013 },
                                trailer: { site: 'youtube', id: 'dQw4w9WgXcQ' },
                            },
                        ],
                    },
                },
            });
        }
        if (url.includes('youtube.com/oembed')) {
            return jsonRes({ title: 'L’Attaque des Titans — Bande-annonce officielle VF' });
        }
        return jsonRes({}, 404);
    };

    const res = await resolveAnimeTrailers({
        titles: ['L’Attaque des Titans'],
        officialTitle: 'L’Attaque des Titans',
        year: 2013,
        season: null,
        behavior: { languageMode: 'vf', maxTrailers: 2 },
    });
    assert.equal(res.streams.length, 1);
    assert.equal(res.streams[0].ytId, 'dQw4w9WgXcQ');
});

test('applyDisplayMode compact : préserve le titre personnalisé sur une seule ligne pour le flux externe YouTube', () => {
    const ext = buildExternalYoutubeStream('dQw4w9WgXcQ', 'Mon Titre Override', 'netflix');
    const [formatted] = applyDisplayMode([ext], { display: 'compact' }, 'override');
    assert.equal(formatted.title, 'Ouvrir YouTube • Mon Titre Override');
});

test('Routes Stremio : ignore les IDs non-IMDb sans polluer failed_log, gère Saison 0 (Specials) et les IDs 8-10 chiffres, et évite le double comptage sur /meta', async () => {
    await setOverride({
        imdbId: 'tt12345678',
        season: null,
        ytId: 'dQw4w9WgXcQ',
        title: 'Série Moderne',
        mediaType: 'series',
    });
    await setOverride({
        imdbId: 'tt12345678', season: 2, ytId: 'abcdefghijk', title: 'Série Moderne', mediaType: 'series',
    });

    netStubState.handler = async (url) => {
        if (url.includes('/find/tt12345678')) {
            return jsonRes({ tv_results: [{ id: 555, name: 'Série Moderne' }] });
        }
        if (url.includes('/find/tt99999999')) {
            return jsonRes({ movie_results: [{ id: 777, title: 'Film Sans Trailer' }] });
        }
        if (url.includes('youtube.com/oembed')) {
            return jsonRes({ title: 'Série Moderne Bande-annonce VF' });
        }
        return jsonRes({ results: [], titles: [] });
    };

    const cfg = Buffer.from(JSON.stringify({
        tmdbKey: 'user-tmdb-key',
        pseudo: 'Testeur',
        externalOnly: true,
    })).toString('base64url');

    // 1. Un chemin manifest invalide ne doit pas enregistrer une fausse installation.
    const badManifest = await fetch(`${base}/not-base64-json/manifest.json`).then(r => r.json());
    assert.equal(badManifest.behaviorHints.configurationRequired, true);
    const installs = await getInstallStats();
    assert.equal(installs.total, 0);

    // 2. Des IDs Stremio tiers (kitsu:..., saison invalide) ne doivent pas polluer failed_log.
    const kitsuRes = await fetch(`${base}/${cfg}/stream/series/kitsu%3A12345.json`).then(r => r.json());
    assert.deepEqual(kitsuRes.streams, []);
    const badSeasonRes = await fetch(`${base}/${cfg}/stream/series/tt1234567:abc.json`).then(r => r.json());
    assert.deepEqual(badSeasonRes.streams, []);
    assert.equal((await getFailedLog()).length, 0);

    // 3. /meta avec externalOnly:true conserve bien `trailers` (ytId) et n'incrémente pas `override.uses`.
    const metaRes = await fetch(`${base}/${cfg}/meta/series/tt12345678.json`).then(r => r.json());
    assert.ok(metaRes.meta);
    assert.deepEqual(metaRes.meta.trailers, [{ source: 'dQw4w9WgXcQ', type: 'Trailer' }]);
    const seasonMeta = await fetch(`${base}/${cfg}/meta/series/tt12345678%3A2%3A1.json`).then(r => r.json());
    assert.deepEqual(seasonMeta.meta.trailers, [{ source: 'abcdefghijk', type: 'Trailer' }]);
    assert.equal((await getOverrideUses())['tt12345678:'], '0');

    // 4. Saison 0 (Specials Stremio : tt12345678:0:1) retombe sur la série générale sans "(Saison 0)" et incrémente uses une seule fois.
    const specialStream = await fetch(`${base}/${cfg}/stream/series/tt12345678:0:1.json`).then(r => r.json());
    assert.equal(specialStream.streams.length, 1);
    assert.ok(!specialStream.streams[0].title.includes('Saison 0'));
    assert.equal((await getOverrideUses())['tt12345678:'], '1');

    // 5. /meta renvoie null (et non un objet vide qui écraserait Cinemeta) quand aucune bande-annonce n'existe.
    const emptyMeta = await fetch(`${base}/${cfg}/meta/movie/tt99999999.json`).then(r => r.json());
    assert.equal(emptyMeta.meta, null);
});

test('purge du dashboard : inclut tous les caches de bandes-annonces, SQLite et Stockage BD', async () => {
    const { token } = await fetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: process.env.DASHBOARD_PASSWORD }),
    }).then(r => r.json());
    assert.ok(token);
    const headers = { 'x-admin-token': token };
    const stats = () => fetch(base + '/api/cache/stats', { headers }).then(r => r.json());
    const baseline = await stats();
    const hits = {
        'cache:trailers:film': { streams: [{ ytId: 'abcdefghijk' }] },
        'cache:direct:v1:film': { url: 'https://example.com/film.mp4' },
        'cache:aiom-direct:v3:film': { url: 'https://example.com/film.mp4' },
        'cache:aiom-fallback:v1:film': { video: { url: 'https://example.com/film.mp4' } },
        'cache:aiom-source:v1:positif': { streams: [{ ytId: 'abcdefghijk' }] },
        'cache:aiom-youtube:v1:positif': { stream: { ytId: 'abcdefghijk' } },
        'cache:override-link:serie': { index: 0 },
    };
    const misses = {
        'cache:trailers:echec': { streams: [] },
        'cache:aiom-source:v1:echec': { streams: [] },
        'cache:aiom-youtube:v1:echec': { stream: null },
    };
    await Promise.all(Object.entries({ ...hits, ...misses }).map(([key, value]) => setCached(key, value, 60)));
    await setCached('cache:direct:expire', { url: 'https://example.com/film.mp4' }, -1);
    await setCached('loginattempts:fixture', { count: 3 }, 60);
    federation._cache.set('stockage-positif', { result: { found: true } });
    federation._cache.set('stockage-echec', { result: { found: false } });

    assert.deepEqual(await stats(), { count: baseline.count + 10, success: baseline.success + 7, failures: baseline.failures + 3 });
    const purge = suffix => fetch(base + '/api/cache' + suffix, { method: 'DELETE', headers }).then(r => r.json());
    assert.deepEqual(await purge('?only=failures'), { success: true });
    assert.deepEqual(await stats(), { count: baseline.success + 7, success: baseline.success + 7, failures: 0 });
    assert.equal(federation._cache.has('stockage-positif'), true);
    assert.equal(federation._cache.has('stockage-echec'), false);
    assert.deepEqual(await purge(''), { success: true });
    assert.deepEqual(await stats(), { count: 0, success: 0, failures: 0 });
    assert.equal(federation._cache.size, 0);
    assert.deepEqual(await getCached('loginattempts:fixture'), { count: 3 });
});
