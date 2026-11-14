// Tests du client de fédération « Netflix Catalogue » (URL seule, sans clé API).
// Lancement : npm test

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeBaseUrl, resolveFederatedTrailer, checkConnection } = require('../lib/netflix-federation');

test('normalizeBaseUrl : protocole ajouté, slash final retiré, vide conservé', () => {
    assert.strictEqual(normalizeBaseUrl(''), '');
    assert.strictEqual(normalizeBaseUrl('   '), '');
    assert.strictEqual(normalizeBaseUrl('https://netflix.exemple.fr/'), 'https://netflix.exemple.fr');
    assert.strictEqual(normalizeBaseUrl('http://192.168.1.20:7000///'), 'http://192.168.1.20:7000');
    assert.strictEqual(normalizeBaseUrl('netflix.exemple.fr'), 'https://netflix.exemple.fr');
});

test('resolveFederatedTrailer : sans URL -> source non configurée, aucun appel réseau', async () => {
    const r = await resolveFederatedTrailer({ imdbId: 'tt1234567', baseUrl: '' });
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.configured, false);
    assert.match(r.reason, /non configurée/);
});

test('resolveFederatedTrailer : sans identifiant -> rien à demander', async () => {
    const r = await resolveFederatedTrailer({ baseUrl: 'https://netflix.exemple.fr' });
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.configured, true);
    assert.match(r.reason, /Aucun identifiant/);
});

test('checkConnection : sans URL -> non configurée', async () => {
    const r = await checkConnection('');
    assert.strictEqual(r.configured, false);
    assert.strictEqual(r.ok, false);
});
