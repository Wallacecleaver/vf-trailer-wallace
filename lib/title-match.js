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
    normalizeTitle, extractYear, buildRef: buildBaseRef, findBestMatch,
    significantWords, stripLeadingArticle, similarityRatio,
    ACCEPT_SCORE, PERFECT_SCORE,
} = require('./matching');

// ---- Référence enrichie de variantes de suite ----
// TMDB FR dit "Dune : Deuxième partie", YouTube dit "Dune 2" ou "Dune: Part Two". On ajoute à la
// référence la forme numérique ("dune 2") pour que ces trois écritures se rejoignent.
const SEQUEL_NUM_WORDS = { un: 1, une: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5, six: 6, sept: 7, seven: 7, huit: 8, eight: 8, neuf: 9, nine: 9, dix: 10, ten: 10 };
const SEQUEL_ORDINALS = { premier: 1, premiere: 1, first: 1, deuxieme: 2, second: 2, seconde: 2, troisieme: 3, third: 3, quatrieme: 4, fourth: 4, cinquieme: 5, fifth: 5, sixieme: 6, sixth: 6 };
const SEQUEL_KW = '(?:partie|part|chapitre|chapter|volume|vol|acte|act)';
const SEQUEL_PART_NUM_RE = new RegExp('\\b' + SEQUEL_KW + '\\s+(' + Object.keys(SEQUEL_NUM_WORDS).join('|') + '|\\d{1,2})\\b', 'g');
const SEQUEL_ORD_PART_RE = new RegExp('\\b(' + Object.keys(SEQUEL_ORDINALS).join('|') + ')\\s+' + SEQUEL_KW + '\\b', 'g');

function sequelVariant(norm) {
    const v = norm
        .replace(SEQUEL_PART_NUM_RE, (m, n) => String(SEQUEL_NUM_WORDS[n] || n))
        .replace(SEQUEL_ORD_PART_RE, (m, o) => String(SEQUEL_ORDINALS[o]))
        .replace(/\s+/g, ' ').trim();
    // "partie 1" / "part one" : le premier volet n'a pas de numéro, la variante serait "dune 1" -> on la retire
    return v.replace(/\b1$/, '').trim();
}

function buildRef(tmdb) {
    const ref = buildBaseRef(tmdb);
    const extra = [];
    for (const n of ref.titlesNorm) {
        const v = sequelVariant(n);
        if (v && v !== n && !ref.titlesNorm.includes(v) && !extra.includes(v)) extra.push(v);
    }
    ref.titlesNorm = [...ref.titlesNorm, ...extra];
    return ref;
}

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

// Compteurs qui ne sont PAS des numéros de suite : "Bande-annonce 2", "Trailer #2", "Teaser 3",
// "Saison 4", "S04E02", "Épisode 3". Avant, le moindre "2" du titre faisait rejeter une bande-annonce
// parfaitement valide ("Avengers : Endgame - Bande-annonce 2 VF").
const COUNTER_FILLER = '(?:\\s+(?:officielle|officiel|official|finale|final|nouvelle|new|vf|vff|vfq|vostfr|francaise|francais))*';
const TRAILER_COUNTER_RE = new RegExp(
    '\\b(?:bandes? annonces?|ba|trailers?|teasers?|extraits?|spots?|clips?|featurettes?|promos?|annonces?)' +
    COUNTER_FILLER + '\\s*(?:n|no|numero|num)?\\s*\\d{1,2}\\b', 'g');
const SEASON_EPISODE_RE = /\b(?:saisons?|seasons?)\s*\d{1,2}\b|\bs\d{1,2}(?:e\d{1,3})?\b|\b(?:episodes?|ep)\s*\d{1,3}\b|\be\d{1,3}\b/g;

// "Dune : Deuxième partie" / "Dune: Part Two" / "Dune 2" désignent la même suite : on ramène les
// ordinaux et les nombres écrits en lettres (après partie/part/chapitre...) à un chiffre.
const WORD_TO_NUM = {
    un: 1, une: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5,
    six: 6, sept: 7, seven: 7, huit: 8, eight: 8, neuf: 9, nine: 9, dix: 10, ten: 10,
};
const ORDINAL_TO_NUM = {
    premier: 1, premiere: 1, first: 1, deuxieme: 2, second: 2, seconde: 2, troisieme: 3, third: 3,
    quatrieme: 4, fourth: 4, cinquieme: 5, fifth: 5, sixieme: 6, sixth: 6, septieme: 7, huitieme: 8,
};
const PART_WORD_RE = new RegExp('\\b(partie|part|chapitre|chapter|volume|vol|acte|act|episode)\\s+(' + Object.keys(WORD_TO_NUM).join('|') + ')\\b', 'g');
const ORDINAL_RE = new RegExp('\\b(' + Object.keys(ORDINAL_TO_NUM).join('|') + ')\\b', 'g');

// Numéros "informatifs" d'un titre normalisé. Le 1 est écarté : "Partie 1" / "Part One" désigne le
// premier volet, jamais un conflit (un titre sans numéro est déjà le premier).
function extractNumbers(norm, isVideo) {
    let s = norm;
    if (isVideo) s = s.replace(TRAILER_COUNTER_RE, ' ').replace(SEASON_EPISODE_RE, ' ');
    s = s.replace(PART_WORD_RE, (m, kw, w) => ` ${kw} ${WORD_TO_NUM[w]} `)
         .replace(ORDINAL_RE, (m, w) => ` ${ORDINAL_TO_NUM[w]} `);
    return (s.match(/\b\d+\b/g) || []).map(Number).filter(n => n !== 1);
}

function videoNumericOk(vNorm, rNorm) {
    const rNums = extractNumbers(rNorm, false).filter(n => !isYearNumber(n));
    const cNums = extractNumbers(vNorm, true).filter(n => !isYearNumber(n));

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

    // Inclusion sur MOTS ENTIERS : le titre de la vidéo contient le titre officiel (ou l'inverse).
    // "Dune 2 - Bande annonce VF" contient "Dune". Avant, c'était un simple morceau de chaîne :
    // "Up" était "trouvé" dans "Supernatural", "Her" dans "Mother", "Us" dans "Focus".
    const padV = ` ${vNorm} `, padR = ` ${rNorm} `;
    const reverseOk = significantWords(vNorm).length >= 1;
    if (padV.includes(padR) || (reverseOk && padR.includes(padV))) {
        const coverage = rWords.filter(w => vSet.has(w)).length / rWords.length;
        return { score: Math.min(1, 0.85 + coverage * 0.15), tier: 'inclusion' };
    }

    // Inclusion "compacte" : "Spider-Man" / "Spider Man" / "Spiderman", "Star Wars" / "StarWars".
    // Titre assez long (>= 6 lettres) pour ne pas retrouver un mot court au milieu d'un autre.
    const vC = vNorm.replace(/ /g, ''), rC = rNorm.replace(/ /g, '');
    if (rC.length >= 6 && vC.includes(rC)) {
        return { score: 0.9, tier: 'inclusion-compacte' };
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
    if (!vNorm) return { matches: true, score: 0, rank: 0, tier: 'vide' }; // rien à comparer -> pas de rejet abusif
    if (!ref || !ref.titlesNorm || !ref.titlesNorm.length) return { matches: true, score: 0, rank: 0, tier: 'ref-vide' };

    let best = { score: 0, tier: 'aucun' };
    for (const rNorm of ref.titlesNorm) {
        const r = scoreVideoTitleOne(vNorm, rNorm, opts);
        // >= (pas >) : un rejet à score 0 remplace aussi l'état initial, pour garder
        // la CAUSE du rejet (ex. numero-conflict) dans `tier` au lieu d'un 'aucun' générique
        // qui ne dit rien à l'admin dans le dashboard. Le score, lui, ne change pas.
        if (r.score >= best.score) best = r;
        if (best.score >= 1) break;
    }
    const matches = best.score >= VIDEO_ACCEPT_SCORE;
    return { ...best, matches, rank: matches ? rankScore(best.score, vNorm, ref) : 0 };
}

// ---- Classement entre plusieurs vidéos qui correspondent ----
// Le seuil (matches) dit "assez proche". Le CLASSEMENT départage : un titre propre ("Dune - Bande-annonce
// VF") doit passer avant "Dune : Le Retour du roi - extrait exclusif avec Untel". On compte les mots du titre
// de la vidéo qui ne sont ni dans le titre du film, ni du bruit habituel (bande-annonce, VF, studios...).
const NOISE_WORDS = new Set([
    'bande', 'bandes', 'annonce', 'annonces', 'ba', 'trailer', 'trailers', 'teaser', 'officielle', 'officiel', 'official',
    'vf', 'vff', 'vfi', 'vfq', 'vostfr', 'vost', 'francais', 'francaise', 'french', 'version', 'film', 'films', 'movie',
    'nouvelle', 'new', 'final', 'finale', 'full', 'hd', 'extrait', 'clip', 'spot', 'tv', 'avec', 'cinema', 'cinemas',
    'studio', 'studios', 'pictures', 'bros', 'warner', 'disney', 'universal', 'paramount', 'sony', 'pathe', 'gaumont',
    'studiocanal', 'netflix', 'france', 'prime', 'video', 'apple', 'amazon', 'mgm', 'lionsgate', 'century', 'fox',
    'marvel', 'canal', 'ugc', 'diaphana', 'metropolitan', 'distribution', 'sortie', 'prochainement', 'saison', 'season',
    'episode', 'partie', 'part', 'chapitre', 'volume',
]);

function rankScore(score, vNorm, ref) {
    const known = new Set();
    for (const t of ref.titlesNorm) for (const w of significantWords(t)) known.add(w);
    const residual = significantWords(vNorm).filter(w => !known.has(w) && !NOISE_WORDS.has(w) && !/^\d+$/.test(w)).length;
    let rank = score - Math.min(0.15, residual * 0.03);
    if (/\b(officielle|official)\b/.test(vNorm)) rank += 0.02;
    return rank;
}

// Choisit la MEILLEURE vidéo parmi des résultats de recherche (YouTube...) au lieu de la
// première qui passe le seuil : `isCandidate` filtre d'abord (VF, pas de réaction/critique...), puis on classe
// par pertinence du titre. À qualité égale, l'ordre du moteur de recherche reste le départage.
function pickBestVideoResult(results, ref, isCandidate) {
    let best = null;
    (results || []).forEach((r, i) => {
        if (isCandidate && !isCandidate(r)) return;
        const m = matchVideoTitle(r.title, ref);
        if (!m.matches) return;
        const rank = m.rank - i * 0.004;
        if (!best || rank > best.rank) best = { result: r, rank };
    });
    return best ? best.result : null;
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
    matchVideoTitle, pickBestVideoResult,
    // helpers publics
    normalizeTitle, extractYear, significantWords, similarityRatio,
    ACCEPT_SCORE, PERFECT_SCORE, VIDEO_ACCEPT_SCORE,
};
