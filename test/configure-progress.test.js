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

test('Configure : pseudo en premier, clés API regroupées avant les options', () => {
  const sections = [...html.matchAll(/<section class="config-card"[^>]*>[\s\S]*?<\/section>/g)].map(match => match[0]);
  assert.equal(sections.length, 3);
  const [profile, keys, options] = sections;
  assert.match(profile, /data-step="pseudo"/);
  assert.match(profile, /id="step-pseudo-badge">1</);
  assert.match(profile, /id="cfg-pseudo"/);
  assert.match(keys, /id="step-tmdb-badge">2</);
  assert.match(keys, /id="cfg-tmdbkey"/);
  assert.match(keys, /id="cfg-tvdbkey"/);
  assert.match(keys, /Ta clé API TheTVDB \(facultatif\)/);
  assert.match(options, /Affichage des liens/);
  assert.equal((html.match(/class="step-type">Obligatoire/g) || []).length, 2);
  assert.equal((html.match(/class="step-num optional">Option/g) || []).length, 1);
});

const fnMatch = script.match(/function computeSetupProgress\(data\) \{[\s\S]*?\n    \}/);
assert.ok(fnMatch, 'calcul de progression manquant');
const compute = vm.runInNewContext('(' + fnMatch[0] + ')');

test('Configure : 3 actions de base lorsque rien n’est rempli', () => {
  const p = compute({ pseudo: '', tmdbKey: '', tmdbValidated: false, tvdbKey: '', tvdbValidated: false });
  assert.equal(p.total, 3);
  assert.equal(p.completed, 0);
  assert.equal(p.remaining, 3);
  assert.equal(p.steps.find(step => !step.done).field, 'cfg-pseudo');
});

test('Configure : une clé TMDB entrée mais non testée ne suffit pas', () => {
  const p = compute({ pseudo: '', tmdbKey: 'abc', tmdbValidated: false, tvdbKey: '', tvdbValidated: false });
  assert.equal(p.completed, 1);
  assert.equal(p.remaining, 2);
  assert.equal(p.steps.find(step => step.id === 'tmdb-test').done, false);
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
  const checklist = [...html.matchAll(/data-check="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(checklist, ['pseudo', 'tmdb-key', 'tmdb-test', 'tvdb-test']);
});

test('Configure : TheTVDB reste affiché dans les étapes même si aucune clé n’est donnée', () => {
  assert.match(html, /data-check="tvdb-test" class="is-optional"/);
  assert.doesNotMatch(html, /data-check="tvdb-test" hidden/);
  assert.match(script, /if \(item\.dataset\.check === 'tvdb-test' && !step\)/);
  assert.match(html, /TheTVDB — clé facultative, à renseigner ou ignorer/);
});

test('Configure : retire le long avertissement sous la clé TheTVDB', () => {
  assert.doesNotMatch(html, /Garde ce lien privé : elle n'est pas enregistrée/);
  assert.doesNotMatch(html, /La clé est intégrée au lien d'installation Stremio/);
});
