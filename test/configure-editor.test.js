const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DEFAULT_CONFIGURE } = require('../lib/settings');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/12-configure.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard/pages/configure.html'), 'utf8');
const reply = (data, ok = true) => ({ ok, json: async () => data });
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function editor() {
    const nodes = new Map(), listeners = {}, timers = new Map(), messages = [];
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
        const events = {}, attributes = {}, classes = new Set();
        nodes.set(id, {
            value: '', textContent: '', disabled: false, hidden: false, srcdoc: '', style: {},
            clientWidth: 600, clientHeight: 480, events, attributes,
            classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
            addEventListener(name, callback) { events[name] = callback; },
            setAttribute(name, value) { attributes[name] = value; },
            setCustomValidity(message) { this.validationMessage = message; },
            reportValidity() { this.validityReported = true; },
        });
    }
    let timerId = 0;
    const context = vm.createContext({
        document: { getElementById: id => nodes.get(id) || null },
        window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
        setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
        authHeaders: extra => extra || {},
        authFetch: async () => reply({ ...DEFAULT_CONFIGURE }),
        toast: message => messages.push(message), confirm: () => true,
    });
    vm.runInContext(source, context);
    context.bindConfigureLivePreview();
    const node = id => nodes.get('cfg-' + id);
    return {
        context, node, listeners, messages,
        input(id, value) { node(id).value = value; node(id).events.input(); },
        async preview() {
            assert.equal(timers.size, 1);
            const [id, callback] = [...timers][0];
            timers.delete(id);
            return callback();
        },
    };
}

test('configure : chargement complet et brouillon conservé lors du retour sur l’onglet', async () => {
    const ui = editor();
    assert.equal(ui.node('fields').disabled, true);
    await ui.context.loadConfigureSettings();
    assert.equal(ui.node('fields').disabled, false);
    const fields = ui.context.collectConfigurePayload();
    assert.equal(Object.keys(fields).length, 21);
    for (const key of Object.keys(fields)) assert.equal(ui.node(key).value, DEFAULT_CONFIGURE[key]);
    ui.input('brandName', 'Mon addon personnalisé');
    let calls = 0;
    ui.context.authFetch = async () => { calls++; return reply(DEFAULT_CONFIGURE); };
    await ui.context.loadConfigureSettings();
    assert.equal(calls, 0);
    assert.equal(ui.node('brandName').value, 'Mon addon personnalisé');
    assert.equal(ui.node('save').disabled, false);
    let prevented = false;
    ui.listeners.beforeunload({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
});

test('configure : un chargement HTTP en erreur ou incomplet conserve les champs et permet de réessayer', async () => {
    const ui = editor();
    ui.context.authFetch = async () => reply({}, false);
    await ui.context.loadConfigureSettings();
    assert.equal(ui.node('fields').disabled, true);
    assert.equal(ui.node('save').disabled, true);
    assert.equal(ui.node('load-retry').hidden, false);
    ui.context.authFetch = async () => reply(DEFAULT_CONFIGURE);
    await ui.context.loadConfigureSettings();
    ui.context.authFetch = async () => reply({ brandName: 'Réponse incomplète' });
    await ui.context.loadConfigureSettings();
    assert.equal(ui.node('brandName').value, DEFAULT_CONFIGURE.brandName);
    assert.equal(ui.node('load-retry').hidden, false);
});

test('configure : une sauvegarde refusée (HTTP ou success:false) conserve le brouillon', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    ui.input('brandName', 'Brouillon');
    for (const response of [reply({}, false), reply({ success: false })]) {
        ui.context.authFetch = async () => response;
        await ui.context.saveConfigureSettings();
        assert.equal(ui.node('brandName').value, 'Brouillon');
        assert.equal(ui.context.configureHasChanges(), true);
        assert.equal(ui.node('save').disabled, false);
        assert.match(ui.node('save-state').textContent, /Enregistrement impossible/);
    }
});

test('configure : les frappes pendant la sauvegarde restent à enregistrer, sans double envoi', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    ui.input('brandName', 'Version envoyée');
    const pending = deferred(), bodies = [];
    ui.context.authFetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return pending.promise; };
    const saving = ui.context.saveConfigureSettings();
    assert.equal(ui.node('save').disabled, true);
    await ui.context.saveConfigureSettings();
    ui.input('brandName', 'Version encore en cours');
    pending.resolve(reply({ success: true }));
    await saving;
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].brandName, 'Version envoyée');
    assert.equal(ui.context.configureHasChanges(), true);
    assert.equal(ui.node('save').disabled, false);
    ui.context.authFetch = async () => reply({ success: true });
    await ui.context.saveConfigureSettings();
    assert.equal(ui.context.configureHasChanges(), false);
    assert.equal(ui.node('save').disabled, true);
    ui.listeners.beforeunload({ preventDefault() { assert.fail('Pas de brouillon restant'); } });
});

test('configure : l’aperçu ignore les réponses dépassées dès la nouvelle frappe', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    const pending = deferred();
    ui.context.authFetch = () => pending.promise;
    const older = ui.preview();
    ui.input('brandName', 'Nouvelle version');
    pending.resolve(reply({ html: '<h1>Ancienne version</h1>' }));
    await older;
    assert.equal(ui.node('preview').srcdoc, '');
    ui.context.authFetch = async () => reply({ html: '<h1>Nouvelle version</h1>' });
    await ui.preview();
    assert.equal(ui.node('preview').srcdoc, '<h1>Nouvelle version</h1>');
});

test('configure : une panne de l’aperçu conserve la dernière vue et le bouton Actualiser permet de réessayer', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    ui.node('preview').srcdoc = '<h1>Dernier aperçu</h1>';
    ui.context.authFetch = async () => reply({}, false);
    await ui.preview();
    assert.equal(ui.node('preview').srcdoc, '<h1>Dernier aperçu</h1>');
    assert.match(ui.node('preview-status').textContent, /indisponible/);
    ui.context.authFetch = async () => reply({ html: '<h1>Nouvel aperçu</h1>' });
    ui.context.refreshConfigurePreview(true);
    await ui.preview();
    assert.equal(ui.node('preview').srcdoc, '<h1>Nouvel aperçu</h1>');
});

test('configure : une couleur incomplète est signalée et ne peut pas être enregistrée', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    ui.input('accentColorText', '#12');
    let calls = 0;
    ui.context.authFetch = async () => { calls++; return reply({ success: true }); };
    await ui.context.saveConfigureSettings();
    assert.equal(calls, 0);
    assert.equal(ui.node('accentColorText').attributes['aria-invalid'], 'true');
    assert.equal(ui.node('accentColorText').validityReported, true);
    ui.input('accentColorText', '#123456');
    assert.equal(ui.node('accentColor').value, '#123456');
    await ui.context.saveConfigureSettings();
    assert.equal(calls, 1);
    assert.equal(ui.context.configureHasChanges(), false);
});

test('configure : une réinitialisation annulée ou refusée conserve le brouillon', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    ui.input('brandName', 'À garder');
    let calls = 0;
    ui.context.authFetch = async () => { calls++; return reply({ success: false }); };
    ui.context.confirm = () => false;
    await ui.context.resetConfigureDefaults();
    assert.equal(calls, 0);
    ui.context.confirm = () => true;
    await ui.context.resetConfigureDefaults();
    assert.equal(calls, 1);
    assert.equal(ui.node('brandName').value, 'À garder');
    assert.equal(ui.node('fields').disabled, false);
    assert.equal(ui.context.configureHasChanges(), true);
});

test('configure : réinitialisation confirmée et réussie recharge les valeurs par défaut', async () => {
    const ui = editor();
    await ui.context.loadConfigureSettings();
    ui.input('heroSubtitle', 'Texte personnalisé');
    ui.context.authFetch = async url => reply(url.endsWith('/reset') ? { success: true } : DEFAULT_CONFIGURE);
    await ui.context.resetConfigureDefaults();
    assert.equal(ui.node('heroSubtitle').value, DEFAULT_CONFIGURE.heroSubtitle);
    assert.equal(ui.node('save').disabled, true);
    assert.equal(ui.context.configureHasChanges(), false);
});
