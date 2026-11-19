const { safeFetch } = require('./security');
const { readHead } = require('./media-link');

const HEADER_BYTES = 128 * 1024;
const FRENCH = new Set(['fra', 'fre']);

function* boxes(buffer, start, end) {
    for (let offset = start; offset + 8 <= end;) {
        let size = buffer.readUInt32BE(offset);
        let header = 8;
        if (size === 1) {
            if (offset + 16 > end) return;
            const wide = buffer.readBigUInt64BE(offset + 8);
            if (wide > BigInt(end - offset)) return;
            size = Number(wide);
            header = 16;
        }
        if (size < header || size > end - offset) return;
        yield { type: buffer.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size };
        offset += size;
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
    return audio.length === 1 ? audio[0] : null;
}

async function probeMp4AudioLanguage(url) {
    if (!URL.canParse(url)) return null;
    const target = new URL(url);
    if (target.protocol !== 'https:' || !/\.mp4$/i.test(target.pathname)) return null;
    try {
        const res = await safeFetch(url, {
            headers: { Range: `bytes=0-${HEADER_BYTES - 1}`, 'Accept-Encoding': 'identity' },
            signal: AbortSignal.timeout(2200),
        });
        if (![200, 206].includes(res.status)) {
            res.body?.destroy();
            return null;
        }
        return mp4AudioLanguage(await readHead(res, HEADER_BYTES));
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

module.exports = { mp4AudioLanguage, fillStockageAudioLanguages };
