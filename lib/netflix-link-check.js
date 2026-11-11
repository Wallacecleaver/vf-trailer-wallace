// Vérification d'un lien « ID Netflix = IMDB/TMDB » : on compare ce que dit la page Netflix (titre, année, type)
// avec la fiche TMDB du titre lié. Aucune requête vers Netflix : seulement TMDB, déjà autorisé et léger.
//
// Résultat :
//   ok        titre identique ET année compatible
//   weak      l'un des deux concorde (ex. titre traduit autrement, ou année différente) : lien probable
//   mismatch  ni le titre ni l'année ne concordent : lien jugé faux, jamais utilisé pour distribuer
//   unknown   TMDB ne connaît pas ce titre / n'a pas répondu de façon exploitable

const { tmdbGet } = require('./netflix-tmdb-sync');
const { normTitle } = require('./netflix-common');

const yearOf = d => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

/** Deux titres « aplatis » concordent s'ils sont égaux, ou si l'un contient l'autre (4 caractères minimum). */
function sameTitle(a, b) {
    const x = normTitle(a);
    const y = normTitle(b);
    if (!x || !y) return false;
    if (x === y) return true;
    return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
}

/**
 * Compare la page Netflix (`info`) à une fiche TMDB (`tmdb` : { type, title, name, original_title, original_name,
 * release_date, first_air_date }). Pour une série, Netflix donne l'année de la DERNIÈRE saison : elle est compatible
 * dès qu'elle n'est pas antérieure à la première diffusion.
 */
function compare(info, tmdb) {
    if (!info || !tmdb) return 'unknown';
    const names = [tmdb.title, tmdb.name, tmdb.original_title, tmdb.original_name].filter(Boolean);
    const titleOk = names.some(n => sameTitle(n, info.title));
    const y = yearOf(tmdb.release_date || tmdb.first_air_date);
    let yearOk = false;
    if (info.year && y) yearOk = tmdb.type === 'tv' ? info.year >= y - 1 : Math.abs(info.year - y) <= 1;
    if (titleOk && yearOk) return 'ok';
    if (titleOk || yearOk) return 'weak';
    return names.length ? 'mismatch' : 'unknown';
}

/** Fiche TMDB à comparer : par TMDB ID si on l'a, sinon retrouvée via l'IMDB ID (/find). null si introuvable. */
async function fetchTmdbRecord({ imdbId, tmdbId, type }, preferredType, key) {
    if (tmdbId && (type === 'movie' || type === 'tv')) {
        const d = await tmdbGet(`/${type}/${tmdbId}`, key, { language: 'fr-FR' });
        return d && d.id ? { ...d, type } : null;
    }
    const d = await tmdbGet(`/find/${imdbId}`, key, { external_source: 'imdb_id', language: 'fr-FR' });
    const movie = ((d && d.movie_results) || [])[0];
    const tv = ((d && d.tv_results) || [])[0];
    const pick = preferredType === 'movie' ? (movie && { ...movie, type: 'movie' }) || (tv && { ...tv, type: 'tv' })
        : (tv && { ...tv, type: 'tv' }) || (movie && { ...movie, type: 'movie' });
    return pick || null;
}

/**
 * Vérifie le lien d'une ligne du catalogue. Renvoie { status, tmdbId, type } (tmdbId/type complétés si on les a trouvés),
 * ou null si TMDB est injoignable (on réessaiera à un prochain passage).
 */
async function verifyLink(row, info, key) {
    if (!key || !row || !row.imdb_id) return null;
    try {
        const rec = await fetchTmdbRecord({ imdbId: row.imdb_id, tmdbId: row.tmdb_id, type: row.type }, info.mediaType, key);
        if (!rec) return { status: 'unknown' };
        return { status: compare(info, rec), tmdbId: rec.id, type: rec.type };
    } catch {
        return null;
    }
}

module.exports = { compare, sameTitle, verifyLink };
