// Présentation des flux Stremio : libellés, flux « ouvrir en externe », préférences par utilisateur.

// Types de vidéos TMDB considérés comme "bandes-annonces" au sens strict.
// Les types "extras" (récaps, extraits, making-of...) sont proposés en plus
// seulement quand includeExtras est activé (réglage admin + override par
// utilisateur sur /configure), jamais par défaut.
const ACCEPTED_VIDEO_TYPES = ['Trailer', 'Teaser'];
const EXTRA_VIDEO_TYPES = ['Clip', 'Featurette', 'Behind the Scenes', 'Bloopers', 'Recap', 'Opening Credits'];

// Libellés français affichés dans Stremio pour chaque type de vidéo TMDB.
// On garde le nom "bande-annonce" générique pour les replis Allociné/YouTube
// (formatStreamTitle('trailer')), et on traduit proprement chaque type "extra".
const VIDEO_TYPE_LABELS = {
    'Trailer': 'Bande-annonce',
    'Teaser': 'Teaser',
    'Clip': 'Extrait',
    'Featurette': 'Making-of',
    'Behind the Scenes': 'Coulisses',
    'Bloopers': 'Bêtisier',
    'Recap': 'Récap',
    'Opening Credits': 'Générique',
};

// Résout la liste de types acceptés selon le réglage includeExtras.
function getAcceptedVideoTypes(behavior) {
    return behavior && behavior.includeExtras ? [...ACCEPTED_VIDEO_TYPES, ...EXTRA_VIDEO_TYPES] : ACCEPTED_VIDEO_TYPES;
}

// ---- Présentation des flux dans Stremio ----
// `name` (colonne de gauche) : Stremio y affiche par défaut le nom de l'addon si on ne
// le précise pas -> d'où le "W Bandes-Annonces VF" répété sur chaque ligne. On le
// remplace par un tag court et lisible : clap + VF, avec la qualité RÉELLEMENT connue
// en 2e ligne -- uniquement quand elle est vraiment connue (qualité forcée ET
// effectivement résolue). Le mot "Auto" n'apportait aucune information concrète
// (Stremio choisit lui-même), donc on ne l'affiche plus : sans qualité connue, le
// tag reste sur une seule ligne, plus propre.
// Le vrai logo (image) reste géré par Stremio à partir de manifest.logo, on ne peut
// pas en injecter un par flux ici -- c'est ce tag qui joue ce rôle "repère visuel".
// `title` (colonne de droite) : au lieu du nom brut de la vidéo YouTube (souvent
// redondant ou mal formaté, ex. "Supergirl | Teaser"), on affiche systématiquement
// le titre officiel du film/série (déjà vérifié par title-match.js), de façon uniforme
// quelle que soit la source (TMDB, Allociné, YouTube). Sur 2 lignes (genre / titre),
// sans icône ni tiret : ça reprenait de la place pour rien (déjà dans le tag de
// gauche) et poussait le titre du film hors de la zone visible, tronqué par Stremio.
// Nom du flux (colonne de gauche) : la plateforme quand on la détecte (voir detectPlatform dans
// tmdb.js), sinon le tag VF habituel. Libellés modifiables ici.
const PLATFORM_LABELS = {
    vod: '🎬 VOD',
    netflix: '🔴 Netflix',
    prime: '📦 Prime Video',
    disney: '✨ Disney+',
    max: '🟣 HBO Max',
    apple: '🍎 Apple TV+',
    paramount: '⛰️ Paramount+',
    canal: '📺 CANAL+',
    crunchyroll: '🟠 Crunchyroll',
    mubi: '🎞️ MUBI',
    ocs: '🎬 OCS',
    molotov: '📡 Molotov',
    france_tv: '📺 France.tv',
    arte: '🎭 ARTE',
    tf1: '📺 TF1+',
    m6: '📺 M6+',
    shadowz: '👻 Shadowz',
    filmo: '🎬 Filmo',
    adn: '⛩️ ADN',
    rakuten: '🎥 Rakuten TV',
    pluto: '📺 Pluto TV',
    plex: '📺 Plex',
    tubi: '📺 Tubi',
    hulu: '🟢 Hulu',
    peacock: '🦚 Peacock',
    discovery: '🔎 Discovery+',
    starz: '⭐ STARZ',
    britbox: '🇬🇧 BritBox',
    skyshowtime: '🌌 SkyShowtime',
    viaplay: '📺 Viaplay',
    hayu: '💄 Hayu',
    dazn: '🏟️ DAZN',
    bein: '🏟️ beIN SPORTS',
    curiosity: '🧠 Curiosity Stream',
    viki: '🌏 Viki',
    iqiyi: '🎬 iQIYI',
    wetv: '🎬 WeTV',
    kocowa: '🎬 KOCOWA',
    amc: '🎬 AMC+',
    acorn: '🌰 Acorn TV',
    shudder: '👻 Shudder',
    roku: '📺 The Roku Channel',
    itvx: '📺 ITVX',
    bbc: '🇬🇧 BBC iPlayer',
    channel4: '🇬🇧 Channel 4',
    my5: '🇬🇧 My5',
    now: '📺 NOW',
    rtl: '🇩🇪 RTL+',
    joyn: '🇩🇪 Joyn',
    zdf: '🇩🇪 ZDF',
    ard: '🇩🇪 ARD',
    magenta: '📺 MagentaTV',
    videoland: '🇳🇱 Videoland',
    npo: '🇳🇱 NPO',
    pathe: '🎬 Pathé Thuis',
    svt: '🇸🇪 SVT Play',
    nrk: '🇳🇴 NRK TV',
    drtv: '🇩🇰 DRTV',
    tving: '🇰🇷 TVING',
    wavve: '🇰🇷 Wavve',
    coupang: '🇰🇷 Coupang Play',
    watcha: '🇰🇷 Watcha',
    unext: '🇯🇵 U-NEXT',
    fod: '🇯🇵 FOD',
    abema: '🇯🇵 ABEMA',
    bilibili: '🎬 Bilibili',
    youku: '🎬 Youku',
    tencent: '🎬 Tencent Video',
    mango: '🎬 Mango TV',
    zee5: '🇮🇳 ZEE5',
    sonyliv: '🇮🇳 SonyLIV',
    hotstar: '🇮🇳 JioHotstar',
    eros: '🇮🇳 Eros Now',
    lionsgate: '🎬 Lionsgate Play',
    stan: '🇦🇺 Stan',
    binge: '🇦🇺 BINGE',
    foxtel: '🇦🇺 Foxtel',
    kayo: '🏟️ Kayo',
    neon: '🇳🇿 Neon',
    tvnz: '🇳🇿 TVNZ+',
    crave: '🇨🇦 Crave',
    cbc: '🇨🇦 CBC Gem',
    ctv: '🇨🇦 CTV',
    global: '🇨🇦 Global TV',
    kanopy: '🎬 Kanopy',
    hoopla: '🎬 hoopla',
    aha: '🇮🇳 aha',
    mxplayer: '🇮🇳 MX Player',
    sunnxt: '🇮🇳 Sun NXT',
    hoichoi: '🇮🇳 hoichoi',
};
function formatStreamName(platform) {
    return PLATFORM_LABELS[platform] || '🎬 VF';
}

// Accole "(Saison X)" au titre quand une saison précise est demandée -- évite le souci
// remonté par la communauté (MobLand S2) : sans ça, rien ne distingue la bande-annonce
// de la saison 2 de celle de la série en général, qu'on ouvre l'épisode 1 ou l'épisode 8.
function withSeasonLabel(title, season) {
    return season ? `${title} (Saison ${season})` : title;
}

function formatStreamTitle(kind, officialTitle, season) {
    const kindLabel = VIDEO_TYPE_LABELS[kind] || 'Bande-annonce';
    if (!officialTitle) return `${kindLabel} VF`;
    return `${kindLabel}\n${withSeasonLabel(officialTitle, season)}`;
}

// ---- Flux "ouvrir en externe" ----
// En plus du flux jouable dans le lecteur intégré de Stremio, on ajoute pour chaque
// trailer YouTube une entrée jumelle avec `externalUrl` : Stremio la traite comme un
// lien externe (ouvre l'appli/le navigateur YouTube) plutôt que de tenter de le lire
// dans son propre lecteur. Uniquement pertinent pour les flux YouTube (ytId) -- une
// URL Allociné n'a pas d'équivalent "appli externe" à ouvrir.
function formatExternalStreamName(platform) {
    return `${formatStreamName(platform)}\n▶️ YouTube`;
}

function buildExternalYoutubeStream(ytId, title, platform) {
    return {
        name: formatExternalStreamName(platform),
        title: `${title || 'Bande-annonce VF'}\n(ouvrir dans YouTube)`,
        externalUrl: `https://www.youtube.com/watch?v=${ytId}`,
        __external: true, // marqueur interne (retiré avant envoi) -- voir applyUserStreamPrefs
    };
}

// ---- Préférences d'affichage par utilisateur (page /configure) ----
// externalOnly : ne garde que les flux "ouvrir en externe" (marqués __external:true) --
// les flux qui n'ont pas d'équivalent externe (Allociné, override en URL directe, pas de
// __external du tout) ne sont jamais filtrés, il n'y a rien d'autre à proposer pour eux.
// maxLinks : tronque le nombre total de flux renvoyés, une fois le filtre ci-dessus appliqué.
// Appliqué en tout dernier, après cache/résolution -- jamais mis en cache lui-même (le cache
// reste commun à tous les utilisateurs, indépendant de leurs préférences d'affichage).
function applyUserStreamPrefs(streams, config) {
    if (!streams || !streams.length) return streams;
    let result = streams;
    if (config.externalOnly) {
        result = result.filter(s => s.__external !== false);
    }
    result = result.map(s => {
        if (!('__external' in s)) return s;
        const clean = { ...s };
        delete clean.__external;
        return clean;
    });
    if (config.maxLinks) {
        result = result.slice(0, config.maxLinks);
    }
    return result;
}

// ---- Mode d'affichage (page /configure > « Mode d'affichage ») ----
// 'default'  : présentation historique, inchangée.
// 'compact'  : une seule ligne par flux (type • titre).
// 'detailed' : une ligne par info (type/titre, langue + source, lecture, lien) -- même esprit
//              que le mode « Détaillé » des addons de flux.
// Appliqué en tout dernier (comme applyUserStreamPrefs), jamais mis en cache.
const DISPLAY_MODES = ['default', 'compact', 'detailed'];
const SOURCE_LABELS = {
    tmdb: 'TMDB',
    thetvdb: 'TheTVDB',
    anilist: 'AniList / YouTube',
    allocine: 'Allociné',
    youtube_search: 'YouTube (recherche)',
    netflix_catalogue: 'Netflix Catalogue',
    override: 'Lien manuel',
};

function streamLinkLabel(s) {
    // YouTube est déjà identifié par le type de lecture (intégrée / externe) :
    // afficher seulement son nom évite d'encombrer Stremio avec l'ID complet.
    if (s.ytId) return 'YouTube';
    const raw = s.externalUrl || s.url;
    if (!raw) return null;
    try {
        const u = new URL(raw);
        if (/^(www\.)?(youtube\.com|youtu\.be)$/i.test(u.hostname)) return 'YouTube';
        const label = u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search;
        return label.length > 45 ? `${label.slice(0, 44)}…` : label;
    } catch { return null; }
}

function qualityLabel(h) {
    if (!h) return null;
    return h >= 2160 ? '4K 2160p' : `${h}p`;
}

function stripQuality(s) {
    if (!('__quality' in s)) return s;
    const { __quality, ...rest } = s; // marqueur interne, jamais envoyé
    return rest;
}

function applyDisplayMode(streams, config, source) {
    if (!streams || !streams.length) return streams;
    const mode = config && config.display;
    if (!DISPLAY_MODES.includes(mode) || mode === 'default') return streams.map(stripQuality);
    const sourceLabel = SOURCE_LABELS[source] || null;
    return streams.map(s => {
        const quality = qualityLabel(s.__quality);
        const external = !!s.externalUrl;
        const lines = String(s.title || '').split('\n').filter(l => l && l !== '(ouvrir dans YouTube)');
        const kind = lines[0] || 'Bande-annonce';
        const subject = lines[1] || '';
        if (mode === 'compact') {
            const parts = [external ? 'Ouvrir YouTube' : kind, quality, subject];
            return stripQuality({ ...s, title: parts.filter(Boolean).join(' • ') });
        }
        const l1 = subject ? `${kind} • ${subject}` : kind;
        const l2 = ['🇫🇷 VF ✓', sourceLabel ? `🔎 ${sourceLabel}` : null, quality ? `🎞️ ${quality}` : null].filter(Boolean).join(' • ');
        const l3 = external ? '▶️ Ouverture externe (YouTube)'
            : s.ytId ? '▶️ Lecteur intégré Stremio'
            : '▶️ Lien vidéo direct';
        const link = streamLinkLabel(s);
        const l4 = link ? `🔗 ${link}` : null;
        return stripQuality({ ...s, title: [l1, l2, l3, l4].filter(Boolean).join('\n') });
    });
}

// Flux d'exemple pour l'aperçu de /configure : mêmes constructeurs et mêmes fonctions de
// présentation que le vrai /stream (un seul endroit à maintenir), sur un film fictif.
function buildPreviewStreams(config, filmTitle, platform) {
    const film = filmTitle || 'Dune : Deuxième partie';
    const pair = (kind, ytId) => {
        const title = formatStreamTitle(kind, film);
        return [
            { name: formatStreamName(platform), title, ytId, __external: false, __quality: 1080 },
            { ...buildExternalYoutubeStream(ytId, title, platform), __quality: 1080 },
        ];
    };
    const sample = [...pair('Trailer', 'Way9Dexny3w'), ...pair('Teaser', 'WhXnDlOSBXE')];
    if (config.aiom) return toAiomStreams(sample);
    return applyDisplayMode(applyUserStreamPrefs(sample, config), config, 'tmdb');
}

// ---- Mode AIOMetadata ("A trailer addon" dans Meta Providers > Trailers) ----
// AIOMetadata interroge l'addon comme Stremio le ferait pour un stream, mais ne sait lire que
// deux choses : un `ytId` YouTube ou une URL vidéo directe. Les flux "ouvrir en externe"
// (externalUrl : jumeau YouTube, Dailymotion, lien /proposer) lui sont inutiles, voire nuisibles
// (un lien /proposer pourrait être pris pour un trailer). On ne garde donc qu'UN seul flux
// exploitable, ytId en priorité ; liste vide sinon -> AIOMetadata garde le trailer de son fournisseur.
function toAiomStreams(streams) {
    const usable = (streams || []).filter(s => s && (s.ytId || s.url));
    // ytId d'abord, puis une bande-annonce plutôt qu'un teaser (le teaser passe en premier dans la liste Stremio).
    const isTeaser = s => /^Teaser\b/.test(s.title || '');
    usable.sort((a, b) => ((b.ytId ? 1 : 0) - (a.ytId ? 1 : 0)) || ((isTeaser(a) ? 1 : 0) - (isTeaser(b) ? 1 : 0)));
    return usable.slice(0, 1).map(s => {
        const { __external, __quality, ...rest } = s; // marqueurs internes, jamais envoyés
        return rest;
    });
}

module.exports = {
    ACCEPTED_VIDEO_TYPES, EXTRA_VIDEO_TYPES, getAcceptedVideoTypes,
    PLATFORM_LABELS, formatStreamName, withSeasonLabel, formatStreamTitle,
    buildExternalYoutubeStream, applyUserStreamPrefs, toAiomStreams,
    DISPLAY_MODES, applyDisplayMode, buildPreviewStreams,
};
