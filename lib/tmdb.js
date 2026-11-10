// Client TMDB : toutes les URLs et réponses de l'API TMDB passent par ici.

const { fetchT } = require('./net');

const API = 'https://api.themoviedb.org/3';

// Retrouve un titre TMDB à partir d'un IMDB ID (réponse JSON brute : movie_results / tv_results).
async function findByImdb(imdbId, tmdbKey, language) {
    const res = await fetchT(`${API}/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id${language ? `&language=${language}` : ''}`);
    return res.json();
}

// Réponse brute de /configuration : sert uniquement à savoir si une clé est valide.
function fetchConfiguration(key) {
    return fetchT(`${API}/configuration?api_key=${encodeURIComponent(key)}`);
}

// Recherche films + séries (résultats fusionnés, triés par popularité, 12 max).
async function searchTitles(q, tmdbKey) {
    const [movieRes, tvRes] = await Promise.all([
        fetchT(`${API}/search/movie?api_key=${tmdbKey}&language=fr-FR&query=${encodeURIComponent(q)}`),
        fetchT(`${API}/search/tv?api_key=${tmdbKey}&language=fr-FR&query=${encodeURIComponent(q)}`),
    ]);
    const [movieData, tvData] = await Promise.all([movieRes.json(), tvRes.json()]);

    const toResult = mediaType => r => ({
        tmdbId: r.id,
        mediaType,
        title: mediaType === 'movie' ? r.title : r.name,
        year: (mediaType === 'movie' ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
        popularity: r.popularity || 0,
    });

    return [
        ...(movieData.results || []).map(toResult('movie')),
        ...(tvData.results || []).map(toResult('tv')),
    ]
        .filter(r => r.title)
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 12);
}

// IMDB ID d'un titre TMDB (null si TMDB n'en connaît pas). `type` et `id` sont insérés tels quels
// dans l'URL : l'appelant décide de ce qu'il valide / encode.
async function getImdbId(type, id, tmdbKey) {
    const r = await fetchT(`${API}/${type}/${id}/external_ids?api_key=${tmdbKey}`);
    const data = await r.json();
    return data.imdb_id || null;
}

// Titre FR + titre original + année — le titre original sert à enrichir la référence
// de matching (un trailer peut utiliser le titre international plutôt que le titre FR).
// Résilient : une panne réseau ponctuelle sur CE sous-appel ne doit pas tuer toute la
// résolution (elles sont lancées en Promise.all avec getAlternativeTitles ci-dessous).
async function getTitleAndYear(mediaType, tmdbId, tmdbKey) {
    try {
        const res = await fetchT(`${API}/${mediaType}/${tmdbId}?api_key=${tmdbKey}&language=fr-FR`);
        const data = await res.json();
        const title = mediaType === 'movie' ? data.title : data.name;
        const originalTitle = mediaType === 'movie' ? data.original_title : data.original_name;
        const dateStr = mediaType === 'movie' ? data.release_date : data.first_air_date;
        return { title, originalTitle, year: dateStr ? dateStr.slice(0, 4) : null };
    } catch (err) {
        console.error('Erreur récupération titre TMDB:', err.message);
        return { title: null, originalTitle: null, year: null };
    }
}

// Titres alternatifs TMDB (marché FR) — enrichit encore la référence de matching
// pour les cas où ni le titre FR ni le titre original n'apparaissent dans le trailer.
async function getAlternativeTitles(mediaType, tmdbId, tmdbKey) {
    try {
        const res = await fetchT(`${API}/${mediaType}/${tmdbId}/alternative_titles?api_key=${tmdbKey}`);
        const data = await res.json();
        return (data.titles || [])
            .filter(t => t.iso_3166_1 === 'FR')
            .map(t => t.title);
    } catch (err) {
        console.error('Erreur récupération titres alternatifs TMDB:', err.message);
        return [];
    }
}

module.exports = { API, findByImdb, fetchConfiguration, searchTitles, getImdbId, getTitleAndYear, getAlternativeTitles };
