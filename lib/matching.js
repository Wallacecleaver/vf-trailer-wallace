// ─────────────────────────────────────────────────────────────────────────────
//  matching.js v2 — Mapping : Titre + correspondance TMDB + Année (si présente)
//
//  Moteur de matching "film candidat" : compare un candidat (titre + année +
//  poster TMDB) contre une référence TMDB enrichie (tous les titres + posters).
//  Utilisé par le fallback Allociné (candidats = fiches de recherche) via
//  lib/title-match.js (matchFilmCandidate / findBestFilmMatch).
//  Copié depuis le projet reezn-addon-main puis étendu pour exposer les helpers
//  internes nécessaires au moteur "titre de vidéo bruité" (matchVideoTitle).
// ─────────────────────────────────────────────────────────────────────────────

const ROMAN_TO_ARABIC = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8',
  ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15',
  xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20',
};

const STOPWORDS = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd',
  'et', 'ou', 'au', 'aux', 'en', 'dans', 'sur', 'the', 'a', 'an', 'of', 'and', 'or',
]);

// Mots "d'édition" : seuls mots ajoutés tolérés dans un match par inclusion
const EDITION_WORDS = new Set([
  'version', 'longue', 'extended', 'director', 'cut', 'remastered', 'remaster',
  'unrated', 'theatrical', 'imax', '3d', '4k', 'uhd', 'hdr', 'final', 'edition',
  'speciale', 'special', 'integral', 'complete',
]);

const ACCEPT_SCORE  = 0.70;
const PERFECT_SCORE = 0.98;

function extractYear(raw) {
  const s = String(raw || '');
  let m = s.match(/\(((?:19|20)\d{2})\)/);
  if (m) return parseInt(m[1], 10);
  m = s.match(/((?:19|20)\d{2})\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

function normalizeTitle(raw) {
  let s = String(raw || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\(\s*(?:19|20)\d{2}\s*\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(\d+)\.0\b/g, ' $1 ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return s.split(' ').map(w => ROMAN_TO_ARABIC[w] || w).join(' ');
}

function stripLeadingArticle(norm) {
  return norm.replace(/^(le|la|les|l|the|a|an)\s+/, '');
}

function sequelNumber(norm) {
  let m = norm.match(/\b(\d{1,2})$/);
  if (m) return parseInt(m[1], 10);
  m = norm.match(/\b(?:partie|chapitre|volume|volet|saison)\s+(\d{1,2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function significantWords(norm) {
  return norm.split(' ').filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1), curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
function similarityRatio(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function tmdbPathFromUrl(url) {
  const m = String(url || '').match(/\/t\/p\/(?:w\d+|original)\/([^"?]+)$/);
  return m ? '/' + m[1] : null;
}

function toCandidate(f) {
  const raw  = f.title || '';
  const norm = normalizeTitle(raw);
  const posterPath = (f.tmdbPosterPath || tmdbPathFromUrl(f.poster) || '').trim() || null;
  return { raw, norm, year: extractYear(raw), num: sequelNumber(norm),
           words: significantWords(norm), posterPath, tmdbId: f.tmdbId || null };
}

function buildRef(tmdb) {
  const seen = new Set(); const titlesNorm = [];
  for (const t of (tmdb.allTitles || [])) {
    const n = normalizeTitle(t);
    if (n && !seen.has(n)) { seen.add(n); titlesNorm.push(n); }
  }
  return { tmdbId: tmdb.tmdbId || null, year: parseInt(tmdb.year, 10) || null,
           posterPaths: new Set(tmdb.allPosterPaths || []), titlesNorm };
}

function yearAdjust(cYear, rYear) {
  if (!cYear || !rYear) return { adj: 0, hard: false };
  const d = Math.abs(cYear - rYear);
  if (d === 0) return { adj: +0.10, hard: false };
  if (d === 1) return { adj: +0.02, hard: false };
  if (d <= 3)  return { adj: -0.15, hard: false };
  return { adj: -0.40, hard: d >= 8 };
}

function sequelClash(cNum, rNum) {
  const a = cNum === 1 ? null : cNum;
  const b = rNum === 1 ? null : rNum;
  if (a === b) return false;
  if (a === null) return b > 1;
  if (b === null) return a > 1;
  return true;
}

function scoreOneTitle(cand, rNorm, ref) {
  const { adj, hard } = yearAdjust(cand.year, ref.year);
  const clash = sequelClash(cand.num, sequelNumber(rNorm));

  // T1 — CORRESPONDANCE TMDB via le path du poster
  if (cand.posterPath && ref.posterPaths.has(cand.posterPath)) {
    if (hard) return { score: 0.45, tier: 'poster-tmdb-mais-annee' };
    const yB = cand.year && ref.year && cand.year === ref.year ? 0.03 : 0;
    return { score: Math.min(1, 0.95 + yB), tier: 'poster-tmdb' };
  }

  // T2 — Titre normalisé identique
  if (cand.norm === rNorm || stripLeadingArticle(cand.norm) === stripLeadingArticle(rNorm)) {
    if (hard)  return { score: 0.30, tier: 'titre-exact-mais-annee' };
    if (clash) return { score: 0.35, tier: 'titre-exact-mais-suite' };
    return { score: Math.min(1, 0.92 + adj), tier: 'titre-exact' };
  }

  // T3 — Inclusion : tolérée UNIQUEMENT si les mots ajoutés sont "d'édition"
  if (cand.norm.includes(rNorm) || rNorm.includes(cand.norm)) {
    if (clash) return { score: 0.15, tier: 'inclusion-rejetee' };
    const rWords = significantWords(rNorm);
    const shorter = cand.words.length <= rWords.length ? cand.words : rWords;
    const longer  = cand.words.length <= rWords.length ? rWords : cand.words;
    const shortSet = new Set(shorter);
    const extra = longer.filter(w => !shortSet.has(w));
    if (!extra.every(w => EDITION_WORDS.has(w))) return { score: 0.15, tier: 'inclusion-rejetee' };
    if (hard) return { score: 0.30, tier: 'inclusion-mais-annee' };
    return { score: Math.min(1, 0.78 + adj), tier: 'inclusion' };
  }

  // T4 — Fuzzy
  const rWords = significantWords(rNorm);
  if (!rWords.length || !cand.words.length) return { score: 0, tier: 'vide' };
  const rSet   = new Set(rWords);
  const common = cand.words.filter(w => rSet.has(w)).length;
  const union  = new Set([...cand.words, ...rWords]).size;

  let score = (common / union) * 0.80 + (common / rWords.length) * 0.10 + 0.05 + adj;

  const cs = cand.words.slice(-3).join(' ');
  const rs = rWords.slice(-3).join(' ');
  if (common >= 2 && cs && rs && similarityRatio(cs, rs) >= 0.9) score = Math.max(score, 0.82 + adj);
  if (similarityRatio(cand.norm, rNorm) > 0.85) score = Math.max(score, 0.72 + adj);

  if (clash) score *= 0.15;
  if (hard)  score = Math.min(score, 0.25);
  return { score: Math.min(1, Math.max(0, score)), tier: 'fuzzy' };
}

function scoreMatch(cand, ref) {
  if (cand.tmdbId && ref.tmdbId) {
    return cand.tmdbId === ref.tmdbId
      ? { score: 1, tier: 'tmdb-id' }
      : { score: 0, tier: 'tmdb-id-rejete' };
  }
  let best = { score: 0, tier: 'aucun' };
  for (const rNorm of ref.titlesNorm) {
    const r = scoreOneTitle(cand, rNorm, ref);
    if (r.score > best.score) best = r;
    if (best.score >= 1) break;
  }
  return best;
}

function findBestMatch(films, ref, { accept = ACCEPT_SCORE } = {}) {
  let best = null;
  for (const f of films) {
    const r = scoreMatch(toCandidate(f), ref);
    if (!best || r.score > best.score) best = { ...r, film: f };
    if (best.score >= PERFECT_SCORE) break;
  }
  if (!best || best.score < accept) return null;
  return best;
}

module.exports = {
  normalizeTitle, extractYear, toCandidate, buildRef,
  scoreMatch, findBestMatch, tmdbPathFromUrl,
  stripLeadingArticle, sequelNumber, significantWords, similarityRatio,
  ACCEPT_SCORE, PERFECT_SCORE,
};
