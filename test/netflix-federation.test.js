// Tests de la source Netflix fédérée (lib/netflix-federation.js) : appel de l'API amont,
// authentification, repli IMDb -> TMDB, erreurs, délai maximal, cache et diagnostic.
// Aucun accès réseau réel : faux serveur local.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fed = require('../lib/netflix-federation');

let server, base;
let mode = 'found';
let hits = [];
let statusVersion = '1.2.0';

before(async () => {
    server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        hits.push({
            path: u.pathname,
            query: Object.fromEntries(u.searchParams),
            key: req.headers['x-api-key'] || null,
        });

        if (u.pathname === '/api/status') {
            if (mode === 'unauthorized') { res.writeHead(401); return res.end(); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, version: statusVersion, stats: { total: 10 } }));
        }
        if (u.pathname !== '/api/trailers') { res.writeHead(404); return res.end(); }

        if (mode === 'unauthorized') { res.writeHead(401); return res.end('nope'); }
        if (mode === 'error') { res.writeHead(500); return res.end('nope'); }
        if (mode === 'slow') return; // ne répond jamais : le client doit abandonner
        if (mode === 'badjson') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{oups');
        }
        if (mode === 'notrailer') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ found: false, title: { id: 'nflx:1', name: 'Film amont' }, trailers: [] }));
        }
        if (mode === 'imdb-miss' && u.searchParams.get('imdb')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ found: false, trailers: [] }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            found: true,
            title: { id: 'nflx:1', name: 'Film amont', type: 'movie' },
            trailers: [
                { title: 'Bande-annonce', url: `${base}/trailer/81944880/0.mp4`, runtime: 120, source: 'netflix' },
                { title: 'Teaser', url: 'javascript:alert(1)' },              // schéma refusé
                { title: '  ', url: 'https://cdn.example/trailer/2.mp4' },     // titre vide -> libellé par défaut
            ],
        }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    delete process.env.NETFLIX_FEDERATION_URL;
    delete process.env.NETFLIX_FEDERATION_API_KEY;
    delete process.env.NETFLIX_FEDERATION_TIMEOUT_MS;
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
});

beforeEach(() => {
    mode = 'found';
    hits = [];
    statusVersion = '1.2.0';
    process.env.NETFLIX_FEDERATION_URL = base; // sans slash final
    process.env.NETFLIX_FEDERATION_API_KEY = 'secret';
    process.env.NETFLIX_FEDERATION_TIMEOUT_MS = '2000';
    fed._caches.cache.clear();
});

test('non configurée : aucun appel réseau, raison explicite', async () => {
    delete process.env.NETFLIX_FEDERATION_URL;
    const r = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567' });
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.configured, false);
    assert.match(r.reason, /NETFLIX_FEDERATION_URL/);
    assert.strictEqual(hits.length, 0);
});

test('lookup IMDb : en-tête x-api-key, URLs filtrées, libellé par défaut', async () => {
    process.env.NETFLIX_FEDERATION_URL = `${base}/`; // le slash final doit être retiré
    const r = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567', tmdbId: 12345, type: 'movie' });
    assert.strictEqual(r.found, true);
    assert.strictEqual(r.title.name, 'Film amont');
    assert.strictEqual(r.trailers.length, 2, 'URL javascript: refusée');
    assert.strictEqual(r.trailers[0].url, `${base}/trailer/81944880/0.mp4`);
    assert.strictEqual(r.trailers[0].source, 'netflix_federation');
    assert.strictEqual(r.trailers[1].title, 'Bande-annonce', 'titre vide remplacé');
    assert.strictEqual(hits.length, 1, 'IMDb trouvé : pas de second appel TMDB');
    assert.deepStrictEqual(hits[0].query, { imdb: 'tt1234567' });
    assert.strictEqual(hits[0].key, 'secret');
});

test('repli IMDb -> TMDB + type quand l\'amont ne connaît pas l\'IMDb', async () => {
    mode = 'imdb-miss';
    const r = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567', tmdbId: 12345, type: 'series' });
    assert.strictEqual(r.found, true);
    assert.strictEqual(hits.length, 2);
    assert.deepStrictEqual(hits[1].query, { tmdb: '12345', type: 'series' });
    assert.strictEqual(hits[1].key, 'secret');
});

test('fiche amont sans bande-annonce : pas de second appel, résultat mémorisé', async () => {
    mode = 'notrailer';
    const r = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567', tmdbId: 12345, type: 'movie' });
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.title.name, 'Film amont');
    assert.match(r.reason, /sans bande-annonce/);
    assert.strictEqual(hits.length, 1, 'inutile d\'essayer le TMDB : la fiche existe déjà');

    const again = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567', tmdbId: 12345, type: 'movie' });
    assert.strictEqual(again.found, false);
    assert.strictEqual(hits.length, 1, 'échec servi depuis le cache');
});

test('clé refusée : raison lisible et échec mis en cache', async () => {
    mode = 'unauthorized';
    const r = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567' });
    assert.strictEqual(r.found, false);
    assert.match(r.reason, /clé API/);
    assert.strictEqual(hits.length, 1);

    await fed.resolveFederatedTrailer({ imdbId: 'tt1234567' });
    assert.strictEqual(hits.length, 1, 'pas de nouvel appel pendant la durée du cache d\'échec');
});

test('erreur HTTP 500 et JSON invalide -> pas trouvé, jamais d\'exception', async () => {
    mode = 'error';
    let r = await fed.resolveFederatedTrailer({ imdbId: 'tt1111111' });
    assert.strictEqual(r.found, false);
    assert.match(r.reason, /HTTP 500/);

    fed._caches.cache.clear();
    mode = 'badjson';
    r = await fed.resolveFederatedTrailer({ imdbId: 'tt2222222' });
    assert.strictEqual(r.found, false);
    assert.match(r.reason, /JSON/);
});

test('délai maximal : répond « pas trouvé » sans rester bloqué', async () => {
    mode = 'slow';
    process.env.NETFLIX_FEDERATION_TIMEOUT_MS = '100';
    const t0 = Date.now();
    const r = await fed.resolveFederatedTrailer({ imdbId: 'tt1234567' });
    const elapsed = Date.now() - t0;
    assert.strictEqual(r.found, false);
    assert.match(r.reason, /délai/);
    assert.ok(elapsed < 1500, `abandon trop lent (${elapsed} ms)`);
});

test('cache des succès : un seul appel pour deux résolutions', async () => {
    await fed.resolveFederatedTrailer({ imdbId: 'tt1234567' });
    await fed.resolveFederatedTrailer({ imdbId: 'tt1234567' });
    assert.strictEqual(hits.length, 1);
});

test('checkConnection : non configurée, joignable, ou en erreur', async () => {
    delete process.env.NETFLIX_FEDERATION_URL;
    let r = await fed.checkConnection();
    assert.strictEqual(r.configured, false);
    assert.strictEqual(r.ok, null);

    process.env.NETFLIX_FEDERATION_URL = base;
    r = await fed.checkConnection();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.version, '1.2.0');
    assert.strictEqual(hits.at(-1).path, '/api/status');
    assert.strictEqual(hits.at(-1).key, 'secret');

    mode = 'unauthorized';
    r = await fed.checkConnection();
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /HTTP 401/);
});
