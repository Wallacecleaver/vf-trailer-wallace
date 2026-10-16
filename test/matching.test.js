// Tests du moteur de matching v2 — film candidat (lib/matching.js)
// Lancement : npm test

const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../lib/matching');

test('normalizeTitle : minuscules, accents, années et ponctuation', () => {
    assert.strictEqual(m.normalizeTitle('Le Diable s\'habille en Prada (2006)'), 'le diable s habille en prada');
    assert.strictEqual(m.normalizeTitle('Évasion (1998)'), 'evasion');
    assert.strictEqual(m.normalizeTitle('Café Society'), 'cafe society');
    assert.strictEqual(m.normalizeTitle('    Dune   '), 'dune');
});

test('normalizeTitle : chiffres romains convertis', () => {
    assert.strictEqual(m.normalizeTitle('Piranha II: The Spawning'), 'piranha 2 the spawning');
    assert.strictEqual(m.normalizeTitle('Rocky III'), 'rocky 3');
    assert.strictEqual(m.normalizeTitle('Rocky X'), 'rocky 10');
});

test('extractYear : parenthèses ou fin de chaîne, sinon null', () => {
    assert.strictEqual(m.extractYear('Dune (2021)'), 2021);
    assert.strictEqual(m.extractYear('Dune 2021'), 2021);
    assert.strictEqual(m.extractYear('Dune'), null);
    assert.strictEqual(m.extractYear(''), null);
});

test('sequelNumber : numéro en fin ou mention partie/chapitre/saison', () => {
    assert.strictEqual(m.sequelNumber('prada 2'), 2);
    assert.strictEqual(m.sequelNumber('cars 3'), 3);
    assert.strictEqual(m.sequelNumber('le diable s habille en prada'), null);
    assert.strictEqual(m.sequelNumber('chapitre 5'), 5);
    assert.strictEqual(m.sequelNumber('partie 1'), 1);
});

test('significantWords : exclut stopwords et mots trop courts', () => {
    assert.deepStrictEqual(
        m.significantWords('le diable s habille en prada'),
        ['diable', 'habille', 'prada']
    );
});

const duneRef = m.buildRef({ tmdbId: 438631, year: '2021', allTitles: ['Dune'], allPosterPaths: [] });

test('match film : titre exact -> accepté', () => {
    const r = m.findBestMatch([{ title: 'Dune' }], duneRef);
    assert.ok(r, 'doit matcher');
    assert.ok(r.score >= m.ACCEPT_SCORE);
    assert.strictEqual(r.tier, 'titre-exact');
});

test('match film : même titre mais mauvaise année -> rejeté', () => {
    const r = m.findBestMatch([{ title: 'Dune (1984)' }], duneRef);
    assert.strictEqual(r, null, 'remake/homonyme avec 8+ ans d\'écart doit être rejeté');
});

test('match film : même titre + même année -> bonus année', () => {
    const r = m.findBestMatch([{ title: 'Dune (2021)' }], duneRef);
    assert.ok(r && r.score === 1);
});

test('match film : mots d\'édition autorisés (Extended Cut)', () => {
    const gladiator = m.buildRef({ tmdbId: 98, year: '2000', allTitles: ['Gladiator'], allPosterPaths: [] });
    const r = m.findBestMatch([{ title: 'Gladiator - Extended Cut' }], gladiator);
    assert.ok(r, 'doit matcher');
    assert.strictEqual(r.tier, 'inclusion');
});

test('match film : suite vs titre sans numéro -> rejeté', () => {
    const prada = m.buildRef({ tmdbId: 115, year: '2006', allTitles: ['Le Diable s\'habille en Prada'], allPosterPaths: [] });
    const r = m.findBestMatch([{ title: 'Le Diable s\'habille en Prada 2' }], prada);
    assert.strictEqual(r, null, 'Prada 2 ne doit pas matcher Prada');
});

test('match film : correspondance TMDB via poster -> priorité', () => {
    const ref = m.buildRef({ tmdbId: 1, year: '2021', allTitles: ['Dune'], allPosterPaths: ['/dune.jpg'] });
    const r = m.findBestMatch([{ title: 'Un titre bancal', tmdbPosterPath: '/dune.jpg' }], ref);
    assert.ok(r && r.score >= 0.95, 'le poster TMDB identique doit suffire');
    assert.strictEqual(r.tier, 'poster-tmdb');
});

test('match film : fuzzy sur titre quasi identique uniquement', () => {
    const gladiator = m.buildRef({ tmdbId: 98, year: '2000', allTitles: ['Gladiator'], allPosterPaths: [] });
    assert.strictEqual(m.findBestMatch([{ title: 'Gladiateur' }], gladiator), null);
});

test('findBestMatch : choisit le meilleur candidat parmi plusieurs', () => {
    const candidates = [
        { title: 'Un Autre Film' },
        { title: 'Dune' },
    ];
    const r = m.findBestMatch(candidates, duneRef);
    assert.ok(r && r.film.title === 'Dune');
});

test('buildRef : titre FR + original + alternatifs tous normalisés', () => {
    const ref = m.buildRef({ tmdbId: 5, year: '2011', allTitles: ['Intouchables', 'The Intouchables'], allPosterPaths: [] });
    assert.deepStrictEqual(ref.titlesNorm, ['intouchables', 'the intouchables']);
    assert.strictEqual(ref.year, 2011);
    assert.strictEqual(ref.tmdbId, 5);
});
