const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPlatform, platformFromProviders } = require('../lib/tmdb');
const { formatStreamName, buildPreviewStreams } = require('../lib/stream-format');

// Noms des services et variantes TMDB/JustWatch, y compris les anciennes marques.
const platforms = {
    netflix: ['Netflix', 'Netflix Kids', 'Netflix Standard with Ads'],
    prime: ['Amazon Prime Video', 'Prime Video', 'Amazon Prime Video with Ads'],
    disney: ['Disney Plus', 'Disney+', 'Disney+ Hotstar'],
    max: ['HBO Max', 'Max', 'HBO', 'Home Box Office'],
    apple: ['Apple TV', 'Apple TV+', 'Apple TV Plus'],
    paramount: ['Paramount+', 'Paramount Plus', 'Paramount Plus Premium', 'Paramount Plus Basic with Ads'],
    canal: ['CANAL+', 'Canal Plus', 'myCANAL'],
    crunchyroll: ['Crunchyroll', 'Funimation'],
    mubi: ['MUBI'],
    ocs: ['OCS', 'Cine+ OCS'],
    molotov: ['Molotov TV'],
    france_tv: ['France TV', 'france.tv', 'France Télévisions'],
    arte: ['Arte'],
    tf1: ['TF1', 'TF1+'],
    m6: ['M6', 'M6+', '6play'],
    shadowz: ['Shadowz'],
    filmo: ['FILMO', 'FilmoTV'],
    adn: ['Animation Digital Network', 'ADN'],
    rakuten: ['Rakuten TV'],
    pluto: ['Pluto TV'],
    plex: ['Plex'],
    tubi: ['Tubi TV'],
    hulu: ['Hulu'],
    peacock: ['Peacock Premium', 'Peacock Premium Plus'],
    discovery: ['Discovery+', 'Discovery +', 'Discovery Plus'],
    starz: ['Starz'],
    britbox: ['BritBox'],
    skyshowtime: ['SkyShowtime'],
    viaplay: ['Viaplay'],
    hayu: ['Hayu'],
    dazn: ['DAZN'],
    bein: ['beIN SPORTS'],
    curiosity: ['Curiosity Stream', 'CuriosityStream'],
    viki: ['Rakuten Viki', 'Viki'],
    iqiyi: ['iQIYI'],
    wetv: ['WeTV'],
    kocowa: ['Kocowa'],
    amc: ['AMC+', 'AMC Plus'],
    acorn: ['Acorn TV'],
    shudder: ['Shudder'],
    roku: ['The Roku Channel', 'Roku Channel'],
    itvx: ['ITVX', 'ITVX Premium'],
    bbc: ['BBC iPlayer', 'BBC Player'],
    channel4: ['Channel 4', 'All 4'],
    my5: ['My5'],
    now: ['Now TV', 'Now TV Cinema', 'NOW'],
    rtl: ['RTL+', 'RTL Plus'],
    joyn: ['Joyn'],
    zdf: ['ZDF', 'ZDF Mediathek', 'ZDF Select', 'ZDFtivi'],
    ard: ['ARD Mediathek', 'ARD Plus'],
    magenta: ['Magenta TV', 'MagentaTV', 'Magenta TV+'],
    videoland: ['Videoland'],
    npo: ['NPO Plus', 'NPO Start'],
    pathe: ['Pathé Thuis', 'Pathe Thuis'],
    svt: ['SVT Play'],
    nrk: ['NRK TV', 'NRK Play'],
    drtv: ['DR TV', 'DRTV'],
    tving: ['TVING'],
    wavve: ['Wavve'],
    coupang: ['Coupang Play'],
    watcha: ['Watcha'],
    unext: ['U-NEXT', 'UNEXT'],
    fod: ['FOD'],
    abema: ['ABEMA'],
    bilibili: ['Bilibili'],
    youku: ['Youku'],
    tencent: ['Tencent Video'],
    mango: ['Mango TV'],
    zee5: ['ZEE5'],
    sonyliv: ['Sony Liv', 'SonyLIV'],
    hotstar: ['JioHotstar', 'Hotstar'],
    eros: ['Eros Now'],
    lionsgate: ['Lionsgate Play'],
    stan: ['Stan'],
    binge: ['BINGE', 'BINGE Movies & TV'],
    foxtel: ['Foxtel Now'],
    kayo: ['Kayo Sports'],
    neon: ['Neon TV'],
    tvnz: ['TVNZ+', 'TVNZ On Demand'],
    crave: ['Crave'],
    cbc: ['CBC Gem'],
    ctv: ['CTV'],
    global: ['Global TV'],
    kanopy: ['Kanopy'],
    hoopla: ['Hoopla'],
    aha: ['aha'],
    mxplayer: ['Amazon MX Player', 'MX Player'],
    sunnxt: ['Sun Nxt'],
    hoichoi: ['Hoichoi'],
};

for (const [platform, names] of Object.entries(platforms)) {
    test(`plateforme : ${platform}, noms TMDB et badge disponibles`, () => {
        for (const name of names) {
            assert.equal(detectPlatform({ networks: [{ name }] }), platform, name);
            assert.equal(platformFromProviders({ flatrate: [{ provider_name: name }] }), platform, name);
            assert.equal(platformFromProviders({ buy: [{ provider_name: name }], rent: [{ provider_name: name }] }), 'vod', name);
        }
        assert.notEqual(formatStreamName(platform), '🎬 VF');
    });
}

test('plateformes : les chaînes gardent leur marque sur Amazon, Apple TV et Roku', () => {
    const channels = [
        ['HBO Max Amazon Channel', 'max'],
        ['Paramount+ Amazon Channel', 'paramount'],
        ['Paramount+ Amazon Prime Video Channels', 'paramount'],
        ['Paramount+ Roku Premium Channel', 'paramount'],
        ['Paramount Plus Apple TV channel', 'paramount'],
        ['Discovery+ Amazon Channel', 'discovery'],
        ['AMC Plus Apple TV channel', 'amc'],
        ['Britbox Apple TV channel', 'britbox'],
        ['Acorn TV Apple TV channel', 'acorn'],
        ['Shudder Apple TV channel', 'shudder'],
        ['Starz Apple TV channel', 'starz'],
        ['Eros Now Select Apple TV channel', 'eros'],
        ['CuriosityStream Apple TV channel', 'curiosity'],
        ['Apple TV Amazon Channel', 'apple'],
        ['Sonyliv Amazon Channel', 'sonyliv'],
        ['ARD Plus Apple TV channel', 'ard'],
        ['ZDF Select Amazon Channel', 'zdf'],
        ['ZDFtivi Amazon Channel', 'zdf'],
        ['RTL+ Max Amazon Channel', 'rtl'],
    ];
    for (const [name, expected] of channels) {
        assert.equal(platformFromProviders({ flatrate: [{ provider_name: name }] }), expected, name);
    }
});

test('plateformes : les services distincts ne sont pas attribués à Apple, HBO Max ou NOW', () => {
    for (const name of [
        'Action Max Amazon Channel', 'Premiere Max', 'TFOU Max Amazon Channel', 'VRT MAX',
        'A&E Crime Central Apple TV channel', 'Cinemax Apple TV channel',
        'STUDIOCANAL PRESENTS Apple TV Channel', 'Sundance Now Apple TV channel',
        'Apple TV Store', 'Canal VOD', 'DisneyNOW', 'ThreeNow', '9Now', 'Plateforme inconnue',
        'AMC+Other', 'RTL+Other', 'TVNZ+Other', 'U-NEXTdoor',
    ]) {
        assert.equal(platformFromProviders({ flatrate: [{ provider_name: name }] }), null, name);
    }
});

test('plateformes : les sociétés de production reconnues restent prises en compte', () => {
    for (const [name, expected] of [
        ['Netflix Animation', 'netflix'], ['Amazon MGM Studios', 'prime'],
        ['Disney Studios', 'disney'], ['Apple Original Films', 'apple'],
        ['Apple Studios', 'apple'], ['Paramount Pictures Television', 'paramount'],
    ]) {
        assert.equal(detectPlatform({ production_companies: [{ name }] }), expected, name);
    }
    assert.equal(detectPlatform({ networks: [{ name: 'Netflix' }], production_companies: [{ name: 'Apple Studios' }] }), 'netflix');
});

test('plateformes : ordre des abonnements et valeur absente conservés', () => {
    assert.equal(platformFromProviders({ flatrate: [{ provider_name: 'Disney+' }, { provider_name: 'Netflix' }] }), 'disney');
    assert.equal(platformFromProviders({ flatrate: [{ provider_name: 'Inconnu' }, { provider_name: 'Canal+' }] }), 'canal');
    assert.equal(platformFromProviders(undefined), null);
    assert.equal(detectPlatform({}), null);
});

test('VOD : achat et location affichent un badge générique, quelle que soit la boutique', () => {
    for (const entry of [
        { rent: [{ provider_name: 'Apple TV Store' }] },
        { buy: [{ provider_name: 'Rakuten TV' }] },
        { rent: [{ provider_name: 'Canal VOD' }], buy: [{ provider_name: 'Amazon Video' }] },
        { buy: [{ provider_name: 'Une autre boutique' }] },
    ]) {
        const platform = platformFromProviders(entry);
        assert.equal(platform, 'vod');
        for (const display of ['default', 'compact', 'detailed']) {
            const streams = buildPreviewStreams({ display }, 'Film disponible en VOD', platform);
            assert.ok(streams.length > 0);
            assert.ok(streams.every(stream => stream.name.split('\n')[0] === '🎬 VOD'));
        }
    }
});

test('VOD : un abonnement reconnu reste prioritaire sur les boutiques', () => {
    assert.equal(platformFromProviders({
        flatrate: [{ provider_name: 'Netflix' }],
        rent: [{ provider_name: 'Apple TV Store' }],
    }), 'netflix');
    assert.equal(platformFromProviders({
        flatrate: [{ provider_name: 'Inconnu' }, { provider_name: 'Canal+' }],
        buy: [{ provider_name: 'Amazon Video' }],
    }), 'canal');
    assert.equal(platformFromProviders({
        flatrate: [{ provider_name: 'Inconnu' }],
        rent: [{ provider_name: 'Rakuten TV' }],
    }), 'vod');
});

test('VOD : aucun badge sans offre d’achat ou de location exploitable', () => {
    for (const entry of [
        undefined, {}, { buy: [], rent: [] },
        { rent: [null, {}, { provider_name: '   ' }] },
        { buy: null, rent: {} },
        { free: [{ provider_name: 'Arte' }], ads: [{ provider_name: 'Pluto TV' }] },
    ]) {
        assert.equal(platformFromProviders(entry), null);
    }
});
