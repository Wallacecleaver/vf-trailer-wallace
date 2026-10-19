// ============================================================
// FILTRES DE TITRES DE VIDÉOS — une seule source de vérité.
//
// Avant : trois copies de ces listes (index.js, youtube-search.js), toutes
// testées avec `title.includes(mot)`. Un mot court comme "sub" ou "avis" rejetait donc des titres
// parfaitement valides : "La Substance" (contient "sub"), "Miles Davis" (contient "avis"),
// "Sublime", "Suburbicon"... Ici chaque mot-clé est cherché comme un MOT ENTIER (frontières
// Unicode, pluriel en -s toléré), jamais comme un morceau de mot.
// ============================================================

// Mots qui trahissent une vidéo qui n'est PAS la bande-annonce elle-même
// (réactions, critiques, analyses, films complets...) — fréquents dans les résultats de recherche.
const BLACKLIST_KEYWORDS = [
    'réaction', 'reaction', 'critique', 'review', 'avis', 'analyse', 'analysis',
    'explication', 'explained', 'easter egg', 'breakdown', 'recap', 'récap', 'découpage',
    'making of', 'behind the scenes', 'interview', 'compilation', 'réagit',
    'décryptage', 'chronique', 'fan made', 'fanmade', 'fan-made', 'parodie', 'parody',
    'film complet', 'full movie', 'en entier',
];

// Signaux d'une autre langue / version originale sous-titrée.
const NON_VF_KEYWORDS = [
    // Anglais / VO / sous-titres (génériques)
    'vost', 'vostfr', 'vosta', 'vos', 'vo', '(vo)', '[vo]', 'v.o.',
    'sub', 'subs', 'subtitled', 'subbed', 'subtitles', 'sous-titré', 'sous-titres', 'sous titres',
    'subtítulos', 'subtitulos', 'sottotitoli', 'untertitel',
    'original version', 'original trailer',
    'english', 'anglais', 'eng dub', '(eng)', '[eng]', 'eng',
    // Autres langues de doublage courantes sur YouTube
    'deutsch', 'german', 'allemand',
    'italiano', 'italian', 'italien',
    'español', 'espanol', 'spanish', 'espagnol', 'latino', 'castellano',
    'legendado', 'legendas', 'dublado', 'português', 'portugues', 'portuguese',
    'nederlands', 'dutch', 'néerlandais',
    'русский', 'russian', 'russe',
    '日本語', 'japanese', 'japonais',
    '한국어', 'korean', 'coréen',
    '中文', 'chinese', 'chinois', 'mandarin',
    'türkçe', 'turkish', 'turc',
    'polski', 'polish', 'polonais',
    'arabic', 'arabe', 'العربية',
    'hindi', 'हिन्दी',
];

const isWordChar = ch => /[\p{L}\p{N}]/u.test(ch);

// Construit un détecteur "mot entier" pour une liste de mots-clés.
// Frontière gauche/droite uniquement quand le bord du mot-clé est une lettre/un chiffre
// (pour "(vo)" ou "v.o." les délimiteurs font déjà office de frontière).
function buildKeywordMatcher(keywords) {
    const parts = keywords.map(kw => {
        const k = String(kw).toLowerCase();
        const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pre = isWordChar(k[0]) ? '(?<![\\p{L}\\p{N}])' : '';
        const post = isWordChar(k[k.length - 1]) ? '(?:s)?(?![\\p{L}\\p{N}])' : '';
        return pre + esc + post;
    });
    const re = new RegExp(parts.join('|'), 'iu');
    return text => re.test(String(text || ''));
}

const hasBlacklistSignal = buildKeywordMatcher(BLACKLIST_KEYWORDS);
const hasNonVfSignal = buildKeywordMatcher(NON_VF_KEYWORDS);

// Signal VF explicite : VF / VFF / VFI / VFQ, "français", "french", québécois, doublage.
function hasVfSignal(title) {
    const t = String(title || '');
    return /(?<![\p{L}\p{N}])vf[fiq]?(?![\p{L}\p{N}])/iu.test(t) ||
        /fran[çc]ais/i.test(t) ||
        /\bfrench\b/i.test(t) ||
        /qu[ée]b[ée]cois/i.test(t) ||
        /qu[ée]bec/i.test(t) ||
        /doublage/i.test(t);
}

module.exports = {
    BLACKLIST_KEYWORDS, NON_VF_KEYWORDS,
    buildKeywordMatcher, hasBlacklistSignal, hasNonVfSignal, hasVfSignal,
};
