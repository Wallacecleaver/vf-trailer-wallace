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

test('recherche plateforme : repli cinéma fiable sans second appel, âge contrôlé', async () => {
    const queries = youtube([
        { videoId: 'old', id: CHANNELS.apple[0].id, title: 'Lucky - Bande-annonce VF (2020)' },
        { videoId: 'fallback', id: VOD_CHANNELS[0].id },
    ]);
    assert.equal((await searchYoutubeTrailer('Lucky série 2026 bande annonce VF', reference, { platform: 'apple' })).videoId, 'fallback');
    assert.equal(queries.length, 1);
});

test('recherche brute admin : identité et date extraites, résultats manuels non filtrés', async () => {
    const queries = youtube([{ videoId: 'manual', id: 'inconnu', url: '/@Perso', title: 'Une vidéo VO' }]);
    const results = await searchYoutubeRaw('recherche manuelle');
    assert.equal(results[0].channelId, 'inconnu');
    assert.equal(results[0].channelUrl, '/@Perso');
    assert.equal(results[0].published, 'il y a 2 semaines');
    assert.deepEqual(queries, ['recherche manuelle']);
});
