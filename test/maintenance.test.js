const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-maintenance-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_PASSWORD = 'maintenance-test';
process.env.TOKEN_SECRET = 'maintenance-isolated-test';

// Réseau de recherche simulé, routes Stremio et données locales réelles.
const resolverPath = require.resolve('../lib/resolver');
const streams = [{ name: 'VF', title: 'Bande-annonce conservée', url: 'https://example.com/trailer.mp4' }];
require.cache[resolverPath] = { id: resolverPath, filename: resolverPath, loaded: true, exports: {
    resolveStreams: async () => ({ streams, officialTitle: 'Film de test', hidden: false }),
} };
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { DEFAULT_MAINTENANCE, getMaintenanceSettings, setMaintenanceSettings } = require('../lib/maintenance');
const { getConfigureSettings } = require('../lib/settings');
const app = require('../api');
let server, base, headers;

const request = (pathname, options = {}) => fetch(base + pathname, options);
const save = payload => request('/api/settings/maintenance', {
    method: 'POST', headers, body: JSON.stringify(payload),
});
async function preservedData() {
    return {
        settings: await sql`SELECT * FROM configure_settings`,
        behavior: await sql`SELECT * FROM behavior_settings`,
        mappings: await sql`SELECT * FROM overrides`,
        cache: await sql`SELECT * FROM kv_cache WHERE cache_key = 'maintenance-sentinel'`,
    };
}

before(async () => {
    // Ancienne base déployée, puis ajout idempotent de la table de maintenance.
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    sql.exec(schema.replace(/-- Maintenance de la page publique[\s\S]*?ON CONFLICT \(id\) DO NOTHING;\n/, ''));
    await sql`UPDATE configure_settings SET brand_name = 'Mon addon', hero_subtitle = 'Texte conservé', language_select_hint = 'Ancien réglage conservé' WHERE id = 1`;
    await sql`INSERT INTO overrides (imdb_id, title, links) VALUES ('tt0000123', 'Mapping conservé', '[]')`;
    await sql`INSERT INTO kv_cache VALUES ('maintenance-sentinel', '{"keep":true}', ${Date.now() + 86400000})`;
    const previous = await preservedData();
    await ensureSchema();
    await ensureSchema();
    assert.deepEqual(await preservedData(), previous);
    assert.deepEqual(await getMaintenanceSettings(), DEFAULT_MAINTENANCE);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const login = await request('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'maintenance-test' }),
    }).then(res => res.json());
    headers = { 'Content-Type': 'application/json', 'x-admin-token': login.token };
    assert.ok(login.token);
});

beforeEach(async () => { await setMaintenanceSettings(DEFAULT_MAINTENANCE); });
after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('maintenance : API protégée et anciens points d’édition supprimés', async () => {
    assert.equal((await request('/api/settings/maintenance')).status, 401);
    assert.equal((await request('/api/settings/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    for (const pathname of ['/api/settings/configure', '/api/settings/configure/reset', '/api/configure-preview']) {
        assert.equal((await request(pathname, { method: 'POST', headers, body: '{}' })).status, 404);
    }
});

test('maintenance : désactivée par défaut, page et personnalisation existantes conservées', async () => {
    const response = await request('/configure');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(html, /id="cfg-pseudo"/);
    assert.match(html, /Mon addon/);
    assert.match(html, /Texte conservé/);
    assert.doesNotMatch(html, /<section class="maintenance-notice"/);
});

test('maintenance : activation, désactivation et message conservé sans toucher aux données', async () => {
    const before = await preservedData();
    const response = await save({ enabled: true, title: 'Intervention', message: 'Retour à 22 h', linkUrl: 'https://discord.gg/KN3vRqTHDa' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    let html = await request('/configure').then(res => res.text());
    assert.match(html, /<section class="maintenance-notice"/);
    assert.match(html, /Retour à 22 h/);
    assert.match(html, /id="cfg-pseudo"/);
    await save({ enabled: false });
    html = await request('/configure').then(res => res.text());
    assert.doesNotMatch(html, /<section class="maintenance-notice"/);
    assert.equal((await getMaintenanceSettings()).message, 'Retour à 22 h');
    assert.deepEqual(await preservedData(), before);
    assert.equal((await getConfigureSettings()).languageSelectHint, 'Ancien réglage conservé');
});

test('maintenance : blocage des deux URL de configuration, dashboard toujours accessible', async () => {
    await save({ enabled: true, blockInstall: true, message: 'Maintenance planifiée' });
    for (const pathname of ['/configure', '/ma-config/configure']) {
        const response = await request(pathname);
        const html = await response.text();
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('retry-after'), '300');
        assert.match(html, /Maintenance planifiée/);
        assert.doesNotMatch(html, /id="cfg-pseudo"|id="manifest-url"|Installer dans Stremio/);
    }
    assert.equal((await request('/dashboard')).status, 200);
    assert.equal((await request('/api/settings/maintenance', { headers })).status, 200);
    await save({ enabled: false });
    assert.equal((await request('/configure')).status, 200);
});

test('maintenance : les manifests et les bandes-annonces installés restent disponibles', async () => {
    await save({ enabled: true, blockInstall: true });
    const config = Buffer.from(JSON.stringify({ tmdbKey: 'fixture-key', pseudo: 'Test' })).toString('base64url');
    const manifest = await request('/' + config + '/manifest.json').then(res => res.json());
    assert.equal(manifest.behaviorHints.configurationRequired, false);
    const result = await request('/' + config + '/stream/movie/tt0000123.json').then(res => res.json());
    assert.deepEqual(result.streams, streams);
});

test('maintenance : la sonde déclarée dans Docker reste saine quand la configuration est bloquée', async () => {
    await save({ enabled: true, blockInstall: true });
    assert.equal((await request('/configure')).status, 503);
    const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
    // Tester la véritable URL déclarée dans l'image, y compris une éventuelle redirection.
    const probePath = dockerfile.match(/http:\/\/127\.0\.0\.1:\$\{PORT:-3000\}(\/[^\s]*)/)?.[1];
    assert.ok(probePath, 'URL de la sonde Docker introuvable');
    assert.equal((await request(probePath)).status, 200);
});

test('maintenance : validation des champs et des liens sans modifier les réglages en cas d’erreur', async () => {
    const previous = await getMaintenanceSettings();
    for (const patch of [null, [], { enabled: 'false' }, { blockInstall: 1 }, { title: 'a'.repeat(71) },
        { message: 'a'.repeat(301) }, { brandName: 'Interdit' }, { linkUrl: 'javascript:alert(1)' },
        { linkUrl: 'http://example.com' }, { linkUrl: 'https://user:pass@example.com' }, { linkUrl: 'https://example.com/\nfoo' }]) {
        // Le parseur JSON global refuse déjà le corps littéral null avant le routeur.
        assert.equal((await save(patch)).status, patch === null ? 413 : 400, JSON.stringify(patch));
        assert.deepEqual(await getMaintenanceSettings(), previous);
    }
});

test('maintenance : les contenus HTML restent du texte dans les deux modes', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    await save({ enabled: true, title: payload, message: '<script>alert(1)</script>', linkUrl: 'https://example.com/?q=a&b=c', linkLabel: '<b>Discord</b>' });
    for (const blockInstall of [false, true]) {
        await save({ blockInstall });
        const html = await request('/configure').then(res => res.text());
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
        assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
        assert.match(html, /https:\/\/example.com\/\?q=a&amp;b=c/);
        assert.doesNotMatch(html, /<img src=x|<script>alert\(1\)|<b>Discord<\/b>/);
    }
});
