// Réseau : fetch avec délai maximal + test de joignabilité des services externes.

const fetch = require('node-fetch');
const { safeFetch } = require('./security');

// ---- Fetch réseau avec timeout ----
// Tous les appels externes (TMDB, YouTube, Allociné, oEmbed...) passent par ici :
// un service qui ne répond pas ne doit pas bloquer toute la requête.
const NETWORK_TIMEOUT_MS = 8000;
async function fetchT(url, opts = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: opts.signal || controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Même chose, mais pour une URL fournie par un utilisateur (champ « lien direct ») :
// refuse les adresses internes et revalide chaque redirection. À utiliser au lieu de fetchT.
async function safeFetchT(url, opts = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
    return safeFetch(url, opts, { timeoutMs });
}

async function pingUrl(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
        return r.status < 500; // même une 403/404 prouve que le service répond
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// Services utilisés par le moteur de bandes-annonces.
// Le statut mesure la joignabilité HTTP du fournisseur, pas la validité d'une clé API.
async function checkServices() {
    const [tmdb, youtube, allocine, tvdb, anilist] = await Promise.all([
        pingUrl('https://www.themoviedb.org'),
        pingUrl('https://www.youtube.com'),
        pingUrl('https://www.allocine.fr'),
        pingUrl('https://api4.thetvdb.com/v4/series/1'),
        pingUrl('https://graphql.anilist.co'),
    ]);
    return { tmdb, youtube, allocine, tvdb, anilist };
}

// Même chose, en 'up' / 'down' (format renvoyé par les routes de statut).
function toUpDown(services) {
    return Object.fromEntries(
        Object.entries(services).map(([name, up]) => [name, up ? 'up' : 'down'])
    );
}

// URL oEmbed publique de YouTube (titre d'une vidéo, sans clé API).
function youtubeOembedUrl(ytId) {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}&format=json`;
}

module.exports = { fetchT, safeFetchT, pingUrl, checkServices, toUpDown, youtubeOembedUrl };
