const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = name => fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'js', name + '.js'), 'utf8');
const response = (status, renewed) => new Response('{}', { status, headers: renewed ? { 'x-admin-token': renewed } : {} });

function dashboard(storage = new Map([['vftrailers_token', 'initial-token']])) {
    const nodes = new Map(), listeners = {}, cleared = [];
    function node(id) {
        if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '', innerHTML: '', value: '', checked: false,
            disabled: false, classList: { add() {}, remove() {}, toggle() {} } });
        return nodes.get(id);
    }
    node('dashboard').style.display = 'block';
    node('login-screen').style.display = 'none';
    const location = { href: 'https://addon.exemple.fr/dashboard#overview', origin: 'https://addon.exemple.fr', hash: '#overview' };
    const context = vm.createContext({
        URL, Headers, console, location, history: { pushState() {} }, logsInterval: null, logsPaused: false,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        window: { location, addEventListener: (name, callback) => { listeners[name] = callback; } },
        document: { getElementById: node, querySelector: node, querySelectorAll: () => [] },
        clearInterval: id => cleared.push(id), clearTimeout() {}, setTimeout() {},
        fetch: async () => response(200), toast() {}, extractImdbId: value => value,
        refreshFailedBadge: async () => {}, refreshRequestsBadge: async () => {}, refreshLogsBadge: async () => {},
        loadOverview: async () => {},
    });
    vm.runInContext(script('00-core'), context);
    return { context, storage, node, listeners, cleared };
}

test('dashboard : une panne réseau, 5xx, 429 ou 403 conserve la session', async () => {
    const ui = dashboard();
    for (const status of [500, 502, 503, 504, 429, 403]) {
        ui.context.fetch = async () => response(status);
        assert.equal((await ui.context.authFetch('/api/overrides')).status, status);
        assert.equal(ui.storage.get('vftrailers_token'), 'initial-token');
        assert.equal(ui.node('dashboard').style.display, 'block');
    }
    ui.context.fetch = async () => { throw new Error('Réseau indisponible'); };
    await assert.rejects(ui.context.authFetch('/api/overrides'));
    assert.equal(ui.storage.get('vftrailers_token'), 'initial-token');
});

test('dashboard : renouvellement mémorisé et utilisé pour la requête suivante', async () => {
    const ui = dashboard();
    const sent = [];
    ui.context.fetch = async (url, options) => {
        sent.push(options.headers.get('x-admin-token'));
        assert.equal(options.headers.get('Content-Type'), 'application/json');
        return response(200, 'renewed-token');
    };
    await ui.context.authFetch('/api/overrides', { headers: { 'Content-Type': 'application/json' } });
    await ui.context.authFetch('/api/overrides', { headers: { 'Content-Type': 'application/json' } });
    assert.deepEqual(sent, ['initial-token', 'renewed-token']);
    assert.equal(ui.storage.get('vftrailers_token'), 'renewed-token');
});

test('dashboard : un vrai 401 termine la session et arrête les rafraîchissements', async () => {
    const ui = dashboard();
    vm.runInContext('ovInterval = 1; logsInterval = 2;', ui.context);
    ui.context.fetch = async () => response(401);
    await ui.context.authFetch('/api/overrides');
    assert.equal(ui.storage.has('vftrailers_token'), false);
    assert.equal(ui.node('dashboard').style.display, 'none');
    assert.equal(ui.node('login-screen').style.display, 'flex');
    assert.match(ui.node('login-error').textContent, /expiré ou a été révoquée/);
    assert.deepEqual(ui.cleared, [1, 2]);
});

test('dashboard : un ancien 401 ne déconnecte pas une session déjà renouvelée', async () => {
    const ui = dashboard(), replies = [];
    ui.context.fetch = () => new Promise(resolve => replies.push(resolve));
    const first = ui.context.authFetch('/api/overrides');
    const second = ui.context.authFetch('/api/contributions');
    replies[0](response(200, 'new-token'));
    await first;
    replies[1](response(401));
    await second;
    assert.equal(ui.storage.get('vftrailers_token'), 'new-token');
    assert.equal(ui.node('dashboard').style.display, 'block');
});

test('dashboard : une réponse en retard ne reconnecte pas après une déconnexion volontaire', async () => {
    const ui = dashboard();
    let reply;
    ui.context.fetch = () => new Promise(resolve => { reply = resolve; });
    const pending = ui.context.authFetch('/api/overrides');
    ui.context.logout();
    reply(response(200, 'late-token'));
    await pending;
    assert.equal(ui.storage.has('vftrailers_token'), false);
    assert.equal(ui.node('login-screen').style.display, 'flex');
});

test('dashboard : jeton renouvelé ou déconnexion dans un autre onglet pris en compte', async () => {
    const ui = dashboard();
    ui.storage.set('vftrailers_token', 'other-tab-token');
    ui.listeners.storage({ key: 'vftrailers_token' });
    let sent;
    ui.context.fetch = async (url, options) => { sent = options.headers.get('x-admin-token'); return response(200); };
    await ui.context.authFetch('/api/overrides');
    assert.equal(sent, 'other-tab-token');
    ui.storage.delete('vftrailers_token');
    ui.listeners.storage({ key: 'vftrailers_token' });
    assert.equal(ui.node('login-screen').style.display, 'flex');
});

test('dashboard : aucun jeton envoyé à un autre site', async () => {
    const ui = dashboard();
    let calls = 0;
    ui.context.fetch = async () => { calls++; return response(200); };
    await assert.rejects(ui.context.authFetch('https://autre.exemple.fr/api/overrides'));
    assert.equal(calls, 0);
    assert.equal(ui.storage.get('vftrailers_token'), 'initial-token');
});

test('dashboard : vue d’ensemble, utilisateurs et logs ne déconnectent plus sur 503', async () => {
    for (const [file, method] of [['02-overview', 'loadOverview'], ['03-users', 'loadInstallStats'], ['11-services-status', 'loadLogs']]) {
        const ui = dashboard();
        vm.runInContext(script(file), ui.context);
        ui.context.fetch = async () => response(503);
        await ui.context[method]();
        assert.equal(ui.storage.get('vftrailers_token'), 'initial-token', file);
        assert.equal(ui.node('dashboard').style.display, 'block', file);
    }
});

test('dashboard : erreur temporaire du testeur affichée sans fermer le dashboard', async () => {
    const ui = dashboard();
    vm.runInContext(script('08-test-flux'), ui.context);
    ui.node('ts-imdb').value = 'tt42767924';
    ui.node('ts-type').value = 'series';
    ui.context.fetch = async () => response(503);
    await ui.context.runStreamTest();
    assert.equal(ui.storage.get('vftrailers_token'), 'initial-token');
    assert.match(ui.node('ts-result').innerHTML, /temporairement indisponible/);
    assert.equal(ui.node('ts-btn').disabled, false);
});
