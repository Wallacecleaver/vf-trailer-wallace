// ============================================================
// QUALITÉ FORCÉE — extraction directe d'un flux YouTube à une résolution donnée.
//
// IMPORTANT (honnêteté technique) : YouTube ne propose du 1080p "propre"
// qu'en flux séparés (vidéo sans son côté, audio à part - format adaptatif/DASH),
// que Stremio ne sait PAS recombiner tout seul. Les flux "progressifs"
// (vidéo + audio dans un seul fichier, ce que Stremio peut lire directement)
// plafonnent en général à 720p sur YouTube : le 1080p "propre" n'existe QUE sur
// certaines vidéos (anciens itags 37/38, de moins en moins fréquents). On ne
// peut donc pas "forcer" un 1080p qui n'existe techniquement pas pour une vidéo
// donnée -- ce module tente toujours le meilleur progressif disponible jusqu'à
// la qualité demandée, et ne ment jamais sur ce qui est réellement servi : le
// tag qualité affiché dans Stremio (voir formatStreamName côté index.js)
// reflète la résolution EFFECTIVE, pas celle demandée.
//
// Fiabilisé par rapport à la version précédente :
// - repli manuel sur les champs bruts (hasVideo/hasAudio/height) si
//   ytdl.filterFormats() ne renvoie rien (ça arrive selon les vidéos/versions) ;
// - un essai de retry si l'appel à YouTube échoue (throttle ponctuel fréquent) ;
// - un log admin (pas une erreur) quand la qualité demandée n'était pas
//   disponible pour CETTE vidéo précise -> visible dans le dashboard (Logs)
//   plutôt qu'invisible en silence.
// ============================================================

const { logEvent } = require('./logs');

let ytdl = null;
try {
    ytdl = require('@distube/ytdl-core');
} catch {
    console.error('@distube/ytdl-core non installé — la qualité forcée est désactivée, repli sur ytId natif.');
}

// Cache négatif en mémoire : quand YouTube a bloqué l'extraction pour une vidéo
// (bot detection, IP de datacenter), on ne re-tente PAS avant un moment.
// Sans ça, chaque requête re-scrapait la même vidéo, aggravait le blocage et
// spammait les logs. Mémoire seule : un simple heurtoir suffit, c'est une optimisation.
const BOT_BLOCK_COOLDOWN_MS = 30 * 60 * 1000; // 30 min de pause après un blocage confirmé
const blockedSince = new Map(); // ytId -> timestamp du dernier bot-block

function isBotBlocked(msg) {
    const m = String(msg || '').toLowerCase();
    return m.includes('not a bot') || m.includes('confirm you') || m.includes('recaptcha')
        || m.includes('sign in') || m.includes('verify') || m.includes('bot detection')
        || m.includes('cookie') || m.includes('412');
}

// Repli manuel si ytdl.filterFormats('videoandaudio') ne renvoie rien d'exploitable :
// on refait le même filtre directement sur les champs bruts du format YouTube.
function progressiveFormatsFallback(formats) {
    return (formats || []).filter(f => f && f.hasVideo && f.hasAudio && f.height && f.url);
}

async function resolveYoutubeAtQualityUncached(ytId, quality, { allowRetry = true } = {}) {
    if (!ytdl || quality === 'auto') return null;
    if (blockedSince.has(ytId) && Date.now() - blockedSince.get(ytId) < BOT_BLOCK_COOLDOWN_MS) {
        return null; // pas de re-scrape inutile pendant le cooldown (retour silencieux, déjà logué)
    }

    try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${ytId}`, { requestOptions: { timeout: 8000 } });
        const targetHeight = quality === '1080p' ? 1080 : 720;

        let progressiveFormats = [];
        try {
            progressiveFormats = ytdl.filterFormats(info.formats, 'videoandaudio') || [];
        } catch {
            progressiveFormats = [];
        }
        if (!progressiveFormats.length) progressiveFormats = progressiveFormatsFallback(info.formats);

        const progressive = progressiveFormats
            .filter(f => f.height && f.height <= targetHeight && /^https:\/\//i.test(f.url || ''))
            .sort((a, b) => b.height - a.height || (b.bitrate || 0) - (a.bitrate || 0))[0];

        if (!progressive) {
            // Avant : silencieux (l'appelant repart juste sur ytId natif). Ça cache le cas
            // le plus fréquent en pratique -- YouTube ne propose de moins en moins de formats
            // progressifs (vidéo+audio dans le même fichier) pour les nouvelles vidéos -- donc
            // sans ce log, impossible de distinguer "vidéo sans progressif" d'un vrai bug.
            const heights = (info.formats || []).map(f => f.height).filter(Boolean);
            logEvent({
                level: 'warn', context: 'STREAM', event: 'no_progressive_format',
                message: `Aucun format vidéo+audio combiné compatible trouvé pour cette vidéo YouTube (qualité ${quality} demandée) — lecteur YouTube natif conservé en secours`,
                meta: { ytId, requested: quality, availableHeights: [...new Set(heights)].sort((a, b) => a - b) },
            }).catch(() => {});
            return null; // rien d'exploitable -> l'appelant repart sur ytId natif
        }

        if (progressive.height < targetHeight) {
            // Pas une erreur : juste "cette vidéo précise n'a pas de progressif à la
            // qualité demandée" -> on le note pour que ce soit visible admin plutôt
            // que silencieux, sans jamais bloquer la réponse pour ça.
            logEvent({
                level: 'info', context: 'STREAM', event: 'quality_fallback',
                message: `Qualité ${quality} demandée mais indisponible pour cette vidéo — servi en ${progressive.height}p`,
                meta: { ytId, requested: quality, actual: progressive.height },
            }).catch(() => {});
        }

        return { url: progressive.url, height: progressive.height, container: progressive.container || (String(progressive.mimeType || '').includes('mp4') ? 'mp4' : null) };
    } catch (err) {
        // YouTube bloque le scraping depuis les IP de datacenter avec une page
        // "Sign in to confirm you're not a bot". C'est STRUCTUREL, pas un bug ponctuel :
        // un retry immédiat échouerait à coup sûr, on ne retente pas, on pose un cooldown
        // par vidéo et on le logue en warn (pas en erreur) pour ne pas spamer le journal.
        const botBlocked = isBotBlocked(err && err.message);
        if (botBlocked) {
            blockedSince.set(ytId, Date.now());
            logEvent({
                level: 'warn', context: 'STREAM', event: 'youtube_bot_blocked',
                message: `YouTube bloque l'extraction du flux pour ${ytId} (protection anti-bot, IP serveur) — flux servi via le lecteur intégré`,
                meta: { ytId, requested: quality, error: String(err.message).slice(0, 200) },
            }).catch(() => {});
            console.error('Extraction YouTube bloquée par la protection anti-bot:', ytId);
            return null;
        }
        if (allowRetry) {
            // YouTube throttle/bloque parfois ponctuellement le scraping -- un seul
            // essai de repli immédiat, sans latence perceptible côté utilisateur.
            return resolveYoutubeAtQualityUncached(ytId, quality, { allowRetry: false });
        }
        // console.error seul finit dans les logs Docker, invisibles depuis le dashboard --
        // on le duplique ici pour que l'échec soit visible là où on regarde vraiment.
        logEvent({
            level: 'error', context: 'STREAM', event: 'youtube_extraction_failed',
            message: `Extraction YouTube en échec pour ${ytId} : ${err.message}`,
            meta: { ytId, requested: quality, error: err.message },
        }).catch(() => {});
        console.error('Erreur extraction YouTube qualité forcée:', err.message);
        return null;
    }
}

// Les URL YouTube signées sont temporaires : cache mémoire très court uniquement.
// Le cache SQLite des bandes-annonces ne contient donc JAMAIS ces URL expirables.
const QUALITY_CACHE_TTL_MS = 90 * 1000;
const FAILURE_CACHE_TTL_MS = 20 * 1000;
const qualityCache = new Map();
const qualityInFlight = new Map();

async function resolveYoutubeAtQuality(ytId, quality = '1080p', options = {}) {
    if (!ytId || quality === 'auto') return null;
    const key = `${ytId}:${quality}`;
    const cached = qualityCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) qualityCache.delete(key);
    if (qualityInFlight.has(key)) return qualityInFlight.get(key);

    const lookup = resolveYoutubeAtQualityUncached(ytId, quality, options)
        .catch(() => null)
        .then(value => {
            qualityCache.set(key, {
                value,
                expiresAt: Date.now() + (value ? QUALITY_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
            });
            // Empêche la carte de grandir sans limite sur une instance très utilisée.
            while (qualityCache.size > 300) qualityCache.delete(qualityCache.keys().next().value);
            return value;
        })
        .finally(() => qualityInFlight.delete(key));

    qualityInFlight.set(key, lookup);
    return lookup;
}

// Remplace ytId par une URL progressive jouable lorsque l'extraction réussit.
// Si YouTube bloque l'extraction ou ne fournit pas de format combiné, le flux ytId
// original est conservé sans changement : Stremio garde donc son lecteur YouTube.
async function applyYoutubeQualityToStreams(streams, resolver = resolveYoutubeAtQuality) {
    if (!Array.isArray(streams) || !streams.length) return streams;
    return Promise.all(streams.map(async stream => {
        if (!stream || !stream.ytId || stream.externalUrl) return stream;
        let quality = null;
        try { quality = await resolver(stream.ytId, '1080p', { allowRetry: false }); } catch {}
        if (!quality || !/^https:\/\//i.test(quality.url || '') || !Number.isInteger(quality.height)) return stream;

        const { ytId, ...rest } = stream;
        const behaviorHints = quality.container && quality.container !== 'mp4'
            ? { ...(stream.behaviorHints || {}), notWebReady: true }
            : stream.behaviorHints;
        return {
            ...rest,
            url: quality.url,
            __quality: quality.height,
            ...(behaviorHints ? { behaviorHints } : {}),
        };
    }));
}

module.exports = { resolveYoutubeAtQuality, applyYoutubeQualityToStreams };