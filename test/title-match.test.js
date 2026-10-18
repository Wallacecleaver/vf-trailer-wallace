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

test('trailer #2 (compteur de bande-annonce) n\'est PAS un numéro de suite -> accepté', () => {
    // Avant : "Trailer 2" / "Teaser 2" / "Bande-annonce n°3" était pris pour une suite et rejeté.
    // Le compteur est maintenant ignoré ; un vrai numéro de suite (Dune 2) reste rejeté (test suivant).
    for (const title of [
        'Dune: Part One | Official Trailer 2 (2021)',
        'Dune - Bande-annonce 2 VF',
        'Dune - Bande-annonce n°3 (VF)',
        'Dune - Teaser #2 VF',
    ]) {
        const r = matchVideoTitle(title, duneRef);
        assert.ok(r.matches, title);
    }
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

test('numéro de saison / épisode : jamais pris pour un numéro de suite (même sans ignoreNumbers)', () => {
    const stRef = buildRef({ tmdbId: 66732, year: '2016', allTitles: ['Stranger Things'], allPosterPaths: [] });
    for (const title of [
        'Stranger Things | Récap de la saison 4 VF | Netflix France',
        'Stranger Things - Saison 4 - Bande-annonce VF',
        'Stranger Things S04E02 - Extrait VF',
    ]) {
        assert.ok(matchVideoTitle(title, stRef).matches, title);
    }
});

test('un vrai numéro de suite reste rejeté malgré les compteurs ignorés', () => {
    assert.strictEqual(matchVideoTitle('Dune 2 - Bande-annonce 2 VF', duneRef).matches, false);
});

// ---- Nouveaux garde-fous (matching v2.1) ----
const ref = (titles, year) => buildRef({ tmdbId: 1, year, allTitles: titles, allPosterPaths: [] });

test('inclusion sur mots entiers : un mot court n\'est pas "trouvé" dans un autre mot', () => {
    assert.strictEqual(matchVideoTitle('Supernatural - Bande-annonce VF', ref(['Up'], '2009')).matches, false);
    assert.strictEqual(matchVideoTitle('Mother - Bande-annonce VF', ref(['Her'], '2013')).matches, false);
    assert.strictEqual(matchVideoTitle('Focus - Bande-annonce VF', ref(['Us'], '2019')).matches, false);
    assert.strictEqual(matchVideoTitle('Magic Mike - Bande-annonce VF', ref(['Ma'], '2019')).matches, false);
    assert.ok(matchVideoTitle('Up - Bande-annonce VF', ref(['Up'], '2009')).matches);
});

test('Spider-Man / Spiderman / Spider Man se rejoignent', () => {
    const r = ref(['Spider-Man'], '2002');
    assert.ok(matchVideoTitle('Spiderman - Bande annonce VF', r).matches);
    assert.ok(matchVideoTitle('Spider Man - Bande-annonce VF', r).matches);
});

test('ligatures : "Cœur" et "Coeur" sont le même mot', () => {
    assert.ok(matchVideoTitle('Coeurs vaillants - Bande annonce VF', ref(['Cœurs vaillants'], '1991')).matches);
    assert.ok(matchVideoTitle("L'Œil du diable - Bande annonce VF", ref(["L'Oeil du diable"], '1960')).matches);
});

test('Dune 2 = Dune : Deuxième partie = Dune: Part Two', () => {
    const r = ref(['Dune : Deuxième partie', 'Dune: Part Two'], '2024');
    assert.ok(matchVideoTitle('Dune 2 - Bande-annonce VF', r).matches);
    assert.ok(matchVideoTitle('Dune: Part Two - Bande-annonce VF', r).matches);
    assert.strictEqual(matchVideoTitle('Dune - Bande-annonce VF', r).matches, false, 'sans numéro = le 1er film');
});

test('"Part One" ne crée pas de conflit de numéro', () => {
    assert.ok(matchVideoTitle('Dune: Part One - Bande-annonce VF', duneRef).matches);
});

test('classement : le titre propre passe avant le titre chargé', () => {
    const { pickBestVideoResult } = require('../lib/title-match');
    const r = ref(['Dune'], '2021');
    const results = [
        { videoId: 'a', title: 'Dune - Bande-annonce VF avec Timothée Chalamet et Zendaya (exclusif)' },
        { videoId: 'b', title: 'Dune - Bande-annonce officielle VF' },
    ];
    assert.strictEqual(pickBestVideoResult(results, r).videoId, 'b');
});

test('pickBestVideoResult : rien de pertinent -> null', () => {
    const { pickBestVideoResult } = require('../lib/title-match');
    assert.strictEqual(pickBestVideoResult([{ videoId: 'x', title: 'Autre chose - VF' }], ref(['Dune'], '2021')), null);
});
