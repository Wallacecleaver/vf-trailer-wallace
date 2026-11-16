const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    extractYoutubeId,
    isFrenchTrailerLanguage,
    normalizeTvdbTrailers,
} = require('../lib/tvdb');

test('TheTVDB : extraction des IDs et URLs YouTube', () => {
    assert.strictEqual(extractYoutubeId('abcdefghijk'), 'abcdefghijk');
    assert.strictEqual(extractYoutubeId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
    assert.strictEqual(extractYoutubeId('https://www.youtube.com/watch?v=abcdefghijk&t=12'), 'abcdefghijk');
    assert.strictEqual(extractYoutubeId('https://www.youtube.com/embed/abcdefghijk'), 'abcdefghijk');
    assert.strictEqual(extractYoutubeId('https://vimeo.com/123456'), null);
});

test('TheTVDB : ne retient que les vidéos explicitement françaises', () => {
    assert.strictEqual(isFrenchTrailerLanguage({ language: 'fra', name: 'Trailer' }), true);
    assert.strictEqual(isFrenchTrailerLanguage({ language: 'fr', name: 'Trailer' }), true);
    assert.strictEqual(isFrenchTrailerLanguage({ language: 'eng', name: 'Bande-annonce VF' }), false);
    assert.strictEqual(isFrenchTrailerLanguage({ name: 'Bande-annonce VF' }), true);
    assert.strictEqual(isFrenchTrailerLanguage({ name: 'Official Trailer' }), false);
});

test('TheTVDB : normalisation en flux VF et saison', () => {
    const streams = normalizeTvdbTrailers([
        { name: 'Bande-annonce officielle', language: 'fra', url: 'https://youtu.be/abcdefghijk' },
        { name: 'Official trailer', language: 'eng', url: 'https://youtu.be/lmnopqrstuv' },
        { name: 'Bande-annonce VF', url: 'https://vimeo.com/123' },
    ], 'One Piece', 2, { maxTrailers: 3 });

    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].ytId, 'abcdefghijk');
    assert.strictEqual(streams[0].title, 'Bande-annonce\nOne Piece (Saison 2)');
});
