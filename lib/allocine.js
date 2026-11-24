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

const ALLOCINE_ORIGIN = 'https://www.allocine.fr';
const ALLOCINE_CACHE_VERSION = 2;
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
            if (!Array.isArray(model?.videos)) return;
            for (const video of model.videos) {
                if (video?.id) {
                    const element = model.videos.length === 1 ? el : null;
                    videos.push({ video, element, sources: video.sources ?? (element ? model.sources : null) });
                }
            }
        } catch { /* ce data-model n'est pas celui d'un lecteur */ }
    });
    return videos;
}

function parsePlayerLink(href) {
    try {
        const url = new URL(href, ALLOCINE_ORIGIN);
        if (url.origin !== ALLOCINE_ORIGIN || url.username || url.password) return null;
        const pathname = decodeURIComponent(url.pathname);
        const legacy = pathname.match(/^\/video\/player_gen_cmedia=(\d+)(&[^/]*)?\.html$/);
        const mediaId = legacy?.[1] || pathname.match(/^\/video\/video-(\d+)\/?$/)?.[1];
        if (!mediaId) return null;
        const params = new URLSearchParams([legacy?.[2]?.slice(1), url.search.slice(1)].filter(Boolean).join('&'));
        return { url: url.href, mediaId, films: params.getAll('cfilm'), series: params.getAll('cserie') };
    } catch {
        return null;
    }
}

function playerLinkConflicts(link, entityId, isSeries) {
    const ownIds = isSeries ? link.series : link.films;
    const otherIds = isSeries ? link.films : link.series;
    return !!otherIds.length || ownIds.some(id => id !== entityId);
}

function playerModelConflicts(video, entityId, isSeries) {
    return (video.relatedEntityType && video.relatedEntityType !== (isSeries ? 'series' : 'movie'))
        || (video.relatedEntityId != null && String(video.relatedEntityId) !== entityId);
}

// Choisit la bande-annonce VF dans une page Allociné déjà chargée (liste de vidéos ou fiche série).
function pickTrailerFromPage($, { allocineId, mediaType, directOnly, season }) {
    const players = collectPlayerVideos($);
    const isSeries = mediaType === 'tv';
    const entityId = String(allocineId);
    let best = null;
    for (const { href, text: rawText } of collectLinks($)) {
        const link = parsePlayerLink(href);
        if (!link) continue;
        // Les pages « Vidéos » peuvent afficher des bandes-annonces d'autres titres dans le rail latéral.
        if (playerLinkConflicts(link, entityId, isSeries)) continue;
        const player = players.find(({ video }) => String(video.id) === link.mediaId)?.video;
        if (player && playerModelConflicts(player, entityId, isSeries)) continue;
        if (!link.films.length && !link.series.length && (!player?.relatedEntityType || player.relatedEntityId == null)) continue;

        const text = rawText.toLowerCase();
        if (isSeries && !matchesSeasonVideo(text, season)) continue;
        if (hasNonVfSignal(text) || /version originale|sous-titr/.test(text)) continue;
        if (!/bande[- ]annonce/.test(text)) continue;
        const french = hasVfSignal(text);
        if (directOnly && !french) continue;
        if (best && (best.french || !french)) continue; // une VF explicite l'emporte, sinon on garde la première
        best = { url: link.url, french, dailymotionId: player?.idDailymotion || null };
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
            const found = pickTrailerFromPage(cheerio.load(await res.text()), { allocineId, mediaType, directOnly, season });
            if (found) return found;
        } catch { /* page suivante */ }
    }
    return null;
}

function referencesMedia(raw, pageUrl, mediaId) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    try {
        const url = new URL(raw, pageUrl);
        if (url.origin === 'https://player.allocine.fr' && url.pathname === '/' + mediaId + '.html') return true;
        if (url.protocol === 'https:' && url.hostname.endsWith('.acsta.net')
            && url.pathname.split('/').at(-1).match(/^(\d+)[_.-]/)?.[1] === mediaId) return true;
        return parsePlayerLink(url.href)?.mediaId === mediaId;
    } catch { return false; }
}

// Les sources de lecture doivent appartenir à la vidéo choisie, y compris après redirection.
async function getTrailerMedia(trailer, allocineId, mediaType) {
    const page = parsePlayerLink(trailer.url);
    const res = await safeFetch(page.url, {
        headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), size: 2 * 1024 * 1024,
    }, { allowPrivateUpstream: false });
    const destination = parsePlayerLink(res.url || page.url);
    const isSeries = mediaType === 'tv';
    const entityId = String(allocineId);
    if (!res.ok || destination?.mediaId !== page.mediaId || playerLinkConflicts(destination, entityId, isSeries)) {
        res.body?.destroy?.();
        return { urls: [] };
    }

    const $ = cheerio.load(await res.text());
    const players = collectPlayerVideos($).filter(({ video }) => String(video.id) === page.mediaId);
    if (players.some(({ video }) => playerModelConflicts(video, entityId, isSeries) || hasNonVfSignal(video.title))) {
        return { urls: [] };
    }

    const mp4 = new Set();
    const hls = new Set();
    const add = raw => {
        if (typeof raw !== 'string' || !raw.trim()) return;
        try {
            const url = new URL(raw, destination.url);
            if (url.protocol !== 'https:' || url.username || url.password) return;
            if (/\.mp4$/i.test(url.pathname)) mp4.add(url.href);
            if (/\.m3u8$/i.test(url.pathname)) hls.add(url.href);
        } catch { /* URL ignorée */ }
    };
    const matches = raw => referencesMedia(raw, destination.url, page.mediaId);
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const doc = JSON.parse($(el).html());
            const objects = Array.isArray(doc) ? doc : doc?.['@graph'] || [doc];
            for (const obj of objects) {
                if (obj?.['@type'] === 'VideoObject' && !hasNonVfSignal(obj.name)
                    && [obj.embedUrl, obj.url, obj.contentUrl].some(matches)) add(obj.contentUrl);
            }
        } catch { /* Métadonnées incomplètes */ }
    });
    for (const { video, element, sources } of players) {
        if (sources) {
            for (const source of Object.values(sources)) add(typeof source === 'string' ? source : source?.src || source?.url);
        }
        if (matches(video.contentUrl)) add(video.contentUrl);
        $(element).find('video[src], video source[src]').each((_, el) => add($(el).attr('src')));
    }
    $('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]')
        .each((_, el) => {
            const url = $(el).attr('content');
            if (matches(url)) add(url);
        });
    const dailymotionId = players.map(({ video }) => video.idDailymotion).find(Boolean) || trailer.dailymotionId;
    return { urls: [...mp4, ...hls], dailymotionId };
}

// Fonction principale exportée : renvoie une liste de streams façon Stremio
// `title` sert à la requête de recherche, `ref` (référence TMDB enrichie) au matching.
async function getAllocineTrailerStreams(title, ref, { mediaType = 'movie', directOnly = false, season } = {}) {
    try {
        const allocineId = await findAllocineId(title, ref, mediaType);
        if (!allocineId) return [];

        const trailer = await getTrailerPageUrl(allocineId, { mediaType, directOnly, season });
        if (!trailer) return [];

        const { urls, dailymotionId } = await getTrailerMedia(trailer, allocineId, mediaType)
            .catch(() => ({ urls: [], dailymotionId: trailer.dailymotionId }));
        if (directOnly) return urls.map(url => ({ url }));

        const [streamUrl] = urls;
        const label = `Bande-annonce${trailer.french ? ' VF' : ''} (Allociné) - ${title}`;
        const audioFlag = trailer.french ? {} : { __unverifiedAudio: true };
        if (streamUrl) {
            return [{ title: label, url: streamUrl, ...audioFlag }];
        }
        // Lecteur Dailymotion sans mp4 direct : Stremio ne sait pas le lire, on ouvre la vidéo en externe.
        if (typeof dailymotionId === 'string' && /^[a-z0-9]+$/i.test(dailymotionId)) {
            return [{ title: label, externalUrl: `https://www.dailymotion.com/video/${dailymotionId}`, __external: true, ...audioFlag }];
        }
        return [];
    } catch (err) {
        console.error('Erreur fallback Allociné:', err.message);
        return [];
    }
}

module.exports = { ALLOCINE_CACHE_VERSION, getAllocineTrailerStreams, hrefFromAcrClass, pickTrailerFromPage };
