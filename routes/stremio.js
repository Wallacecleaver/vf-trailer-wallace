// Routes Stremio : manifest, meta, stream.

const { recordRequest } = require('../lib/stats');
const { recordInstallActivity } = require('../lib/install-stats');
const { recordAiomStat } = require('../lib/aiom-stats');
const { logEvent } = require('../lib/logs');
const { logFailure } = require('../lib/overrides');
const { manifest, decodeConfig, FALLBACK_TMDB_KEY, LOGO_URL } = require('../lib/config');
const { resolveStreams, getBehaviorSettingsFast, buildMetaObject } = require('../lib/resolver');
const { resolveAiomDirect } = require('../lib/aiom-direct');
const { aiomTimeoutMs, withDeadline, aiomOutcome, resolveStreamsSingleFlight, logAiomRequest } = require('../lib/aiom');

// ---- Lien AIOMetadata PARTAGÉ : /aiom/manifest.json ----------------------------------------
// Un seul lien identique pour tout le monde (comme https://trailerio.cc/fr/manifest.json) : pas de
// config dans l'URL, pas de page /configure. La config est fixée ici (mode aiom, un seul flux
// ytId/url) et la clé TMDB est celle du serveur (TMDB_API_KEY) ; le délai max reste réglable dans
// le dashboard (Réglages > AIOMetadata). Ces routes DOIVENT être enregistrées avant
// /:config?/manifest.json, sinon "aiom" serait pris pour un segment de config.
const aiomManifest = {
    id: 'org.vftrailers.aiom',
    version: manifest.version,
    name: 'W Bandes-Annonces VF (AIOMetadata)',
    description: 'Bande-annonce VF pour l\'option « A trailer addon » d\'AIOMetadata',
    logo: LOGO_URL,
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
};
const aiomDirectManifest = {
    ...aiomManifest,
    id: 'org.vftrailers.aiom.direct',
    name: 'W Bandes-Annonces VF (AIOM Direct)',
    description: 'Bande-annonce VF en MP4 pour AIOMetadata',
};

function sharedAiomConfig() {
    return { aiom: true, pseudo: 'AIOMetadata', tmdbKey: FALLBACK_TMDB_KEY || null };
}

// Mode AIOMetadata : réponse courte et lisible, journalisée dans le dashboard (Logs > AIOM),
// sans stats globales ni journal "échecs" (voir logAiomRequest).
async function respondAiom(req, res, config, type, imdbId, season) {
    const t0 = Date.now();
    const timeoutMs = aiomTimeoutMs(await getBehaviorSettingsFast()); // réglage du dashboard (cache mémoire 30 s)
    const work = resolveStreamsSingleFlight(type, imdbId, season, config);
    work.catch(() => {}); // évite un unhandledRejection si le délai a déjà répondu
    const result = await withDeadline(work, timeoutMs);
    const ms = Date.now() - t0;
    await Promise.all([
        logAiomRequest({ type, imdbId, season, config, result, ms, timeoutMs }),
        recordAiomStat({ outcome: aiomOutcome(result), fromCache: !!result.fromCache, ms }),
    ]);
    // Cache navigateur/CDN : 10 min, trouvé ou non (un "aucun" ne change pas d'une minute à l'autre) ; un timeout jamais
    // (la résolution continue en arrière-plan, la requête suivante sera servie par le cache).
    res.setHeader('Cache-Control', result.timedOut ? 'no-store' : 'public, max-age=600');
    return res.json({ streams: result.streams });
}

function parseStremioTarget(type, rawIdWithExt) {
    if (type !== 'movie' && type !== 'series') return null;
    let decoded;
    try { decoded = decodeURIComponent(String(rawIdWithExt || '')).replace(/\.json$/, ''); }
    catch { return null; }
    const match = decoded.match(/^(tt\d{6,10})(?::(\d{1,3})(?::\d{1,4})?)?$/);
    if (!match) return null;
    if (type === 'movie' && match[2] !== undefined) return null;
    const seasonNum = match[2] !== undefined ? Number(match[2]) : null;
    // Dans Stremio, la saison 0 correspond aux « Specials » : en base, season=0 signifie « global »
    // et TMDB/Stockage BD n'ont pas de bande-annonce « Saison 0 ». On la traite comme la fiche série générale.
    const season = seasonNum && seasonNum >= 1 ? String(seasonNum) : null;
    return { imdbId: match[1], season };
}

module.exports = function registerStremioRoutes(app) {
    app.get('/aiom/manifest.json', (req, res) => {
        res.json(aiomManifest);
    });

    app.get('/aiom/stream/:type/:idWithExt', async (req, res) => {
        const config = sharedAiomConfig();
        if (!config.tmdbKey) return res.json({ streams: [] });
        const { type } = req.params;
        const parsed = parseStremioTarget(type, req.params.idWithExt);
        if (!parsed) return res.json({ streams: [] });
        try {
            return await respondAiom(req, res, config, type, parsed.imdbId, parsed.season);
        } catch {
            await logEvent({ level: 'error', context: 'AIOM', event: 'aiom_shared_error',
                message: 'Résolution AIOMetadata partagée impossible', meta: { type, imdbId: parsed.imdbId } });
            res.json({ streams: [] });
        }
    });

    app.get('/aiom-direct/manifest.json', (_req, res) => res.json(aiomDirectManifest));

    app.get('/aiom-direct/stream/:type/:idWithExt', async (req, res) => {
        const { type, idWithExt } = req.params;
        const target = parseStremioTarget(type, idWithExt);
        res.setHeader('Cache-Control', 'no-store');
        if (!target) return res.json({ streams: [] });

        try {
            const behavior = await getBehaviorSettingsFast();
            const work = resolveAiomDirect(type, target.imdbId, target.season, FALLBACK_TMDB_KEY, behavior);
            const { streams } = await withDeadline(work, aiomTimeoutMs(behavior));
            if (streams.length) res.setHeader('Cache-Control', 'public, max-age=120');
            return res.json({ streams });
        } catch {
            await logEvent({
                level: 'warn', context: 'AIOM', event: 'aiom_direct_error',
                message: 'Résolution AIOM Direct impossible', meta: { type, imdbId: target.imdbId },
            }).catch(() => {});
            return res.json({ streams: [] });
        }
    });

    // Manifest et stream acceptent un segment de config optionnel en tête d'URL.
    app.get('/:config?/manifest.json', async (req, res) => {
        let hasValidConfig = false;

        if (req.params.config && req.params.config !== 'manifest.json') {
            // Le manifest ne peut plus être renvoyé tel quel : si l'URL contient une config
            // valide (clé TMDB), il faut lever configurationRequired, sinon Stremio continue
            // d'afficher le bouton "Configure" au lieu de "Install" même une fois configuré.
            const { tmdbKey, pseudo } = decodeConfig(req.params.config);
            hasValidConfig = !!tmdbKey;
            if (hasValidConfig) {
                const isNewInstall = await recordInstallActivity(req.params.config, pseudo);
                if (isNewInstall) {
                    await logEvent({
                        level: 'info', context: 'INSTALL', event: 'manifest_created',
                        message: `${pseudo || 'Un visiteur'} a créé son manifest`,
                        meta: { pseudo: pseudo || null },
                    });
                }
            }
        }

        res.json({
            ...manifest,
            behaviorHints: {
                ...manifest.behaviorHints,
                configurationRequired: !hasValidConfig,
            },
        });
    });

    app.get('/:config?/meta/:type/:idWithExt', async (req, res) => {
        try {
            const config = decodeConfig(req.params.config);
            const { type } = req.params;
            const parsed = parseStremioTarget(type, req.params.idWithExt);
            if (!parsed) return res.json({ meta: null });

            const meta = await buildMetaObject(type, parsed.imdbId, config);
            res.json({ meta: meta || null });
        } catch (err) {
            console.error('Erreur /meta:', err);
            await logEvent({ level: 'error', context: 'META', event: 'meta_error', message: err.message, meta: { path: req.path } });
            res.json({ meta: null });
        }
    });

    app.get('/:config?/stream/:type/:idWithExt', async (req, res) => {
        try {
            const config = decodeConfig(req.params.config);
            const { type } = req.params;
            const parsed = parseStremioTarget(type, req.params.idWithExt);
            if (!parsed) return res.json({ streams: [] });
            const { imdbId, season } = parsed;

            if (config.aiom) return await respondAiom(req, res, config, type, imdbId, season);

            const { streams, officialTitle, hidden } = await resolveStreams(type, imdbId, season, config);

            // On attend ces écritures (en parallèle) avant de répondre : les stats sont ainsi
            // toujours à jour au moment où la réponse part.
            await Promise.all([
                recordRequest({ type, imdbId, title: officialTitle }),
                streams.length === 0 && !hidden ? logFailure({ imdbId, type, season, title: officialTitle }) : Promise.resolve(),
            ]);

            res.json({ streams });
        } catch (err) {
            console.error('Erreur /stream:', err);
            await logEvent({ level: 'error', context: 'STREAM', event: 'stream_error', message: err.message, meta: { path: req.path } });
            res.json({ streams: [] });
        }
    });
};
