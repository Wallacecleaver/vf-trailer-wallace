// ============================================================
// LECTURE YOUTUBE DE MEILLEURE QUALITÉ POUR STREMIO
//
// Les URL Googlevideo extraites par ytdl-core sont temporaires et peuvent être
// limitées à l'IP du serveur qui les a demandées. On ne les transmet donc jamais
// directement au lecteur : le VPS relaie le flux et gère les requêtes HTTP Range.
// Cela consomme le débit sortant du VPS pendant la lecture.
//
// On ne retient que les formats progressifs (audio + vidéo dans un seul fichier),
// jusqu'à 1080p. Si aucun format compatible n'existe ou si YouTube bloque l'extraction,
// le flux ytId natif reste proposé dans Stremio.
// ============================================================

const crypto = require('crypto');
const { logEvent } = require('./logs');
const { APP_BASE_URL } = require('./config');

let ytdl = null;
try {
    ytdl = require('@distube/ytdl-core');
} catch {
    console.error('@distube/ytdl-core non installé — lecture YouTube améliorée désactivée.');
}

const INFO_TIMEOUT_MS = 8000;
const INFO_CACHE_TTL_MS = 2 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 20 * 1000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ACTIVE_PROXY_STREAMS = 8;
const BOT_BLOCK_COOLDOWN_MS = 30 * 60 * 1000;

const blockedSince = new Map();
const infoCache = new Map();
const infoInFlight = new Map();
let activeProxyStreams = 0;

// Secret partagé uniquement par ce processus. TOKEN_SECRET doit être défini dans
// l'environnement pour que les liens signés restent valides après un redémarrage.
const proxySecret = process.env.TOKEN_SECRET
    ? crypto.createHash('sha256').update(String(process.env.TOKEN_SECRET)).digest()
    : crypto.randomBytes(32);

function isBotBlocked(msg) {
    const m = String(msg || '').toLowerCase();
    return m.includes('not a bot') || m.includes('confirm you') || m.includes('recaptcha')
        || m.includes('sign in') || m.includes('verify') || m.includes('bot detection')
        || m.includes('cookie') || m.includes('412') || m.includes('429');
}

function progressiveFormatsFallback(formats) {
    return (formats || []).filter(f => f && f.hasVideo && f.hasAudio && f.height && f.url);
}

function selectProgressiveFormat(info, quality) {
    const targetHeight = quality === '720p' ? 720 : 1080;
    let formats = [];
    try {
        formats = ytdl.filterFormats(info.formats || [], 'videoandaudio') || [];
    } catch {
        formats = [];
    }
    if (!formats.length) formats = progressiveFormatsFallback(info.formats);

    return formats
        .filter(f => f && f.height && f.height <= targetHeight
            && f.hasVideo !== false && f.hasAudio !== false
            && /^https:\/\//i.test(f.url || '')
            && Number.isSafeInteger(Number(f.contentLength))
            && Number(f.contentLength) > 0)
        .sort((a, b) => b.height - a.height || (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
}

async function resolveYoutubeAtQualityUncached(ytId, quality) {
    if (!ytdl || typeof ytdl.getInfo !== 'function') return null;
    if (blockedSince.has(ytId) && Date.now() - blockedSince.get(ytId) < BOT_BLOCK_COOLDOWN_MS) return null;

    try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${ytId}`, {
            requestOptions: { timeout: INFO_TIMEOUT_MS },
        });
        const format = selectProgressiveFormat(info, quality);
        if (!format) {
            const heights = (info.formats || []).map(f => f.height).filter(Boolean);
            logEvent({
                level: 'warn', context: 'STREAM', event: 'no_progressive_format',
                message: `Aucun format vidéo+audio combiné compatible trouvé pour YouTube (qualité ${quality}) — lecteur YouTube natif conservé en secours`,
                meta: { ytId, requested: quality, availableHeights: [...new Set(heights)].sort((a, b) => a - b) },
            }).catch(() => {});
            return null;
        }

        if (format.height < (quality === '720p' ? 720 : 1080)) {
            logEvent({
                level: 'info', context: 'STREAM', event: 'quality_fallback',
                message: `Qualité ${quality} demandée mais indisponible — flux progressif servi en ${format.height}p`,
                meta: { ytId, requested: quality, actual: format.height },
            }).catch(() => {});
        }

        return {
            info,
            format,
            height: format.height,
            container: format.container || (String(format.mimeType || '').includes('mp4') ? 'mp4' : null),
        };
    } catch (err) {
        if (isBotBlocked(err && err.message)) {
            blockedSince.set(ytId, Date.now());
            logEvent({
                level: 'warn', context: 'STREAM', event: 'youtube_bot_blocked',
                message: `YouTube bloque l'extraction pour ${ytId} (protection anti-bot ou limitation de débit) — lecteur natif conservé`,
                meta: { ytId, requested: quality, error: String(err.message).slice(0, 200) },
            }).catch(() => {});
            return null;
        }
        logEvent({
            level: 'warn', context: 'STREAM', event: 'youtube_extraction_failed',
            message: `Extraction YouTube impossible pour ${ytId} : ${String(err.message || err).slice(0, 180)} — lecteur natif conservé`,
            meta: { ytId, requested: quality },
        }).catch(() => {});
        return null;
    }
}

async function resolveYoutubeAtQuality(ytId, quality = '1080p') {
    if (!ytdl || !/^[A-Za-z0-9_-]{11}$/.test(String(ytId || ''))) return null;
    if (!['720p', '1080p'].includes(quality)) return null;

    const key = `${ytId}:${quality}`;
    const cached = infoCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) infoCache.delete(key);
    if (infoInFlight.has(key)) return infoInFlight.get(key);

    const lookup = resolveYoutubeAtQualityUncached(ytId, quality)
        .catch(() => null)
        .then(value => {
            infoCache.set(key, {
                value,
                expiresAt: Date.now() + (value ? INFO_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
            });
            while (infoCache.size > 150) infoCache.delete(infoCache.keys().next().value);
            return value;
        })
        .finally(() => infoInFlight.delete(key));

    infoInFlight.set(key, lookup);
    return lookup;
}

function makeYoutubeProxyToken(ytId, quality = '1080p') {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(ytId || '')) || !['720p', '1080p'].includes(quality)) return null;
    const payload = Buffer.from(JSON.stringify({
        ytId,
        quality,
        exp: Date.now() + TOKEN_TTL_MS,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', proxySecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyYoutubeProxyToken(token) {
    if (typeof token !== 'string' || token.length > 512) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = crypto.createHmac('sha256', proxySecret).update(payload).digest();
    let actual;
    try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!/^[A-Za-z0-9_-]{11}$/.test(data.ytId || '')) return null;
        if (!['720p', '1080p'].includes(data.quality)) return null;
        if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
        return data;
    } catch {
        return null;
    }
}

function parseByteRange(header, totalSize) {
    if (!header) return null;
    if (!Number.isSafeInteger(totalSize) || totalSize <= 0) {
        const error = new Error('Taille vidéo inconnue');
        error.statusCode = 416;
        throw error;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!match || (!match[1] && !match[2])) {
        const error = new Error('Plage vidéo non valide');
        error.statusCode = 416;
        throw error;
    }

    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            const error = new Error('Plage vidéo non valide');
            error.statusCode = 416;
            throw error;
        }
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : totalSize - 1;
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || start >= totalSize) {
        const error = new Error('Plage vidéo hors limites');
        error.statusCode = 416;
        throw error;
    }
    return { start, end: Math.min(end, totalSize - 1) };
}

async function handleYoutubeProxyRequest(req, res, token) {
    const payload = verifyYoutubeProxyToken(token);
    if (!payload) return res.status(404).end();

    if (activeProxyStreams >= MAX_ACTIVE_PROXY_STREAMS) {
        res.setHeader('Retry-After', '15');
        return res.status(503).send('Trop de lectures vidéo simultanées. Réessaie dans un instant.');
    }

    activeProxyStreams++;
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        activeProxyStreams = Math.max(0, activeProxyStreams - 1);
    };
    res.once('finish', release);
    res.once('close', release);

    try {
        const prepared = await resolveYoutubeAtQuality(payload.ytId, payload.quality);
        if (!prepared || !prepared.info || !prepared.format || typeof ytdl.downloadFromInfo !== 'function') {
            release();
            if (!res.headersSent) return res.status(502).send('Flux YouTube indisponible. Utilise le lien YouTube de secours.');
            return res.end();
        }

        if (res.destroyed) { release(); return; }
        const totalSize = Number(prepared.format.contentLength);
        let range = null;
        try {
            range = parseByteRange(req.headers.range, totalSize);
        } catch (err) {
            release();
            res.setHeader('Content-Range', `bytes */${Number.isSafeInteger(totalSize) ? totalSize : '*'}`);
            return res.status(416).end();
        }

        const start = range ? range.start : 0;
        const end = range ? range.end : totalSize - 1;
        const mimeType = String(prepared.format.mimeType || 'video/mp4').split(';')[0].trim();

        res.status(range ? 206 : 200);
        res.setHeader('Content-Type', mimeType || 'video/mp4');
        res.setHeader('Content-Length', String(end - start + 1));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', 'inline; filename="trailer-video"');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
        if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);

        if (req.method === 'HEAD') {
            release();
            return res.end();
        }

        const downloadOptions = { format: prepared.format, highWaterMark: 1024 * 1024 };
        if (range) downloadOptions.range = range;
        const upstream = ytdl.downloadFromInfo(prepared.info, downloadOptions);

        upstream.once('error', err => {
            logEvent({
                level: 'warn', context: 'STREAM', event: 'youtube_proxy_failed',
                message: `Relais vidéo YouTube interrompu pour ${payload.ytId} : ${String(err.message || err).slice(0, 160)}`,
                meta: { ytId: payload.ytId },
            }).catch(() => {});
            if (!res.headersSent) res.status(502).end();
            else res.destroy(err);
        });
        res.once('close', () => {
            if (!res.writableEnded && typeof upstream.destroy === 'function') upstream.destroy();
        });
        upstream.pipe(res);
    } catch (err) {
        release();
        logEvent({
            level: 'warn', context: 'STREAM', event: 'youtube_proxy_failed',
            message: `Impossible de relayer la vidéo YouTube ${payload.ytId} : ${String(err.message || err).slice(0, 160)}`,
            meta: { ytId: payload.ytId },
        }).catch(() => {});
        if (!res.headersSent) return res.status(502).send('Flux YouTube indisponible. Utilise le lien YouTube de secours.');
        res.destroy(err);
    }
}

async function applyYoutubeQualityToStreams(streams, resolver = resolveYoutubeAtQuality) {
    if (!Array.isArray(streams) || !streams.length) return streams;
    return Promise.all(streams.map(async stream => {
        if (!stream || !stream.ytId || stream.externalUrl) return stream;
        let prepared = null;
        try { prepared = await resolver(stream.ytId, '1080p'); } catch {}
        if (!prepared || !Number.isInteger(prepared.height)) return stream;

        const token = makeYoutubeProxyToken(stream.ytId, '1080p');
        if (!token) return stream;
        const { ytId, ...rest } = stream;
        const behaviorHints = prepared.container && prepared.container !== 'mp4'
            ? { ...(stream.behaviorHints || {}), notWebReady: true }
            : stream.behaviorHints;
        return {
            ...rest,
            url: `${APP_BASE_URL}/youtube/${token}`,
            __quality: prepared.height,
            ...(behaviorHints ? { behaviorHints } : {}),
        };
    }));
}

module.exports = {
    resolveYoutubeAtQuality,
    applyYoutubeQualityToStreams,
    makeYoutubeProxyToken,
    verifyYoutubeProxyToken,
    parseByteRange,
    handleYoutubeProxyRequest,
};