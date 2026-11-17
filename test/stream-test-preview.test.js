const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildStreamPreviewVariants, applyDisplayMode, applyUserStreamPrefs, toAiomStreams } = require('../lib/stream-format');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/08-test-flux.js'), 'utf8');
const sample = [
    { name: '🔴 Netflix', title: 'Bande-annonce\nTrouble échange', ytId: 'abcdefghijk', __external: false, __quality: 1080 },
    { name: '🔴 Netflix\n▶️ YouTube', title: 'Bande-annonce\nTrouble échange\n(ouvrir dans YouTube)', externalUrl: 'https://www.youtube.com/watch?v=abcdefghijk', __external: true, __quality: 1080 },
];

test('aperçu du testeur : mêmes trois formats que Stremio, résultat original intact', () => {
    const original = structuredClone(sample);
    const views = buildStreamPreviewVariants(sample, 'tmdb');
    for (const mode of ['default', 'compact', 'detailed']) {
        const expected = applyDisplayMode(applyUserStreamPrefs(sample, {}), { display: mode }, 'tmdb')
            .map(({ name, title }) => ({ name, title }));
        assert.deepEqual(views[mode], expected);
        assert.ok(views[mode].every(row => Object.keys(row).sort().join(',') === 'name,title'));
    }
    assert.match(views.detailed[0].title, /1080p/);
    assert.match(views.detailed[1].title, /Ouverture externe/);
    assert.deepEqual(sample, original);
});

test('aperçu du testeur : stockage direct sans faux lien YouTube ni qualité inventée', () => {
    const views = buildStreamPreviewVariants([{ name: '🔴 Netflix', title: 'Bande-annonce\nTrouble échange', url: 'https://stockage.example/trailer.mp4' }], 'netflix_catalogue');
    assert.match(views.detailed[0].title, /Stockage BD/);
    assert.match(views.detailed[0].title, /Lien vidéo direct/);
    assert.doesNotMatch(views.detailed[0].title, /YouTube|1080p|🔗|stockage\.example/);
});

test('aperçu du testeur : AIOMetadata garde son unique flux et les listes vides restent vides', () => {
    const views = buildStreamPreviewVariants(sample, 'tmdb', true);
    const expected = toAiomStreams(sample).map(({ name, title }) => ({ name, title }));
    for (const mode of ['default', 'compact', 'detailed']) {
        assert.deepEqual(views[mode], expected);
        assert.equal(views[mode].length, 1);
        assert.deepEqual(buildStreamPreviewVariants(undefined)[mode], []);
    }
});

function ui() {
    const nodes = new Map(), network = [];
    const node = id => {
        if (!nodes.has(id)) {
            const classes = new Set();
            nodes.set(id, {
                value: '', checked: false, hidden: false, disabled: false, textContent: '', innerHTML: '', style: {}, dataset: {}, attributes: {},
                classList: {
                    add: name => classes.add(name), remove: name => classes.delete(name),
                    contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
                },
                setAttribute(name, value) { this.attributes[name] = value; },
                removeAttribute(name) { delete this.attributes[name]; },
                focus() {}, scrollIntoView() {},
            });
        }
        return nodes.get(id);
    };
    node('ts-type').value = 'movie';
    node('ts-preview-display').value = 'default';
    const context = vm.createContext({
        document: { getElementById: node }, window: {}, console,
        setTimeout: () => 1, clearTimeout() {},
        authHeaders: extra => extra || {},
        authFetch: async (url, options) => { network.push({ url, options }); return { ok: true, status: 200, json: async () => ({ streams: [] }) }; },
        toast() {}, extractImdbId: text => (text.match(/tt\d+/) || [text])[0],
        escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        escapeAttr: value => String(value), extractYoutubeId: () => null, mountYoutubePlayer() {},
    });
    vm.runInContext(source, context);
    context.checkOverrideNow = () => {};
    return { context, node, network };
}
function result(streams = sample, extra = {}) {
    return { streams, source: 'tmdb', officialTitle: 'Trouble échange', trace: [],
        preview: buildStreamPreviewVariants(streams, 'tmdb'), ...extra };
}
const response = data => ({ ok: true, status: 200, json: async () => data });
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('panneau Stremio : changement de format sans réseau et textes échappés', () => {
    const page = ui();
    const streams = [{ name: '<img src=x>', title: 'Bande-annonce\n<script>film</script>', url: 'https://example.com/trailer.mp4' }];
    page.context.renderStreamTestResult(result(streams), 'tt0000123', null, 'movie');
    assert.match(page.node('ts-preview-list').innerHTML, /&lt;img src=x&gt;/);
    assert.doesNotMatch(page.node('ts-preview-list').innerHTML, /<img src=x>|<script>film/);
    page.node('ts-preview-display').value = 'detailed';
    page.context.renderTsStremioPreview();
    assert.match(page.node('ts-preview-list').innerHTML, /Lecteur|Lien vidéo direct/);
    assert.match(page.node('ts-preview-list').innerHTML, /onclick="playStream\(0\)"/);
    assert.equal(page.network.length, 0);
    assert.equal(page.node('ts-preview-type').textContent, 'Film');
});

test('panneau Stremio : série, saison et mode AIOMetadata fidèles au résultat', () => {
    const page = ui();
    const streams = toAiomStreams(sample);
    page.context.renderStreamTestResult(result(streams, { aiom: true, preview: buildStreamPreviewVariants(streams, 'tmdb', true) }), 'tt0000123', '2', 'series');
    assert.equal(page.node('ts-preview-type').textContent, 'Série');
    assert.match(page.node('ts-preview-media-meta').textContent, /Saison 2/);
    assert.equal(page.node('ts-preview-display').disabled, true);
    assert.match(page.node('ts-preview-note').textContent, /Vue AIOMetadata · 1 lien/);
});

test('panneau Stremio : vide, masqué et erreur remplacent les anciens liens', () => {
    const page = ui();
    for (const data of [result([], {}), result([], { hidden: true }), result([], { error: 'Indisponible <temporairement>' })]) {
        page.context.renderStreamTestResult(data, 'tt0000123', null, 'movie');
        assert.equal(page.node('ts-preview-display').disabled, true);
        assert.doesNotMatch(page.node('ts-preview-list').innerHTML, /onclick="playStream/);
    }
    assert.match(page.node('ts-preview-list').innerHTML, /&lt;temporairement&gt;/);
});

test('panneau Stremio : Effacer invalide la réponse en cours et la sélection précédente', async () => {
    const page = ui(), pending = deferred();
    page.node('ts-imdb').value = 'tt0000123';
    page.context.authFetch = () => pending.promise;
    const work = page.context.runStreamTest();
    assert.equal(page.node('ts-preview-list').attributes['aria-busy'], 'true');
    page.context.resetTsForm();
    pending.resolve(response(result()));
    await work;
    assert.match(page.node('ts-preview-list').innerHTML, /Lance un test/);
    assert.equal(page.node('ts-preview-media').hidden, true);
    assert.equal(page.node('ts-btn').disabled, false);
    assert.equal(vm.runInContext('tsLast', page.context), null);
});

test('panneau Stremio : une réponse dépassée ne remplace pas le dernier test', async () => {
    const page = ui(), older = deferred(), newer = deferred(), replies = [older, newer];
    page.context.authFetch = () => replies.shift().promise;
    page.node('ts-imdb').value = 'tt0000123';
    const first = page.context.runStreamTest();
    page.node('ts-imdb').value = 'tt0000456';
    const second = page.context.runStreamTest();
    newer.resolve(response(result(sample, { officialTitle: 'Dernier test' })));
    await second;
    older.resolve(response(result(sample, { officialTitle: 'Ancien test' })));
    await first;
    assert.equal(page.node('ts-preview-media-title').textContent, 'Dernier test');
    assert.equal(vm.runInContext('tsLast.imdbId', page.context), 'tt0000456');
    assert.equal(page.node('ts-btn').textContent, '🔬 Tester');
});

test('panneau Stremio : panne HTTP sans conserver un aperçu trompeur', async () => {
    const page = ui();
    page.node('ts-imdb').value = 'tt0000123';
    page.context.authFetch = async () => ({ ok: false, status: 503 });
    await page.context.runStreamTest();
    assert.match(page.node('ts-preview-list').innerHTML, /indisponible/);
    assert.equal(page.node('ts-preview-display').disabled, true);
    assert.equal(page.node('ts-btn').disabled, false);
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-test-preview-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_PASSWORD = 'preview-test';
process.env.TOKEN_SECRET = 'preview-isolated-test';
const state = { calls: [], result: result() };
const resolverPath = require.resolve('../lib/resolver');
require.cache[resolverPath] = { id: resolverPath, filename: resolverPath, loaded: true, exports: {
    testResolve: async (...args) => { state.calls.push(args); return state.result; },
} };
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const app = require('../api');
let server, base, headers;

before(async () => {
    await ensureSchema();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'preview-test' }),
    }).then(res => res.json());
    assert.ok(login.token);
    headers = { 'Content-Type': 'application/json', 'x-admin-token': login.token };
});
beforeEach(() => { state.calls = []; state.result = { streams: structuredClone(sample), officialTitle: 'Trouble échange', source: 'tmdb', aiom: false }; });
after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
async function snapshot() {
    const tables = await sql(["SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"]);
    const data = {};
    for (const { name } of tables) data[name] = await sql(['SELECT * FROM "' + name + '" ORDER BY rowid']);
    return JSON.stringify(data);
}

test('testeur API : une résolution, trois aperçus et aucune écriture SQLite', async () => {
    const original = structuredClone(state.result);
    const before = await snapshot();
    const response = await fetch(base + '/api/test-resolve', {
        method: 'POST', headers, body: JSON.stringify({ type: 'series', imdbId: 'tt0000123', season: '2', ignoreOverride: true, aiom: false }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(state.calls, [['series', 'tt0000123', '2', true, false]]);
    assert.deepEqual(data.streams, original.streams);
    assert.deepEqual(data.preview, buildStreamPreviewVariants(original.streams, 'tmdb'));
    assert.deepEqual(state.result, original);
    assert.equal(await snapshot(), before);
});

test('testeur API : simulation AIOMetadata et accès administrateur préservés', async () => {
    state.result = { streams: toAiomStreams(sample), officialTitle: 'Trouble échange', source: 'tmdb', aiom: true };
    const unauth = await fetch(base + '/api/test-resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'movie', imdbId: 'tt0000123' }),
    });
    assert.equal(unauth.status, 401);
    assert.equal(state.calls.length, 0);
    const response = await fetch(base + '/api/test-resolve', {
        method: 'POST', headers, body: JSON.stringify({ type: 'movie', imdbId: 'tt0000123', aiom: true }),
    });
    const data = await response.json();
    assert.equal(data.preview.detailed.length, 1);
    assert.deepEqual(data.preview.detailed, data.preview.default);
    assert.equal(state.calls[0][4], true);
});
