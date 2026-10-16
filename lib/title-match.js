// ============================================================
// TITLE-MATCH v2 — deux moteurs de correspondance, au-dessus de matching.js
//
// Ancien (v1) : une seule fonction booleenne `titleMatches(officialTitle,
// candidateName)` avec une logique faible (au moins un mot significatif présent).
// Problème : elle sous-notait à tort les titres de vidéos bruyants
// ("Dune 2 - Bande-annonce VF - Warner") et laissait passer des hors-sujet
// (un signal VF suffisait + un mot partagé).
//
// Nouveau (v2) : deux moteurs séparés, car les deux cas n'ont pas les mêmes
// exigences :
//   1. matchFilmCandidate / findBestFilmMatch — pour comparer un CANDIDAT FILM
//      (titre + année + poster TMDB) contre le film demandé. C'est le terrain de
//      jeu de matching.js (tiers précis : poster TMDB, titre exact, inclusion
//      restreinte aux mots "d'édition", fuzzy). Utilisé par Allociné.
//   2. matchVideoTitle — pour comparer un TITRE DE VIDÉO BRUITÉ (trailer YouTube
//      / TMDB) contre le film demandé. Recall-based : le titre de vidéo contient
//      le nom du film ENTOURÉ de bruit ("Bande-annonce VF", éditeur, chaîne...)
//      qui ferait sous-noter le moteur film par matching.js. On tolère donc le
//      bruit, mais on garde des garde-fous : signal VF (à l'appelant) + vérif
//      numérique anti-suite ROBUSTE.
//
// Référence enrichie : au lieu de comparer au seul titre FR, on construit la ref
// avec le titre FR + titre original + tous les titres alternatifs TMDB
// (/alternative_titles) — règle le cas fréquent où le trailer YouTube utilise le
// titre international (ex. "28 Days Later" pour "28 Jours plus tard").
// ============================================================

const {
    normalizeTitle, extractYear, buildRef, findBestMatch,
    significantWords, stripLeadingArticle, similarityRatio,
    ACCEPT_SCORE, PERFECT_SCORE,
} = require('./matching');

// ---- Seuil du moteur vidéo ----
// Recall-based : on préfère accepter un trailer un peu approximatif (dont le
// signal VF + la vérif numérique ont déjà filtré les pires cas) plutôt que de
// rejeter un trailer correct parce que son titre est bruité.
const VIDEO_ACCEPT_SCORE = 0.62;

// ---- Correctif anti-suite "adapté au bruit" ----
// matching.js suppose le numéro de suite en FIN de chaîne (sequelNumber :
// /\d{1,2}$/), vrai pour un titre de film propre mais FAUX pour un titre de
// vidéo bruité : "Cars 2 - Bande annonce VF" → sequelNumber renvoie null →
// sequelClash(2, null) renvoie clash → le trailer légitime est rejeté.
// Ici on cherche les numéros N'IMPORTE OÙ dans la chaîne, en ignorant les
// années (19xx/20xx, omniprésentes dans les titres de vidéos) :
//   - titre officiel SANS numéro : un petit numéro isolé dans le candidat
//     trahit presque toujours une AUTRE entrée ("Prada" vs "Prada 2").
//   - titre officiel NUMÉROTÉ : le numéro de la suite doit être présent dans le
//     candidat ("Cars 2" dans "Cars 2 - BA VF"), et aucun numéro conflictuel ne
//     doit s'y ajouter ("Cars 3" → rejet).
function isYearNumber(n) { return n >= 1900 && n <= 2100; }

function extractNumbers(norm) {
    return (norm.match(/\b\d+\b/g) || []).map(Number);
}

function videoNumericOk(vNorm, rNorm) {
    const rNums = extractNumbers(rNorm).filter(n => !isYearNumber(n));
    const cNums = extractNumbers(vNorm).filter(n => !isYearNumber(n));

    if (rNums.length === 0) {
        return !cNums.some(n => n >= 1 && n <= 50);
    }
    if (!rNums.some(n => cNums.includes(n))) return false;
    const okNums = new Set(rNums);
    return !cNums.some(n => n >= 1 && n <= 50 && !okNums.has(n));
}

// Score d'un titre de vidéo contre UN titre normalisé de la référence.
// `opts.ignoreNumbers` : les numéros du titre de vidéo ne sont plus traités comme
// des numéros de suite conflictuels. Utilisé pour les vidéos "extras" (Récap,
// Extrait, Making-of...) dont le titre contient souvent des numéros de saison ou
// d'épisode ("Récap de la saison 4") qui ne sont pas des indices de suite.
function scoreVideoTitleOne(vNorm, rNorm, opts) {
    if (!(opts && opts.ignoreNumbers)) {
        if (!videoNumericOk(vNorm, rNorm)) return { score: 0, tier: 'numero-conflict' };
    }

    // Exact : identique, ou identique hors article initial ("Le Diable..." == "Diable...")
    if (vNorm === rNorm || stripLeadingArticle(vNorm) === stripLeadingArticle(rNorm)) {
        return { score: 1, tier: 'titre-exact' };
    }

    const rWords = significantWords(rNorm);
    if (!rWords.length) return { score: 0, tier: 'aucun' };

    const vSet = new Set(significantWords(vNorm));

    // Inclusion : le titre de la vidéo contient littéralement le titre officiel
    // (ou l'inverse). "Dune 2 - Bande annonce VF" contient "Dune".
    if (vNorm.includes(rNorm) || rNorm.includes(vNorm)) {
        const coverage = rWords.filter(w => vSet.has(w)).length / rWords.length;
        return { score: Math.min(1, 0.85 + coverage * 0.15), tier: 'inclusion' };
    }

    // Fuzzy recall : il faut une bonne couverture des mots significatifs du titre
    // officiel. On EXCLUT les purs nombres du calcul : ils sont déjà garantis par la
    // vérif numérique, et ils biaisent la couverture ("28" partagé par "28 Jours" et
    // "28 Semaines" validerait à tort). Pour une couverture partielle, le mot le plus
    // distinctif (le 1er non-numérique) doit être présent : ça écarte "28 Semaines
    // plus tard" pour "28 Jours plus tard" ("jours" absent) tout en acceptant
    // "2 Fast 2 Furious - BA VF" pour "2 Fast 2 Furious".
    const rCore = rWords.filter(w => !/^\d+$/.test(w));
    if (!rCore.length) return { score: 0, tier: 'recall-incomplet' };
    const hits = rCore.filter(w => vSet.has(w)).length;
    const coverage = hits / rCore.length;
    if (coverage < 0.6) return { score: 0, tier: 'recall-incomplet' };
    if (coverage < 0.85 && !vSet.has(rCore[0])) return { score: 0, tier: 'recall-incomplet' };
    const score = 0.5 + coverage * 0.4;
    return { score: Math.min(1, Math.max(score, 0.7)), tier: 'recall' };
}

// ---- Moteur 2 : titre de vidéo bruité ----
// `opts.ignoreNumbers` (optionnel) : désactive la vérif anti-numéro de suite pour
// les vidéos "extras" dont le titre porte des numéros de saison/épisode.
function matchVideoTitle(videoTitle, ref, opts) {
    const vNorm = normalizeTitle(videoTitle);
    if (!vNorm) return { matches: true, score: 0, tier: 'vide' }; // rien à comparer -> pas de rejet abusif
    if (!ref || !ref.titlesNorm || !ref.titlesNorm.length) return { matches: true, score: 0, tier: 'ref-vide' };

    let best = { score: 0, tier: 'aucun' };
    for (const rNorm of ref.titlesNorm) {
        const r = scoreVideoTitleOne(vNorm, rNorm, opts);
        // >= (pas >) : un rejet à score 0 remplace aussi l'état initial, pour garder
        // la CAUSE du rejet (ex. numero-conflict) dans `tier` au lieu d'un 'aucun' générique
        // qui ne dit rien à l'admin dans le dashboard. Le score, lui, ne change pas.
        if (r.score >= best.score) best = r;
        if (best.score >= 1) break;
    }
    return { ...best, matches: best.score >= VIDEO_ACCEPT_SCORE };
}

// ---- Moteur 1 : candidat film (Allociné) ----
// `candidate` : { title, tmdbId?, poster?, tmdbPosterPath? }. Renvoie
// { matches, score, tier, film }.
function matchFilmCandidate(candidate, ref, { accept = ACCEPT_SCORE } = {}) {
    const m = findBestMatch([candidate], ref, { accept });
    return m ? { matches: true, ...m } : { matches: false, score: 0, tier: 'aucun' };
}

// Cherche le MEILLEUR candidat film parmi une liste (résultats de recherche).
function findBestFilmMatch(candidates, ref, { accept = ACCEPT_SCORE } = {}) {
    return findBestMatch(candidates, ref, { accept });
}

module.exports = {
    // ref
    buildRef,
    // moteur film
    matchFilmCandidate, findBestFilmMatch,
    // moteur vidéo
    matchVideoTitle,
    // helpers publics
    normalizeTitle, extractYear, significantWords, similarityRatio,
    ACCEPT_SCORE, PERFECT_SCORE, VIDEO_ACCEPT_SCORE,
};
