// Tests du client de fédération « Stockage BD » (URL seule, sans clé API).
// Lancement : npm test

const { test } = require('node:test');
const assert = require('node:assert');
// Domaine factice + fetch simulé : on désactive le garde-fou anti-SSRF (activé en production).
process.env.ALLOW_PRIVATE_UPSTREAM = '1';
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

// La clé API de l'instance amont part en en-tête x-api-key, et rien n'est envoyé sans clé.
test('resolveFederatedTrailer : la clé part en x-api-key (absente si aucune clé)', async () => {
    const fetchPath = require.resolve('node-fetch');
    const fedPath = require.resolve('../lib/netflix-federation');
    const realFetch = require.cache[fetchPath];
    const seen = [];
    require.cache[fetchPath] = {
        id: fetchPath, filename: fetchPath, loaded: true,
        exports: async (url, opts) => {
            seen.push({ url, headers: (opts && opts.headers) || {} });
            return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ found: true, trailers: [{ url: 'https://x/y.mp4' }] }) };
        },
    };
    delete require.cache[require.resolve('../lib/security')];
    delete require.cache[fedPath];
    try {
        const fed = require('../lib/netflix-federation');

        await fed.resolveFederatedTrailer({ imdbId: 'tt1111111', baseUrl: 'https://netflix.exemple.fr', apiKey: 'cle-secrete' });
        assert.strictEqual(seen[0].headers['x-api-key'], 'cle-secrete');

        fed.clearCache();
        seen.length = 0;
        await fed.resolveFederatedTrailer({ imdbId: 'tt2222222', baseUrl: 'https://netflix.exemple.fr' });
        assert.strictEqual(seen[0].headers['x-api-key'], undefined);
    } finally {
        if (realFetch) require.cache[fetchPath] = realFetch; else delete require.cache[fetchPath];
        delete require.cache[fedPath];
    }
});
