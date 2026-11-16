// Aperçu réel de /configure : même recherche que le testeur admin, sans écritures
// dans SQLite (cache, mappings, statistiques ou journaux). Les variations de mise
// en page réutilisent brièvement la recherche en mémoire, puis sont formatées à part.
const crypto = require('crypto');
const { FALLBACK_TMDB_KEY } = require('./config');
const { getImdbId } = require('./tmdb');
const { getBehaviorSettings } = require('./settings');
const { testResolve } = require('./resolver');
const { getOverrideRevision } = require('./overrides');
const { applyUserStreamPrefs, applyDisplayMode, toAiomStreams } = require('./stream-format');

const searches = new Map();
const TTL_MS = 15000;
const MAX_SEARCHES = 200;

function searchOnce(key, work) {
    const hit = searches.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.promise;
    if (searches.size >= MAX_SEARCHES) searches.delete(searches.keys().next().value);
    const entry = { expiresAt: Infinity, promise: null };
    entry.promise = Promise.resolve().then(work).then(result => {
        entry.expiresAt = Date.now() + TTL_MS;
        return result;
    }, error => {
        if (searches.get(key) === entry) searches.delete(key);
        throw error;
    });
    searches.set(key, entry);
    return entry.promise;
}

async function resolvePreview(mediaType, tmdbId, config) {
    if (!FALLBACK_TMDB_KEY) {
        return { streams: [], message: 'Aperçu réel indisponible : clé TMDB du serveur non configurée.' };
    }
    const behavior = await getBehaviorSettings();
    // Les réglages de connexion et leurs clés ne figurent jamais en clair dans la clé mémoire.
    const key = crypto.createHash('sha256').update(JSON.stringify({
        mediaType, tmdbId, behavior, includeExtras: config.includeExtras, overrideRevision: getOverrideRevision(),
    })).digest('hex');
    const result = await searchOnce(key, async () => {
        const imdbId = await getImdbId(mediaType, tmdbId, FALLBACK_TMDB_KEY);
        if (!/^tt\d+$/.test(imdbId || '')) {
            return { streams: [], message: 'Aperçu indisponible pour ce titre.' };
        }
        return testResolve(mediaType === 'tv' ? 'series' : 'movie', imdbId, null, false, false, {
            behavior, includeExtras: config.includeExtras,
        });
    });
    if (result.error) return { streams: [], message: 'La recherche de bandes-annonces est indisponible.' };
    const streams = config.aiom ? toAiomStreams(result.streams)
        : applyDisplayMode(applyUserStreamPrefs(result.streams, config), config, result.source);
    return {
        streams,
        source: result.source || null,
        message: streams.length ? null : result.message || (result.hidden
            ? 'Ce titre est masqué par l’administrateur.'
            : 'Aucune bande-annonce trouvée avec ces options.'),
    };
}

module.exports = { resolvePreview };
