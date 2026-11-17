// Détection et validation stricte du numéro de saison dans le titre d'une vidéo.
//
// Pourquoi : sur TMDB (vidéos globales de la série), TheTVDB (trailers globaux), YouTube ou
// Stockage BD, la bande-annonce principale d'une série ne porte presque jamais « Saison 1 » :
// c'est simplement « Le Problème à 3 corps | Bande-annonce finale VF ».
// - Sur la Saison 1 (ou la fiche générale sans saison), une vidéo sans numéro de saison est donc
//   bien celle de la saison 1 (en revanche, « Saison 2 » doit être écartée).
// - Sur une Saison >= 2, accepter une vidéo globale sans numéro de saison revenait à servir la
//   bande-annonce de la Saison 1 renommée « (Saison 2) ». Sur toute source non rattachée à la
//   saison par l'API, le titre de la vidéo DOIT mentionner explicitement la saison demandée.

const ROMAN_TO_INT = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5,
    vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};

const WORD_ORDINAL_SEASON = [
    [/\b(?:premi[eè]re|first)\s+(?:saison|season)\b/i, 1],
    [/\b(?:deuxi[eè]me|seconde|second)\s+(?:saison|season)\b/i, 2],
    [/\b(?:troisi[eè]me|third)\s+(?:saison|season)\b/i, 3],
    [/\b(?:quatri[eè]me|fourth)\s+(?:saison|season)\b/i, 4],
    [/\b(?:cinqui[eè]me|fifth)\s+(?:saison|season)\b/i, 5],
    [/\b(?:sixi[eè]me|sixth)\s+(?:saison|season)\b/i, 6],
    [/\b(?:septi[eè]me|seventh)\s+(?:saison|season)\b/i, 7],
    [/\b(?:huiti[eè]me|eighth)\s+(?:saison|season)\b/i, 8],
    [/\b(?:neuvi[eè]me|ninth)\s+(?:saison|season)\b/i, 9],
    [/\b(?:dixi[eè]me|tenth)\s+(?:saison|season)\b/i, 10],
];

const WORD_ORDINAL_PART = [
    [/\b(?:premi[eè]re|first)\s+(?:partie|part)\b/i, 1],
    [/\b(?:deuxi[eè]me|seconde|second)\s+(?:partie|part)\b/i, 2],
    [/\b(?:troisi[eè]me|third)\s+(?:partie|part)\b/i, 3],
    [/\b(?:quatri[eè]me|fourth)\s+(?:partie|part)\b/i, 4],
    [/\b(?:cinqui[eè]me|fifth)\s+(?:partie|part)\b/i, 5],
];

// Priorité 1 : marqueurs explicites de SAISON (prioritaires sur « Partie 2 » / « Volume 2 » quand les deux coexistent,
// ex. « Partie 2 (Bande-annonce) : Bridgerton Saison 4 » -> Saison 4, jamais Saison 2).
const SEASON_NUM_RE = /\b(?:saison|season)\s*0?(\d{1,2})\b/i;
const COMPACT_SEASON_RE = /\bS0?(\d{1,2})(?:\b|E\d)/i;
const NUM_ORDINAL_SEASON_RE = /\b0?(\d{1,2})\s*(?:e|er|[eè]re|re|[eè]me|nde|nd|st|rd|th)\s+(?:saison|season)\b/i;
const SEASON_ROMAN_RE = /\b(?:saison|season)\s+(x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/i;

// Priorité 2 : découpages utilisés comme saisons par Netflix / animés (« Lupin : Partie 3 », « Avatar : Livre 2 », « Cour 2 »).
const PART_NUM_RE = /\b(?:partie|part|volume|vol\.?|chapitre|chapter|livre|book|tome|acte|arc|cour)\s*0?(\d{1,2})\b/i;
const NUM_ORDINAL_PART_RE = /\b0?(\d{1,2})\s*(?:e|er|[eè]re|re|[eè]me|nde|nd|st|rd|th)\s+(?:partie|part)\b/i;
const PART_ROMAN_RE = /\b(?:partie|part|volume|vol\.?|chapitre|chapter|livre|book|tome|acte|arc)\s+(x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/i;

// Extrait le numéro de saison explicite d'un libellé vidéo (ou `null` s'il n'y en a aucun).
// Ne confond jamais un chiffre du titre de l'œuvre (« Le Problème à 3 corps », « 1899 »)
// ni un compteur de bande-annonce (« Bande-annonce #2 », « Trailer 2 »).
function extractExplicitSeason(title) {
    const s = String(title || '');
    if (!s) return null;

    // 1. Vraie mention « Saison / Season / S02 » sur l'ensemble du titre d'abord
    let m = SEASON_NUM_RE.exec(s);
    if (m) return Number(m[1]);

    m = COMPACT_SEASON_RE.exec(s);
    if (m) return Number(m[1]);

    m = NUM_ORDINAL_SEASON_RE.exec(s);
    if (m) return Number(m[1]);

    m = SEASON_ROMAN_RE.exec(s);
    if (m) return ROMAN_TO_INT[m[1].toLowerCase()] || null;

    for (const [re, num] of WORD_ORDINAL_SEASON) {
        if (re.test(s)) return num;
    }

    // 2. Repli sur « Partie / Volume / Livre / Cour » uniquement si aucune « Saison » n'est mentionnée
    m = PART_NUM_RE.exec(s);
    if (m) return Number(m[1]);

    m = NUM_ORDINAL_PART_RE.exec(s);
    if (m) return Number(m[1]);

    m = PART_ROMAN_RE.exec(s);
    if (m) return ROMAN_TO_INT[m[1].toLowerCase()] || null;

    for (const [re, num] of WORD_ORDINAL_PART) {
        if (re.test(s)) return num;
    }
    return null;
}

// Vérifie si une vidéo convient à la saison demandée :
// - `scoped: true`  -> la vidéo vient déjà d'un endpoint dédié à cette saison (ex. TMDB `/season/2/videos`) :
//                      un nom générique (« Bande-annonce VF ») est accepté, seule une autre saison explicite est rejetée.
// - `scoped: false` -> la vidéo vient d'une liste globale (TMDB série entière, YouTube, TheTVDB global, Stockage BD) :
//                      pour `season >= 2`, la saison DOIT figurer explicitement dans le titre ;
//                      pour `season === 1`, une vidéo sans saison ou « Saison 1 » est acceptée, mais « Saison 2+ » est rejetée.
function matchesSeasonVideo(title, season, { scoped = false, isExtra = false } = {}) {
    const req = Number.isInteger(Number(season)) && Number(season) > 0 ? Number(season) : null;
    if (!req) return true;

    const explicit = extractExplicitSeason(title);
    if (scoped) {
        if (isExtra) return true; // ex. « Récap de la saison 1 » rattaché à la saison 2 sur TMDB
        return explicit === null || explicit === req;
    }
    if (req >= 2) return explicit === req;
    return explicit === null || explicit === 1;
}

module.exports = {
    extractExplicitSeason,
    matchesSeasonVideo,
};
