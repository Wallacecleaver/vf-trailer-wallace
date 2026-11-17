const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/14-aiom.js'), 'utf8');
function dashboard(clipboard = true) {
    const nodes = new Map(), copied = [], messages = [];
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { value: '', href: '', focus() { this.focused = true; }, select() { this.selected = true; } });
        return nodes.get(id);
    };
    const context = vm.createContext({
        window: { location: { origin: 'https://addon.example' } },
        document: { getElementById: node, execCommand: () => true },
        navigator: { clipboard: clipboard ? { writeText: async text => copied.push(text) } : undefined },
        toast: text => messages.push(text),
    });
    vm.runInContext(script, context);
    return { context, node, copied, messages };
}

test('onglet AIOM : lien fixe sans clé ni requête réseau', () => {
    const ui = dashboard();
    ui.context.loadAiomSettings();
    assert.equal(ui.node('aiom-manifest-url').value, 'https://addon.example/aiom/manifest.json');
    assert.equal(ui.node('aiom-open').href, 'https://addon.example/aiom/manifest.json');
});

test('onglet AIOM : copie du lien complet', async () => {
    const ui = dashboard();
    await ui.context.copyAiomManifest();
    assert.deepEqual(ui.copied, ['https://addon.example/aiom/manifest.json']);
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
