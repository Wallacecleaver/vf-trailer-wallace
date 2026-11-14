// Résolution « sans override ni cache » : TMDB, puis Allociné / recherche YouTube,
// puis l'instance Netflix Catalogue (fédération par URL, sans clé API).

const { getAllocineTrailerStreams } = require('./allocine');
const { resolveFederatedTrailer } = require('./netflix-federation');
const { searchYoutubeTrailer } = require('./youtube-search');
const { buildRef, matchVideoTitle } = require('./title-match');
const { hasNonVfSignal, hasVfSignal } = require('./video-filters');
const { fetchT } = require('./net');
const { findByImdb, getTitleAndYear, getAlternativeTitles } = require('./tmdb');
const { EXTRA_VIDEO_TYPES, getAcceptedVideoTypes, formatStreamTitle } = require('./stream-format');

function pickBestTrailers(videos, maxTrailers) {
    // Affichage dans Stremio : le meilleur Teaser (s'il y en a un) PUIS la bande-annonce, puis les
    // éventuels extras (Clip, Récap, Making-of...) s'ils sont activés. Un teaser disponible est donc
    // toujours proposé en plus de la bande-annonce, même avec maxTrailers = 1 (on passe alors à 2).
    const byFreshness = (a, b) => {
        if (a.official !== b.official) return a.official ? -1 : 1;
        return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    };
    const ofType = t => videos.filter(v => v.type === t).sort(byFreshness);
    const teasers = ofType('Teaser');
    const trailers = ofType('Trailer');
    const extras = videos.filter(v => v.type !== 'Trailer' && v.type !== 'Teaser').sort(byFreshness);

    const limit = teasers.length ? Math.max(maxTrailers, 2) : maxTrailers;
    const seenNames = new Set();
    const picked = [];
    const add = v => {
        const key = v.name.trim().toLowerCase();
        if (seenNames.has(key) || picked.length >= limit) return;
        seenNames.add(key);
        picked.push(v);
    };
    if (teasers.length) add(teasers[0]);
    for (const v of trailers) add(v);
    for (const v of extras) add(v);
    return picked;
}

// Transforme les bandes-annonces de l'instance Netflix Catalogue en flux Stremio.
// Ce sont des URLs vidéo directes (relais /trailer/... de l'amont), pas des IDs YouTube.
function federationStreams(trailers, officialTitle, season, maxTrailers) {
    return (trailers || [])
        .slice(0, Math.max(1, maxTrailers || 2))
        .map(t => ({
            title: formatStreamTitle(/teaser/i.test(t.title || '') ? 'Teaser' : 'Trailer', officialTitle, season),
            url: t.url,
        }));
}

// Résolution complète (sans override, sans cache) — TMDB, puis Allociné / YouTube / Netflix Catalogue en repli
// `trace` (optionnel) : tableau dans lequel on pousse les étapes { step, ok, detail, ms } pour
// le testeur admin (/api/test-resolve). Non fourni -> aucune instrumentation (0 surcoût).
async function resolveViaApis(type, imdbId, season, behavior, tmdbKey, trace) {
    const rec = (step, ok, detail, ms) => { if (trace) trace.push({ step, ok: !!ok, detail: detail || '', ms: ms == null ? null : ms }); };
    // Mots-clés "pas VF" ajoutés par l'admin (réglages) : cherchés tels quels dans le titre, comme avant.
    const extraNonVf = (behavior.extraVfKeywords || []).map(k => String(k).toLowerCase()).filter(Boolean);
    // Strict : il faut un signal explicite VF/VFQ ET aucune trace d'une autre langue (mots entiers, voir
    // lib/video-filters.js). Un trailer sans AUCUNE indication de langue (ex: "Official Trailer" tout court)
    // est donc rejeté par défaut -> pas de VF, pas de faux "peut-être français".
    const isLikelyVF = name => !hasNonVfSignal(name) && !extraNonVf.some(kw => name.toLowerCase().includes(kw)) && hasVfSignal(name);

    // Fédération « Netflix Catalogue » : une simple URL suffit (pas de clé API).
    // Interrogée en dernier recours, et aussi quand TMDB ne connaît pas du tout le titre.
    async function runFederation(query) {
        if (!behavior.netflixCatalogueUrl) {
            rec('netflix-catalogue', false, 'URL de l’instance Netflix Catalogue non configurée');
            return null;
        }
        const t0 = Date.now();
        let fed;
        try {
            fed = await resolveFederatedTrailer({ ...query, baseUrl: behavior.netflixCatalogueUrl });
        } catch (err) {
            fed = { found: false, reason: `Erreur fédération : ${err.message}` };
        }
        rec('netflix-catalogue', fed.found,
            fed.found ? `${fed.trailers.length} bande(s)-annonce(s) via l’instance Netflix Catalogue` : fed.reason,
            Date.now() - t0);
        if (!fed.found) return null;
        const title = (fed.title && fed.title.name) || query.officialTitle || null;
        return {
            streams: federationStreams(fed.trailers, title, season, behavior.maxTrailers),
            source: 'netflix_catalogue',
            officialTitle: title,
        };
    }

    const tFind = Date.now();
    const findData = await findByImdb(imdbId, tmdbKey);
    const result = type === 'movie' ? findData.movie_results?.[0] : findData.tv_results?.[0];
    if (!result) {
        rec('tmdb-find', false, `Aucun résultat TMDB pour ${imdbId}`, Date.now() - tFind);
        // TMDB ne connaît pas ce titre (ou l'API a échoué) : l'instance Netflix Catalogue
        // peut quand même le retrouver par IMDb. C'est le seul repli possible ici.
        const fed = await runFederation({ imdbId, type });
        if (fed) return fed;
        return { streams: [], officialTitle: null };
    }
    rec('tmdb-find', true, `TMDB: ${type === 'movie' ? 'film' : 'série'} #${result.id} (${result.title || result.name || result.original_title || result.original_name || ''})`, Date.now() - tFind);

    const tmdbId = result.id;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    // URLs des listes de vidéos TMDB. On lance leur téléchargement TOUT DE SUITE, en même temps que le
    // titre / les titres alternatifs : avant, tout s'enchaînait (titre -> vidéos fr -> vidéos défaut),
    // soit 2 à 4 allers-retours réseau perdus à attendre. Le filtrage et l'ordre de priorité restent
    // exactement les mêmes plus bas ; seul l'attente réseau est mise en commun.
    const vSeasonFr = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/videos?api_key=${tmdbKey}&language=fr-FR`;
    const vSeasonDef = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/videos?api_key=${tmdbKey}`;
    const vGlobalFr = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${tmdbKey}&language=fr-FR`;
    const vGlobalDef = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${tmdbKey}`;
    const jsonByUrl = new Map();
    const getJson = url => {
        let p = jsonByUrl.get(url);
        if (!p) {
            p = fetchT(url).then(r => r.json());
            p.catch(() => {}); // une préchargée jamais attendue ne doit pas finir en unhandledRejection
            jsonByUrl.set(url, p);
        }
        return p;
    };
    if (mediaType === 'tv' && season) getJson(vSeasonFr);
    getJson(vGlobalFr);
    if (behavior.trailerLanguage !== 'fr-only') getJson(vGlobalDef);

    // Titre FR + original + alternatifs en parallèle (deux allers-retours réseau
    // séparés) puis construction de la référence enrichie utilisée par le matching v2.
    const tMeta = Date.now();
    const [{ title: officialTitle, originalTitle, year: officialYear }, alternativeTitles] = await Promise.all([
        getTitleAndYear(mediaType, tmdbId, tmdbKey),
        getAlternativeTitles(mediaType, tmdbId, tmdbKey),
    ]);
    rec('tmdb-meta', !!officialTitle, `Titre officiel: ${officialTitle || 'inconnu'}${officialYear ? ` (${officialYear})` : ''}${alternativeTitles.length ? ` · ${alternativeTitles.length} titre(s) alternatif(s)` : ''}`, Date.now() - tMeta);
    const ref = buildRef({
        tmdbId,
        year: officialYear,
        allTitles: [officialTitle, originalTitle, ...alternativeTitles].filter(Boolean),
        allPosterPaths: [],
    });

    async function fetchVideos(url, stepLabel) {
        const t0 = Date.now();
        const data = await getJson(url);
        const all = (data.results || []).filter(v => v.site === 'YouTube');
        const accepted = getAcceptedVideoTypes(behavior);
        let kept = all.filter(v =>
            v.site === 'YouTube' && accepted.includes(v.type) && isLikelyVF(v.name) &&
            // Garde-fou anti-suite conservé pour Trailer/Teaser (un "2" dans le titre
            // trahit une autre entrée), mais relâché pour les extras : "Récap de la
            // saison 4" porte un numéro de saison qui n'est pas un numéro de suite.
            matchVideoTitle(v.name, ref, { ignoreNumbers: EXTRA_VIDEO_TYPES.includes(v.type) })
        );
        if (behavior.ignoreTeasers) kept = kept.filter(v => v.type !== 'Teaser');
        rec('tmdb-videos', kept.length > 0, `${stepLabel}: ${kept.length}/${all.length} retenue(s)${behavior.ignoreTeasers ? ' (sans teaser)' : ''}${behavior.includeExtras ? ' (extras inclus)' : ''}`, Date.now() - t0);
        return kept;
    }

    let trailers = [];
    if (mediaType === 'tv' && season) {
        trailers = await fetchVideos(vSeasonFr, `Vidéos saison ${season} (fr-FR)`);
        if (!trailers.length && behavior.trailerLanguage !== 'fr-only') trailers = await fetchVideos(vSeasonDef, `Vidéos saison ${season} (langue par défaut)`);
    }
    if (!trailers.length) trailers = await fetchVideos(vGlobalFr, 'Vidéos globales (fr-FR)');
    if (!trailers.length && behavior.trailerLanguage !== 'fr-only') trailers = await fetchVideos(vGlobalDef, 'Vidéos globales (langue par défaut)');

    // Replis Allociné > YouTube (voir ci-dessous). Renvoie { streams, source } ou null si rien trouvé /
    // repli désactivé. Utilisé quand TMDB n'a rien, ET pour compléter quand TMDB n'a qu'un teaser
    // (ou des extras) sans vraie bande-annonce.
    async function runWebFallbacks() {
        if (!officialTitle || !behavior.allocineFallback) {
            rec('allocine', false, !officialTitle ? 'Titre officiel inconnu — repli Allociné impossible' : 'Repli Allociné désactivé dans les réglages');
            return null;
        }
        // Les replis sont LANCÉS EN MÊME TEMPS, puis lus dans l'ordre de priorité habituel
        // (Allociné > YouTube) : un titre sans bande-annonce VF coûte la durée du repli le plus lent
        // au lieu de la SOMME des deux. La logique "un repli désactivé coupe la suite de la chaîne"
        // est conservée telle quelle.
        const timed = promise => {
            const t = Date.now();
            const p = promise.then(v => ({ v, ms: Date.now() - t }));
            p.catch(() => {});
            return p;
        };
        const query = `${officialTitle} bande annonce VF`;
        const pAllo = timed(getAllocineTrailerStreams(officialTitle, ref));
        const pYt = behavior.youtubeSearchFallback ? timed(searchYoutubeTrailer(query, ref)) : null;

        const { v: allocineStreams, ms: msAllo } = await pAllo;
        rec('allocine', allocineStreams.length > 0, allocineStreams.length > 0 ? `${allocineStreams.length} bande-annonce(s) trouvée(s)` : 'Aucune bande-annonce trouvée sur Allociné', msAllo);
        if (allocineStreams.length > 0) {
            return {
                streams: allocineStreams.map(s => ({ title: formatStreamTitle('trailer', officialTitle, season), url: s.url })),
                source: 'allocine',
            };
        }

        // Dernier recours : recherche YouTube directe (scraping, pas d'API/clé/quota).
        // Le moins fiable des sources -> toujours en dernière position de la chaîne.
        if (!pYt) {
            rec('youtube-search', false, 'Repli recherche YouTube désactivé dans les réglages');
            return null;
        }
        const { v: found, ms: msYt } = await pYt;
        rec('youtube-search', !!found, found ? `Trouvé: v=${found.videoId}` : `Rien de pertinent pour "${query}"`, msYt);
        if (!found) return null;
        return {
            streams: [{ title: formatStreamTitle('trailer', officialTitle, season), ytId: found.videoId }],
            source: 'youtube_search',
        };
    }

    // Replis complets : Allociné > recherche YouTube > instance Netflix Catalogue.
    async function runFallbacks() {
        const web = await runWebFallbacks();
        if (web) return web;
        return runFederation({ imdbId, tmdbId, type });
    }

    if (trailers.length > 0) {
        const best = pickBestTrailers(trailers, behavior.maxTrailers || 2);
        rec('tmdb-pick', true, `${best.length} trailer(s) sélectionné(s) sur ${trailers.length} (max ${behavior.maxTrailers || 2})`);
        const streams = best.map(t => ({
            title: formatStreamTitle(t.type, officialTitle, season),
            ytId: t.key,
        }));
        // TMDB a une vraie bande-annonce : on s'arrête là.
        if (best.some(t => t.type === 'Trailer')) return { streams, officialTitle, source: 'tmdb' };
        // Sinon (juste un teaser / des extras), on cherche la bande-annonce ailleurs et on l'ajoute APRÈS.
        rec('tmdb-complement', true, 'Pas de bande-annonce TMDB (teaser/extras seulement) — recherche Allociné / YouTube / Netflix Catalogue');
        const extra = await runFallbacks();
        return { streams: extra ? [...streams, ...extra.streams] : streams, officialTitle, source: 'tmdb' };
    }

    const fb = await runFallbacks();
    if (!fb) return { streams: [], officialTitle, source: null };
    return { streams: fb.streams, officialTitle: fb.officialTitle || officialTitle, source: fb.source };
}

module.exports = { resolveViaApis };
