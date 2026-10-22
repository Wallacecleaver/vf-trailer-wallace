// ============================================================
// FALLBACK ALLOCINÉ — scraping pour récupérer une bande-annonce VF
// quand TMDB n'en a pas.
//
// ATTENTION : contrairement à TMDB (API stable), on scrape du HTML public.
// Si Allociné change la structure de leurs pages, ce module cassera et
// il faudra ajuster les sélecteurs / regex ci-dessous.
//
// IMPORTANT (v2 matching) : avant, on prenait AVEUGLÉMENT le premier lien
// "fichefilm" trouvé, vérifié seulement par un titleMatches faible (au moins
// un mot partagé). Sur un titre ambigu, un remake, ou une recherche qui
// remontait un homonyme, ça pouvait renvoyer la bande-annonce d'un AUTRE film.
// On passe maintenant TOUS les candidats au moteur de matching v2
// (findBestFilmMatch via title-match.js) : titre normalisé + année + garde-fous
// anti-suite ("Prada 2" ne matche plus "Prada") et on garde le meilleur candidat
// qui passe le seuil. La référence TMDB est ENRICHIE (titre FR + original +
// titres alternatifs), voir buildRef côté index.js.
// ============================================================

const fetch = require('node-fetch');
const cheerio = require('cheerio'); // npm i cheerio
const { findBestFilmMatch, extractYear } = require('./title-match');

const HEADERS = {
    // Un vrai User-Agent desktop pour éviter d'être bloqué bêtement
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
};

// Timeout réseau : un scrape Allociné qui ne répond pas ne doit pas faire échouer
// toute la résolution.
const TIMEOUT_MS = 8000;
async function fetchTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) }, signal: opts.signal || controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Nettoie un texte de candidat : tout ce qui suit le premier (année) est du bruit
// (synopsis, métadonnées de la carte de recherche) qui ferait échouer le tier
// "inclusion" du matcher film (il n'autorise que les mots "d'édition" en plus).
// Ex. "Le Diable s'habille en Prada (2006) 1h49 ... Synopsis" -> on garde
// "Le Diable s'habille en Prada (2006)".
function cleanCandidateTitle(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/^([\s\S]*?\(?\b(?:19|20)\d{2}\)?)/);
    return (m ? m[1] : s).trim();
}

// 1. Cherche le film sur Allociné et renvoie son ID interne (fichefilm) — UNIQUEMENT
// si un résultat correspond vraiment au film demandé (matching v2, pas un "à peu près").
async function findAllocineId(title, ref) {
    const query = encodeURIComponent(title);
    const res = await fetchTimeout(`https://www.allocine.fr/recherche/?q=${query}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Les liens de fiches films ressemblent à :
    // /film/fichefilm_gen_cfilm=123456.html ou /film/fichefilm-123456/
    // On collecte TOUS les candidats (dans l'ordre de pertinence d'Allociné), on
    // construit un titre propre pour chacun (alt de l'image > title > texte du lien
    // > carte complète), puis on laisse findBestFilmMatch choisir le meilleur qui
    // dépasse le seuil — au lieu du premier lien venu comme avant.
    const seenIds = new Set();
    const candidates = [];

    $('a[href*="fichefilm"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/fichefilm[_-](?:gen_cfilm=)?(\d+)/);
        if (!match) return;
        const id = match[1];
        if (seenIds.has(id)) return; // Allociné répète parfois le même lien (image + titre)
        seenIds.add(id);

        // Texte le plus fiable : alt de l'affiche ("Titre (2006)"), sinon title du lien,
        // sinon texte du lien, sinon toute la carte (année incluse dans la carte).
        const imgAlt = $(el).find('img').first().attr('alt');
        const linkTitle = $(el).attr('title');
        const linkText = $(el).text().trim();
        const containerText = $(el).closest('li, article, div').first().text();

        let candTitle = imgAlt || linkTitle || linkText || containerText;
        candTitle = cleanCandidateTitle(candTitle);

        // Si le candidat n'a pas d'année mais la carte en montre une, on la rattache
        // (le matcher film s'en sert pour valider/invalider, ex. remake homonyme).
        if (!extractYear(candTitle)) {
            const containerYear = extractYear(containerText);
            if (containerYear) candTitle = `${candTitle} (${containerYear})`;
        }
        if (!candTitle) return;

        candidates.push({ id, title: candTitle.slice(0, 300) });
    });

    const best = findBestFilmMatch(candidates, ref);
    return best ? best.film.id : null;
}

// 2. Récupère les vidéos listées pour ce film, et cherche une bande-annonce
async function getTrailerPageUrl(allocineId) {
    const res = await fetchTimeout(`https://www.allocine.fr/videos/fichefilm-${allocineId}/toutes/`);
    const html = await res.text();
    const $ = cheerio.load(html);

    let trailerHref = null;

    // Allociné liste parfois plusieurs versions d'une même bande-annonce (VF, VOST, VO)
    // sur la page "toutes les vidéos". On exclut explicitement tout ce qui est étiqueté
    // VOST/VO -- une entrée sans mention de langue est considérée VF par défaut, Allociné
    // étant un site français où c'est la version proposée en premier lieu.
    const NON_VF_LABELS = ['vost', 'vostfr', ' vo ', '(vo)', '[vo]', 'v.o.', 'version originale', 'sous-titr'];

    $('a[href*="player_gen_cmedia"], a[href*="/video/"]').each((_, el) => {
        if (trailerHref) return;

        const text = $(el).text().toLowerCase();
        const href = $(el).attr('href') || '';

        if (NON_VF_LABELS.some(kw => text.includes(kw))) return; // VOST/VO explicite -> on passe

        // On cherche en priorité une "bande-annonce" (pas un extrait/making-of)
        if (text.includes('bande-annonce') || text.includes('bande annonce')) {
            trailerHref = href.startsWith('http') ? href : `https://www.allocine.fr${href}`;
        }
    });

    return trailerHref;
}

// 3. Sur la page du lecteur vidéo, extrait l'URL réelle du flux (mp4/hls)
async function extractVideoStreamUrl(playerPageUrl) {
    const res = await fetchTimeout(playerPageUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Tentative 1 : JSON-LD VideoObject (schema.org), souvent présent pour le SEO
    let streamUrl = null;

    $('script[type="application/ld+json"]').each((_, el) => {
        if (streamUrl) return;
        try {
            const json = JSON.parse($(el).html());
            const obj = Array.isArray(json) ? json.find(o => o['@type'] === 'VideoObject') : json;
            if (obj && obj['@type'] === 'VideoObject' && obj.contentUrl) {
                streamUrl = obj.contentUrl;
            }
        } catch {
            // JSON invalide, on ignore et on essaie les autres méthodes
        }
    });

    // Tentative 2 : balise <video> ou <source> directe
    if (!streamUrl) {
        const videoSrc = $('video source').first().attr('src') || $('video').first().attr('src');
        if (videoSrc) streamUrl = videoSrc;
    }

    // Tentative 3 : meta og:video
    if (!streamUrl) {
        const ogVideo = $('meta[property="og:video"]').attr('content')
            || $('meta[property="og:video:url"]').attr('content');
        if (ogVideo) streamUrl = ogVideo;
    }

    return streamUrl;
}

// Fonction principale exportée : renvoie une liste de streams façon Stremio
// `title` sert à la requête de recherche, `ref` (référence TMDB enrichie) au matching.
async function getAllocineTrailerStreams(title, ref) {
    try {
        const allocineId = await findAllocineId(title, ref);
        if (!allocineId) return [];

        const playerPageUrl = await getTrailerPageUrl(allocineId);
        if (!playerPageUrl) return [];

        const streamUrl = await extractVideoStreamUrl(playerPageUrl);
        if (!streamUrl) return [];

        return [{
            title: `Bande-annonce VF (Allociné) - ${title}`,
            url: streamUrl
        }];
    } catch (err) {
        console.error('Erreur fallback Allociné:', err.message);
        return [];
    }
}

module.exports = { getAllocineTrailerStreams };
