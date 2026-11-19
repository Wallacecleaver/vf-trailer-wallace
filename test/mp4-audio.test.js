const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mp4AudioLanguage } = require('../lib/mp4-audio');

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
    assert.equal(mp4AudioLanguage(box('moov', track('soun', 'und'))), null);
    assert.equal(mp4AudioLanguage(movie.subarray(0, movie.length - 1)), null);
});
