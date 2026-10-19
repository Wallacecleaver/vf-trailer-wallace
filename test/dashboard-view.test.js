const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderDashboardShell, PAGES, SCRIPTS } = require('../lib/dashboard-view');

const DIR = path.join(__dirname, '..', 'dashboard');
const html = renderDashboardShell();

test('dashboard : aucun repère {{...}} ne reste dans la page générée', () => {
    assert.ok(!/\{\{(css|pages|js)\}\}/.test(html));
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.trimEnd().endsWith('</html>'));
});

test('dashboard : chaque page déclarée est présente (id="page-...")', () => {
    for (const p of PAGES) {
        const marker = fs.readFileSync(path.join(DIR, 'pages', `${p}.html`), 'utf8').match(/id="(page-[a-z-]+)"/);
        assert.ok(marker, `pages/${p}.html doit contenir un id="page-..."`);
        assert.ok(html.includes(`id="${marker[1]}"`), `${marker[1]} absent de la page générée`);
    }
});

test('dashboard : tous les fichiers du dossier sont listés (rien d\'oublié)', () => {
    const onDisk = (dir, ext) => fs.readdirSync(path.join(DIR, dir)).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).sort();
    assert.deepStrictEqual(onDisk('pages', '.html'), [...PAGES].sort(), 'pages/*.html et PAGES (lib/dashboard-view.js) divergent');
    assert.deepStrictEqual(onDisk('js', '.js'), [...SCRIPTS].sort(), 'js/*.js et SCRIPTS (lib/dashboard-view.js) divergent');
});

test('dashboard : le JavaScript assemblé est syntaxiquement valide', () => {
    const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(js));
});

test('dashboard : chaque fichier JS est lisible seul (pas de coupure en plein milieu d\'une fonction)', () => {
    for (const s of SCRIPTS) {
        const code = fs.readFileSync(path.join(DIR, 'js', `${s}.js`), 'utf8');
        assert.doesNotThrow(() => new Function(code), `js/${s}.js n'est pas valide seul`);
    }
});
