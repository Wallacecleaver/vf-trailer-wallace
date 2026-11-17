// ============================================================
// RECHERCHE YOUTUBE — dernier recours, sans clé API ni quota.
//
// Contrairement à TMDB (catalogué) et Allociné (scraping ciblé sur une page
// dédiée), ici on scrape directement une page de résultats de recherche
// YouTube, comme le ferait un navigateur. C'est la source la MOINS fiable
// des trois : n'importe qui peut uploader n'importe quoi sous n'importe quel
// titre. Le repli vise donc uniquement des chaînes identifiées et un titre exact.
//
// IMPORTANT : avant, on acceptait le premier résultat qui avait juste "l'air"
// d'être en VF (signal VF + pas de mot-clé d'une autre langue), SANS vérifier
// que la vidéo avait un quelconque rapport avec le film/série demandé. YouTube
// a beau retourner des résultats pertinents pour la requête, rien n'empêche un
// résultat totalement hors-sujet (mauvais rapprochement algorithmique côté
// YouTube, vidéo virale sans rapport, etc.) de matcher juste sur le VF. C'est
// ce qui produisait des cas comme "Wildcat" -> trailer nommé "MIKAELA", ou
// "Soulm8te" -> trailer nommé "FALL 2 B..." : le mauvais nom aurait dû sauter
// aux yeux, mais rien ne le vérifiait. On exige maintenant aussi une
// correspondance avec le titre officiel via le moteur v2 matchVideoTitle
// (titre + garde-fous numériques, référence TMDB enrichie), et on continue de
// parcourir les résultats suivants tant qu'aucun ne matche, plutôt que de
// s'arrêter sur le premier "VF-like".
//
// Fragile par nature : dépend du HTML interne (ytInitialData) que YouTube
// peut changer sans préavis. Si le scraping casse un jour, cette fonction
// renvoie simplement null -> l'addon continue de fonctionner normalement,
// juste sans ce dernier filet de sécurité.
// ============================================================

const { pickBestVideoResult } = require('./title-match');
const { hasBlacklistSignal, hasNonVfSignal, hasVfSignal } = require('./video-filters');
const { normalizeTitle } = require('./matching');
const { channelPolicy, matchesChannel } = require('./youtube-channels');

// Timeout réseau : YouTube met parfois du temps à répondre -- un scrape lent
// ne doit pas faire échouer la résolution.
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
    const trailer = /\b(?:bandes? annonces?|trailers?|ba)\b/.test(normalizeTitle(title));
    return trailer && hasVfSignal(title);
}

// Recherche le premier résultat vidéo PERTINENT (VF + correspond au titre officiel)
// pour une requête donnée. `ref` (référence TMDB enrichie) sert uniquement à la
// vérification de pertinence, pas à la requête elle-même (déjà construite par
// l'appelant). Renvoie { videoId, title, channel } ou null si rien d'exploitable.
async function searchYoutubeTrailer(query, ref, opts = {}) {
    const policy = channelPolicy(opts.platform);
    const results = await searchYoutubeRaw(query + ' ' + policy.queryName);
    // Le signal VF ne suffit pas : le titre doit aussi correspondre au film/série demandé (moteur v2),
    // et parmi les résultats valables on prend le MEILLEUR (titre le plus propre), pas le premier venu.
    const options = { rejected: opts.rejected, now: opts.now };
    const pickFrom = channels => {
        for (const channel of channels) {
            const best = pickBestVideoResult(results, ref, r => passesLanguageAndNoiseFilters(r.title) && matchesChannel(r, channel), options);
            if (best) return best;
        }
        return null;
    };
    const best = pickFrom(policy.primary) || pickFrom(policy.secondary);
    return best ? { videoId: best.videoId, title: best.title, channel: best.channel } : null; // rien de VF ET pertinent -> mieux vaut rien qu'un mauvais match
}

// Recherche YouTube BRUTE pour le dashboard : renvoie les résultats tels quels (videoId,
// titre, miniature, durée) SANS filtrage VF/pertinence -- c'est l'admin qui choisit le lien
// qu'il veut mapper. Partage le même scraping ytInitialData que searchYoutubeTrailer.
async function searchYoutubeRaw(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=fr&gl=FR`;
        const res = await fetchTimeout(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept-Language': 'fr-FR,fr;q=0.9',
                // Évite la page de consentement RGPD (EU) qui remplacerait les résultats par un formulaire cookies.
                'Cookie': 'CONSENT=YES+1;',
            },
        });
        if (!res.ok) return [];
        const html = await res.text();

        const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
        if (!match) return [];

        let data;
        try {
            data = JSON.parse(match[1]);
        } catch {
            return [];
        }

        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
            ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

        const out = [];
        for (const item of contents) {
            const v = item.videoRenderer;
            if (!v || !v.videoId) continue;
            const title = v.title?.runs?.map(r => r.text).join('') || '';
            if (!title) continue;
            const owners = v.ownerText?.runs || v.longBylineText?.runs || v.shortBylineText?.runs || [];
            const owner = owners.find(run => run.navigationEndpoint?.browseEndpoint);
            const endpoint = owner?.navigationEndpoint?.browseEndpoint;
            out.push({
                videoId: v.videoId,
                title,
                channel: owners.map(r => r.text).join('') || null,
                channelId: endpoint?.browseId || null,
                channelUrl: endpoint?.canonicalBaseUrl || null,
                published: v.publishedTimeText?.simpleText || null,
                duration: v.lengthText?.simpleText || v.lengthText?.runs?.map(r => r.text).join('') || null,
                thumb: v.thumbnail?.thumbnails?.[0]?.url || null,
            });
            if (out.length >= 15) break;
        }
        return out;
    } catch (err) {
        console.error('Erreur recherche YouTube brute:', err.message);
        return [];
    }
}

module.exports = { searchYoutubeTrailer, searchYoutubeRaw };
