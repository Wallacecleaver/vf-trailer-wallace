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
// (bot detection, IP de datacenter Vercel), on ne re-tente PAS avant un moment.
// Sans ça, chaque requête re-scrapait la même vidéo, aggravait le blocage et
// spammait les logs. Mémory-only (pas de Redis) : un simple heurtoir suffit,
// chaque instance serverless garde le sien -- c'est un optim, pas une garantie.
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

async function resolveYoutubeAtQuality(ytId, quality, { allowRetry = true } = {}) {
    if (!ytdl || quality === 'auto') return null;
    if (blockedSince.has(ytId) && Date.now() - blockedSince.get(ytId) < BOT_BLOCK_COOLDOWN_MS) {
        return null; // pas de re-scrape inutile pendant le cooldown (retour silencieux, déjà logué)
    }

    try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${ytId}`);
        const targetHeight = quality === '1080p' ? 1080 : 720;

        let progressiveFormats = [];
        try {
            progressiveFormats = ytdl.filterFormats(info.formats, 'videoandaudio') || [];
        } catch {
            progressiveFormats = [];
        }
        if (!progressiveFormats.length) progressiveFormats = progressiveFormatsFallback(info.formats);

        const progressive = progressiveFormats
            .filter(f => f.height && f.height <= targetHeight)
            .sort((a, b) => b.height - a.height)[0];

        if (!progressive) {
            // Avant : silencieux (l'appelant repart juste sur ytId natif). Ça cache le cas
            // le plus fréquent en pratique -- YouTube ne propose de moins en moins de formats
            // progressifs (vidéo+audio dans le même fichier) pour les nouvelles vidéos -- donc
            // sans ce log, impossible de distinguer "vidéo sans progressif" d'un vrai bug.
            const heights = (info.formats || []).map(f => f.height).filter(Boolean);
            logEvent({
                level: 'warn', context: 'STREAM', event: 'no_progressive_format',
                message: `Aucun format vidéo+audio combiné trouvé pour cette vidéo YouTube (qualité ${quality} demandée) — flux resté ytId-only, injouable sur Fusion/Nuvio`,
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

        return { url: progressive.url, height: progressive.height };
    } catch (err) {
        // YouTube bloque le scraping depuis les IP de datacenter (Vercel) avec une page
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
            return resolveYoutubeAtQuality(ytId, quality, { allowRetry: false });
        }
        // console.error seul finit dans les logs Vercel, invisibles depuis le dashboard --
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

module.exports = { resolveYoutubeAtQuality };