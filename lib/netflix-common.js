// Petits outils partagés par tous les modules « catalogue Netflix » : formats d'identifiants et comparaison de titres.
// (Un seul endroit pour les regex : avant, elles étaient recopiées dans cinq fichiers.)

const NID_RE = /^\d{5,}$/;        // ID Netflix : 81944880
const IMDB_RE = /^tt\d{5,10}$/;   // IMDB ID : tt15239678

const isNid = v => NID_RE.test(String(v === undefined || v === null ? '' : v));
const isImdb = v => IMDB_RE.test(String(v === undefined || v === null ? '' : v));

/** Titre « aplati » pour comparer deux écritures (casse, accents, ponctuation ignorés). */
const normTitle = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

module.exports = { NID_RE, IMDB_RE, isNid, isImdb, normTitle };
