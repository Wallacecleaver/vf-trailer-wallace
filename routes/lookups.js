// Handlers partagés par le dashboard (avec auth) et la page publique /proposer (sans auth).
// `label` n'apparaît que dans les messages d'erreur des logs (ex. " (public)").

const { fetchT, youtubeOembedUrl } = require('../lib/net');
const { FALLBACK_TMDB_KEY } = require('../lib/config');
const { searchTitles } = require('../lib/tmdb');

// Recherche TMDB (clé de secours serveur, jamais celle d'un visiteur).
const tmdbSearch = (label = '') => async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });

    try {
        res.json(await searchTitles(q, tmdbKey));
    } catch (err) {
        console.error(`Erreur recherche TMDB${label}:`, err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
};

// Titre d'une vidéo YouTube à partir de son ID (oEmbed publique, pas de clé API).
const youtubeTitle = (label = '') => async (req, res) => {
    const id = (req.query.id || '').toString().trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'YouTube ID invalide' });

    try {
        const r = await fetchT(youtubeOembedUrl(id));
        if (!r.ok) return res.status(404).json({ error: 'Vidéo introuvable, privée ou supprimée' });
        const data = await r.json();
        res.json({ title: data.title });
    } catch (err) {
        console.error(`Erreur titre YouTube${label}:`, err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
};

module.exports = { tmdbSearch, youtubeTitle };
