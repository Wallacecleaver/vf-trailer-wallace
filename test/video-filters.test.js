// Tests des filtres de langue / bruit (lib/video-filters.js)
const { test } = require('node:test');
const assert = require('node:assert');
const { hasNonVfSignal, hasVfSignal, hasBlacklistSignal } = require('../lib/video-filters');

test('mots courts : jamais détectés au milieu d\'un autre mot', () => {
    // "sub" dans "Substance", "avis" dans "Davis", "vo" dans "Volver", "eng" dans "Engrenages"
    for (const t of ['La Substance - Bande-annonce VF', 'Sublime - VF', 'Miles Davis - Bande-annonce VF', 'Volver - Bande-annonce VF', 'Engrenages - Bande-annonce VF']) {
        assert.strictEqual(hasNonVfSignal(t), false, t);
        assert.strictEqual(hasBlacklistSignal(t), false, t);
    }
});

test('vraies VO / sous-titres : détectées', () => {
    for (const t of ['Dune - Trailer VOSTFR', 'Dune - ENG SUB', 'Dune (VO)', 'Dune - Official Trailer subtitled', 'Dune - VOS', 'Dune - sous-titré', 'Dune [VO]', 'Dune - Subs']) {
        assert.strictEqual(hasNonVfSignal(t), true, t);
    }
});

test('réactions / critiques / films complets : détectés, avec pluriel', () => {
    for (const t of ['Dune - Réaction', 'Dune - Les réactions', 'Dune - Review', 'Dune - Avis', 'Dune - Film complet VF']) {
        assert.strictEqual(hasBlacklistSignal(t), true, t);
    }
});

test('signal VF : VF / VFF / VFQ / français', () => {
    for (const t of ['Dune - VF', 'Dune VFF', 'Dune (VFQ)', 'Dune - Bande-annonce française', 'Dune - French trailer']) {
        assert.strictEqual(hasVfSignal(t), true, t);
    }
    for (const t of ['Dune - Official Trailer', 'Dune - Bande-annonce', 'VFX breakdown']) {
        assert.strictEqual(hasVfSignal(t), false, t);
    }
});
