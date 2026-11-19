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
let storedTrailers = [{ title: 'Trailer', url: 'https://netflix.exemple.fr/trailer/1.mp4' }];

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
        return { found: true, title: { name: 'Film Test' }, trailers: storedTrailers };
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

test('Stockage BD : français prioritaire, VO écartée et langue inconnue signalée', async () => {
    reset();
    const initial = storedTrailers;
    storedTrailers = [
        { title: 'Trailer', url: 'https://netflix.exemple.fr/unknown.mp4' },
        { title: 'Bande-annonce VF', lang: 'en-US', url: 'https://netflix.exemple.fr/english.mp4' },
        { title: 'Bande-annonce VO', url: 'https://netflix.exemple.fr/vo.mp4' },
        { title: 'Bande-annonce', lang: 'fr-FR', url: 'https://netflix.exemple.fr/french.mp4' },
    ];
    try {
        const common = { youtubeEnabled: false, maxTrailers: 4 };
        const preferred = await resolveViaApis('movie', 'tt1234567', null, behavior(common), 'KEY');
        assert.deepStrictEqual(preferred.streams.map(s => s.url.split('/').at(-1)), ['french.mp4', 'unknown.mp4']);
        assert.strictEqual(preferred.streams[1].__unverifiedAudio, true);
        const strict = await resolveViaApis('movie', 'tt1234567', null, behavior({ ...common, trailerLanguage: 'fr-only' }), 'KEY');
        assert.deepStrictEqual(strict.streams, [preferred.streams[0]]);
    } finally {
        storedTrailers = initial;
    }
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

test('Saison >= 2 absente de TMDB : mapping strict (rejette la BA globale Saison 1) + Stockage BD + teaser de secours si ignoreTeasers', async () => {
    reset();
    const fedCalls = [];
    const ytQueries = [];
    let globalHasSeason3 = false;
    let youtubeHasSeason2Trailer = false;

    stub('net', {
        fetchT: async url => {
            calls.urls.push(url);
            if (url.includes('/find/')) return json({ tv_results: [{ id: 108545, name: 'Le Problème à 3 corps' }] });
            if (url.includes('/alternative_titles')) return json({ results: [] });
            if (url.includes('/watch/providers')) return json({ results: {} });
            if (url.includes('/season/2/videos') || url.includes('/season/3/videos')) return json({ results: [] });
            if (url.includes('/season/1/videos')) {
                return json({ results: [{ site: 'YouTube', type: 'Trailer', name: 'Le Problème à 3 corps - Bande-annonce VF', key: 's1youtube00', iso_639_1: 'fr', official: true, published_at: '2024-03-01' }] });
            }
            if (url.includes('/videos')) {
                const list = [
                    { site: 'YouTube', type: 'Trailer', name: 'Le Problème à 3 corps | Bande-annonce finale VF', key: 's1global000', iso_639_1: 'fr', official: true, published_at: '2024-03-01' },
                ];
                if (globalHasSeason3) {
                    list.push({ site: 'YouTube', type: 'Trailer', name: 'Le Problème à 3 corps : Saison 3 | Bande-annonce officielle VF', key: 's3global000', iso_639_1: 'fr', official: true, published_at: '2027-03-01' });
                }
                return json({ results: list });
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
    stub('youtube-search', {
        searchYoutubeTrailer: async (query, ref, opts) => {
            ytQueries.push({ query, year: ref.year, season: opts.season });
            if (youtubeHasSeason2Trailer && opts.season === 2) {
                return { videoId: 's2ytfull000', title: 'Le Problème à 3 corps - Saison 2 | Bande-annonce VF', channel: 'Netflix France' };
            }
            return null;
        },
    });
    delete require.cache[lib('tmdb')];
    delete require.cache[lib('resolve-apis')];
    const { resolveViaApis: fresh } = require('../lib/resolve-apis');

    // 1. Saison 1 : utilise TMDB normalement sans interroger Stockage BD
    const s1 = await fresh('series', 'tt13016388', 1, behavior(), 'KEY');
    assert.strictEqual(s1.source, 'tmdb');
    assert.strictEqual(s1.streams[0].ytId, 's1youtube00');
    assert.strictEqual(fedCalls.length, 0);

    // 2. Saison 2 (ignoreTeasers: false) : récupère directement le Teaser Saison 2 sur Stockage BD
    const s2 = await fresh('series', 'tt13016388', 2, behavior({ ignoreTeasers: false }), 'KEY');
    assert.strictEqual(s2.source, 'netflix_catalogue');
    assert.strictEqual(s2.platform, 'netflix');
    assert.strictEqual(fedCalls.length, 1);
    assert.strictEqual(fedCalls[0].strictSeason, true);
    assert.strictEqual(fedCalls[0].season, 2);
    assert.strictEqual(s2.streams[0].url, 'https://netflix.exemple.fr/trailer/81024821/0.mp4');
    assert.strictEqual(s2.streams[0].title, 'Teaser\nLe Problème à 3 corps (Saison 2)');

    // 3. Saison 2 avec ignoreTeasers: true (cas réel du dashboard) :
    //    - rejette la BA globale Saison 1 (`s1global000`, qui ne mentionne pas « Saison 2 »)
    //    - cherche une vraie BA « saison 2 » sur YouTube (sans l'année 2024 de la S1)
    //    - comme aucune BA complète S2 n'existe encore, restitue le Teaser S2 de Stockage BD en secours !
    const traceS2 = [];
    const s2NoTeaser = await fresh('series', 'tt13016388', 2, behavior({ ignoreTeasers: true, includeExtras: true }), 'KEY', traceS2);
    assert.strictEqual(s2NoTeaser.source, 'netflix_catalogue');
    assert.strictEqual(s2NoTeaser.streams.length, 1);
    assert.strictEqual(s2NoTeaser.streams[0].url, 'https://netflix.exemple.fr/trailer/81024821/0.mp4');
    assert.strictEqual(s2NoTeaser.streams[0].title, 'Teaser\nLe Problème à 3 corps (Saison 2)');
    assert.ok(ytQueries.some(q => q.query === 'Le Problème à 3 corps saison 2 bande annonce VF' && q.year === null && q.season === 2));
    assert.strictEqual(calls.allocine, 0, 'Allociné ne doit pas être appelé sur une saison >= 2');
    assert.ok(traceS2.some(t => t.step === 'tmdb-videos' && /saison 2 absente du titre/.test(t.detail)));
    assert.ok(traceS2.some(t => t.step === 'teaser-secours'));

    // 4. Saison 2 avec ignoreTeasers: true MAIS une vraie BA Saison 2 existe sur YouTube :
    //    la vraie BA gagne et le teaser de secours est bien ignoré !
    youtubeHasSeason2Trailer = true;
    const s2WithFull = await fresh('series', 'tt13016388', 2, behavior({ ignoreTeasers: true }), 'KEY');
    assert.strictEqual(s2WithFull.source, 'youtube_search');
    assert.strictEqual(s2WithFull.streams.length, 1);
    assert.strictEqual(s2WithFull.streams[0].ytId, 's2ytfull000');
    youtubeHasSeason2Trailer = false;

    // 5. Saison 3 inexistante partout : NE SERT JAMAIS la BA globale Saison 1 (`s1global000`) !
    const s3Empty = await fresh('series', 'tt13016388', 3, behavior(), 'KEY');
    assert.deepStrictEqual(s3Empty.streams, []);

    // 6. Saison 3 présente dans les vidéos globales TMDB avec « Saison 3 » explicite dans le titre : retenue !
    globalHasSeason3 = true;
    const s3Global = await fresh('series', 'tt13016388', 3, behavior(), 'KEY');
    assert.strictEqual(s3Global.source, 'tmdb');
    assert.strictEqual(s3Global.streams[0].ytId, 's3global000');
});
