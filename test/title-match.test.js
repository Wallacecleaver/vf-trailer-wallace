// Tests du moteur de matching v2 — titre de vidéo bruité (lib/title-match.js)
// Lancement : npm test

const { test } = require('node:test');
const assert = require('node:assert');
const { buildRef, matchVideoTitle, findBestFilmMatch } = require('../lib/title-match');

const duneRef = buildRef({ tmdbId: 438631, year: '2021', allTitles: ['Dune'], allPosterPaths: [] });

test('trailer bruité qui contient le titre officiel -> accepté', () => {
    const r = matchVideoTitle('Dune - Bande annonce VF (2021)', duneRef);
    assert.ok(r.matches);
    assert.ok(r.score >= 0.62);
    assert.strictEqual(r.tier, 'inclusion');
});

test('trailer #2 (compteur dans le titre) sans numéro dans la ref -> rejeté', () => {
    // Limite connue et assumée du moteur : un "2" dans le titre (Trailer 2, Teaser 2...)
    // est traité comme un numéro de suite quand la ref n'en a pas -> rejeté, avec la
    // cause conservée dans `tier`. Le signal de langue, lui, est géré par l'appelant.
    const r = matchVideoTitle('Dune: Part One | Official Trailer 2 (2021)', duneRef);
    assert.strictEqual(r.matches, false);
    assert.strictEqual(r.tier, 'numero-conflict');
});

test('numéro de suite ajouté à un titre sans numéro -> rejeté', () => {
    const r = matchVideoTitle('Dune 2 - Bande annonce VF', duneRef);
    assert.strictEqual(r.matches, false, 'Dune 2 est une autre entrée que Dune');
    assert.strictEqual(r.tier, 'numero-conflict');
});

test('bonne suite -> accepté', () => {
    const cars2 = buildRef({ tmdbId: 2, year: '2011', allTitles: ['Cars 2'], allPosterPaths: [] });
    const r = matchVideoTitle('Cars 2 - Bande annonce VF', cars2);
    assert.ok(r.matches);
});

test('mauvaise suite -> rejeté', () => {
    const cars2 = buildRef({ tmdbId: 2, year: '2011', allTitles: ['Cars 2'], allPosterPaths: [] });
    const r = matchVideoTitle('Cars 3 - Bande annonce VF', cars2);
    assert.strictEqual(r.matches, false);
    assert.strictEqual(r.tier, 'numero-conflict');
});

test('28 Semaines plus tard ne matche pas 28 Jours plus tard', () => {
    const ref = buildRef({ tmdbId: 3, year: '2002', allTitles: ['28 Jours plus tard'], allPosterPaths: [] });
    const r = matchVideoTitle('28 Semaines plus tard - Bande annonce VF', ref);
    assert.strictEqual(r.matches, false, 'le mot distinctif "jours" est absent');
});

test('28 Jours plus tard -> accepté', () => {
    const ref = buildRef({ tmdbId: 3, year: '2002', allTitles: ['28 Jours plus tard'], allPosterPaths: [] });
    const r = matchVideoTitle('28 Jours plus tard - Bande annonce VF', ref);
    assert.ok(r.matches);
});

test('ref réduite à un stopword : fail-closed, pas de crash, score fini', () => {
    // Ref absurde ("The") : aucun mot significatif -> le moteur rejette par défaut
    // (fail-closed). Le test garantit surtout qu'aucune division par zéro/NaN ne se
    // produit (le score doit rester un nombre fini), quel que soit le chemin.
    const theRef = buildRef({ tmdbId: 4, year: null, allTitles: ['The'], allPosterPaths: [] });
    const r = matchVideoTitle('The - Bande annonce VF', theRef);
    assert.ok(Number.isFinite(r.score), `score doit être un nombre, reçu ${r.score}`);
    assert.strictEqual(r.matches, false);
});

test('titre vide -> fail-open assumé (le filtrage VF se fait en amont)', () => {
    const r = matchVideoTitle('', duneRef);
    assert.ok(r.matches);
});

test('référence vide -> fail-open assumé', () => {
    const r = matchVideoTitle('nimporte quoi', buildRef({ tmdbId: 1, year: null, allTitles: [], allPosterPaths: [] }));
    assert.ok(r.matches);
});

test('film totalement différent -> rejeté', () => {
    const r = matchVideoTitle('Alien - Bande annonce VF', duneRef);
    assert.strictEqual(r.matches, false);
});

test('titre international présent dans la référence -> accepté', () => {
    const ref = buildRef({ tmdbId: 6, year: '2011', allTitles: ['Intouchables', 'The Intouchables'], allPosterPaths: [] });
    const r = matchVideoTitle('The Intouchables - Bande annonce VF', ref);
    assert.ok(r.matches, 'le trailer utilise le titre international, présent dans la ref');
});

test('findBestFilmMatch (exposé par title-match.js) fonctionne', () => {
    const r = findBestFilmMatch([{ title: 'Dune' }], duneRef);
    assert.ok(r && r.film.title === 'Dune');
});

test('extras : "Récap de la saison 4" accepté grâce à ignoreNumbers', () => {
    const stRef = buildRef({ tmdbId: 66732, year: '2016', allTitles: ['Stranger Things'], allPosterPaths: [] });
    const r = matchVideoTitle('Stranger Things | Récap de la saison 4 VF | Netflix France', stRef, { ignoreNumbers: true });
    assert.ok(r.matches, 'un numéro de saison ne doit pas compter comme un numéro de suite');
});

test('extras : sans ignoreNumbers, le numéro de saison reste rejeté (comportement par défaut)', () => {
    const stRef = buildRef({ tmdbId: 66732, year: '2016', allTitles: ['Stranger Things'], allPosterPaths: [] });
    const r = matchVideoTitle('Stranger Things | Récap de la saison 4 VF | Netflix France', stRef);
    assert.strictEqual(r.matches, false);
    assert.strictEqual(r.tier, 'numero-conflict');
});
