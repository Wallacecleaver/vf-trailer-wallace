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

test('YouTube désactivé : aucune vidéo TMDB demandée, pas de recherche YouTube, repli sur Netflix Catalogue', async () => {
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


test('Sans bande-annonce TMDB : recherche YouTube avant Allociné et Netflix Catalogue', async () => {
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
