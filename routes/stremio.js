// Routes Stremio : manifest, relais Netflix, meta, stream.

const { relayTrailer } = require('../lib/netflix-trailer');
const { recordRequest } = require('../lib/stats');
const { recordInstallActivity } = require('../lib/install-stats');
const { recordAiomStat } = require('../lib/aiom-stats');
const { logEvent } = require('../lib/logs');
const { logFailure } = require('../lib/overrides');
const { manifest, decodeConfig } = require('../lib/config');
const { resolveStreams, getBehaviorSettingsFast, buildMetaObject } = require('../lib/resolver');
const { aiomTimeoutMs, withDeadline, aiomOutcome, resolveStreamsSingleFlight, logAiomRequest } = require('../lib/aiom');

module.exports = function registerStremioRoutes(app) {
    // Relais de la bande-annonce de la page Netflix (source de dernier recours, voir lib/netflix-trailer.js).
    // Stremio / AIOMetadata reçoivent cette URL stable ; le lien vidéo Netflix, lui, expire : il est renouvelé ici.
    app.get('/nf/:nid.mp4', (req, res) => relayTrailer(req, res, req.params.nid));
    app.head('/nf/:nid.mp4', (req, res) => relayTrailer(req, res, req.params.nid));

    // Manifest et stream acceptent un segment de config optionnel en tête d'URL.
    app.get('/:config?/manifest.json', async (req, res) => {
        let hasValidConfig = false;

        if (req.params.config && req.params.config !== 'manifest.json') {
            // Le manifest ne peut plus être renvoyé tel quel : si l'URL contient une config
            // valide (clé TMDB), il faut lever configurationRequired, sinon Stremio continue
            // d'afficher le bouton "Configure" au lieu de "Install" même une fois configuré.
            const { tmdbKey, pseudo } = decodeConfig(req.params.config);
            hasValidConfig = !!tmdbKey;
            const isNewInstall = await recordInstallActivity(req.params.config, pseudo);
            if (isNewInstall) {
                await logEvent({
                    level: 'info', context: 'INSTALL', event: 'manifest_created',
                    message: `${pseudo || 'Un visiteur'} a créé son manifest`,
                    meta: { pseudo: pseudo || null },
                });
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
            const imdbId = decodeURIComponent(req.params.idWithExt).replace(/\.json$/, '');

            const meta = await buildMetaObject(type, imdbId, config);
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
            const id = decodeURIComponent(req.params.idWithExt).replace(/\.json$/, '');
            const [imdbId, season] = id.split(':');

            // Mode AIOMetadata : réponse courte et lisible, journalisée dans le dashboard (Logs > AIOM),
            // sans stats globales ni journal "échecs" (voir logAiomRequest).
            if (config.aiom) {
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
