// Décide si une vidéo TMDB est une bonne bande-annonce VF, en croisant LANGUE et NOM.
//
// Signaux de langue (au moins un requis) :
//   - langue TMDB : iso_639_1 === 'fr'
//   - nom : signal VF explicite (VF / VFF / VFQ / français / doublage...)
// Garde-fous (un seul suffit à rejeter) :
//   - nom avec un signal d'une autre langue / VOST / sous-titres
//   - nom de réaction / critique / film complet
//   - mot-clé "pas VF" ajouté dans les réglages
// Titre :
//   - nom générique ("Bande-annonce officielle") : pas de comparaison, TMDB a déjà rattaché la vidéo au titre
//   - nom qui contient un vrai titre ("Dune 2 - Bande-annonce VF") : il doit correspondre au film
//     (anti-suite / anti-hors-sujet), comme avant.

const { hasNonVfSignal, hasVfSignal, hasBlacklistSignal } = require('./video-filters');
const { matchVideoTitle, isGenericVideoName } = require('./title-match');

function tmdbVideoVerdict(video, ref, { extraNonVf = [], ignoreNumbers = false } = {}) {
    const name = String((video && video.name) || '');
    const lower = name.toLowerCase();
    const langFr = String((video && video.iso_639_1) || '').toLowerCase() === 'fr';
    const nameVf = hasVfSignal(name);

    if (hasNonVfSignal(name)) return { ok: false, reason: 'nom-autre-langue' };
    if (hasBlacklistSignal(name)) return { ok: false, reason: 'nom-hors-bande-annonce' };
    if (extraNonVf.some(kw => kw && lower.includes(kw))) return { ok: false, reason: 'mot-cle-non-vf' };
    if (!langFr && !nameVf) return { ok: false, reason: 'aucun-signal-vf' };

    if (isGenericVideoName(name)) return { ok: true, reason: langFr ? 'langue-fr+nom-generique' : 'nom-vf+nom-generique' };

    const m = matchVideoTitle(name, ref, { ignoreNumbers });
    if (!m.matches) return { ok: false, reason: `titre-different (${m.tier || 'score bas'})` };
    return { ok: true, reason: langFr ? 'langue-fr+titre' : 'nom-vf+titre' };
}

module.exports = { tmdbVideoVerdict };
