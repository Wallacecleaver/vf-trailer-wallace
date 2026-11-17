// Client TMDB : toutes les URLs et réponses de l'API TMDB passent par ici.

const { fetchT } = require('./net');

const API = 'https://api.themoviedb.org/3';

// Retrouve un titre TMDB à partir d'un IMDB ID (réponse JSON brute : movie_results / tv_results).
async function findByImdb(imdbId, tmdbKey, language) {
    const res = await fetchT(`${API}/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id${language ? `&language=${encodeURIComponent(language)}` : ''}`);
    return res.json();
}

// Réponse brute de /configuration : sert uniquement à savoir si une clé est valide.
function fetchConfiguration(key) {
    return fetchT(`${API}/configuration?api_key=${encodeURIComponent(key)}`);
}

// Recherche films + séries (résultats fusionnés, triés par popularité, 12 max).
async function searchTitles(q, tmdbKey) {
    const [movieRes, tvRes] = await Promise.all([
        fetchT(`${API}/search/movie?api_key=${encodeURIComponent(tmdbKey)}&language=fr-FR&query=${encodeURIComponent(q)}`),
        fetchT(`${API}/search/tv?api_key=${encodeURIComponent(tmdbKey)}&language=fr-FR&query=${encodeURIComponent(q)}`),
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

// IMDB ID d'un titre TMDB (null si TMDB n'en connaît pas).
async function getImdbId(type, id, tmdbKey) {
    const safeType = type === 'tv' ? 'tv' : 'movie';
    const r = await fetchT(`${API}/${safeType}/${encodeURIComponent(id)}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`);
    const data = await r.json();
    return data.imdb_id || null;
}

// Catalogue des plateformes reconnues. Les noms viennent des champs networks /
// production_companies et des fournisseurs JustWatch renvoyés par TMDB.
// On garde des identifiants courts pour les utiliser directement dans stream-format.js.
const PLATFORM_MATCHERS = [
    ['netflix', /\bnetflix\b/i],
    ['prime', /\b(prime video|amazon prime video|amazon video|amazon studios|amazon mgm studios)\b/i],
    ['disney', /\b(disney\s*\+|disney plus|disney studios)(?!\w)/i],
    ['max', /^max$|\b(hbo\s*max|hbo|home box office|warner max)\b/i],
    ['apple', /^apple tv(?:\s*(?:plus|\+))?$|\b(apple original|apple studios)\b/i],
    ['paramount', /\b(paramount\s*\+|paramount plus|paramount pictures television)(?!\w)/i],
    ['canal', /\b(canal\s*\+|canal plus|mycanal)(?!\w)/i],
    ['crunchyroll', /\b(crunchyroll|funimation)\b/i],
    ['mubi', /\bmubi\b/i],
    ['ocs', /\bocs\b/i],
    ['molotov', /\bmolotov\b/i],
    ['france_tv', /\b(france\s*tv|france televisions|francetv)\b/i],
    ['arte', /\barte\b/i],
    ['tf1', /\btf1\b|tf1 video\b/i],
    ['m6', /\b(m6(?:\s*(\+|plus))?|6play)(?!\w)/i],
    ['shadowz', /\bshadowz\b/i],
    ['filmo', /\bfilmo(?:tv)?\b/i],
    ['adn', /\b(animation digital network|adn)\b/i],
    ['rakuten', /\brakuten tv\b/i],
    ['pluto', /\bpluto tv\b/i],
    ['plex', /\bplex\b/i],
    ['tubi', /\btubi\b/i],
    ['hulu', /\bhulu\b/i],
    ['peacock', /\bpeacock\b/i],
    ['discovery', /\b(discovery\s*\+|discovery plus)(?!\w)/i],
    ['starz', /\bstarz\b/i],
    ['britbox', /\bbritbox\b/i],
    ['skyshowtime', /\bskyshowtime\b/i],
    ['viaplay', /\bviaplay\b/i],
    ['hayu', /\bhayu\b/i],
    ['dazn', /\bdazn\b/i],
    ['bein', /\bbein\s*sports?\b/i],
    ['curiosity', /\bcuriosity\s*stream\b/i],
    ['viki', /\b(viki|rakuten viki)\b/i],
    ['iqiyi', /\biqiyi\b/i],
    ['wetv', /\bwetv\b/i],
    ['kocowa', /\bkocowa\b/i],
    ['amc', /\b(amc\s*\+|amc plus)(?!\w)/i],
    ['acorn', /\bacorn tv\b/i],
    ['shudder', /\bshudder\b/i],
    ['roku', /\b(roku channel|the roku channel)\b/i],
    ['itvx', /\bitvx\b/i],
    ['bbc', /\b(bbc iplayer|bbc player)\b/i],
    ['channel4', /\b(channel 4|all 4)\b/i],
    ['my5', /\bmy5\b/i],
    ['now', /^now$|\bnow tv\b/i],
    ['rtl', /\b(rtl\s*\+|rtl plus)(?!\w)/i],
    ['joyn', /\bjoyn\b/i],
    ['zdf', /\bzdf(?:tivi)?\b/i],
    ['ard', /\bard\s*(mediathek|plus)\b/i],
    ['magenta', /\bmagenta\s*tv\b/i],
    ['videoland', /\bvideoland\b/i],
    ['npo', /\bnpo\s*(plus|start)\b/i],
    ['pathe', /\bpathe thuis\b/i],
    ['svt', /\bsvt play\b/i],
    ['nrk', /\bnrk (tv|play)\b/i],
    ['drtv', /\b(dr tv|drtv)\b/i],
    ['tving', /\btving\b/i],
    ['wavve', /\bwavve\b/i],
    ['coupang', /\bcoupang play\b/i],
    ['watcha', /\bwatcha\b/i],
    ['unext', /\b(u-next|unext)\b/i],
    ['fod', /\bfod\b/i],
    ['abema', /\babema\b/i],
    ['bilibili', /\bbilibili\b/i],
    ['youku', /\byouku\b/i],
    ['tencent', /\b(tencent video|wetv)\b/i],
    ['mango', /\bmango tv\b/i],
    ['zee5', /\bzee5\b/i],
    ['sonyliv', /\bsony\s*liv\b/i],
    ['hotstar', /\b(jiohotstar|hotstar)\b/i],
    ['eros', /\beros now\b/i],
    ['lionsgate', /\blionsgate play\b/i],
    ['stan', /\bstan\b/i],
    ['binge', /\bbinge\b/i],
    ['foxtel', /\bfoxtel now\b/i],
    ['kayo', /\bkayo sports?\b/i],
    ['neon', /\bneon tv\b/i],
    ['tvnz', /\b(tvnz\s*\+|tvnz on demand)(?!\w)/i],
    ['crave', /\bcrave\b/i],
    ['cbc', /\bcbc gem\b/i],
    ['ctv', /\bctv\b/i],
    ['global', /\bglobal tv\b/i],
    ['kanopy', /\bkanopy\b/i],
    ['hoopla', /\bhoopla\b/i],
    ['aha', /\baha\b/i],
    ['mxplayer', /\bmx player\b/i],
    ['sunnxt', /\bsun nxt\b/i],
    ['hoichoi', /\bhoichoi\b/i],
];

function platformFromName(name) {
    let value = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    if (!value) return null;
    // « Paramount Plus Apple TV channel » reste Paramount+, pas Apple TV.
    // Retire seulement le distributeur en fin de nom ; The Roku Channel est un service en soi.
    if (!/^(the )?roku channel$/i.test(value)) {
        value = value.replace(/\s+(amazon(?: prime video)?|apple tv|roku(?: premium)?) channels?$/i, '');
    }
    const match = PLATFORM_MATCHERS.find(([, pattern]) => pattern.test(value));
    return match ? match[0] : null;
}

// Plateforme d'origine d'après les chaînes de diffusion et sociétés de production TMDB.
// On teste d'abord les networks, plus représentatifs du diffuseur d'une série.
function detectPlatform(data) {
    const names = [
        ...(data.networks || []).map(x => (x && x.name) || ''),
        ...(data.production_companies || []).map(x => (x && x.name) || ''),
    ];
    for (const name of names) {
        const platform = platformFromName(name);
        if (platform) return platform;
    }
    return null;
}

// Disponibilité en France (ou WATCH_REGION), via JustWatch exposé par TMDB.
// Premier abonnement reconnu, dans l'ordre TMDB ; sinon badge générique VOD si une
// offre d'achat/location existe. Une boutique ne prend jamais le nom d'un abonnement.
function platformFromProviders(entry) {
    const providers = (entry && entry.flatrate) || [];
    for (const provider of providers) {
        const platform = platformFromName(provider && provider.provider_name);
        if (platform) return platform;
    }
    for (const type of ['rent', 'buy']) {
        const offers = entry && entry[type];
        if (Array.isArray(offers) && offers.some(provider =>
            provider && typeof provider.provider_name === 'string' && provider.provider_name.trim())) {
            return 'vod';
        }
    }
    return null;
}

const WATCH_REGION = process.env.WATCH_REGION || 'FR';

async function getWatchPlatform(mediaType, tmdbId, tmdbKey, region = WATCH_REGION) {
    try {
        const res = await fetchT(`${API}/${mediaType}/${tmdbId}/watch/providers?api_key=${tmdbKey}`);
        const data = await res.json();
        return platformFromProviders(data && data.results && data.results[region]);
    } catch (err) {
        console.error('Erreur disponibilité TMDB (watch/providers):', err.message);
        return null;
    }
}

// Plateforme finale : production d'abord (original Netflix/Apple), sinon abonnement ou VOD.
async function getPlatform(mediaType, tmdbId, tmdbKey) {
    const [info, watch] = await Promise.all([getTitleAndYear(mediaType, tmdbId, tmdbKey), getWatchPlatform(mediaType, tmdbId, tmdbKey)]);
    return info.platform || watch || null;
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
        const productionCountries = Array.isArray(data.production_countries)
            ? data.production_countries.map(country => country && country.iso_3166_1).filter(Boolean)
            : [];
        return {
            title,
            originalTitle,
            year: dateStr ? dateStr.slice(0, 4) : null,
            platform: detectPlatform(data),
            genreIds: Array.isArray(data.genres) ? data.genres.map(genre => Number(genre.id)).filter(Number.isFinite) : [],
            originCountries: Array.isArray(data.origin_country) ? data.origin_country : productionCountries,
            originalLanguage: data.original_language || null,
        };
    } catch (err) {
        console.error('Erreur récupération titre TMDB:', err.message);
        return { title: null, originalTitle: null, year: null, platform: null, genreIds: [], originCountries: [], originalLanguage: null };
    }
}

// Titres alternatifs TMDB (marché FR) — enrichit encore la référence de matching
// pour les cas où ni le titre FR ni le titre original n'apparaissent dans le trailer.
async function getAlternativeTitles(mediaType, tmdbId, tmdbKey) {
    try {
        const res = await fetchT(`${API}/${mediaType}/${tmdbId}/alternative_titles?api_key=${tmdbKey}`);
        const data = await res.json();
        const list = Array.isArray(data.titles) ? data.titles : (Array.isArray(data.results) ? data.results : []);
        return list
            .filter(t => t && t.iso_3166_1 === 'FR' && t.title)
            .map(t => t.title);
    } catch (err) {
        console.error('Erreur récupération titres alternatifs TMDB:', err.message);
        return [];
    }
}

module.exports = { API, findByImdb, fetchConfiguration, searchTitles, getImdbId, getTitleAndYear, getAlternativeTitles, detectPlatform,
    platformFromProviders, getWatchPlatform, getPlatform, WATCH_REGION };
