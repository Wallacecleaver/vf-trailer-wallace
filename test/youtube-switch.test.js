// Tests de l'interrupteur général YouTube (réglage youtubeEnabled) dans la chaîne de résolution.
// Tout le réseau est simulé : on remplace net / allocine / fédération / recherche YouTube avant
// de charger resolve-apis. Lancement : npm test

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const lib = name => path.join(__dirname, '..', 'lib', name + '.js');
const stub = (name, exports) => {
    require.cache[lib(name)] = { id: lib(name), filename: lib(name), loaded: true, exports };
};

const calls = { urls: [], order: [], allocine: 0, federation: 0, youtubeSearch: 0 };
let tmdbHasTrailer = true;

const json = body => ({ json: async () => body });
stub('net', {
    fetchT: async url => {
        calls.urls.push(url);
        if (url.includes('/find/')) return json({ movie_results: [{ id: 42, title: 'Film Test' }] });
        if (url.includes('/alternative_titles')) return json({ titles: [] });
        if (url.includes('/videos')) {
            return json({ results: tmdbHasTrailer ? [{ site: 'YouTube', type: 'Trailer', name: 'Film Test - Bande-annonce VF', key: 'abcdefghijk', official: true, published_at: '2026-01-01' }] : [] });
        }
        return json({ title: 'Film Test', original_title: 'Film Test', release_date: '2026-01-01' });
    },
});
stub('allocine', { getAllocineTrailerStreams: async () => { calls.order.push('allocine'); calls.allocine++; return []; } });
stub('netflix-federation', {
    resolveFederatedTrailer: async () => {
        calls.order.push('netflix');
        calls.federation++;
        return { found: true, title: { name: 'Film Test' }, trailers: [{ title: 'Trailer', url: 'https://netflix.exemple.fr/trailer/1.mp4' }] };
    },
});
stub('youtube-search', { searchYoutubeTrailer: async () => { calls.order.push('youtube'); calls.youtubeSearch++; return { videoId: 'zzzzzzzzzzz' }; } });

const { resolveViaApis } = require('../lib/resolve-apis');
const { DEFAULT_BEHAVIOR } = require('../lib/settings');

const reset = () => { calls.urls = []; calls.order = []; calls.allocine = 0; calls.federation = 0; calls.youtubeSearch = 0; tmdbHasTrailer = true; };
const behavior = extra => ({ ...DEFAULT_BEHAVIOR, netflixCatalogueUrl: 'https://netflix.exemple.fr', ...extra });

test('YouTube activé (défaut) : TMDB fournit la bande-annonce YouTube, Netflix jamais consulté', async () => {
    reset();
    assert.strictEqual(DEFAULT_BEHAVIOR.youtubeEnabled, true);
    const r = await resolveViaApis('movie', 'tt1234567', null, behavior(), 'KEY');
    assert.strictEqual(r.source, 'tmdb');
    assert.strictEqual(r.streams[0].ytId, 'abcdefghijk');
    assert.strictEqual(calls.federation, 0);
});

test('YouTube désactivé : aucune vidéo TMDB demandée, pas de recherche YouTube, repli sur Stockage BD', async () => {
    reset();
    const trace = [];
    const r = await resolveViaApis('movie', 'tt1234567', null, behavior({ youtubeEnabled: false }), 'KEY', trace);
    assert.strictEqual(r.source, 'netflix_catalogue');
    assert.ok(r.streams.length > 0 && r.streams.every(s => !s.ytId && /^https:\/\/netflix\.exemple\.fr/.test(s.url)));
    assert.strictEqual(calls.urls.filter(u => u.includes('/videos')).length, 0, 'aucune requête /videos');
    assert.strictEqual(calls.youtubeSearch, 0);
    assert.strictEqual(calls.allocine, 1, 'Allociné est consulté après YouTube');
    assert.strictEqual(calls.federation, 1);
    assert.deepStrictEqual(calls.order, ['allocine', 'netflix']);
    assert.ok(trace.some(t => t.step === 'tmdb-videos' && /YouTube désactivé/.test(t.detail)));
});

test('YouTube désactivé et rien ailleurs : liste vide, jamais de recherche YouTube', async () => {
    reset();
    stub('netflix-federation', { resolveFederatedTrailer: async () => { calls.federation++; return { found: false, reason: 'rien' }; } });
    delete require.cache[lib('resolve-apis')];
    const { resolveViaApis: fresh } = require('../lib/resolve-apis');
    const r = await fresh('movie', 'tt1234567', null, behavior({ youtubeEnabled: false }), 'KEY');
    assert.deepStrictEqual(r.streams, []);
    assert.strictEqual(calls.youtubeSearch, 0);
});


test('Sans bande-annonce TMDB : recherche YouTube avant Allociné et Stockage BD', async () => {
    reset();
    tmdbHasTrailer = false;
    const r = await resolveViaApis('movie', 'tt1234567', null, behavior(), 'KEY');
    assert.strictEqual(r.source, 'youtube_search');
    assert.strictEqual(r.streams[0].ytId, 'zzzzzzzzzzz');
    assert.deepStrictEqual(calls.order, ['youtube'], 'les sources suivantes ne sont pas consultées si YouTube trouve une vidéo');
    assert.strictEqual(calls.allocine, 0);
    assert.strictEqual(calls.federation, 0);
});

test('Recherche YouTube indépendante du réglage de repli Allociné', async () => {
    reset();
    tmdbHasTrailer = false;
    const r = await resolveViaApis('movie', 'tt1234567', null, behavior({ allocineFallback: false }), 'KEY');
    assert.strictEqual(r.source, 'youtube_search');
    assert.deepStrictEqual(calls.order, ['youtube']);
});

test('Saison >= 2 absente de TMDB : interroge Stockage BD (strictSeason) avant la BA globale Saison 1 de TMDB', async () => {
    reset();
    const fedCalls = [];
    stub('net', {
        fetchT: async url => {
            calls.urls.push(url);
            if (url.includes('/find/')) return json({ tv_results: [{ id: 108545, name: 'Le Problème à 3 corps' }] });
            if (url.includes('/alternative_titles')) return json({ results: [] });
            if (url.includes('/watch/providers')) return json({ results: {} });
            if (url.includes('/season/2/videos')) return json({ results: [] }); // rien sur TMDB pour la S2
            if (url.includes('/season/1/videos')) {
                return json({ results: [{ site: 'YouTube', type: 'Trailer', name: 'Le Problème à 3 corps - Bande-annonce VF', key: 's1youtube00', iso_639_1: 'fr', official: true, published_at: '2024-03-01' }] });
            }
            if (url.includes('/videos')) {
                return json({ results: [{ site: 'YouTube', type: 'Trailer', name: 'Le Problème à 3 corps | Bande-annonce finale VF', key: 's1global000', iso_639_1: 'fr', official: true, published_at: '2024-03-01' }] });
            }
            return json({ name: 'Le Problème à 3 corps', original_name: '3 Body Problem', first_air_date: '2024-03-21', networks: [{ name: 'Netflix' }] });
        },
    });
    stub('netflix-federation', {
        resolveFederatedTrailer: async opts => {
            fedCalls.push(opts);
            if (opts.strictSeason && opts.season === 2) {
                return {
                    found: true,
                    title: { name: 'Le Problème à 3 corps' },
                    trailers: [{ title: 'Saison 2 (Teaser) : Le Problème à 3 corps', url: 'https://netflix.exemple.fr/trailer/81024821/0.mp4', season: 2, kind: 'teaser' }],
                };
            }
            return { found: false, reason: 'aucune vidéo pour cette saison' };
        },
    });
    delete require.cache[lib('tmdb')];
    delete require.cache[lib('resolve-apis')];
    const { resolveViaApis: fresh } = require('../lib/resolve-apis');

    // Saison 1 : utilise TMDB normalement sans interroger Stockage BD
    const s1 = await fresh('series', 'tt13016388', 1, behavior(), 'KEY');
    assert.strictEqual(s1.source, 'tmdb');
    assert.strictEqual(s1.streams[0].ytId, 's1youtube00');
    assert.strictEqual(fedCalls.length, 0);

    // Saison 2 : TMDB S2 est vide -> récupère le Teaser Saison 2 sur Stockage BD au lieu de la BA globale S1
    const s2 = await fresh('series', 'tt13016388', 2, behavior(), 'KEY');
    assert.strictEqual(s2.source, 'netflix_catalogue');
    assert.strictEqual(s2.platform, 'netflix');
    assert.strictEqual(fedCalls.length, 1);
    assert.strictEqual(fedCalls[0].strictSeason, true);
    assert.strictEqual(fedCalls[0].season, 2);
    assert.strictEqual(s2.streams[0].url, 'https://netflix.exemple.fr/trailer/81024821/0.mp4');
    assert.strictEqual(s2.streams[0].title, 'Teaser\nLe Problème à 3 corps (Saison 2)');

    // Saison 3 (pas de teaser sur Stockage BD non plus) : retombe proprement sur la BA globale TMDB
    const s3 = await fresh('series', 'tt13016388', 3, behavior(), 'KEY');
    assert.strictEqual(s3.source, 'tmdb');
    assert.strictEqual(s3.streams[0].ytId, 's1global000');
});
