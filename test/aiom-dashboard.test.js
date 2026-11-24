const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/14-aiom.js'), 'utf8');
function dashboard(clipboard = true) {
    const nodes = new Map(), copied = [], messages = [], network = [], pages = [];
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { value: '', href: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
            dataset: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
            focus() { this.focused = true; }, select() { this.selected = true; } });
        return nodes.get(id);
    };
    const context = vm.createContext({
        window: { location: { origin: 'https://addon.example' } },
        document: { getElementById: node, execCommand: () => true },
        navigator: { clipboard: clipboard ? { writeText: async text => copied.push(text) } : undefined },
        toast: text => messages.push(text),
        authFetch: async url => { network.push(url); return response(sample()); },
        showPage: page => pages.push(page),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/14-utils.js'), 'utf8'), context);
    context.toast = text => messages.push(text);
    vm.runInContext(script, context);
    return { context, node, copied, messages, network, pages };
}
const response = data => ({ ok: true, json: async () => data });
function sample(extra = {}) {
    return { configured: true, total: 100, today: 12, found: 80, avgMs: 245, cacheRate: 62, timeoutSeconds: 5,
        tmdbConfigured: true, byOutcome: { ytId: 65, url: 15, aucun: 10, timeout: 8, masque: 2 },
        days: [{ date: '2026-11-16', count: 88 }, { date: '2026-11-17', count: 12 }], recent: [], ...extra };
}

test('onglet AIOM : lien fixe sans clé et statistiques authentifiées', async () => {
    const ui = dashboard();
    await ui.context.loadAiomSettings();
    assert.equal(ui.node('aiom-manifest-url').value, 'https://addon.example/aiom/manifest.json');
    assert.equal(ui.node('aiom-open').href, 'https://addon.example/aiom/manifest.json');
    assert.deepEqual(ui.network, ['/api/aiom-stats']);
    assert.equal(ui.node('aiom-total').textContent, '100');
    assert.equal(ui.node('aiom-hit-rate').textContent, '80 %');
    assert.equal(ui.node('aiom-avg-ms').textContent, '245 ms');
    assert.equal(ui.node('aiom-timeouts').textContent, '8');
    assert.equal(ui.node('aiom-key-warning').hidden, true);
    assert.equal(ui.node('aiom-refresh').disabled, false);
    assert.match(ui.node('aiom-outcomes').innerHTML, /YouTube|Vidéo directe/);
});

test('onglet AIOM : copie du lien complet', async () => {
    const ui = dashboard();
    await ui.context.copyAiomManifest();
    assert.deepEqual(ui.copied, ['https://addon.example/aiom/manifest.json']);
    assert.deepEqual(ui.network, []);
});

test('onglet AIOM : enregistre la source et conserve le lien de partage', async () => {
    const ui = dashboard();
    const url = 'https://trailers.example/nuvio-strict/manifest.json';
    ui.context.authFetch = async (path, options) => {
        if (path === '/api/aiom-stats') return response(sample({ sourceManifestUrl: '' }));
        assert.equal(path, '/api/settings/aiom-source');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(options.body), { sourceManifestUrl: url });
        return response({ sourceManifestUrl: url });
    };
    await ui.context.loadAiomSettings();
    ui.node('aiom-source-url').value = url;
    await ui.context.saveAiomSource();
    assert.equal(ui.node('aiom-source-status').textContent, 'Source externe active.');
    assert.equal(ui.node('aiom-manifest-url').value, 'https://addon.example/aiom/manifest.json');
    assert.equal(ui.node('aiom-key-status').hidden, true);
});

test('onglet AIOM : copie de secours et sélection manuelle si le presse-papiers échoue', async () => {
    const ui = dashboard(false);
    await ui.context.copyAiomManifest();
    assert.equal(ui.node('aiom-manifest-url').selected, true);
    const offline = dashboard();
    offline.context.navigator.clipboard.writeText = async () => { throw new Error('Refus'); };
    await offline.context.copyAiomManifest();
    assert.equal(offline.node('aiom-manifest-url').selected, true);
    assert.match(offline.messages[0], /Ctrl\+C/);
});

test('onglet AIOM : aucune demande et clé serveur absente sans chiffres trompeurs', async () => {
    const ui = dashboard();
    ui.context.authFetch = async () => response(sample({ total: 0, found: 0, today: 0, tmdbConfigured: false, byOutcome: {}, days: [] }));
    await ui.context.loadAiomSettings();
    assert.equal(ui.node('aiom-total').textContent, '0');
    assert.equal(ui.node('aiom-hit-rate').textContent, '—');
    assert.equal(ui.node('aiom-avg-ms').textContent, '—');
    assert.equal(ui.node('aiom-timeouts').textContent, '0');
    assert.equal(ui.node('aiom-key-warning').hidden, false);
    assert.equal(ui.node('aiom-key-status').dataset.state, 'missing');
    assert.match(ui.node('aiom-activity').innerHTML, /Aucune demande/);
    assert.match(ui.node('aiom-recent').innerHTML, /Aucun événement/);
});

test('onglet AIOM : panne temporaire, chiffres conservés et nouvelle tentative possible', async () => {
    const ui = dashboard();
    await ui.context.loadAiomSettings();
    for (const failure of [async () => ({ ok: false, status: 503 }), async () => { throw new Error('Réseau'); }]) {
        ui.context.authFetch = failure;
        await ui.context.loadAiomStats();
        assert.equal(ui.node('aiom-total').textContent, '100');
        assert.equal(ui.node('aiom-stats-error').hidden, false);
        assert.match(ui.node('aiom-stats-error').textContent, /dernières données/);
        assert.equal(ui.node('aiom-refresh').disabled, false);
        assert.equal(ui.node('aiom-stats').attributes['aria-busy'], 'false');
    }
    ui.context.authFetch = async () => response(sample({ total: 120 }));
    await ui.context.loadAiomStats();
    assert.equal(ui.node('aiom-total').textContent, '120');
    assert.equal(ui.node('aiom-stats-error').hidden, true);
});

test('onglet AIOM : premier chargement indisponible, lien toujours copiable', async () => {
    const ui = dashboard();
    ui.context.authFetch = async () => response({ configured: false });
    await ui.context.loadAiomSettings();
    assert.equal(ui.node('aiom-stats-error').hidden, false);
    assert.match(ui.node('aiom-key-status').textContent, /indisponible/);
    await ui.context.copyAiomManifest();
    assert.equal(ui.copied[0], 'https://addon.example/aiom/manifest.json');
});

test('onglet AIOM : une réponse ancienne ne remplace pas les dernières statistiques', async () => {
    const ui = dashboard(), replies = [];
    ui.context.authFetch = () => new Promise(resolve => replies.push(resolve));
    const first = ui.context.loadAiomStats();
    const second = ui.context.loadAiomStats();
    replies[1](response(sample({ total: 200 })));
    await second;
    replies[0](response(sample({ total: 100 })));
    await first;
    assert.equal(ui.node('aiom-total').textContent, '200');
});

test('onglet AIOM : journal échappé et graphique accessible sans HTML injecté', () => {
    const ui = dashboard();
    ui.context.renderAiomStats(sample({ recent: [{ message: '<img src=x onerror=alert(1)>', time: 'invalide', level: 'error' }] }));
    assert.match(ui.node('aiom-recent').innerHTML, /&lt;img/);
    assert.doesNotMatch(ui.node('aiom-recent').innerHTML, /<img|Invalid Date/);
    const chart = ui.context.renderAiomActivity([{ date: '<img src=x>', count: 3 }, { date: '2026-11-17', count: 8 }]);
    assert.doesNotMatch(chart, /<img|NaN|Infinity/);
    assert.match(chart, /tabindex="0" aria-label="17\/11 · 8/);
});

test('onglet AIOM : accès au journal filtré sur AIOM', () => {
    const ui = dashboard();
    ui.node('logs-level').value = 'error';
    ui.node('logs-search').value = 'ancien filtre';
    ui.context.openAiomLogs();
    assert.equal(ui.node('logs-ctx').value, 'AIOM');
    assert.equal(ui.node('logs-level').value, '');
    assert.equal(ui.node('logs-search').value, '');
    assert.deepEqual(ui.pages, ['logs']);
});
