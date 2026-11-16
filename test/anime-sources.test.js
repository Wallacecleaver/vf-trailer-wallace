const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeAnimeTitle,
    animeTitleMatches,
    isFrenchAnimeVideo,
    getJikanVideoCandidates,
} = require('../lib/anime-sources');

test('Animés : normalisation des titres et accents', () => {
    assert.strictEqual(normalizeAnimeTitle('L’Attaque des Titans — Saison 1'), 'attaque titans');
    assert.strictEqual(normalizeAnimeTitle('Fullmetal Alchemist: Brotherhood'), 'fullmetal alchemist brotherhood');
});

test('Animés : rapprochement des titres AniList et titres alternatifs', () => {
    const candidate = {
        title: { english: 'Attack on Titan', romaji: 'Shingeki no Kyojin', native: '進撃の巨人' },
        synonyms: ['L’Attaque des Titans'],
    };
    assert.strictEqual(animeTitleMatches(candidate, ['L’Attaque des Titans']), true);
    assert.strictEqual(animeTitleMatches(candidate, ['Demon Slayer']), false);
});

test('Animés : VF/VOSTFR uniquement, sans confondre avec la VO', () => {
    assert.strictEqual(isFrenchAnimeVideo('Bande-annonce VF', 'vf'), true);
    assert.strictEqual(isFrenchAnimeVideo('French Dub Trailer', 'vf'), true);
    assert.strictEqual(isFrenchAnimeVideo('Official Trailer', 'vf'), false);
    assert.strictEqual(isFrenchAnimeVideo('Trailer VOSTFR', 'vf'), false);
    assert.strictEqual(isFrenchAnimeVideo('Trailer VOSTFR', 'vo'), true);
    assert.strictEqual(isFrenchAnimeVideo('Bande-annonce VF', 'both'), true);
});

test('Animés : récupération des bandes-annonces et promos Jikan', () => {
    const candidates = getJikanVideoCandidates({
        data: {
            trailer: { title: 'Official Trailer', url: 'https://youtu.be/abcdefghijk' },
            promo: [{ title: 'PV 1', trailer: { title: 'French Trailer VF', youtube_id: 'lmnopqrstuv' } }],
        },
    });
    assert.strictEqual(candidates.length, 2);
    assert.strictEqual(candidates[0].url, 'https://youtu.be/abcdefghijk');
    assert.strictEqual(candidates[1].url, 'lmnopqrstuv');
});
