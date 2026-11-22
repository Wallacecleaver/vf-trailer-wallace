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
const { safeFetch } = require('./security');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');
const { matchesSeasonVideo } = require('./season-match');
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

// 1. Cherche le film ou la série sur Allociné et renvoie son ID interne (fichefilm / ficheserie) —
// UNIQUEMENT si un résultat correspond vraiment au titre demandé (matching v2, pas un "à peu près").
async function findAllocineId(title, ref, mediaType = 'movie') {
    const query = encodeURIComponent(title);
    const res = await fetchTimeout(`https://www.allocine.fr/rechercher/?q=${query}`);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const slug = mediaType === 'tv' ? 'ficheserie' : 'fichefilm';
    const idRegex = mediaType === 'tv'
        ? /ficheserie[_-](?:gen_cserie=)?(\d+)/
        : /fichefilm[_-](?:gen_cfilm=)?(\d+)/;

    const seenIds = new Set();
    const candidates = [];

    $(`a[href*="${slug}"], main .meta-title-link`).each((_, el) => {
        const link = $(el);
        // Les résultats récents stockent le chemin relatif en base64 dans une classe ACr.
        const encoded = (link.attr('class') || '').match(/(?:^|\s)ACr([A-Za-z0-9+/=]{3})ACr([A-Za-z0-9+/=]+)(?=\s|$)/);
        const href = link.attr('href') || (encoded ? Buffer.from(encoded[1] + encoded[2], 'base64').toString('utf8') : '');
        const match = href.startsWith('/') && !href.startsWith('//') && href.match(idRegex);
        if (!match) return;
        const id = match[1];
        if (seenIds.has(id)) return; // Allociné répète parfois le même lien (image + titre)
        seenIds.add(id);

        // Texte le plus fiable : alt de l'affiche ("Titre (2006)"), sinon title du lien,
        // sinon texte du lien, sinon toute la carte (année incluse dans la carte).
        const card = link.closest('.entity-card');
        const imgAlt = link.find('img').first().attr('alt');
        const linkTitle = link.attr('title');
        const linkText = link.text().trim();
        const containerText = card.length ? card.find('.meta-body-info').first().text()
            : link.closest('li, article, div').first().text();

        let candTitle = imgAlt || linkTitle || linkText || containerText;
        candTitle = cleanCandidateTitle(candTitle);

        // Si le candidat n'a pas d'année mais la carte en montre une, on la rattache
        // (le matcher s'en sert pour valider/invalider, ex. remake homonyme).
        if (!extractYear(candTitle)) {
            const releaseDate = card.find('.meta-body-info .date').first().text();
            const containerYear = extractYear(releaseDate) || extractYear(containerText);
            if (containerYear) candTitle = `${candTitle} (${containerYear})`;
        }
        if (!candTitle) return;

        candidates.push({ id, title: candTitle.slice(0, 300) });
    });

    const best = findBestFilmMatch(candidates, ref);
    return best ? best.film.id : null;
}

// Allociné n'écrit plus ses liens en <a href> : ce sont des <span class="ACr…"> dont la classe contient
// le chemin relatif en base64, coupé en deux (« ACr » + 3 caractères + « ACr » + la suite).
// Ex. ACrL3ZACrpZGVv… -> /video/player_gen_cmedia=…. On décode donc aussi ces classes.
const ACR_CLASS_RE = /(?:^|\s)ACr([A-Za-z0-9+/=]{3})ACr([A-Za-z0-9+/=]+)(?=\s|$)/;
function hrefFromAcrClass(cls) {
    const m = String(cls || '').match(ACR_CLASS_RE);
    if (!m) return null;
    try {
        const decoded = Buffer.from(m[1] + m[2], 'base64').toString('utf8');
        return decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : null;
    } catch { return null; }
}

// Tous les liens de la page (vrais <a> + liens encodés), regroupés par chemin : l'affiche et le titre
// d'une même vidéo pointent vers la même URL mais ne portent pas le même texte.
function collectLinks($) {
    const byHref = new Map();
    $('a[href], [class*="ACr"]').each((_, el) => {
        const node = $(el);
        const href = node.attr('href') || hrefFromAcrClass(node.attr('class'));
        if (!href || !href.startsWith('/')) return;
        const text = [node.text(), node.attr('title'), node.attr('aria-label')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        byHref.set(href, `${byHref.get(href) || ''} ${text}`.trim());
    });
    return [...byHref].map(([href, text]) => ({ href, text }));
}

// Lecteurs déclarés dans <figure data-model="{videos:[…]}"> : donne l'id Dailymotion de la vidéo
// (le lecteur Allociné d'une série n'expose souvent aucun mp4 direct).
function collectPlayerVideos($) {
    const videos = [];
    $('[data-model]').each((_, el) => {
        try {
            const model = JSON.parse($(el).attr('data-model'));
            for (const v of (model && model.videos) || []) if (v && v.id) videos.push(v);
        } catch { /* ce data-model n'est pas celui d'un lecteur */ }
    });
    return videos;
}

// Choisit la bande-annonce VF dans une page Allociné déjà chargée (liste de vidéos ou fiche série).
function pickTrailerFromPage($, { mediaType, directOnly, season }) {
    const players = collectPlayerVideos($);
    let best = null;
    for (const { href, text: rawText } of collectLinks($)) {
        if (!/player_gen_cmedia=|\/video\//.test(href)) continue;
        const text = rawText.toLowerCase();
        if (mediaType === 'tv' && !matchesSeasonVideo(text, season)) continue;
        if (hasNonVfSignal(text) || /version originale|sous-titr/.test(text)) continue;
        if (!/bande[- ]annonce/.test(text)) continue;
        const french = hasVfSignal(text);
        if (directOnly && !french) continue;
        if (best && (best.french || !french)) continue; // une VF explicite l'emporte, sinon on garde la première
        const url = new URL(href, 'https://www.allocine.fr');
        const mediaId = (href.match(/player_gen_cmedia=(\d+)/) || [])[1];
        const player = players.find(v => String(v.id) === mediaId);
        best = { url: url.href, french, dailymotionId: (player && player.idDailymotion) || null };
    }
    return best;
}

// 2. Récupère les vidéos listées pour ce film ou cette série, et cherche une bande-annonce.
// Pour une série on essaie la page « Vidéos », l'ancienne URL, puis la fiche série elle-même
// (une série à venir n'a souvent qu'une bande-annonce, visible sur la fiche).
async function getTrailerPageUrl(allocineId, { mediaType, directOnly, season }) {
    const urls = mediaType === 'tv'
        ? [`https://www.allocine.fr/series/ficheserie-${allocineId}/videos/`,
           `https://www.allocine.fr/videos/ficheserie-${allocineId}/toutes/`,
           `https://www.allocine.fr/series/ficheserie_gen_cserie=${allocineId}.html`]
        : [`https://www.allocine.fr/videos/fichefilm-${allocineId}/toutes/`];
    for (const pageUrl of urls) {
        try {
            const res = await fetchTimeout(pageUrl);
            if (!res.ok) continue;
            const found = pickTrailerFromPage(cheerio.load(await res.text()), { mediaType, directOnly, season });
            if (found) return found;
        } catch { /* page suivante */ }
    }
    return null;
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

// AIOM Direct peut essayer plusieurs URLs du lecteur, plutôt qu'une page og:video.
async function getDirectVideoCandidates(playerPageUrl) {
    const page = new URL(playerPageUrl);
    if (page.protocol !== 'https:' || !/(^|\.)allocine\.fr$/i.test(page.hostname)) return [];
    const res = await safeFetch(page.href, {
        headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), size: 2 * 1024 * 1024,
    });
    if (!res.ok) {
        res.body?.destroy?.();
        return [];
    }
    const $ = cheerio.load(await res.text());
    const candidates = new Set();
    const add = raw => {
        if (typeof raw !== 'string' || !raw.trim()) return;
        try {
            const url = new URL(raw, res.url || page.href);
            if (url.protocol === 'https:') candidates.add(url.href);
        } catch { /* URL ignorée */ }
    };
    $('video[src], video source[src]').each((_, el) => add($(el).attr('src')));
    $('[data-model]').each((_, el) => {
        if (candidates.size >= 8) return false;
        try {
            const model = JSON.parse($(el).attr('data-model'));
            const sources = model?.videos?.[0]?.sources || model?.sources;
            if (sources) {
                for (const source of Object.values(sources)) add(typeof source === 'string' ? source : source?.src || source?.url);
            }
        } catch { /* Le modèle n'est pas celui d'un lecteur */ }
    });
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const doc = JSON.parse($(el).html());
            const objects = Array.isArray(doc) ? doc : doc?.['@graph'] || [doc];
            for (const obj of objects) if (obj?.['@type'] === 'VideoObject') add(obj.contentUrl);
        } catch { /* Métadonnées incomplètes */ }
    });
    $('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]')
        .each((_, el) => add($(el).attr('content')));
    const urls = [...candidates];
    return [...urls.filter(url => /\.mp4$/i.test(new URL(url).pathname)),
        ...urls.filter(url => !/\.mp4$/i.test(new URL(url).pathname))];
}

// Fonction principale exportée : renvoie une liste de streams façon Stremio
// `title` sert à la requête de recherche, `ref` (référence TMDB enrichie) au matching.
async function getAllocineTrailerStreams(title, ref, { mediaType = 'movie', directOnly = false, season } = {}) {
    try {
        const allocineId = await findAllocineId(title, ref, mediaType);
        if (!allocineId) return [];

        const trailer = await getTrailerPageUrl(allocineId, { mediaType, directOnly, season });
        if (!trailer) return [];

        if (directOnly) return (await getDirectVideoCandidates(trailer.url)).map(url => ({ url }));

        const streamUrl = await extractVideoStreamUrl(trailer.url).catch(() => null);
        const playable = streamUrl && /\.(mp4|m3u8)(\?|$)/i.test(streamUrl.split('#')[0]);
        const label = `Bande-annonce${trailer.french ? ' VF' : ''} (Allociné) - ${title}`;
        const audioFlag = trailer.french ? {} : { __unverifiedAudio: true };
        if (streamUrl && (playable || !trailer.dailymotionId)) {
            return [{ title: label, url: streamUrl, ...audioFlag }];
        }
        // Lecteur Dailymotion sans mp4 direct : Stremio ne sait pas le lire, on ouvre la vidéo en externe.
        if (trailer.dailymotionId) {
            return [{ title: label, externalUrl: `https://www.dailymotion.com/video/${trailer.dailymotionId}`, __external: true, ...audioFlag }];
        }
        return [];
    } catch (err) {
        console.error('Erreur fallback Allociné:', err.message);
        return [];
    }
}

module.exports = { getAllocineTrailerStreams, hrefFromAcrClass, pickTrailerFromPage };
