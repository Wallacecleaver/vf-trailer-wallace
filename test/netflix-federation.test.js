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

test('resolveFederatedTrailer : transmet season + strict_season + imdb/tmdb groupés, filtre la saison et ne met pas pending en cache', async () => {
    const fetchPath = require.resolve('node-fetch');
    const fedPath = require.resolve('../lib/netflix-federation');
    const realFetch = require.cache[fetchPath];
    const seen = [];
    let responder = () => ({ found: false, trailers: [] });
    require.cache[fetchPath] = {
        id: fetchPath, filename: fetchPath, loaded: true,
        exports: async (url) => {
            seen.push(url);
            return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(responder(url)) };
        },
    };
    delete require.cache[require.resolve('../lib/security')];
    delete require.cache[fedPath];
    try {
        const fed = require('../lib/netflix-federation');

        // 1) Saison 2 stricte : envoie imdb + tmdb + season=2 + strict_season=1 en un seul appel
        responder = () => ({
            found: true,
            title: { name: 'Le Problème à 3 corps', imdb_id: 'tt13016388', tmdb_id: 108545 },
            trailers: [
                { title: 'Saison 2 (Teaser) : Le Problème à 3 corps', url: 'https://x/s2.mp4', season: 2, kind: 'teaser' },
                { title: 'Le Problème à 3 corps : Saison 1 (Dans cette saison)', url: 'https://x/s1.mp4', season: 1, kind: 'teaser' },
            ],
        });
        const s2 = await fed.resolveFederatedTrailer({
            imdbId: 'tt13016388', tmdbId: 108545, type: 'series', season: 2, strictSeason: true,
            baseUrl: 'https://netflix.exemple.fr',
        });
        assert.strictEqual(seen.length, 1);
        assert.match(seen[0], /imdb=tt13016388/);
        assert.match(seen[0], /tmdb=108545/);
        assert.match(seen[0], /season=2/);
        assert.match(seen[0], /strict_season=1/);
        assert.strictEqual(s2.found, true);
        assert.strictEqual(s2.trailers.length, 1);
        assert.strictEqual(s2.trailers[0].url, 'https://x/s2.mp4');

        // 2) Cache isolé par saison : demander la saison 3 ne réutilise pas la saison 2
        const s3 = await fed.resolveFederatedTrailer({
            imdbId: 'tt13016388', tmdbId: 108545, type: 'series', season: 3, strictSeason: true,
            baseUrl: 'https://netflix.exemple.fr',
        });
        assert.strictEqual(seen.length, 2);
        assert.strictEqual(s3.found, false);

        // 3) Réponse `pending: true` : jamais mise en cache négatif 30 min
        fed.clearCache();
        seen.length = 0;
        responder = () => ({ found: false, pending: true, trailers: [] });
        const p1 = await fed.resolveFederatedTrailer({ imdbId: 'tt9999999', baseUrl: 'https://netflix.exemple.fr' });
        assert.strictEqual(p1.found, false);
        assert.strictEqual(p1.pending, true);
        responder = () => ({ found: true, title: { imdb_id: 'tt9999999' }, trailers: [{ title: 'BA', url: 'https://x/ok.mp4' }] });
        const p2 = await fed.resolveFederatedTrailer({ imdbId: 'tt9999999', baseUrl: 'https://netflix.exemple.fr' });
        assert.strictEqual(p2.found, true);
        assert.strictEqual(seen.length, 2);
    } finally {
        if (realFetch) require.cache[fetchPath] = realFetch; else delete require.cache[fetchPath];
        delete require.cache[fedPath];
    }
});
