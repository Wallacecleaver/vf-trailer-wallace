// Résolution complète d'un flux : override manuel > cache > TMDB / Allociné / Netflix Catalogue / YouTube.
// resolveStreams() est le point d'entrée utilisé par les routes /stream, /meta et le mode AIOMetadata.

const { getCached, setCached } = require('./cache');
const { logEvent } = require('./logs');
const { getBehaviorSettings } = require('./settings');
const { getOverride, logResolution, incrementOverrideUse } = require('./overrides');
const { FALLBACK_TMDB_KEY, APP_BASE_URL } = require('./config');
const { findByImdb } = require('./tmdb');
const { resolveViaApis } = require('./resolve-apis');
const { buildOverrideLinks, resolveOverrideLinks } = require('./override-links');
const { formatStreamName, withSeasonLabel, buildExternalYoutubeStream, applyUserStreamPrefs, toAiomStreams } = require('./stream-format');

// Dédup : on ne veut logger qu'une seule fois qu'une personne donnée (pseudo) a
// cherché un titre donné. Mémorisé en base (kv_cache, 30 jours) : survit aux redémarrages.
// Best-effort : si la base est indisponible, on logue à chaque fois.
const SEEN_SEARCH_TTL_SECONDS = 30 * 24 * 60 * 60;
async function isNewSearch(pseudoKey, imdbId, type) {
    try {
        const key = `seen:${pseudoKey}|${imdbId}|${type}`;
        if (await getCached(key)) return false;
        await setCached(key, 1, SEEN_SEARCH_TTL_SECONDS);
        return true;
    } catch (err) {
        console.error('Erreur dédup recherche:', err.message);
        return true;
    }
}

// Cache mémoire (~30s) pour getBehaviorSettings() :
// ce réglage est lu à CHAQUE requête /stream mais ne change quasiment jamais -- inutile de
// interroger la base à chaque fois. Utilisé uniquement sur le chemin chaud (résolution réelle) ;
// les routes /api/settings/behavior (dashboard) continuent d'appeler getBehaviorSettings()
// directement pour toujours refléter l'état exact. Contrepartie : jusqu'à ~30s avant qu'un
// changement de réglage admin soit pris en compte par les visiteurs -- largement acceptable
// pour ce type de réglage, et ça réduit d'autant les requêtes en base.
let _behaviorCache = null;
let _behaviorCacheAt = 0;
const BEHAVIOR_CACHE_TTL_MS = 30000;
async function getBehaviorSettingsFast() {
    if (_behaviorCache && Date.now() - _behaviorCacheAt < BEHAVIOR_CACHE_TTL_MS) return _behaviorCache;
    _behaviorCache = await getBehaviorSettings();
    _behaviorCacheAt = Date.now();
    return _behaviorCache;
}

// Point d'entrée réel : override manuel > cache > résolution complète > qualité forcée.
// Renommée en "Core" -- voir resolveStreams (wrapper) juste après, qui applique les
// préférences d'affichage de l'utilisateur (externalOnly / maxLinks) sur le résultat.
async function resolveStreamsCore(type, imdbId, season, config) {
    const pseudoKey = config.pseudo || 'anonyme';
    // Clone impératif : getBehaviorSettingsFast() renvoie le même objet en mémoire tant que
    // le cache est valide (30s) ; sans clone, muter behavior.includeExtras ci-dessous
    // modifierait l'objet partagé et ferait fuiter la préférence d'un visiteur vers le
    // suivant dans la même fenêtre de cache.
    const behavior = { ...(await getBehaviorSettingsFast()) };
    // Override utilisateur (config encodée dans l'URL) sur le réglage admin :
    // tri-state -- true force les extras, false les coupe, null suit l'admin.
    if (typeof config.includeExtras === 'boolean') behavior.includeExtras = config.includeExtras;

    const override = await getOverride(imdbId, season);
    if (override) {
        if (override.hidden) {
            // "Masquer ce titre" (dashboard) : l'admin a volontairement coupé le mapping
            // pour cet IMDB ID -> aucune bande-annonce. Pas d'override_used, pas de
            // logFailure (voir route /stream) : c'est un choix délibéré, pas un échec.
            return { streams: [], officialTitle: override.title || null, hidden: true };
        }
        const links = buildOverrideLinks(override);
        if (links.length) {
            const streams = await resolveOverrideLinks(links, override.title, `${imdbId}:${season || ''}`, override.contributedBy, season);
            if (await isNewSearch(pseudoKey, imdbId, type)) {
                await logEvent({ level: 'info', context: 'OVERRIDE', event: 'override_used', message: `Override utilisé pour ${imdbId}${override.title ? ' — ' + override.title : ''}`, meta: { imdbId, season: season || null, pseudo: config.pseudo || null } });
            }
            await incrementOverrideUse(imdbId, season);
            return { streams, officialTitle: override.title || null, source: 'override' };
        }
        // Override existant mais SANS lien et non masqué (ex: réactivé après un masquage
        // sans lien) -> ne pas servir un flux cassé, on retombe sur la résolution normale.
    }

    const tmdbKey = config.tmdbKey;
    if (!tmdbKey) return { streams: [], officialTitle: null }; // pas de clé perso configurée par le visiteur -> rien à faire (plus de fallback sur la clé serveur)

    // L'état includeExtras fait partie de la clé de cache : un résultat avec extras
    // n'est PAS compatible avec un utilisateur sans extras (et inversement), sinon on
    // servirait des flux "Récap"/"Extrait" à quelqu'un qui ne les veut pas.
    const cacheKey = `cache:trailers:${imdbId}:${type}:${season || 'all'}:${behavior.includeExtras ? 'x' : 'nx'}`;

    if (behavior.cacheEnabled) {
        const cached = await getCached(cacheKey);
        if (cached) {
            if (await isNewSearch(pseudoKey, imdbId, type)) {
                if (cached.streams.length > 0) {
                    // Plus de logEvent ici : une résolution réussie n'est pas un événement à
                    // journaliser (bruit), seuls les vrais problèmes de mapping (rien trouvé)
                    // le sont. Le suivi des résolutions reste dans "Résolutions récentes".
                    await logResolution({
                        imdbId, season, type,
                        title: cached.officialTitle,
                        source: cached.source,
                        streams: cached.streams,
                    });
                } else {
                    // Échec mis en cache (cacheFailures) : le mapping manquant reste un vrai
                    // problème à journaliser, même si la résolution elle-même vient du cache.
                    const typeLabel = type === 'series' ? 'série' : 'film';
                    const titleLabel = cached.officialTitle ? `"${cached.officialTitle}"` : imdbId;
                    const who = config.pseudo ? config.pseudo : 'Un visiteur';
                    await logEvent({
                        level: 'warn', context: 'STREAM', event: 'trailer_not_found',
                        message: `${who} a voulu voir ${titleLabel} (${typeLabel}) — mapping manquant`,
                        meta: { imdbId, type, pseudo: config.pseudo || null },
                    });
                }
            }
            return { ...cached, fromCache: true }; // fromCache : uniquement pour le journal AIOM, jamais re-stocké
        }
    }

    let result = await resolveViaApis(type, imdbId, season, behavior, tmdbKey);
    const isNew = await isNewSearch(pseudoKey, imdbId, type);

    if (result.streams.length > 0) {
        if (isNew) {
            // Idem : plus de logEvent pour un succès -- seul le journal "Résolutions
            // récentes" (mapping) le retient, les Logs ne gardent que les vrais problèmes.
            await logResolution({
                imdbId, season, type,
                title: result.officialTitle,
                source: result.source,
                streams: result.streams,
            });
        }
    } else if (isNew) {
        const typeLabel = type === 'series' ? 'série' : 'film';
        const titleLabel = result.officialTitle ? `"${result.officialTitle}"` : imdbId;
        const who = config.pseudo ? config.pseudo : 'Un visiteur';
        await logEvent({
            level: 'warn', context: 'STREAM', event: 'trailer_not_found',
            message: `${who} a voulu voir ${titleLabel} (${typeLabel}) — mapping manquant`,
            meta: { imdbId, type, pseudo: config.pseudo || null },
        });
    }

    // Pose ici le tag `name` affiché à gauche dans Stremio (voir formatStreamName) et le flux
    // jumeau "ouvrir en externe" pour chaque trailer YouTube -- centralisé ici plutôt que dans
    // resolveViaApis. Plus de résolution d'URL directe (voir buildYoutubeStreams) : ces flux
    // restent ytId-only, lisibles sur l'appli Stremio officielle via son lecteur intégré.
    if (result.streams.length > 0) {
        const expanded = result.streams.map(s => {
            if (!s.ytId) return [{ ...s, name: formatStreamName() }];
            return [{ ...s, name: formatStreamName(), __external: false }, buildExternalYoutubeStream(s.ytId, s.title)];
        });
        result = { ...result, streams: expanded.flat() };
    }

    if (behavior.cacheEnabled && result.streams.length > 0) {
        // TTL différencié par source : TMDB (catalogué, stable) > Allociné (HTML
        // scrapé, peut changer) > YouTube search (le moins fiable, re-vérifié souvent).
        let ttl;
        if (result.source === 'allocine') ttl = (behavior.allocineCacheTtlHours || 2) * 3600;
        else if (result.source === 'youtube_search') ttl = (behavior.youtubeSearchCacheTtlHours || 1) * 3600;
        else ttl = (behavior.cacheTtlHours || 6) * 3600;
        await setCached(cacheKey, result, ttl);
    } else if (behavior.cacheEnabled && behavior.cacheFailures) {
        // TTL volontairement court et indépendant de cacheTtlHours : un échec n'a pas la même
        // durée de vie qu'un succès (peut être corrigé par un override à tout moment).
        const failTtl = Math.max(60, (behavior.failureCacheTtlMinutes || 30) * 60);
        await setCached(cacheKey, result, failTtl);
    }

    return result;
}

// Wrapper public : applique les préférences d'affichage propres à l'utilisateur
// (externalOnly / maxLinks, définies sur /configure) après coup, sur CHAQUE chemin de
// retour de resolveStreamsCore (override, cache, résolution fraîche) sans avoir à
// dupliquer la logique à chaque return -- et sans jamais polluer le cache partagé,
// qui reste calculé une seule fois pour tout le monde en amont.
// Quand aucune source ne trouve de bande-annonce VF, plutôt qu'une liste vide (impasse
// silencieuse), on propose un flux "virtuel" qui renvoie vers /proposer avec le titre déjà
// pré-rempli -- transforme un échec en invitation à contribuer, pile au moment où la personne
// est le plus motivée à corriger elle-même. N'est jamais mis en cache séparément : fait partie
// du résultat normal de resolveStreamsCore (qui lui, cache un vrai [] -- voir plus haut), donc
// réévalué à la même fréquence que n'importe quel échec, pas plus souvent ni moins.
function buildProposeLinkStream(type, imdbId, season, officialTitle) {
    const params = new URLSearchParams({ imdbId, type: type === 'series' ? 'series' : 'movie' });
    if (season) params.set('season', String(season));
    if (officialTitle) params.set('title', officialTitle);
    return {
        name: '🎬 VF\n➕ Proposer',
        title: `${withSeasonLabel(officialTitle || 'Ce titre', season)}\nAucune bande-annonce VF trouvée — propose le bon lien`,
        externalUrl: `${APP_BASE_URL}/proposer?${params.toString()}`,
        __external: true,
    };
}

async function resolveStreams(type, imdbId, season, config) {
    const result = await resolveStreamsCore(type, imdbId, season, config);
    if (config.aiom) return { ...result, streams: toAiomStreams(result.streams) };
    let streams = applyUserStreamPrefs(result.streams, config);
    // Pas de flux "proposer" si : rien n'a vraiment été tenté (pas de clé TMDB configurée --
    // la personne n'a même pas fini sa config), ou si l'admin a explicitement masqué ce titre
    // (result.hidden) -- dans ce cas le silence est délibéré, pas un échec à combler.
    if (!streams.length && config.tmdbKey && !result.hidden) {
        streams = [buildProposeLinkStream(type, imdbId, season, result.officialTitle)];
    }
    return { ...result, streams };
}

// ---- Objet meta (pour le resource 'meta', consommé par Fusion & co) ----
// Format volontairement calqué à l'identique sur trailerio-lite (id, type, name, links --
// rien d'autre) : eux ne renvoient ni poster, ni background, ni le champ standard `trailers`,
// uniquement `links`. Testons si c'est la forme minimaliste qui compte pour Fusion, plutôt
// que d'ajouter des champs qui pourraient faire traiter cet addon comme un fournisseur de
// meta "complet" (concurrent d'AIOMetadata) au lieu d'un simple fournisseur de trailer.
async function buildMetaObject(type, imdbId, config) {
    const tmdbKey = config.tmdbKey;
    if (!tmdbKey) return null; // pas de clé perso -> pas de meta

    const findData = await findByImdb(imdbId, tmdbKey);
    const result = type === 'movie' ? findData.movie_results?.[0] : findData.tv_results?.[0];
    if (!result) return null;
    const title = type === 'movie' ? result.title : result.name;
    if (!title) return null;

    const { streams } = await resolveStreams(type, imdbId, null, config);
    const playable = streams.filter(s => !s.externalUrl && s.url); // seuls les flux avec URL directe résolue intéressent Fusion

    const links = playable.map(s => ({ trailers: s.url, provider: 'VF' }));

    // Champ natif Stremio (protocole officiel) : déclenche le bouton "Watch trailer" sur la
    // fiche du film/série, un lecteur dédié SÉPARÉ du lecteur principal -> contrairement aux
    // streams classiques, ça n'alimente jamais "Continuer à regarder"/bibliothèque (voir
    // discussion : ce bouton est distinct du bouton "Show", qui seul déclenche ce tracking).
    // Format attendu : { source: <ID YouTube>, type: 'Trailer' } -- source est bien l'ID seul,
    // pas une URL complète (contrairement au `links.trailers` ci-dessus, gardé pour Fusion).
    // On ne peut fournir ça QUE pour les trailers YouTube (source = ytId) : les flux Allociné
    // n'ont pas d'ID YouTube donc ne peuvent pas alimenter ce champ.
    const trailers = streams
        .filter(s => s.ytId)
        .map(s => ({ source: s.ytId, type: 'Trailer' }));

    return { id: imdbId, type, name: title, links, trailers };
}

// Résolution "à blanc" pour le testeur du dashboard : réutilise le même pipeline
// (override > TMDB/Allociné/YouTube selon les réglages actuels) mais ne touche JAMAIS
// au cache, aux stats ni aux logs -> un test admin ne doit pas polluer les vraies données.
async function testResolve(type, imdbId, season, ignoreOverride, aiom) {
    const trace = [];
    const rec = (step, ok, detail, ms) => trace.push({ step, ok: !!ok, detail: detail || '', ms: ms == null ? null : ms });

    const override = await getOverride(imdbId, season);
    if (override && !ignoreOverride) {
        if (override.hidden) {
            rec('override', true, 'Titre masqué par un override — aucune bande-annonce');
            return { source: 'override', officialTitle: override.title || null, streams: [], hidden: true, trace, aiom: !!aiom };
        }
        const overrideTitle = override.title || 'Bande-annonce VF';
        const streams = override.ytId
            ? [{ title: overrideTitle, ytId: override.ytId }, buildExternalYoutubeStream(override.ytId, overrideTitle)]
            : [{ title: overrideTitle, url: override.url }];
        rec('override', true, `Override appliqué${override.ytId ? ` — v=${override.ytId}` : override.url ? ' — URL directe' : ''}`);
        return { source: 'override', officialTitle: override.title || null, streams: aiom ? toAiomStreams(streams) : streams, trace, aiom: !!aiom };
    }
    if (override && ignoreOverride) {
        rec('override', false, 'Override ignoré (coché dans le formulaire) — test de la chaîne normale');
    }

    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return { error: "Aucune clé TMDB de secours configurée côté serveur (variable d'env TMDB_API_KEY) -> impossible de tester sans clé personnelle.", trace };

    const behavior = await getBehaviorSettings();
    const result = await resolveViaApis(type, imdbId, season, behavior, tmdbKey, trace);
    const expanded = result.streams.flatMap(s => s.ytId ? [s, buildExternalYoutubeStream(s.ytId, s.title)] : [s]);
    // Simulation AIOMetadata : montre exactement ce que l'addon renverrait en mode aiom.
    const streams = aiom ? toAiomStreams(expanded) : expanded;
    return { source: result.source, officialTitle: result.officialTitle, streams, trace, aiom: !!aiom };
}

module.exports = { resolveStreams, getBehaviorSettingsFast, buildMetaObject, testResolve };
