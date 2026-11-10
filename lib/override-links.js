// Liens d'un override manuel : liste prioritaire, vérification « le lien est-il vivant ? », flux YouTube.

const { probeDirectLink } = require('./media-link');
const { netflixUrlToRelay } = require('./netflix-trailer');
const { youtubeIdFromUrl } = require('./overrides');
const { getCached, setCached } = require('./cache');
const { fetchT, youtubeOembedUrl } = require('./net');
const { formatStreamName, formatStreamTitle, withSeasonLabel, buildExternalYoutubeStream } = require('./stream-format');

// Construit la liste prioritaire de liens d'un override (rétrocompat avec ytId/url seuls).
function buildOverrideLinks(override) {
    // Une URL YouTube enregistrée dans le champ "URL directe" (anciens overrides) est servie comme un vrai lien YouTube.
    const fromUrl = u => { const id = youtubeIdFromUrl(u); return id ? { ytId: id } : { url: netflixUrlToRelay(u) }; };
    const links = Array.isArray(override.links)
        ? override.links
            .filter(l => l && (typeof l.ytId === 'string' && l.ytId.trim() || typeof l.url === 'string' && l.url.trim()))
            .map(l => l.ytId ? { ytId: l.ytId.trim() } : fromUrl(l.url.trim()))
        : [];
    if (!links.length) {
        if (typeof override.ytId === 'string' && override.ytId.trim()) links.push({ ytId: override.ytId.trim() });
        else if (typeof override.url === 'string' && override.url.trim()) links.push(fromUrl(override.url.trim()));
    }
    return links;
}

// Vérifie (oEmbed) qu'une vidéo YouTube existe et est publique -- sert à sauter un lien mort
// et passer au repli suivant. Coûteux (1 requête), donc réservé au cas multi-liens.
async function isYoutubeLinkAvailable(ytId) {
    try {
        const r = await fetchT(youtubeOembedUrl(ytId), {}, 5000);
        return r.ok;
    } catch {
        return false;
    }
}

// Vérifie (HEAD) qu'une URL directe répond -- sert à sauter un lien mort dans la chaîne
// de repli, comme isYoutubeLinkAvailable pour les ytId. Réservé au cas multi-liens.
async function isUrlReachable(url) {
    try {
        const r = await fetchT(url, { method: 'HEAD', redirect: 'follow' }, 5000);
        if (r.ok || r.status < 400) return true;
        // Beaucoup de CDN refusent HEAD (403/405/501) alors que le GET fonctionne : ce n'est pas un lien mort.
        if (![400, 403, 405, 501].includes(r.status)) return false;
    } catch { /* on retente en GET */ }
    return (await probeDirectLink(url, 5000)).ok;
}

// TTL du cache "quel lien est actuellement vivant" pour les overrides à liens de repli
// multiples (voir resolveOverrideLinks). Volontairement court : un lien qui vient de
// mourir reste servi jusqu'à expiration -- même compromis que le reste du cache de
// l'addon (cache.js), pas un cas à part.
const OVERRIDE_LINK_CHECK_TTL_SECONDS = 10 * 60; // 10 min

// Résout les liens d'un override en respectant l'ordre de priorité : le PREMIER lien jouable
// est servi, les suivants servent de repli si une vidéo devient indisponible/supprimée.
// Cas courant (1 seul lien) : comportement identique à avant, zéro latence ajoutée.
//
// Cas à 2+ liens : déterminer "lequel est encore vivant" demande un appel réseau par lien
// (oEmbed YouTube / HEAD sur l'URL, jusqu'à 5s chacun) -- REFAIT AVANT à CHAQUE requête
// Stremio de CHAQUE visiteur regardant ce titre, sans aucun cache, contrairement au reste
// de l'addon. Sur un override à 2-3 replis, ça pouvait ajouter plusieurs secondes de
// latence à chaque ouverture. On met maintenant en cache l'INDEX du premier lien trouvé
// vivant (`overrideKey` = imdbId:season), invalidé automatiquement par overrides.js dès
// que l'override est modifié -- donc pas de risque de rester bloqué sur un mauvais choix
// après une correction manuelle.
// Ajoute "👤 Proposé par X" en 2e ligne du titre affiché dans Stremio, uniquement quand
// l'override vient d'une contribution communautaire acceptée (override.contributedBy).
// Un override créé/édité normalement par l'admin depuis le dashboard n'a pas ce champ
// -> le titre reste inchangé, aucune mention n'apparaît.
function withContributorNote(title, contributedBy) {
    return contributedBy ? `${title}\n👤 Proposé par ${contributedBy}` : title;
}

async function resolveOverrideLinks(links, overrideTitle, overrideKey, contributedBy, season) {
    const baseTitle = overrideTitle ? withSeasonLabel(overrideTitle, season) : formatStreamTitle('trailer', null, season);
    const title = withContributorNote(baseTitle, contributedBy);

    if (links.length === 1) {
        const l = links[0];
        if (l.ytId) return buildYoutubeStreams(l.ytId, title);
        return [{ name: formatStreamName(), title, url: l.url }];
    }

    const cacheKey = overrideKey ? `cache:override-link:${overrideKey}` : null;
    if (cacheKey) {
        const cached = await getCached(cacheKey);
        if (cached && typeof cached.index === 'number' && links[cached.index]) {
            const l = links[cached.index];
            return l.ytId ? buildYoutubeStreams(l.ytId, title) : [{ name: formatStreamName(), title, url: l.url }];
        }
    }

    for (let i = 0; i < links.length; i++) {
        const l = links[i];
        if (l.ytId) {
            if (!(await isYoutubeLinkAvailable(l.ytId))) continue; // lien mort -> repli suivant
            if (cacheKey) await setCached(cacheKey, { index: i }, OVERRIDE_LINK_CHECK_TTL_SECONDS);
            return buildYoutubeStreams(l.ytId, title);
        }
        if (!(await isUrlReachable(l.url))) continue; // lien mort -> repli suivant
        if (cacheKey) await setCached(cacheKey, { index: i }, OVERRIDE_LINK_CHECK_TTL_SECONDS);
        return [{ name: formatStreamName(), title, url: l.url }];
    }
    return []; // tous les liens sont morts -> on ne sert rien (plutôt que du cassé)
}

// Flux YouTube servi tel quel via `ytId` (lecteur intégré Stremio officiel), sans tentative
// d'extraction d'une URL directe -- ancien comportement retiré : le scraping ytdl-core était
// quasi-systématiquement bloqué par la protection anti-bot de YouTube sur les IP de datacenter
// (voir historique), pour un gain quasi nul et beaucoup de latence/bruit dans les logs.
function buildYoutubeStreams(ytId, title) {
    const stream = { name: formatStreamName(), title, ytId, __external: false };
    return [stream, buildExternalYoutubeStream(ytId, title)];
}

module.exports = { buildOverrideLinks, resolveOverrideLinks, buildYoutubeStreams };
