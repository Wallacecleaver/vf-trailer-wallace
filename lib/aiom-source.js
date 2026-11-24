// Source meta facultative pour le manifest AIOM partagé.
const { createHash } = require('node:crypto');
const sql = require('./db');
const { getCached, setCached } = require('./cache');
const { getOverride } = require('./overrides');
const { assertSafeUrlSync, safeFetch } = require('./security');
const { hasNonVfSignal } = require('./video-filters');

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const AIOM_MANIFEST_ID = 'org.vftrailers.aiom';
const SOURCE = 'manifest_externe';
const inflight = new Map();

function parseManifestUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('URL invalide');
    const url = assertSafeUrlSync(value.trim());
    if (url.protocol !== 'https:' || !url.pathname.endsWith('/manifest.json') || url.hash) {
        throw new Error('Manifest HTTPS requis');
    }
    return url;
}

async function readSourceJson(url, signal, size) {
    const response = await safeFetch(url.href, { headers: { accept: 'application/json' }, signal, size },
        { maxRedirects: 0, allowPrivateUpstream: false });
    if (!response.ok) {
        response.body?.destroy?.();
        throw new Error('Réponse du fournisseur indisponible');
    }
    return response.json();
}

async function validateAiomSource(url) {
    const manifest = await readSourceJson(url, AbortSignal.timeout(5000), 64 * 1024);
    const resource = Array.isArray(manifest?.resources) && manifest.resources.find(r => r === 'meta' || r?.name === 'meta');
    const types = resource?.types ?? manifest?.types;
    const prefixes = resource?.idPrefixes ?? manifest?.idPrefixes;
    return typeof manifest?.id === 'string' && manifest.id !== AIOM_MANIFEST_ID && !!resource && Array.isArray(types)
        && types.includes('movie') && types.includes('series')
        && (prefixes == null || (Array.isArray(prefixes) && (prefixes.length === 0 || prefixes.includes('tt'))));
}

async function getAiomSource() {
    const [row] = await sql`SELECT source_manifest_url FROM aiom_settings WHERE id = 1`;
    return row?.source_manifest_url || '';
}

async function setAiomSource(url) {
    await sql`INSERT INTO aiom_settings (id, source_manifest_url) VALUES (1, ${url})
        ON CONFLICT (id) DO UPDATE SET source_manifest_url = EXCLUDED.source_manifest_url`;
}

function trailerFromMeta(meta) {
    const list = value => Array.isArray(value) ? value : [];
    const titleOf = row => [row?.title, row?.name, row?.displayName].find(value => typeof value === 'string' && value.trim());
    const candidates = [...list(meta.trailerStreams), ...list(meta.trailers)];
    // Les deux champs peuvent décrire le même YouTube avec des libellés différents.
    const idOf = row => [row?.ytId, row?.key, row?.source].find(id => typeof id === 'string' && YOUTUBE_ID.test(id));
    const rejected = new Set(candidates.filter(row => hasNonVfSignal(titleOf(row))).map(idOf));
    for (const row of candidates) {
        const ytId = idOf(row);
        if (ytId && !rejected.has(ytId) && (!row.site || /^youtube$/i.test(row.site))) {
            return { ytId, title: (titleOf(row) || 'Bande-annonce').slice(0, 240) };
        }
    }
    for (const row of [...list(meta.trailerStreams), ...list(meta.links)]) {
        const title = titleOf(row);
        if (hasNonVfSignal(title) || hasNonVfSignal(row?.provider)) continue;
        try {
            const url = assertSafeUrlSync(row?.url || row?.trailers);
            if (url.protocol === 'https:' && /\.mp4$/i.test(url.pathname)) {
                return { url: url.href, title: (title || 'Bande-annonce').slice(0, 240) };
            }
        } catch { /* lien sans vidéo MP4 publique */ }
    }
    return null;
}

async function resolveAiomSource(sourceUrl, type, imdbId, season, behavior, timeoutMs) {
    const override = await getOverride(imdbId, season);
    if (override?.hidden) return { streams: [], hidden: true, officialTitle: override.title };
    const resourceId = season ? `${imdbId}:${season}` : imdbId;
    const scope = createHash('sha256').update(sourceUrl).digest('hex');
    const key = `cache:aiom-source:v1:${scope}:${type}:${resourceId}`;
    const cached = behavior.cacheEnabled && await getCached(key);
    if (cached) return { ...cached, fromCache: true };
    if (inflight.has(key)) return inflight.get(key);

    const signal = AbortSignal.timeout(timeoutMs);
    const work = (async () => {
        const url = parseManifestUrl(sourceUrl);
        url.pathname = url.pathname.replace(/manifest\.json$/, `meta/${type}/${encodeURIComponent(resourceId)}.json`);
        const data = await readSourceJson(url, signal, 8 * 1024 * 1024);
        if (!data || !Object.hasOwn(data, 'meta')) throw new Error('Réponse meta invalide');
        const meta = data.meta;
        if (meta !== null && (meta?.type !== type || (meta.id !== imdbId && meta.id !== resourceId))) {
            throw new Error('La fiche du fournisseur ne correspond pas au titre');
        }
        const trailer = meta && trailerFromMeta(meta);
        const result = { streams: trailer ? [trailer] : [], source: SOURCE,
            officialTitle: typeof meta?.name === 'string' ? meta.name.slice(0, 180) : null };
        if (behavior.cacheEnabled) await setCached(key, result, trailer ? 120 : 30);
        return result;
    })().catch(() => ({ streams: [], source: SOURCE, timedOut: signal.aborted, sourceUnavailable: !signal.aborted }))
        .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
}

module.exports = { AIOM_MANIFEST_ID, parseManifestUrl, validateAiomSource, getAiomSource, setAiomSource, resolveAiomSource };
