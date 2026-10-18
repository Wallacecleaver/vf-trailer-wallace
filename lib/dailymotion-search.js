// ============================================================
// RECHERCHE DAILYMOTION — repli supplémentaire après YouTube.
//
// Contrairement à youtube-search.js (scraping de la page de résultats YouTube,
// via ytInitialData), Dailymotion expose une VRAIE API publique documentée,
// sans clé requise : https://api.dailymotion.com/videos?search=... -- pas de
// HTML à parser, pas de structure de page qui peut casser du jour au lendemain.
// Structurellement plus solide que le fallback YouTube, même si le filtrage
// VF/pertinence reste la même logique (best-effort, comme les autres reprises).
//
// Dailymotion héberge réellement ses propres vidéos (pas des embeds YouTube,
// contrairement à des sites comme CinéSérie) : de vraies chaînes comme
// "Allociné" ou "Bande Annonce Actu" y postent des bandes-annonces natives.
//
// Comme pour YouTube, c'est un DERNIER recours : n'importe qui peut uploader
// n'importe quoi sous n'importe quel titre sur Dailymotion aussi. Le filtrage
// est intentionnellement aussi strict que pour YouTube -- signal VF explicite +
// correspondance au titre officiel via title-match.js, sinon on ne renvoie rien
// plutôt qu'un mauvais match.
// ============================================================

const { pickBestVideoResult } = require('./title-match');
const { hasBlacklistSignal, hasNonVfSignal, hasVfSignal } = require('./video-filters');

const TIMEOUT_MS = 8000;
async function fetchTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: opts.signal || controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Filtres partagés (lib/video-filters.js) : mots-clés cherchés comme MOTS ENTIERS, plus de faux rejets
// du type "La Substance" (contient "sub") ou "Miles Davis" (contient "avis").
function passesLanguageAndNoiseFilters(title) {
    if (hasBlacklistSignal(title)) return false;
    if (hasNonVfSignal(title)) return false;
    return hasVfSignal(title);
}

// Recherche le premier résultat vidéo PERTINENT (VF + correspond au titre officiel).
// Renvoie { videoId, title } ou null si rien d'exploitable.
async function searchDailymotionTrailer(query, ref) {
    const results = await searchDailymotionRaw(query);
    // Le signal VF ne suffit pas : le titre doit aussi correspondre au film/série demandé (moteur v2),
    // et parmi les résultats valables on prend le MEILLEUR (titre le plus propre), pas le premier venu.
    const best = pickBestVideoResult(results, ref, r => passesLanguageAndNoiseFilters(r.title));
    return best ? { videoId: best.videoId, title: best.title } : null; // rien de VF ET pertinent -> mieux vaut rien qu'un mauvais match
}

// Recherche BRUTE pour le dashboard : renvoie les résultats tels quels, sans filtrage
// VF/pertinence -- c'est l'admin qui choisit le lien à mapper. Même API que searchDailymotionTrailer.
async function searchDailymotionRaw(query) {
    try {
        const fields = 'id,title,thumbnail_360_url,duration,owner.screenname';
        const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&fields=${fields}&limit=15&languages=fr&country=FR`;
        const res = await fetchTimeout(url);
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data.list) ? data.list : [];
        return list.map(v => ({
            videoId: v.id,
            title: v.title || '',
            channel: v['owner.screenname'] || null,
            duration: v.duration || null,
            thumb: v.thumbnail_360_url || null,
        }));
    } catch (err) {
        console.error('Erreur recherche Dailymotion:', err.message);
        return [];
    }
}

module.exports = { searchDailymotionTrailer, searchDailymotionRaw };
