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

const { matchVideoTitle } = require('./title-match');

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

// Mêmes listes que youtube-search.js -- même logique de filtrage, juste une source différente.
const BLACKLIST_KEYWORDS = [
    'réaction', 'reaction', 'critique', 'review', 'avis', 'analyse', 'analysis',
    'explication', 'explained', 'easter egg', 'breakdown', 'recap', 'découpage',
    'making of', 'behind the scenes', 'interview', 'compilation', 'réagit',
    'décryptage', 'chronique',
];

const NON_VF_KEYWORDS = [
    'vost', 'vostfr', 'vosta', ' vo ', '(vo)', '[vo]', ' vo)', ' vo]', 'v.o.',
    'sub', 'subtitled', 'subbed', 'subtitles', 'original version', 'original trailer',
    'english', 'anglais', 'eng dub', '(eng)', '[eng]', ' eng ',
    'deutsch', 'german', 'allemand',
    'italiano', 'italian', 'italien',
    'español', 'espanol', 'spanish', 'espagnol', 'latino', 'castellano',
    'legendado', 'legendas', 'dublado', 'português', 'portugues', 'portuguese',
    'nederlands', 'dutch', 'néerlandais',
    '日本語', 'japanese', 'japonais',
    '한국어', 'korean', 'coréen',
    '中文', 'chinese', 'chinois', 'mandarin',
    'türkçe', 'turkish', 'turc',
    'polski', 'polish', 'polonais',
    'arabic', 'arabe', 'العربية',
    'hindi', 'हिन्दी',
];

function hasVfSignal(title) {
    return /\bvf\b/i.test(title) ||
        /\bvfq\b/i.test(title) ||
        /fran[çc]ais/i.test(title) ||
        /\bfrench\b/i.test(title) ||
        /qu[ée]b[ée]cois/i.test(title) ||
        /qu[ée]bec/i.test(title) ||
        /doublage/i.test(title);
}

function looksLegit(title, ref) {
    const t = (title || '').toLowerCase();
    if (BLACKLIST_KEYWORDS.some(kw => t.includes(kw))) return false;
    if (NON_VF_KEYWORDS.some(kw => t.includes(kw))) return false;
    if (!hasVfSignal(title)) return false;
    return matchVideoTitle(title, ref).matches;
}

// Recherche le premier résultat vidéo PERTINENT (VF + correspond au titre officiel).
// Renvoie { videoId, title } ou null si rien d'exploitable.
async function searchDailymotionTrailer(query, ref) {
    const results = await searchDailymotionRaw(query);
    for (const r of results) {
        if (looksLegit(r.title, ref)) return { videoId: r.videoId, title: r.title };
    }
    return null;
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
