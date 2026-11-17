const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractExplicitSeason, matchesSeasonVideo } = require('../lib/season-match');
const { buildRef, matchVideoTitle } = require('../lib/title-match');

test('extractExplicitSeason : détecte toutes les formes explicites de saison sans faux positifs', () => {
    // Formes explicites courantes (FR / EN / Netflix / YouTube)
    assert.equal(extractExplicitSeason('Saison 2 (Teaser) : Le Problème à 3 corps'), 2);
    assert.equal(extractExplicitSeason('Le Problème à 3 corps | Saison 2 Bande-annonce VF'), 2);
    assert.equal(extractExplicitSeason('Stranger Things - Season 4 Official Trailer VF'), 4);
    assert.equal(extractExplicitSeason('La Chronique des Bridgerton : Partie 2 | Bande-annonce VF'), 2);
    assert.equal(extractExplicitSeason('Partie 2 (Bande-annonce) : La Chronique des Bridgerton - Saison 4'), 4);
    assert.equal(extractExplicitSeason('Volume 2 | Stranger Things : Saison 4 Bande-annonce VF'), 4);
    assert.equal(extractExplicitSeason('Lupin - Partie 3 | Bande-annonce officielle VF'), 3);
    assert.equal(extractExplicitSeason('The Mandalorian S03 Bande-annonce VF'), 3);
    assert.equal(extractExplicitSeason('Arcane S2E1 Extrait VF'), 2);
    assert.equal(extractExplicitSeason('Saison II - Bande-annonce VF'), 2);
    assert.equal(extractExplicitSeason('2e saison - Bande-annonce VF'), 2);
    assert.equal(extractExplicitSeason('2ème saison | Bande-annonce officielle VF'), 2);
    assert.equal(extractExplicitSeason('Deuxième saison - Bande-annonce VF'), 2);
    assert.equal(extractExplicitSeason('Seconde saison - Bande-annonce VF'), 2);
    assert.equal(extractExplicitSeason('Avatar : Livre 2 - Bande-annonce VF'), 2);

    // Zéro faux positif sur les chiffres du titre ou les compteurs de bande-annonce
    assert.equal(extractExplicitSeason('Le Problème à 3 corps | Bande-annonce finale VF'), null);
    assert.equal(extractExplicitSeason('1899 | Bande-annonce officielle VF'), null);
    assert.equal(extractExplicitSeason('24 Heures chrono - Bande-annonce VF'), null);
    assert.equal(extractExplicitSeason('Le Problème à 3 corps - Bande-annonce 2 VF'), null);
    assert.equal(extractExplicitSeason('Trailer #2 VF'), null);
    assert.equal(extractExplicitSeason('Teaser 2 VF'), null);
});

test('matchesSeasonVideo : strict sur les listes globales, souple sur un endpoint dédié à la saison', () => {
    // Liste globale (TMDB série entière, YouTube, TVDB global, Stockage BD)
    assert.equal(matchesSeasonVideo('Le Problème à 3 corps | Bande-annonce finale VF', 1, { scoped: false }), true);
    assert.equal(matchesSeasonVideo('Le Problème à 3 corps | Saison 2 Bande-annonce VF', 1, { scoped: false }), false);
    assert.equal(matchesSeasonVideo('Le Problème à 3 corps | Bande-annonce finale VF', 2, { scoped: false }), false);
    assert.equal(matchesSeasonVideo('Saison 2 (Teaser) : Le Problème à 3 corps', 2, { scoped: false }), true);
    assert.equal(matchesSeasonVideo('Saison 3 (Bande-annonce) : Le Problème à 3 corps', 2, { scoped: false }), false);

    // Endpoint déjà rattaché à la saison (ex. TMDB /tv/{id}/season/2/videos)
    assert.equal(matchesSeasonVideo('Bande-annonce officielle VF', 2, { scoped: true }), true);
    assert.equal(matchesSeasonVideo('Saison 2 - Bande-annonce VF', 2, { scoped: true }), true);
    assert.equal(matchesSeasonVideo('Saison 1 - Bande-annonce VF', 2, { scoped: true }), false);
    assert.equal(matchesSeasonVideo('Récap de la saison 1 VF', 2, { scoped: true, isExtra: true }), true);
});

test('title-match + season-match : les variantes « 2e saison » / « Saison II » ne déclenchent pas de conflit numérique', () => {
    const ref = buildRef({
        tmdbId: 108545,
        year: null,
        allTitles: ['Le Problème à 3 corps', '3 Body Problem'],
        allPosterPaths: [],
    });
    assert.equal(matchVideoTitle('Le Problème à 3 corps - Saison 2 | Bande-annonce VF | Netflix France', ref).matches, true);
    assert.equal(matchVideoTitle('Saison 2 (Teaser) : Le Problème à 3 corps | VF | Netflix', ref).matches, true);
    assert.equal(matchVideoTitle('Le Problème à 3 corps - 2e saison | Bande-annonce VF', ref).matches, true);
    assert.equal(matchVideoTitle('Le Problème à 3 corps - Saison II | Bande-annonce VF', ref).matches, true);
});
