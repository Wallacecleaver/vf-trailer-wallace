const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { mp4AudioLanguage, mp4MetadataRange } = require('../lib/mp4-audio');

function box(type, ...parts) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0));
    header.write(type, 4, 4, 'ascii');
    return Buffer.concat([header, ...parts]);
}

function track(handlerType, language, version = 0) {
    const handler = Buffer.alloc(20);
    handler.write(handlerType, 8, 4, 'ascii');
    const media = Buffer.alloc(version ? 36 : 24);
    media[0] = version;
    const packed = [...language].reduce((value, char) => (value << 5) | (char.charCodeAt(0) - 96), 0);
    media.writeUInt16BE(packed, version ? 32 : 20);
    return box('trak', box('mdia', box('mdhd', media), box('hdlr', handler)));
}

test('MP4 : lit la langue audio et ignore celle des pistes vidéo et sous-titres', () => {
    const movie = box('moov', track('vide', 'und'), track('soun', 'fra', 1), track('text', 'eng'));
    assert.equal(mp4AudioLanguage(Buffer.concat([box('ftyp'), movie])), 'fra');
    assert.equal(mp4AudioLanguage(box('moov', track('soun', 'eng'), track('text', 'fra'))), 'eng');
});

test('MP4 : langue inconnue quand plusieurs pistes divergent ou que l’en-tête est incomplet', () => {
    const movie = box('moov', track('soun', 'fra'));
    assert.equal(mp4AudioLanguage(box('moov', track('soun', 'fra'), track('soun', 'eng'))), null);
    assert.equal(mp4AudioLanguage(box('moov', track('soun', 'eng'), track('soun', 'eng'))), 'eng');
    assert.equal(mp4AudioLanguage(box('moov', track('soun', 'und'))), null);
    assert.equal(mp4AudioLanguage(movie.subarray(0, movie.length - 1)), null);
});

test('MP4 : trouve les métadonnées après mdat ou au-delà de la première lecture', () => {
    const ftyp = box('ftyp');
    const mdat = box('mdat', Buffer.alloc(150 * 1024));
    const moov = box('moov', track('soun', 'fra'));
    const late = Buffer.concat([ftyp, mdat, moov]);
    const lateRange = mp4MetadataRange(late.subarray(0, 128 * 1024), late.length);
    assert.deepEqual(lateRange, { start: ftyp.length + mdat.length, length: moov.length });
    assert.equal(mp4AudioLanguage(late.subarray(lateRange.start)), 'fra');

    const largeMoov = box('moov', box('free', Buffer.alloc(150 * 1024)), track('soun', 'fra'));
    const large = Buffer.concat([ftyp, largeMoov]);
    assert.deepEqual(mp4MetadataRange(large.subarray(0, 128 * 1024), large.length),
        { start: ftyp.length, length: largeMoov.length });
    assert.equal(mp4MetadataRange(late.subarray(0, 128 * 1024), late.length - moov.length), null);
});

test('MP4 : demande une seconde plage bornée et refuse une plage mal alignée', async t => {
    const file = Buffer.concat([box('ftyp'), box('mdat', Buffer.alloc(150 * 1024)), box('moov', track('soun', 'fra'))]);
    const requests = [];
    let wrongOffset = false;
    const security = require('../lib/security');
    t.mock.method(security, 'safeFetch', async (_url, options) => {
        const [, start, last] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range).map(Number);
        requests.push([start, last, options.signal]);
        const actualStart = wrongOffset && start > 0 ? start - 1 : start;
        return {
            status: 206,
            headers: { get: name => name === 'content-range' ? `bytes ${actualStart}-${last}/${file.length}` : null },
            body: Readable.from([file.subarray(actualStart, last + 1)]),
        };
    });
    const modulePath = require.resolve('../lib/mp4-audio');
    const original = require.cache[modulePath];
    delete require.cache[modulePath];
    try {
        const { fillStockageAudioLanguages } = require(modulePath);
        const source = [{ url: 'https://example.org/trailer.mp4' }];
        assert.equal((await fillStockageAudioLanguages(source))[0].lang, 'fra');
        assert.equal(requests.length, 2);
        assert.equal(requests[1][1], file.length - 1);
        assert.equal(requests[0][2], requests[1][2]);
        wrongOffset = true;
        assert.equal((await fillStockageAudioLanguages(source))[0].lang, undefined);
    } finally {
        require.cache[modulePath] = original;
    }
});
