const { test } = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('../lib/strict-title-match');
const { buildRef, matchVideoTitle, findBestFilmMatch, pickBestVideoResult } = require('../lib/title-match');

test('matcher strict : normalisation, mêmes mots et refus des titres prolongés', () => {
    assert.deepEqual(matcher.normalizeTokens('Les Évadés (1994) VF'), ['evades']);
    assert.equal(matcher.titlesMatch(['Lucky'], 'Lucky Luke'), false);
    assert.equal(matcher.titlesMatch(['Happy End'], 'My Happy Ending'), false);
    assert.equal(matcher.titlesMatch(['Le Retour du Roi'], 'Retour Roi VF'), true);
    assert.equal(matcher.titlesMatch(['Grand Bleu'], 'Bleu Grand'), true);
    assert.equal(matcher.titlesMatch(['The'], ''), false);
});

test('matcher strict : classement par année puis ordre des mots, égalités stables', () => {
    assert.equal(matcher.yearVerdict(2026, 2026), 'exact');
    assert.equal(matcher.yearVerdict(2026, 2025), 'close');
    assert.equal(matcher.yearVerdict(2026, undefined), 'unknown');
    assert.equal(matcher.yearVerdict(2026, 2020), 'mismatch');
    const wanted = { titles: ['Grand Bleu'], year: 2026 };
    const candidates = [
        { title: 'Grand Bleu', item: 'inconnu' }, { title: 'Grand Bleu', year: 2020, item: 'ancien' },
        { title: 'Bleu Grand', year: 2026, item: 'inverse' }, { title: 'Grand Bleu', year: 2026, item: 'exact' },
        { title: 'Grand Bleu', year: 2026, item: 'egalite' },
    ];
    const original = candidates.slice();
    assert.equal(matcher.pickBest(wanted, candidates).item, 'exact');
    assert.deepEqual(candidates, original);
    assert.equal(matcher.accepts(wanted, candidates[1]), false);
    assert.equal(matcher.pickBest(wanted, [{ title: 'Autre film', item: 1 }]), null);
});

test('matcher strict : variantes de sous-titres sans couper Re:Zero ou Spider-Man', () => {
    assert.deepEqual(matcher.expandTitles(['Mushoku Tensei: Jobless Reincarnation']), ['Mushoku Tensei: Jobless Reincarnation', 'Mushoku Tensei']);
    assert.deepEqual(matcher.expandTitles(['Re:Zero']), ['Re:Zero']);
    assert.deepEqual(matcher.expandTitles(['Spider-Man']), ['Spider-Man']);
    assert.deepEqual(matcher.expandTitles(['Re:ZERO -Starting Life']), ['Re:ZERO -Starting Life', 'Re:ZERO']);
});

test('vidéos : Lucky Luke et My Happy Ending ne contournent plus le matching', () => {
    for (const [title, wanted] of [
        ['Lucky Luke - Bande-annonce officielle (VF) | Disney+', 'Lucky'],
        ['Dune Prophecy - Bande-annonce VF', 'Dune'],
        ['Dune - Prophecy - Bande-annonce VF', 'Dune'],
        ['My Happy Ending - Bande-annonce VF', 'Happy End'],
        ["Avatar La Voie de l'eau - Bande-annonce VF", 'Avatar'],
    ]) assert.equal(matchVideoTitle(title, buildRef({ allTitles: [wanted], year: 2026 })).matches, false, title);
});

test('vidéos : mentions de série, titre numérique et suites conservés', () => {
    for (const [wanted, title] of [
        ['Lucky', 'Lucky : la série - Bande-annonce VF'],
        ['Lucky', 'Lucky, la série Apple TV+ - Bande-annonce VF'],
        ['Lucky', 'Lucky Saison 1 - Bande-annonce VF'],
        ['Barbie', 'Barbie Le Film - Bande-annonce VF'],
        ['1917', '1917 - Bande-annonce VF'],
        ['Blade Runner 2049', 'Blade Runner 2049 - Bande-annonce VF'],
        ['Spider-Man : No Way Home', 'Spider-Man : No Way Home - Bande-annonce VF'],
    ]) assert.equal(matchVideoTitle(title, buildRef({ allTitles: [wanted] })).matches, true, title);
    assert.equal(matchVideoTitle('Blade Runner - Bande-annonce VF', buildRef({ allTitles: ['Blade Runner 2049'] })).matches, false);
});

test('films Allociné : matcher partagé réellement utilisé, année et titres numériques', () => {
    const wanted = buildRef({ allTitles: ['Lucky'], year: 2026 });
    assert.equal(findBestFilmMatch([{ title: 'Lucky Luke (2026)' }], wanted), null);
    assert.equal(findBestFilmMatch([{ title: 'Lucky (2020)' }], wanted), null);
    const good = { title: 'Lucky (2026)' };
    assert.equal(findBestFilmMatch([{ title: 'Lucky' }, { title: 'Lucky (2025)' }, good], wanted).film, good);
    assert.ok(findBestFilmMatch([{ title: '1917 (2019)' }], buildRef({ allTitles: ['1917'], year: 2019 })));
});

test('vidéos : année exacte préférée à une année absente ou proche', () => {
    const wanted = buildRef({ allTitles: ['Lucky'], year: 2026 });
    const exact = { title: 'Lucky - Bande-annonce VF (2026)' };
    const results = [{ title: 'Lucky - Bande-annonce officielle VF' }, { title: 'Lucky - Bande-annonce VF (2025)' }, exact];
    assert.equal(pickBestVideoResult(results, wanted), exact);
});
