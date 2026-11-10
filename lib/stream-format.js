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
function formatStreamName() {
    return '🎬 VF';
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
function formatExternalStreamName() {
    return '🎬 VF\n▶️ YouTube';
}

function buildExternalYoutubeStream(ytId, title) {
    return {
        name: formatExternalStreamName(),
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
        const { __external, ...rest } = s; // marqueur interne, jamais envoyé
        return rest;
    });
}

module.exports = {
    ACCEPTED_VIDEO_TYPES, EXTRA_VIDEO_TYPES, getAcceptedVideoTypes,
    formatStreamName, withSeasonLabel, formatStreamTitle,
    buildExternalYoutubeStream, applyUserStreamPrefs, toAiomStreams,
};
