// Mode AIOMetadata ("A trailer addon" dans Meta Providers > Trailers) : délai, résultat, journal.

const { logEvent } = require('./logs');
const { resolveStreams } = require('./resolver');

// AIOMetadata attend la réponse pendant qu'il construit la fiche : au-delà de ce délai on répond
// vide (il retombe sur son propre trailer). La résolution continue en arrière-plan et remplit le
// cache pour la requête suivante. Réglable dans le dashboard (Réglages > AIOMetadata), 1 à 12 s
// ; 5 s par défaut.
function aiomTimeoutMs(behavior) {
    const secs = Number(behavior && behavior.aiomTimeoutSeconds);
    return (Number.isFinite(secs) && secs > 0 ? Math.min(12, Math.max(1, secs)) : 5) * 1000;
}
function withDeadline(promise, ms) {
    let timer;
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve({ streams: [], timedOut: true }), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Résultat d'une requête AIOMetadata (même vocabulaire pour le journal et les compteurs).
function aiomOutcome(result) {
    const first = result.streams && result.streams[0];
    if (result.timedOut) return 'timeout';
    if (result.hidden) return 'masque';
    if (first) return first.ytId ? 'ytId' : 'url';
    return 'aucun';
}

// Une seule résolution à la fois par titre/config : AIOMetadata redemande souvent le même titre
// pendant qu'une résolution lente tourne encore (délai dépassé -> nouvelle requête). Sans ça,
// chaque requête relançait TMDB + Allociné + YouTube en parallèle pour rien.
const _aiomInflight = new Map();
function resolveStreamsSingleFlight(type, imdbId, season, config) {
    const key = [type, imdbId, season || '', config.tmdbKey || '', config.pseudo || '', config.includeExtras].join('|');
    const running = _aiomInflight.get(key);
    if (running) return running;
    const p = resolveStreams(type, imdbId, season, config).finally(() => _aiomInflight.delete(key));
    _aiomInflight.set(key, p);
    return p;
}

// Journal dashboard (page Logs, contexte AIOM) : une ligne par requête AIOMetadata, SANS toucher
// aux stats globales (AIOMetadata peut interroger l'addon pour beaucoup de titres d'un coup : ça
// gonflerait "Requêtes totales" et noierait les vraies demandes des utilisateurs Stremio).
// Dédoublonnage en mémoire (5 min) : un même titre redemandé en boucle
// ne remplit pas le journal, mais un changement de résultat (ex. timeout puis succès) est loggé.
const AIOM_LOG_DEDUPE_MS = 5 * 60 * 1000;
const _aiomSeen = new Map();
async function logAiomRequest({ type, imdbId, season, config, result, ms, timeoutMs }) {
    const first = result.streams && result.streams[0];
    const code = aiomOutcome(result);
    const outcome = code === 'masque' ? 'masqué' : code;

    const key = `${type}:${imdbId}:${season || ''}:${outcome}`;
    const now = Date.now();
    const last = _aiomSeen.get(key);
    if (last && now - last < AIOM_LOG_DEDUPE_MS) return;
    _aiomSeen.set(key, now);
    if (_aiomSeen.size > 500) {
        for (const [k, t] of _aiomSeen) if (now - t > AIOM_LOG_DEDUPE_MS) _aiomSeen.delete(k);
    }

    const typeLabel = type === 'series' ? 'série' : 'film';
    const titleLabel = result.officialTitle ? `"${result.officialTitle}"` : imdbId;
    const verdict = {
        ytId: 'trailer YouTube renvoyé',
        url: 'trailer en lien direct renvoyé',
        aucun: 'aucun trailer VF — AIOMetadata garde celui de son fournisseur',
        timeout: `trop lent (> ${Math.round(timeoutMs / 1000)} s) — AIOMetadata garde celui de son fournisseur`,
        masqué: 'titre masqué par un override',
    }[outcome];

    await logEvent({
        level: outcome === 'timeout' ? 'warn' : 'info',
        context: 'AIOM',
        event: 'aiom_request',
        message: `AIOMetadata → ${titleLabel} (${typeLabel}) : ${verdict}`,
        meta: {
            imdbId, type,
            season: season || null,
            title: result.officialTitle || null,
            pseudo: config.pseudo || null,
            result: outcome,
            source: result.source || null,
            cache: result.timedOut ? null : (result.fromCache ? 'oui' : 'non'),
            ms: `${ms} ms`,
            ytId: first && first.ytId ? first.ytId : null,
        },
    });
}

module.exports = { aiomTimeoutMs, withDeadline, aiomOutcome, resolveStreamsSingleFlight, logAiomRequest };
