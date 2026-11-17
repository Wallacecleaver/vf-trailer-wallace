// Tests du matching vidéo TMDB : langue (iso_639_1) + nom (lib/tmdb-video-match.js)
const { test } = require('node:test');
const assert = require('node:assert');
const { tmdbVideoVerdict } = require('../lib/tmdb-video-match');
const { buildRef, isGenericVideoName } = require('../lib/title-match');

const ref = buildRef({ tmdbId: 1, year: '2026', allTitles: ['Lucky'], allPosterPaths: [] });
const ok = (v, extra) => tmdbVideoVerdict(v, ref, extra).ok;

test('noms génériques détectés', () => {
    for (const n of ['Bande-annonce officielle', 'Official Trailer', 'Bande-annonce VF', 'Teaser 2', 'Trailer #2 VF']) {
        assert.strictEqual(isGenericVideoName(n), true, n);
    }
    for (const n of ['Lucky - Bande-annonce VF', 'Dune 2 - Bande-annonce']) {
        assert.strictEqual(isGenericVideoName(n), false, n);
    }
});

test('langue fr + nom générique : accepté (cas Lucky)', () => {
    assert.strictEqual(ok({ iso_639_1: 'fr', name: 'Bande-annonce officielle', type: 'Trailer' }), true);
});

test('langue en + nom générique sans VF : rejeté', () => {
    assert.strictEqual(ok({ iso_639_1: 'en', name: 'Official Trailer' }), false);
    assert.strictEqual(ok({ name: 'Official Trailer' }), false);
});

test('langue fr mais nom VOST / réaction / mot-clé admin : rejeté', () => {
    assert.strictEqual(ok({ iso_639_1: 'fr', name: 'Bande-annonce VOSTFR' }), false);
    assert.strictEqual(ok({ iso_639_1: 'fr', name: 'Réaction à la bande-annonce' }), false);
    assert.strictEqual(ok({ iso_639_1: 'fr', name: 'Bande-annonce officielle' }, { extraNonVf: ['officielle'] }), false);
});

test('nom avec VF explicite, langue non taguée : accepté', () => {
    assert.strictEqual(ok({ iso_639_1: 'en', name: 'Lucky - Bande-annonce VF' }), true);
    assert.strictEqual(ok({ name: 'Bande-annonce VF' }), true);
});

test('nom avec un autre titre : le titre doit correspondre, même en langue fr', () => {
    assert.strictEqual(ok({ iso_639_1: 'fr', name: 'Lucky - Bande-annonce' }), true);
    assert.strictEqual(ok({ iso_639_1: 'fr', name: 'Prada 2 - Bande-annonce' }), false);
});
