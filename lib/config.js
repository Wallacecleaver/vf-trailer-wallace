// Configuration de l'addon : variables d'environnement, manifest Stremio, config utilisateur de l'URL.

const FALLBACK_TMDB_KEY = process.env.TMDB_API_KEY; // clé perso, réservée au testeur admin du dashboard (/api/test-resolve) — jamais utilisée pour les visiteurs de l'addon
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

// Logo servi comme fichier statique (public/logo_transparent_check.png) plutôt qu'en
// base64 dans le manifest : Stremio limite la taille du descriptor, et l'ancien base64
// (~40 Ko) le faisait dépasser -> erreur "Max descriptor size reached".
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const LOGO_URL = `${APP_BASE_URL}/logo_transparent_check.png`;
// Surchageable via env var si un domaine perso est ajouté un jour -- voir note sur LOGO_URL,
// même logique : une valeur fixe raisonnable par défaut plutôt qu'une détection dynamique
// fragile (pas d'accès à `req` à l'endroit où ce lien est construit, voir buildProposeLinkStream).

const manifest = {
    id: 'org.vftrailers',
    version: '3.5.0',
    name: 'W Bandes-Annonces VF',
    description: 'Addon Stremio bande d\'annonce VF',
    logo: LOGO_URL,
    // 'stream' reste pour l'app Stremio officielle (onglet Streams). On ajoute 'meta' à
    // côté : certains clients tiers (Fusion notamment) n'affichent leurs bandes-annonces
    // qu'à partir du champ `trailers` de l'objet meta, pas du resource `stream` -- les deux
    // mécanismes coexistent dans le protocole Stremio, indépendants l'un de l'autre.
    resources: ['stream', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
};

// ---- Décodage de la config utilisateur (base64url -> JSON) ----
// Segment de config plafonné à 2 Ko : au-delà, on refuse silencieusement (une config
// ne contient que tmdbKey/pseudo/maxLinks/externalOnly, jamais besoin de plus) --
// ça protège d'un URL abusivement long (anti-abus, allègement des logs).
function decodeConfig(str) {
    if (!str || typeof str !== 'string' || str.length > 2048) return {};
    try {
        let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const json = Buffer.from(b64, 'base64').toString('utf-8');
        const parsed = JSON.parse(json);
        const maxLinksNum = Number(parsed.maxLinks);
        return {
            tmdbKey: typeof parsed.tmdbKey === 'string' ? parsed.tmdbKey : null,
            pseudo: typeof parsed.pseudo === 'string' ? parsed.pseudo.trim().slice(0, 40) || null : null,
            // externalOnly : n'affiche que les flux "ouvrir dans YouTube" (pas de lecture intégrée).
            // maxLinks : limite le nombre total de flux renvoyés (1 à 10) -- certains utilisateurs
            // préfèrent un seul lien plutôt que 2-3 (trailer + teaser, jouable + externe...).
            // includeExtras : tri-state -- true force les extras, false les coupe, null (absent)
            // suit le réglage admin (behavior.includeExtras). Laisse l'admin décider par défaut,
            // tout en donnant au visiteur la main s'il le veut.
            externalOnly: parsed.externalOnly === true,
            includeExtras: typeof parsed.includeExtras === 'boolean' ? parsed.includeExtras : null,
            maxLinks: Number.isInteger(maxLinksNum) && maxLinksNum > 0 && maxLinksNum <= 10 ? maxLinksNum : null,
            // aiom : mode "A trailer addon" d'AIOMetadata (un seul flux ytId/url, délai court, pas de
            // flux externes ni de lien /proposer) -- voir toAiomStreams et la route /stream.
            aiom: parsed.aiom === true,
        };
    } catch {
        return {};
    }
}

module.exports = { FALLBACK_TMDB_KEY, DASHBOARD_PASSWORD, APP_BASE_URL, LOGO_URL, manifest, decodeConfig };
