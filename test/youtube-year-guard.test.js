const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CHANNELS, VOD_CHANNELS } = require('../lib/youtube-channels');
const {
    buildRef, matchVideoTitle, videoYearMismatch, publishedYearsAgo, videoTooOld,
    evaluateVideoResult, pickBestVideoResult,
} = require('../lib/title-match');

const now = new Date('2026-11-17T12:00:00Z');
const ref = (title = 'Lucky', year = 2026) => buildRef({ allTitles: [title], year });
const old = { videoId: 'old', title: 'LUCKY Bande Annonce VF (2020)', published: 'il y a 6 ans' };
const current = { videoId: 'current', title: 'Lucky - Bande-annonce VF (2026) | Apple TV+', published: 'il y a 2 semaines', channel: 'Apple TV France', channelId: CHANNELS.apple[0].id };

test('année YouTube : homonyme 2020 rejeté pour 2026 uniquement avec checkYear', () => {
    assert.deepEqual(matchVideoTitle(old.title, ref(), { checkYear: true }), {
        matches: false, score: 0, rank: 0, tier: 'annee-differente', videoYear: 2020,
    });
    assert.equal(matchVideoTitle(old.title, ref()).matches, true);
    assert.equal(videoYearMismatch(old.title, ref()), 2020);
});

test('année YouTube : tolérance ±1, année absente ou inconnue et années multiples', () => {
    for (const title of ['Lucky - VF (2025)', 'Lucky - VF (2026)', 'Lucky - VF (2027)', 'Lucky - VF', 'Lucky - VF 2020 / 2026']) {
        assert.equal(videoYearMismatch(title, ref()), null, title);
        assert.equal(matchVideoTitle(title, ref(), { checkYear: true }).matches, true, title);
    }
    assert.equal(videoYearMismatch(old.title, ref('Lucky', null)), null);
    assert.equal(matchVideoTitle(old.title, ref('Lucky', null), { checkYear: true }).matches, true);
});

test('année YouTube : Blade Runner 2049 et 1917 ne sont pas des dates de sortie', () => {
    for (const [title, year] of [['Blade Runner 2049', 2017], ['1917', 2019]]) {
        const reference = ref(title, year);
        for (const videoTitle of [title + ' - Bande-annonce VF', title + ' - Bande-annonce VF (' + year + ')']) {
            assert.equal(videoYearMismatch(videoTitle, reference), null);
            assert.equal(matchVideoTitle(videoTitle, reference, { checkYear: true }).matches, true);
        }
        assert.equal(videoYearMismatch(title + ' - Bande-annonce VF (2010)', reference), 2010);
    }
});

test('publication YouTube : années françaises et anglaises, autres durées inconnues', () => {
    assert.equal(publishedYearsAgo('il y a 6 ans'), 6);
    assert.equal(publishedYearsAgo('Diffusée il y a 1 an'), 1);
    assert.equal(publishedYearsAgo('6 years ago'), 6);
    assert.equal(publishedYearsAgo('Streamed 1 year ago'), 1);
    for (const value of ['il y a 6 mois', 'il y a 2 semaines', 'Hier', '', null, undefined]) {
        assert.equal(publishedYearsAgo(value), null);
    }
});

test('publication YouTube : rejet seulement avant sortie moins deux ans, date injectée', () => {
    assert.equal(videoTooOld('il y a 2 ans', 2026, now), false);
    assert.equal(videoTooOld('il y a 3 ans', '2026', now), true);
    assert.equal(videoTooOld('il y a 6 ans', null, now), false);
    assert.equal(videoTooOld(null, 2026, now), false);
    assert.equal(videoTooOld('il y a 6 ans', 2026, new Date('invalide')), false);
    assert.equal(videoTooOld('il y a 3 ans', 2026, new Date('2030-11-17T12:00:00Z')), false);
});

test('évaluation YouTube : raisons françaises pour année, suite, ancienneté et titre différent', () => {
    assert.deepEqual(evaluateVideoResult(old, ref(), { now }), { ok: false, reason: 'année 2020 ≠ 2026' });
    assert.deepEqual(evaluateVideoResult({ title: 'Lucky 2 - Bande-annonce VF' }, ref(), { now }), { ok: false, reason: 'autre numéro de suite' });
    assert.deepEqual(evaluateVideoResult({ title: 'Autre film - Bande-annonce VF' }, ref(), { now }), { ok: false, reason: 'titre différent' });
    assert.deepEqual(evaluateVideoResult({ title: 'Lucky - Bande-annonce VF', published: 'il y a 6 ans' }, ref(), { now }), {
        ok: false, reason: 'publiée il y a 6 ans (bien avant la sortie en 2026)',
    });
    const valid = evaluateVideoResult(current, ref(), { now });
    assert.equal(valid.ok, true);
    assert.ok(Number.isFinite(valid.rank) && valid.rank > 0);
});

test('sélection YouTube : bonne série 2026 choisie, homonyme 2020 expliqué', () => {
    const rejected = [];
    assert.equal(pickBestVideoResult([old, current], ref(), null, { rejected, now }), current);
    assert.deepEqual(rejected, [{ title: old.title, reason: 'année 2020 ≠ 2026' }]);
    assert.equal(pickBestVideoResult([old], ref(), null, { now }), null);
});

test('sélection YouTube : publication ancienne sans année rejetée, dates inconnues conservées', () => {
    const video = { title: 'Lucky - Bande-annonce VF', published: 'il y a 6 ans' };
    const rejected = [];
    assert.equal(pickBestVideoResult([video], ref(), null, { rejected, now }), null);
    assert.match(rejected[0].reason, /publiée il y a 6 ans/);
    const undated = { title: video.title };
    assert.equal(pickBestVideoResult([undated], ref(), null, { now }), undated);
    assert.equal(pickBestVideoResult([video], ref('Lucky', null), null, { now }), video);
});

test('sélection YouTube : trois rejets maximum, sans titre différent ni candidats exclus', () => {
    const rejected = [];
    const results = [
        { title: 'Autre film - VF' }, { title: 'Lucky 2 - VOSTFR' }, old,
        { title: 'Lucky 2 - VF' }, { title: 'Lucky - VF', published: 'il y a 6 ans' },
        { title: 'Lucky - VF (2010)' },
    ];
    assert.equal(pickBestVideoResult(results, ref(), r => !r.title.includes('VOSTFR'), { rejected, now }), null);
    assert.equal(rejected.length, 3);
    assert.deepEqual(rejected.map(r => r.reason), ['année 2020 ≠ 2026', 'autre numéro de suite', 'publiée il y a 6 ans (bien avant la sortie en 2026)']);
});

test('recherche YouTube : date et chaîne extraites, requête unique précise et trace du résolveur', async t => {
    const originalFetch = global.fetch;
    const replaced = [];
    const stub = (name, exports) => {
        const filename = require.resolve('../lib/' + name);
        replaced.push([filename, require.cache[filename]]);
        require.cache[filename] = { id: filename, filename, loaded: true, exports };
    };
    t.after(() => {
        global.fetch = originalFetch;
        for (const [filename, cached] of replaced) {
            if (cached) require.cache[filename] = cached;
            else delete require.cache[filename];
        }
    });
    const calls = [], order = [];
    let results = [old, current], officialYear = 2026, platform = null;
    global.fetch = async url => {
        calls.push(new URL(url).searchParams.get('search_query'));
        order.push('youtube');
        const contents = results.map(r => ({ videoRenderer: {
            videoId: r.videoId, title: { runs: [{ text: r.title }] },
            ownerText: { runs: [{ text: r.channel || 'FilmsActu', navigationEndpoint: {
                browseEndpoint: { browseId: r.channelId || VOD_CHANNELS[0].id },
            } }] },
            ...(r.published ? { publishedTimeText: { simpleText: r.published } } : {}),
        } }));
        const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: {
            sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] },
        } } } };
        return { ok: true, text: async () => '<script>var ytInitialData = ' + JSON.stringify(data) + ';</script>' };
    };
    const { searchYoutubeRaw, searchYoutubeTrailer } = require('../lib/youtube-search');
    const raw = await searchYoutubeRaw('test');
    assert.equal(raw[0].published, 'il y a 6 ans');
    assert.equal(raw[1].channel, current.channel);
    const rejected = [];
    assert.deepEqual(await searchYoutubeTrailer('test', ref(), { now, rejected }), {
        videoId: current.videoId, title: current.title, channel: current.channel,
    });
    assert.match(rejected[0].reason, /année 2020/);
    results = [{ videoId: 'dated', title: 'Lucky - Bande-annonce VF', published: 'il y a 6 ans' }];
    assert.equal(await searchYoutubeTrailer('test', ref(), { now }), null);
    results = [{ videoId: 'undated', title: 'Lucky - Bande-annonce VF' }];
    assert.equal((await searchYoutubeRaw('test'))[0].published, null);

    // Seuls les amonts sont simulés ; scraping, sélection, ordre des replis et trace restent réels.
    stub('config', { TVDB_API_KEY: null });
    stub('net', { fetchT: async () => ({ json: async () => ({ results: [] }) }) });
    stub('tmdb', {
        findByImdb: async () => ({ movie_results: [{ id: 42 }], tv_results: [{ id: 42 }] }),
        getTitleAndYear: async () => ({ title: 'Lucky', year: officialYear }),
        getAlternativeTitles: async () => [], getWatchPlatform: async () => platform,
    });
    stub('tvdb', { getTvdbTrailers: async () => ({ streams: [], reason: 'Aucun trailer de test' }) });
    stub('anime-sources', {});
    stub('allocine', { getAllocineTrailerStreams: async () => { order.push('allocine'); return []; } });
    stub('netflix-federation', { resolveFederatedTrailer: async () => { order.push('stockage'); return { found: false }; } });
    const { resolveViaApis } = require('../lib/resolve-apis');
    const behavior = { youtubeSearchFallback: true, allocineFallback: true, netflixCatalogueUrl: 'https://stockage.example', trailerLanguage: 'fr-only' };
    results = [old]; calls.length = 0; order.length = 0;
    const failureTrace = [];
    assert.deepEqual((await resolveViaApis('series', 'tt1234567', null, behavior, 'fixture', failureTrace)).streams, []);
    assert.deepEqual(calls, ['Lucky série 2026 bande annonce VF FilmsActu']);
    assert.deepEqual(order, ['youtube', 'allocine', 'stockage']);
    assert.match(failureTrace.find(r => r.step === 'youtube-search').detail,
        /Rien de pertinent pour "Lucky série 2026 bande annonce VF" · écarté : "LUCKY Bande Annonce VF \(2020\)" \(année 2020 ≠ 2026\)/);
    results = [current]; calls.length = 0; order.length = 0;
    const successTrace = [];
    assert.equal((await resolveViaApis('movie', 'tt1234567', null, behavior, 'fixture', successTrace)).streams[0].ytId, current.videoId);
    assert.deepEqual(calls, ['Lucky 2026 bande annonce VF FilmsActu']);
    assert.deepEqual(order, ['youtube']);
    assert.equal(successTrace.find(r => r.step === 'youtube-search').detail, 'Trouvé: v=current — "' + current.title + '" · ' + current.channel);
    officialYear = null; calls.length = 0;
    await resolveViaApis('series', 'tt1234567', null, behavior, 'fixture');
    assert.deepEqual(calls, ['Lucky série bande annonce VF FilmsActu']);
    platform = 'apple'; calls.length = 0;
    await resolveViaApis('series', 'tt1234567', null, behavior, 'fixture');
    assert.deepEqual(calls, ['Lucky série bande annonce VF Apple France']);
});
