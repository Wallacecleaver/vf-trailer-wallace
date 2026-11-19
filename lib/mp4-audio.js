const { safeFetch } = require('./security');
const { readHead } = require('./media-link');

const HEADER_BYTES = 128 * 1024;
const MAX_METADATA_BYTES = 512 * 1024;
const FRENCH = new Set(['fra', 'fre']);

function boxHeader(buffer, offset, end) {
    if (offset + 8 > end) return null;
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
        if (offset + 16 > end) return null;
        const wide = buffer.readBigUInt64BE(offset + 8);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER - offset)) return null;
        size = Number(wide);
        header = 16;
    }
    if (size < header) return null;
    return { type: buffer.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size };
}

function* boxes(buffer, start, end) {
    for (let offset = start; offset + 8 <= end;) {
        const box = boxHeader(buffer, offset, end);
        if (!box || box.end > end) return;
        yield box;
        offset = box.end;
    }
}

function children(buffer, box, type) {
    return [...boxes(buffer, box.start, box.end)].filter(child => child.type === type);
}

function readLanguage(buffer, box) {
    if (!box || box.start === box.end) return null;
    const version = buffer[box.start];
    if (version !== 0 && version !== 1) return null;
    const offset = box.start + (version === 1 ? 32 : 20);
    if (offset + 2 > box.end) return null;
    const packed = buffer.readUInt16BE(offset);
    const language = String.fromCharCode(...[10, 5, 0].map(shift => 96 + ((packed >> shift) & 31)));
    return /^[a-z]{3}$/.test(language) && !['und', 'zxx', 'mul'].includes(language) ? language : null;
}

function mp4AudioLanguage(buffer) {
    const root = { start: 0, end: buffer.length };
    const moov = children(buffer, root, 'moov')[0];
    if (!moov) return null;
    const audio = [];
    for (const track of children(buffer, moov, 'trak')) {
        const media = children(buffer, track, 'mdia')[0];
        if (!media) continue;
        const handler = children(buffer, media, 'hdlr')[0];
        if (!handler || handler.start + 12 > handler.end
            || buffer.toString('ascii', handler.start + 8, handler.start + 12) !== 'soun') continue;
        audio.push(readLanguage(buffer, children(buffer, media, 'mdhd')[0]));
    }
    if (!audio.length || audio.includes(null)) return null;
    if (audio.every(language => FRENCH.has(language))) return 'fra';
    // Avec plusieurs langues, on ne peut pas garantir la piste choisie par le lecteur.
    return audio.every(language => language === audio[0]) ? audio[0] : null;
}

// Un MP4 peut stocker moov après mdat. On suit les tailles des boîtes plutôt
// que de chercher un marqueur au hasard dans les octets de la vidéo.
function mp4MetadataRange(prefix, totalBytes) {
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= prefix.length
        || prefix.toString('ascii', 4, 8) !== 'ftyp') return null;
    for (let offset = 0; offset < prefix.length;) {
        const box = boxHeader(prefix, offset, prefix.length);
        if (!box || box.end > totalBytes) return null;
        if (box.type === 'moov') {
            const size = box.end - offset;
            return box.end > prefix.length && size <= MAX_METADATA_BYTES
                ? { start: offset, length: size } : null;
        }
        if (box.end >= prefix.length) {
            return box.end < totalBytes ? { start: box.end, length: Math.min(MAX_METADATA_BYTES, totalBytes - box.end) } : null;
        }
        offset = box.end;
    }
    return null;
}

async function readRange(url, start, length, signal) {
    const res = await safeFetch(url, {
        headers: { Range: `bytes=${start}-${start + length - 1}`, 'Accept-Encoding': 'identity' },
        signal,
    });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') || '');
    const partial = res.status === 206 && range && Number(range[1]) === start
        && Number(range[2]) < start + length && Number(range[2]) >= start && Number(range[3]) > Number(range[2]);
    const full = res.status === 200 && start === 0 && length === HEADER_BYTES;
    if (!partial && !full) {
        res.body?.destroy();
        return null;
    }
    const total = Number(partial ? range[3] : res.headers.get('content-length'));
    return { prefix: await readHead(res, length), total };
}

async function probeMp4AudioLanguage(url) {
    if (!URL.canParse(url)) return null;
    const target = new URL(url);
    if (target.protocol !== 'https:' || !/\.mp4$/i.test(target.pathname)) return null;
    try {
        const signal = AbortSignal.timeout(2200);
        const first = await readRange(url, 0, HEADER_BYTES, signal);
        if (!first) return null;
        const language = mp4AudioLanguage(first.prefix);
        if (language) return language;
        const next = mp4MetadataRange(first.prefix, first.total);
        const second = next && await readRange(url, next.start, next.length, signal);
        return second?.total === first.total ? mp4AudioLanguage(second.prefix) : null;
    } catch {
        return null;
    }
}

async function fillStockageAudioLanguages(trailers) {
    const unchecked = trailers.filter(trailer => /^(?:und|unknown)?$/i.test(String(trailer.lang || '').trim())).slice(0, 3);
    const languages = await Promise.all(unchecked.map(trailer => probeMp4AudioLanguage(trailer.url)));
    const byTrailer = new Map(unchecked.map((trailer, index) => [trailer, languages[index]]));
    return trailers.map(trailer => byTrailer.get(trailer) ? { ...trailer, lang: byTrailer.get(trailer) } : trailer);
}

module.exports = { mp4AudioLanguage, mp4MetadataRange, fillStockageAudioLanguages };
