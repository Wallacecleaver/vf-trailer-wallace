// Réseau : fetch avec délai maximal + test de joignabilité des services externes.

const fetch = require('node-fetch');

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

// Les trois services dont dépend l'addon. Renvoie { tmdb, youtube, allocine } (booléens).
async function checkServices() {
    const [tmdb, youtube, allocine] = await Promise.all([
        pingUrl('https://www.themoviedb.org'),
        pingUrl('https://www.youtube.com'),
        pingUrl('https://www.allocine.fr'),
    ]);
    return { tmdb, youtube, allocine };
}

// Même chose, en 'up' / 'down' (format renvoyé par les routes de statut).
function toUpDown(services) {
    return {
        tmdb: services.tmdb ? 'up' : 'down',
        youtube: services.youtube ? 'up' : 'down',
        allocine: services.allocine ? 'up' : 'down',
    };
}

// URL oEmbed publique de YouTube (titre d'une vidéo, sans clé API).
function youtubeOembedUrl(ytId) {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}&format=json`;
}

module.exports = { fetchT, pingUrl, checkServices, toUpDown, youtubeOembedUrl };
