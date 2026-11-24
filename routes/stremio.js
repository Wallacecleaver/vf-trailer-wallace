// Routes Stremio : manifest, meta, stream.

const { recordRequest } = require('../lib/stats');
const { recordInstallActivity } = require('../lib/install-stats');
const { recordAiomStat } = require('../lib/aiom-stats');
const { logEvent } = require('../lib/logs');
const { logFailure } = require('../lib/overrides');
const { manifest, decodeConfig, FALLBACK_TMDB_KEY, LOGO_URL } = require('../lib/config');
const { resolveStreams, getBehaviorSettingsFast, buildMetaObject } = require('../lib/resolver');
const { resolveAiomDirect, resolveSharedAiom } = require('../lib/aiom-direct');
const { aiomTimeoutMs, withDeadline, aiomOutcome, resolveStreamsSingleFlight, logAiomRequest } = require('../lib/aiom');
const { getAiomSource, resolveAiomSource } = require('../lib/aiom-source');
const { buildNuvioMeta } = require('../lib/nuvio');

// ---- Lien AIOMetadata PARTAGÉ : /aiom/manifest.json ----------------------------------------
// Un seul lien identique pour tout le monde (comme https://trailerio.cc/fr/manifest.json) : pas de
// config dans l'URL, pas de page /configure. Le dashboard choisit la source du lien partagé.
// La source native utilise la clé TMDB du serveur. Ces routes DOIVENT être enregistrées avant
// /:config?/manifest.json, sinon "aiom" serait pris pour un segment de config.
const aiomManifest = {
    id: 'org.vftrailers.aiom',
    version: manifest.version,
    name: 'W Bandes-Annonces VF (AIOMetadata)',
    description: 'Bande-annonce VF pour AIOMetadata',
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
const directTrailerManifest = {
    ...aiomManifest,
    id: 'org.vftrailers.direct',
    name: 'W Bandes-Annonces VF (Direct)',
    description: 'Bandes-annonces VF en vidéo directe MP4 ou HLS',
    resources: manifest.resources,
};
const fusionManifest = {
    ...aiomManifest,
    id: 'org.vftrailers.fusion',
    name: 'W Bandes-Annonces VF (Fusion)',
    description: 'Bandes-annonces VF en MP4 ou HLS dans Fusion',
    resources: ['meta'],
};
const nuvioManifest = {
    ...aiomManifest,
    id: 'org.vftrailers.nuvio',
    name: 'W Bandes-Annonces VF (Nuvio)',
    description: 'Bandes-annonces YouTube en VF sur les fiches Nuvio',
    resources: ['meta'],
};
const nuvioStrictManifest = {
    ...nuvioManifest,
    id: 'org.vftrailers.nuvio.strict',
    name: 'W Bandes-Annonces VF (Nuvio VF stricte)',
};

function sharedAiomConfig() {
    return { aiom: true, pseudo: 'AIOMetadata', tmdbKey: FALLBACK_TMDB_KEY || null };
}

// Mode AIOMetadata : réponse courte et lisible, journalisée dans le dashboard (Logs > AIOM),
// sans stats globales ni journal "échecs" (voir logAiomRequest).
async function respondAiom(req, res, config, type, imdbId, season, { shared = false } = {}) {
    const t0 = Date.now();
    const behavior = await getBehaviorSettingsFast();
    const timeoutMs = aiomTimeoutMs(behavior);
    const sourceUrl = shared ? await getAiomSource() : '';
    let work;
    if (sourceUrl) work = resolveAiomSource(sourceUrl, type, imdbId, season, behavior, timeoutMs);
    else if (shared) work = resolveSharedAiom(type, imdbId, season, config.tmdbKey, behavior, timeoutMs);
    else work = resolveStreamsSingleFlight(type, imdbId, season, config);
    const result = await withDeadline(work, timeoutMs);
    const ms = Date.now() - t0;
    // Cache navigateur/CDN : 2 min sur le lien partagé. Une préparation ou un timeout
    // conserve la possibilité d'obtenir la vidéo prioritaire dès le prochain appel.
    const cacheable = !sourceUrl && !result.timedOut && !result.pending;
    const maxAge = result.streams.length ? (shared ? 120 : 600) : 120;
    res.setHeader('Cache-Control', !cacheable ? 'no-store' : `public, max-age=${maxAge}`);
    res.json({ streams: result.streams });
    // Journal et compteurs APRÈS l'envoi de la réponse : une base lente ou en erreur ne retarde plus
    // AIOMetadata et ne peut plus faire perdre une bande-annonce déjà trouvée. On les attend quand même
    // (sans bloquer la réponse) pour que l'hébergement serverless ne coupe pas l'écriture.
    try {
        await Promise.all([
            logAiomRequest({ type, imdbId, season, config, result, ms, timeoutMs }),
            recordAiomStat({ outcome: aiomOutcome(result), fromCache: !!result.fromCache, ms }),
        ]);
    } catch { /* journal best-effort */ }
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

async function respondDirect(req, res, { asMeta = false, allowHls = false } = {}) {
    const { type, idWithExt } = req.params;
    const target = parseStremioTarget(type, idWithExt);
    const empty = asMeta ? { meta: null } : { streams: [] };
    res.setHeader('Cache-Control', 'no-store');
    if (!target) return res.json(empty);

    const { imdbId, season } = target;
    try {
        const behavior = await getBehaviorSettingsFast();
        const work = resolveAiomDirect(type, imdbId, season, FALLBACK_TMDB_KEY, behavior, { allowHls });
        const { streams, officialTitle, provider } = await withDeadline(work, aiomTimeoutMs(behavior));
        if (!streams.length) return res.json(empty);
        res.setHeader('Cache-Control', 'public, max-age=120');
        if (!asMeta) return res.json({ streams });

        return res.json({ meta: {
            id: imdbId,
            type,
            name: officialTitle || imdbId,
            links: [{ trailers: streams[0].url, provider: `VF · ${provider}` }],
        } });
    } catch {
        await logEvent({
            level: 'warn', context: allowHls ? 'STREAM' : 'AIOM',
            event: allowHls ? 'direct_trailer_error' : 'aiom_direct_error',
            message: allowHls ? 'Résolution de la bande-annonce directe impossible' : 'Résolution AIOM Direct impossible',
            meta: { type, imdbId },
        }).catch(() => {});
        return res.json(empty);
    }
}

async function respondNuvio(req, res, strict) {
    const { type, idWithExt } = req.params;
    const target = parseStremioTarget(type, idWithExt);
    res.setHeader('Cache-Control', 'no-store');
    if (!target) return res.json({ meta: null });

    try {
        const behavior = await getBehaviorSettingsFast();
        const timeoutMs = aiomTimeoutMs(behavior);
        const work = buildNuvioMeta(type, target.imdbId, target.season, FALLBACK_TMDB_KEY, behavior, { strict, timeoutMs });
        const meta = await withDeadline(work, timeoutMs, null);
        if (meta?.trailers.length) res.setHeader('Cache-Control', 'public, max-age=120');
        return res.json({ meta });
    } catch {
        return res.json({ meta: null });
    }
}

module.exports = function registerStremioRoutes(app) {
    app.get('/aiom/manifest.json', (req, res) => {
        res.json(aiomManifest);
    });

    app.get('/aiom/stream/:type/:idWithExt', async (req, res) => {
        const config = sharedAiomConfig();
        const { type } = req.params;
        const parsed = parseStremioTarget(type, req.params.idWithExt);
        if (!parsed) return res.json({ streams: [] });
        try {
            return await respondAiom(req, res, config, type, parsed.imdbId, parsed.season, { shared: true });
        } catch {
            await logEvent({ level: 'error', context: 'AIOM', event: 'aiom_shared_error',
                message: 'Résolution AIOMetadata partagée impossible', meta: { type, imdbId: parsed.imdbId } });
            res.json({ streams: [] });
        }
    });

    app.get('/aiom-direct/manifest.json', (_req, res) => res.json(aiomDirectManifest));
    app.get('/aiom-direct/stream/:type/:idWithExt', (req, res) => respondDirect(req, res));

    app.get('/direct/manifest.json', (_req, res) => res.json(directTrailerManifest));
    app.get('/direct/stream/:type/:idWithExt', (req, res) => respondDirect(req, res, { allowHls: true }));
    app.get('/direct/meta/:type/:idWithExt', (req, res) => respondDirect(req, res, { asMeta: true, allowHls: true }));

    app.get('/fusion/manifest.json', (_req, res) => res.json(fusionManifest));
    app.get('/fusion/meta/:type/:idWithExt', (req, res) => respondDirect(req, res, { asMeta: true, allowHls: true }));
    app.get('/nuvio/manifest.json', (_req, res) => res.json(nuvioManifest));
    app.get('/nuvio/meta/:type/:idWithExt', (req, res) => respondNuvio(req, res, false));
    app.get('/nuvio-strict/manifest.json', (_req, res) => res.json(nuvioStrictManifest));
    app.get('/nuvio-strict/meta/:type/:idWithExt', (req, res) => respondNuvio(req, res, true));

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

            const { streams, officialTitle, hidden, pending } = await resolveStreams(type, imdbId, season, config);
            if (pending) res.setHeader('Cache-Control', 'no-store');

            // On attend ces écritures (en parallèle) avant de répondre : les stats sont ainsi
            // toujours à jour au moment où la réponse part.
            await Promise.all([
                recordRequest({ type, imdbId, title: officialTitle }),
                streams.length === 0 && !hidden && !pending ? logFailure({ imdbId, type, season, title: officialTitle }) : Promise.resolve(),
            ]);

            res.json({ streams });
        } catch (err) {
            console.error('Erreur /stream:', err);
            await logEvent({ level: 'error', context: 'STREAM', event: 'stream_error', message: err.message, meta: { path: req.path } });
            res.json({ streams: [] });
        }
    });
};
