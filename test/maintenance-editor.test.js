const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DEFAULT_MAINTENANCE } = require('../lib/maintenance');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/12-configure.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard/pages/configure.html'), 'utf8');
const reply = (data, ok = true) => ({ ok, json: async () => data });

function editor() {
    const nodes = new Map(), listeners = {};
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
        nodes.set(id, {
            value: '', checked: false, textContent: '', disabled: false, hidden: false, events: {}, attributes: {},
            addEventListener(name, callback) { this.events[name] = callback; },
            setAttribute(name, value) { this.attributes[name] = value; },
            setCustomValidity(message) { this.validationMessage = message; },
            reportValidity() { this.validityReported = true; },
        });
    }
    const context = vm.createContext({
        URL, document: { getElementById: id => nodes.get(id) || null },
        window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
        authHeaders: extra => extra || {}, authFetch: async () => reply({ ...DEFAULT_MAINTENANCE }), toast() {},
    });
    vm.runInContext(source, context);
    context.bindMaintenanceSettings();
    const node = id => nodes.get('mnt-' + id);
    return {
        context, node, listeners,
        input(id, value) {
            const flag = typeof value === 'boolean';
            node(id)[flag ? 'checked' : 'value'] = value;
            node(id).events[flag ? 'change' : 'input']();
        },
    };
}

test('maintenance dashboard : seuls les réglages de maintenance sont proposés', async () => {
    const ui = editor();
    assert.equal(ui.node('fields').disabled, true);
    await ui.context.loadMaintenanceSettings();
    assert.equal(ui.node('fields').disabled, false);
    assert.equal(ui.node('save').disabled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(ui.context.collectMaintenancePayload())), DEFAULT_MAINTENANCE);
    assert.doesNotMatch(html, /cfg-brandName|cfg-hero|cfg-accent|iframe|Réinitialiser/);
});

test('maintenance dashboard : revenir sur l’onglet conserve le brouillon', async () => {
    const ui = editor();
    await ui.context.loadMaintenanceSettings();
    ui.input('message', 'Message non enregistré');
    let calls = 0;
    ui.context.authFetch = async () => { calls++; return reply(DEFAULT_MAINTENANCE); };
    await ui.context.loadMaintenanceSettings();
    assert.equal(calls, 0);
    assert.equal(ui.node('message').value, 'Message non enregistré');
    let prevented = false;
    ui.listeners.beforeunload({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
});

test('maintenance dashboard : aperçu immédiat en texte et indication claire du blocage', async () => {
    const ui = editor();
    await ui.context.loadMaintenanceSettings();
    ui.input('message', '<img src=x onerror=alert(1)>');
    assert.equal(ui.node('preview-message').textContent, '<img src=x onerror=alert(1)>');
    ui.input('enabled', true);
    assert.match(ui.node('preview-state').textContent, /configuration accessible/);
    assert.equal(ui.node('preview').attributes['data-mode'], 'banner');
    assert.equal(ui.node('preview-refresh').hidden, true);
    assert.equal(ui.node('preview-banner-icon').hidden, false);
    ui.input('blockInstall', true);
    assert.match(ui.node('preview-state').textContent, /configuration suspendue/);
    assert.equal(ui.node('preview').attributes['data-mode'], 'locked');
    assert.equal(ui.node('preview-mode').textContent, 'Page de maintenance');
    assert.equal(ui.node('preview-refresh').hidden, false);
    assert.equal(ui.node('preview-availability').hidden, false);
    assert.equal(ui.node('preview-banner-icon').hidden, true);
    ui.input('enabled', false);
    assert.match(ui.node('preview-state').textContent, /masqué/);
    assert.equal(ui.node('message').value, '<img src=x onerror=alert(1)>');
});

test('maintenance dashboard : chargement incomplet ou en erreur sans écraser les champs', async () => {
    const ui = editor();
    ui.context.authFetch = async () => reply({}, false);
    await ui.context.loadMaintenanceSettings();
    assert.equal(ui.node('fields').disabled, true);
    assert.equal(ui.node('retry').hidden, false);
    ui.context.authFetch = async () => reply(DEFAULT_MAINTENANCE);
    await ui.context.loadMaintenanceSettings();
    ui.context.authFetch = async () => reply({ title: 'Incomplet' });
    await ui.context.loadMaintenanceSettings();
    assert.equal(ui.node('title').value, DEFAULT_MAINTENANCE.title);
});

test('maintenance dashboard : sauvegarde refusée conserve les options et permet de réessayer', async () => {
    const ui = editor();
    await ui.context.loadMaintenanceSettings();
    ui.input('enabled', true);
    for (const response of [reply({}, false), reply({ success: false })]) {
        ui.context.authFetch = async () => response;
        await ui.context.saveMaintenanceSettings();
        assert.equal(ui.node('enabled').checked, true);
        assert.equal(ui.node('save').disabled, false);
        assert.match(ui.node('save-state').textContent, /Enregistrement impossible/);
    }
});

test('maintenance dashboard : les modifications pendant l’enregistrement restent en brouillon', async () => {
    const ui = editor();
    await ui.context.loadMaintenanceSettings();
    ui.input('title', 'Version envoyée');
    let resolve, calls = 0;
    ui.context.authFetch = () => { calls++; return new Promise(done => { resolve = done; }); };
    const saving = ui.context.saveMaintenanceSettings();
    await ui.context.saveMaintenanceSettings();
    assert.equal(calls, 1);
    ui.input('title', 'Version suivante');
    resolve(reply({ success: true }));
    await saving;
    assert.equal(ui.context.maintenanceHasChanges(), true);
    assert.equal(ui.node('save').disabled, false);
    ui.context.authFetch = async () => reply({ success: true });
    await ui.context.saveMaintenanceSettings();
    assert.equal(ui.context.maintenanceHasChanges(), false);
});

test('maintenance dashboard : un lien dangereux ou non HTTPS ne peut pas être enregistré', async () => {
    const ui = editor();
    await ui.context.loadMaintenanceSettings();
    let calls = 0;
    ui.context.authFetch = async () => { calls++; return reply({ success: true }); };
    for (const value of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/"']) {
        ui.input('linkUrl', value);
        await ui.context.saveMaintenanceSettings();
        assert.equal(calls, 0);
        assert.equal(ui.node('preview-link').hidden, true);
    }
    ui.input('linkUrl', 'https://discord.gg/KN3vRqTHDa');
    await ui.context.saveMaintenanceSettings();
    assert.equal(calls, 1);
    assert.equal(ui.node('preview-link').hidden, false);
});
