// Identités YouTube : on vérifie l'auteur réel, jamais un nom écrit dans le titre.
// IDs stables et handles des pages officielles, consultées le 17 novembre 2026.
const CHANNELS = {
    netflix: [{ name: 'Netflix France', id: 'UCroNr00O68n25IqSNapMK8w', handle: 'NetflixFrance' }],
    apple: [
        { name: 'Apple France', id: 'UCh5CL7XbLPZPfJa7Bf6ifng', handle: 'AppleFrance' },
        { name: 'Apple TV', id: 'UC1Myj674wRVXB9I4c6Hm5zA', handle: 'AppleTV' },
    ],
    prime: [{ name: 'Amazon Prime Video France', id: 'UC4YtyYW5RpGBgQqChMyjfIg', handle: 'PrimeVideoFR' }],
    disney: [
        { name: 'Disney Plus FR', id: 'UCfrLPVjIxAJzNFu_TsevXVw', handle: 'DisneyPlusFR' },
        { name: 'Disney France', id: 'UCakQLdwrxuo0KhJ49Sq2csA', handle: 'DisneyFR' },
    ],
    max: [{ name: 'HBO Max France', id: 'UCrZ9ku2VGO3DoaCZBPymlcw', handle: 'HBOMaxFR' }],
    paramount: [{ name: 'Paramount+ France', id: 'UCdyJtenRnSPnmcUq8FtSPHg', handle: 'ParamountPlusFR' }],
    crunchyroll: [{ name: 'Crunchyroll FR', id: 'UCf2L21tpe1P-Y4QjOXkCIvQ', handle: 'CrunchyrollFR' }],
    mubi: [{ name: 'MUBI France', id: 'UCf0Qr19jtTBkM9vfJz9SPdQ', handle: 'mubifrance' }],
};
const VOD_CHANNELS = [
    { name: 'FilmsActu', id: 'UC_i8X3p8oZNaik8X513Zn1Q', handle: 'FilmsActu' },
    { name: 'Allociné | Bandes Annonces', id: 'UC5i9ji_nljs6-mp0jz_hOHg', handle: 'AllocineBA' },
    { name: 'Warner Bros. France', id: 'UCZ0o1IeuSSceEixZbSATWtw', handle: 'warnerbrosfr' },
];

function matchesChannel(result, channel) {
    if (result.channelId) return result.channelId === channel.id;
    return String(result.channelUrl || '').replace(/^https?:\/\/(?:www\.)?youtube\.com/i, '').replace(/\/$/, '').toLowerCase() === '/@' + channel.handle.toLowerCase();
}

function channelPolicy(platform) {
    const primary = CHANNELS[platform] || VOD_CHANNELS;
    const secondary = CHANNELS[platform] ? VOD_CHANNELS : platform === 'vod' ? [] : Object.values(CHANNELS).flat();
    return { primary, secondary, queryName: primary[0].name };
}

module.exports = { CHANNELS, VOD_CHANNELS, matchesChannel, channelPolicy };
