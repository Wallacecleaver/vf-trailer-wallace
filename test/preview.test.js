const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-preview-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_KEY = 'tmdb-test-key';
delete process.env.TVDB_API_KEY;

const state = { videos: [], found: true, lookupError: false, order: [], externalLookups: 0 };
const stub = (name, exports) => {
    const filename = path.join(__dirname, '..', 'lib', name + '.js');
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const json = data => ({ ok: true, json: async () => data });

// Les réponses externes sont simulées ; le routeur, le résolveur, les préférences
// et SQLite restent réels. Un mauvais aperçu ne peut donc pas se cacher derrière
// un mock du résolveur ou des exemples YouTube.
stub('net', {
    fetchT: async (url, options = {}) => {
        if (options.method === 'HEAD') return { ok: !url.includes('/mort'), status: url.includes('/mort') ? 404 : 200 };
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/external_ids')) {
            state.externalLookups++;
            if (state.lookupError) throw new Error('Erreur interne avec secret-storage-key');
            const id = pathname.split('/')[3];
            return json({ imdb_id: id === '999999' ? null : 'tt' + id.padStart(7, '0') });
        }
        if (pathname.includes('/find/')) {
            const id = Number(pathname.split('/').pop().replace('tt', ''));
            return json({ movie_results: [{ id, title: 'Trouble échange' }], tv_results: [{ id, name: 'Trouble échange' }] });
        }
        if (pathname.endsWith('/alternative_titles')) return json({ titles: [], results: [] });
        if (pathname.endsWith('/watch/providers')) return json({ results: {} });
        if (pathname.endsWith('/videos')) return json({ results: state.videos });
        return json({ name: 'Trouble échange', title: 'Trouble échange', original_name: 'Trouble échange',
            first_air_date: '2026-01-01', release_date: '2026-01-01', networks: [{ name: 'Netflix' }] });
    },
});
stub('youtube-search', { searchYoutubeTrailer: async () => { state.order.push('youtube'); return null; } });
stub('allocine', { getAllocineTrailerStreams: async () => { state.order.push('allocine'); return []; } });
stub('netflix-federation', {
    resolveFederatedTrailer: async options => {
        state.order.push('stockage');
        assert.equal(options.baseUrl, 'https://stockage.exemple.fr');
        assert.equal(options.apiKey, 'secret-storage-key');
        return { found: state.found, title: { name: 'Trouble échange' }, trailers: state.found
            ? [{ title: 'Trailer', url: 'https://stockage.exemple.fr/trailer/1.mp4' }] : [] };
    },
});

const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { DEFAULT_BEHAVIOR, setBehaviorSettings } = require('../lib/settings');
const { setOverride } = require('../lib/overrides');
const { testResolve } = require('../lib/resolver');
let server, base;

before(async () => {
    await ensureSchema();
    const app = express();
    app.use(express.json());
    require('../routes/pages')(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});

beforeEach(async () => {
    state.videos = [];
    state.found = true;
    state.lookupError = false;
    state.order = [];
    state.externalLookups = 0;
    await setBehaviorSettings({ ...DEFAULT_BEHAVIOR, netflixCatalogueUrl: 'https://stockage.exemple.fr',
        netflixCatalogueKey: 'secret-storage-key' });
});

after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

async function preview(tmdbId, extra = {}, method = 'POST') {
    const body = { type: 'tv', tmdbId, display: 'detailed', ...extra };
    const response = method === 'GET'
        ? await fetch(base + '/api/preview-streams?' + new URLSearchParams(body))
        : await fetch(base + '/api/preview-streams', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, data: await response.json() };
}

async function snapshot() {
    const tables = await sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`;
    const result = {};
    for (const { name } of tables) result[name] = await sql([`SELECT * FROM "${name}" ORDER BY rowid`]);
    return JSON.stringify(result);
}

test('aperçu réel : repli Stockage BD, même résultat que le dashboard, aucune écriture SQLite', async () => {
    const initial = await snapshot();
    const { response, data } = await preview(900001);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(data.source, 'netflix_catalogue');
    assert.equal(data.streams.length, 1);
    assert.match(data.streams[0].title, /Stockage BD/);
    assert.match(data.streams[0].title, /Lien vidéo direct/);
    assert.match(data.streams[0].title, /🔗 Vidéo · Stockage BD/);
    assert.doesNotMatch(data.streams[0].title, /stockage\.exemple\.fr|\.mp4/);
    assert.doesNotMatch(data.streams[0].title, /YouTube|1080p|Teaser/);
    assert.deepEqual(state.order, ['youtube', 'allocine', 'stockage']);
    assert.deepEqual(Object.keys(data.streams[0]).sort(), ['name', 'title']);
    assert.ok(!JSON.stringify(data).includes('secret-storage-key'));
    assert.ok(!('trace' in data));
    const dashboard = await testResolve('series', 'tt0900001', null, false, false);
    assert.equal(dashboard.source, data.source);
    assert.equal(dashboard.streams.length, data.streams.length);
    assert.equal(await snapshot(), initial);
    const get = await preview(900001, {}, 'GET');
    assert.deepEqual(get.data, data);
});

test('aperçu réel : changements de présentation sans relancer la recherche, flux YouTube réels uniquement', async () => {
    state.videos = [{ site: 'YouTube', type: 'Trailer', name: 'Trouble échange - Bande-annonce VF', key: 'abcdefghijk', official: true }];
    const initial = await snapshot();
    const [first, second] = await Promise.all([preview(900002), preview(900002, { maxLinks: 1, display: 'compact' })]);
    assert.equal(first.data.source, 'tmdb');
    assert.equal(first.data.streams.length, 2);
    assert.equal(second.data.streams.length, 1);
    assert.equal(state.externalLookups, 1);
    assert.deepEqual(state.order, []);
    const external = await preview(900002, { externalOnly: true });
    assert.equal(external.data.streams.length, 1);
    assert.match(external.data.streams[0].title, /Ouverture externe/);
    assert.equal(state.externalLookups, 1);
    assert.equal(await snapshot(), initial);
});

test('aperçu réel : extras activés et désactivés suivent les options utilisateur', async () => {
    state.found = false;
    state.videos = [{ site: 'YouTube', type: 'Clip', name: 'Trouble échange - Extrait VF', key: 'abcdefghijk', official: true }];
    const withExtras = await preview(900003, { includeExtras: 'on' });
    assert.ok(withExtras.data.streams.length > 0);
    assert.match(withExtras.data.streams[0].title, /Extrait/);
    const withoutExtras = await preview(900003, { includeExtras: 'off' });
    assert.equal(withoutExtras.data.streams.length, 0);
    assert.match(withoutExtras.data.message, /Aucune bande-annonce/);
});

test('aperçu réel : absence de vidéo sans faux trailer ni teaser YouTube', async () => {
    state.found = false;
    const { data } = await preview(900004);
    assert.deepEqual(data.streams, []);
    assert.match(data.message, /Aucune bande-annonce/);
});

test('aperçu réel : mapping manuel multi-liens et masquage appliqués immédiatement sans toucher aux données', async () => {
    const first = await preview(900005);
    assert.equal(first.data.source, 'netflix_catalogue');
    await setOverride({ imdbId: 'tt0900005', title: 'Trouble échange', links: [
        { url: 'https://stockage.exemple.fr/mort.mp4' }, { url: 'https://stockage.exemple.fr/manuel.mp4' },
    ] });
    const initial = await snapshot();
    const manual = await preview(900005);
    assert.equal(manual.data.source, 'override');
    assert.equal(manual.data.streams.length, 1);
    assert.match(manual.data.streams[0].title, /Lien manuel/);
    assert.match(manual.data.streams[0].title, /manuel\.mp4/);
    assert.equal(await snapshot(), initial);
    await setOverride({ imdbId: 'tt0900005', title: 'Trouble échange', hidden: true });
    const hiddenSnapshot = await snapshot();
    const hidden = await preview(900005);
    assert.deepEqual(hidden.data.streams, []);
    assert.match(hidden.data.message, /masqué/);
    assert.equal(await snapshot(), hiddenSnapshot);
});

test('aperçu réel : les réglages admin changent la recherche sans modifier la connexion existante', async () => {
    await preview(900006);
    state.order = [];
    await setBehaviorSettings({ youtubeEnabled: false });
    const initial = await snapshot();
    const { data } = await preview(900006);
    assert.equal(data.source, 'netflix_catalogue');
    assert.deepEqual(state.order, ['allocine', 'stockage']);
    assert.equal(await snapshot(), initial);
});

test('aperçu réel : identifiants invalides et absents gérés proprement', async () => {
    const invalid = await preview(-1);
    assert.equal(invalid.response.status, 400);
    assert.equal(state.externalLookups, 0);
    const noImdb = await preview(999999);
    assert.deepEqual(noImdb.data.streams, []);
    assert.match(noImdb.data.message, /indisponible pour ce titre/);
});

test('aperçu réel : erreur réseau sans secret exposé, puis nouvelle tentative possible', async () => {
    state.lookupError = true;
    const failed = await preview(900007);
    assert.equal(failed.response.status, 502);
    assert.ok(!JSON.stringify(failed.data).includes('secret-storage-key'));
    state.lookupError = false;
    const retry = await preview(900007);
    assert.equal(retry.data.source, 'netflix_catalogue');
    assert.equal(state.externalLookups, 2);
});
