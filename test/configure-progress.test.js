const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderConfigureHtml } = require('../lib/configure-view');

const html = renderConfigureHtml({
  brandName: 'Bandes-Annonces VF',
  heroTitleWhite: 'Bandes-Annonces',
  heroTitleRed: ' VF',
  heroSubtitle: 'Bandes-annonces officielles en français',
});

const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test('Configure : le JavaScript embarqué reste syntaxiquement valide', () => {
  assert.ok(script, 'script de la page configure manquant');
  assert.doesNotThrow(() => new vm.Script(script));
});

test('Configure : sections obligatoires avant les options', () => {
  const tmdb = html.indexOf('data-step="tmdb"');
  const pseudo = html.indexOf('data-step="pseudo"');
  const tvdb = html.indexOf('Sources complémentaires');
  const links = html.indexOf('Affichage des liens');
  assert.ok(tmdb >= 0 && pseudo > tmdb && tvdb > pseudo && links > tvdb);
  assert.equal((html.match(/class="step-type">Obligatoire/g) || []).length, 2);
  assert.equal((html.match(/class="step-num optional">Option/g) || []).length, 2);
});

const fnMatch = script.match(/function computeSetupProgress\(data\) \{[\s\S]*?\n    \}/);
assert.ok(fnMatch, 'calcul de progression manquant');
const compute = vm.runInNewContext('(' + fnMatch[0] + ')');

test('Configure : 3 actions de base lorsque rien n’est rempli', () => {
  const p = compute({ pseudo: '', tmdbKey: '', tmdbValidated: false, tvdbKey: '', tvdbValidated: false });
  assert.equal(p.total, 3);
  assert.equal(p.completed, 0);
  assert.equal(p.remaining, 3);
});

test('Configure : une clé TMDB entrée mais non testée ne suffit pas', () => {
  const p = compute({ pseudo: '', tmdbKey: 'abc', tmdbValidated: false, tvdbKey: '', tvdbValidated: false });
  assert.equal(p.completed, 1);
  assert.equal(p.remaining, 2);
  assert.equal(p.steps[1].done, false);
});

test('Configure : la vérification TMDB et le pseudo rendent le lien installable', () => {
  const p = compute({ pseudo: 'Test', tmdbKey: 'abc', tmdbValidated: true, tvdbKey: '', tvdbValidated: false });
  assert.equal(p.total, 3);
  assert.equal(p.completed, 3);
  assert.equal(p.remaining, 0);
});

test('Configure : TheTVDB vide ne bloque pas, une clé renseignée exige validation', () => {
  const base = { pseudo: 'Test', tmdbKey: 'abc', tmdbValidated: true };
  const pending = compute({ ...base, tvdbKey: 'tvdbKey', tvdbValidated: false });
  assert.equal(pending.total, 4);
  assert.equal(pending.completed, 3);
  assert.equal(pending.remaining, 1);
  const valid = compute({ ...base, tvdbKey: 'tvdbKey', tvdbValidated: true });
  assert.equal(valid.remaining, 0);
});

test('Configure : le panneau comporte une barre et une checklist accessible', () => {
  assert.match(html, /id="setup-progress-track" role="progressbar"/);
  for (const id of ['tmdb-key', 'tmdb-test', 'pseudo', 'tvdb-test']) {
    assert.ok(html.includes('data-check="' + id + '"'));
  }
});
