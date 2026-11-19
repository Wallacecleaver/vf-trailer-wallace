const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHANNELS, VOD_CHANNELS, matchesChannel, channelPolicy } = require('../lib/youtube-channels');
const { searchYoutubeRaw, searchYoutubeTrailer } = require('../lib/youtube-search');
const { buildRef } = require('../lib/title-match');
const reference = buildRef({ allTitles: ['Lucky'], year: 2026 });
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

function youtube(results) {
    const queries = [];
    global.fetch = async url => {
        queries.push(new URL(url).searchParams.get('search_query'));
        const contents = results.map(result => ({ videoRenderer: {
            videoId: result.videoId, title: { runs: [{ text: result.title || 'Lucky - Bande-annonce VF (2026)' }] },
            ownerText: { runs: [{ text: result.name || 'Netflix France', navigationEndpoint: { browseEndpoint: {
                browseId: result.id, canonicalBaseUrl: result.url,
            } } }] },
            publishedTimeText: { simpleText: result.published || 'il y a 2 semaines' },
        } }));
        const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: {
            sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] },
        } } } };
        return { ok: true, text: async () => '<script>var ytInitialData = ' + JSON.stringify(data) + ';</script>' };
    };
    return queries;
}

test('chaînes : plateformes identifiées et FilmsActu prioritaire pour la VOD', () => {
    for (const [platform, channels] of Object.entries(CHANNELS)) {
        assert.equal(channelPolicy(platform).primary, channels);
        for (const channel of channels) assert.match(channel.id, /^UC[A-Za-z0-9_-]{22}$/);
    }
    assert.equal(channelPolicy('vod').primary[0].name, 'FilmsActu');
    assert.equal(channelPolicy(null).primary[0].name, 'FilmsActu');
});

test('chaînes : noms copiés et identités contradictoires refusés, handle explicite accepté', () => {
    const netflix = CHANNELS.netflix[0];
    assert.equal(matchesChannel({ channel: 'Netflix France' }, netflix), false);
    assert.equal(matchesChannel({ channel: 'Netflix France', channelId: 'chaine-usurpee', channelUrl: '/@NetflixFrance' }, netflix), false);
    assert.equal(matchesChannel({ channelId: netflix.id }, netflix), true);
    assert.equal(matchesChannel({ channelUrl: '/@NetflixFrance' }, netflix), true);
});

test('recherche plateforme : auteur officiel préféré, une seule requête ciblée', async () => {
    const queries = youtube([
        { videoId: 'fake', id: 'chaine-usurpee' },
        { videoId: 'cinema', id: VOD_CHANNELS[0].id },
        { videoId: 'official', id: CHANNELS.netflix[0].id },
    ]);
    const found = await searchYoutubeTrailer('Lucky série 2026 bande annonce VF', reference, { platform: 'netflix' });
    assert.equal(found.videoId, 'official');
    assert.deepEqual(queries, ['Lucky série 2026 bande annonce VF Netflix France']);
});

test('recherche VOD : FilmsActu puis Allociné, sans accepter une chaîne inconnue', async () => {
    youtube([{ videoId: 'allocine', id: VOD_CHANNELS[1].id }, { videoId: 'filmsactu', id: VOD_CHANNELS[0].id }]);
    assert.equal((await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference, { platform: 'vod' })).videoId, 'filmsactu');
    youtube([{ videoId: 'unknown', id: 'inconnu' }, { videoId: 'allocine', id: VOD_CHANNELS[1].id }]);
    assert.equal((await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference, { platform: 'vod' })).videoId, 'allocine');
    youtube([{ videoId: 'unknown', id: 'inconnu' }]);
    assert.equal(await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference, { platform: 'vod' }), null);
});

test('recherche YouTube : bande-annonce ET VF requis avant le nettoyage du titre', async () => {
    for (const title of ['Lucky - Bande-annonce officielle', 'Lucky - Bande-annonce VOSTFR', 'Lucky - Extrait VF', 'Lucky - Teaser VF', 'Réaction à Lucky - Bande-annonce VF']) {
        youtube([{ videoId: 'reject', id: CHANNELS.netflix[0].id, title }]);
        assert.equal(await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference, { platform: 'netflix' }), null, title);
    }
    youtube([{ videoId: 'ok', id: CHANNELS.netflix[0].id, title: 'Lucky - Bande-annonce VF (2026)' }]);
    assert.equal((await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference, { platform: 'netflix' })).videoId, 'ok');
});

test('recherche YouTube : la bonne chaîne ne suffit pas à valider Lucky Luke', async () => {
    youtube([{ videoId: 'wrong', id: CHANNELS.disney[0].id, title: 'Lucky Luke - Bande-annonce officielle (VF) | Disney+' }]);
    assert.equal(await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference, { platform: 'disney' }), null);
});

test('recherche YouTube : bande-annonce Prime officielle sans VF mais audio français détecté', async () => {
    const videoId = 'a8ECma_sutE';
    const id = CHANNELS.prime[0].id;
    const title = 'Avec toi pour toujours - Bande-Annonce Officielle | Prime Video';
    const ref = buildRef({ allTitles: ['Avec toi pour toujours', 'Son Yemek', 'Last Meal'], year: 2026 });
    const scenarios = [
        { title, tracks: [{ kind: 'asr', vssId: 'a.fr', languageCode: 'fr' }], match: true, checked: true },
        { title, tracks: [{ vssId: '.fr', languageCode: 'fr' }], match: false, checked: true },
        { title, tracks: [{ kind: 'asr', vssId: 'a.tr', languageCode: 'tr' }], match: false, checked: true },
        { title: 'Avec toi pour toujours 2 - Bande-annonce officielle', match: false, checked: false },
        { title: 'Avec toi pour toujours - Bande-annonce VOSTFR', match: false, checked: false },
        { title, channelId: 'other-channel', match: false, checked: false },
    ];
    for (const scenario of scenarios) {
        const queries = youtube([{ videoId, id: scenario.channelId || id, title: scenario.title }]);
        const searchFetch = global.fetch;
        const watch = [];
        global.fetch = async raw => {
            const url = new URL(raw);
            if (url.pathname !== '/watch') return searchFetch(raw);
            watch.push(url.searchParams.get('v'));
            const player = { videoDetails: { videoId, channelId: id },
                captions: { playerCaptionsTracklistRenderer: { captionTracks: scenario.tracks } } };
            return { ok: true, text: async () => '<script>var ytInitialPlayerResponse = ' + JSON.stringify(player) + ';</script>' };
        };
        const result = await searchYoutubeTrailer('Avec toi pour toujours 2026 bande annonce VF', ref, { platform: 'prime' });
        assert.equal(result?.videoId, scenario.match ? videoId : undefined);
        assert.deepEqual(watch, scenario.checked ? [videoId] : []);
        assert.equal(queries.length, 1);
    }
});

test('recherche plateforme : repli cinéma fiable sans second appel, âge contrôlé', async () => {
    const queries = youtube([
        { videoId: 'old', id: CHANNELS.apple[0].id, title: 'Lucky - Bande-annonce VF (2020)' },
        { videoId: 'fallback', id: VOD_CHANNELS[0].id },
    ]);
    assert.equal((await searchYoutubeTrailer('Lucky série 2026 bande annonce VF', reference, { platform: 'apple' })).videoId, 'fallback');
    assert.equal(queries.length, 1);
});

test('recherche YouTube : un second passage retrouve une VF avec les mêmes garde-fous', async () => {
    const id = CHANNELS.prime[0].id;
    const firstQueries = youtube([{ videoId: 'wrong', id, title: 'Lucky Luke - Bande-annonce VF' }]);
    const firstFetch = global.fetch;
    const secondQueries = youtube([
        { videoId: 'spoof', id: 'usurpation', title: 'Lucky - Bande-annonce VF (2026)' },
        { videoId: 'other', id, title: 'Lucky - Bande-annonce VOSTFR' },
        { videoId: 'right', id, title: 'Lucky - Bande-annonce VF (2026)' },
    ]);
    const secondFetch = global.fetch;
    global.fetch = (raw, options) => {
        const query = new URL(raw).searchParams.get('search_query');
        return (query === 'Lucky bande annonce' ? secondFetch : firstFetch)(raw, options);
    };
    const result = await searchYoutubeTrailer('Lucky 2026 bande annonce VF', reference,
        { platform: 'prime', backupQuery: 'Lucky bande annonce' });
    assert.equal(result.videoId, 'right');
    assert.deepEqual(firstQueries, ['Lucky 2026 bande annonce VF Amazon Prime Video France']);
    assert.deepEqual(secondQueries, ['Lucky bande annonce']);
});

test('recherche brute admin : identité et date extraites, résultats manuels non filtrés', async () => {
    const queries = youtube([{ videoId: 'manual', id: 'inconnu', url: '/@Perso', title: 'Une vidéo VO' }]);
    const results = await searchYoutubeRaw('recherche manuelle');
    assert.equal(results[0].channelId, 'inconnu');
    assert.equal(results[0].channelUrl, '/@Perso');
    assert.equal(results[0].published, 'il y a 2 semaines');
    assert.deepEqual(queries, ['recherche manuelle']);
});
