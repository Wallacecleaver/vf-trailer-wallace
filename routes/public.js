// Routes publiques (sans auth) : test de clé TMDB, santé des services, aides de la page /proposer,
// soumission d'une proposition. Ces routes sont appelables par n'importe quel visiteur.

const { fetchT, checkServices, toUpDown, youtubeOembedUrl } = require('../lib/net');
const { FALLBACK_TMDB_KEY } = require('../lib/config');
const { fetchConfiguration, getImdbId } = require('../lib/tmdb');
const { getCached, setCached } = require('../lib/cache');
const { logEvent } = require('../lib/logs');
const { addContribution } = require('../lib/contributions');
const { tmdbSearch, youtubeTitle } = require('./lookups');

module.exports = function registerPublicRoutes(app) {
    // Endpoint public (pas de requireAuth) : utilisé par le bouton "Tester" de la page
    // /configure pour vérifier une clé TMDB perso avant de générer le lien d'installation.
    // On passe par le serveur plutôt qu'un fetch direct depuis le navigateur car la CSP
    // globale (voir plus haut) limite connect-src à 'self'.
    app.get('/api/test-tmdb', async (req, res) => {
        const key = (req.query.key || '').toString().trim();
        if (!key) return res.status(400).json({ valid: false, error: 'Clé manquante' });
        try {
            const r = await fetchConfiguration(key);
            if (r.ok) return res.json({ valid: true });
            const data = await r.json().catch(() => ({}));
            res.json({ valid: false, error: data.status_message || `Erreur TMDB (${r.status})` });
        } catch (err) {
            await logEvent({ level: 'error', context: 'SYSTEM', event: 'tmdb_unreachable', message: 'Impossible de joindre TMDB depuis le serveur', meta: { error: err.message } });
            res.status(502).json({ valid: false, error: 'Erreur réseau côté serveur, réessaie.' });
        }
    });

    // ---- Health check des services externes (pour le badge live sur /configure) ----
    // Volontairement public (pas de requireAuth) : c'est juste "le service est joignable ou pas",
    // aucune donnée sensible. On teste le domaine public, pas l'API authentifiée, pour ne pas
    app.get('/api/health', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const current = await checkServices();

        // On ne log QUE les changements d'état (pas chaque check, sinon spam à chaque
        // visite de /configure). Best-effort : si la base est indisponible, on skip juste le log.
        try {
            const prev = await getCached('system:health:last');
            if (prev) {
                for (const svc of ['tmdb', 'youtube', 'allocine']) {
                    if (prev[svc] !== current[svc]) {
                        await logEvent({
                            level: current[svc] ? 'info' : 'warn',
                            context: 'SYSTEM',
                            event: current[svc] ? 'service_up' : 'service_down',
                            message: `${svc.toUpperCase()} est ${current[svc] ? 'de nouveau joignable' : 'devenu injoignable'}`,
                            meta: { service: svc },
                        });
                    }
                }
            }
            await setCached('system:health:last', current, 30 * 24 * 60 * 60);
        } catch (err) {
            console.error('Erreur suivi santé services:', err.message);
        }

        res.json({ ...toUpDown(current), checkedAt: new Date().toISOString() });
    });

    // Variantes PUBLIQUES (sans requireAuth) des helpers TMDB/YouTube du dashboard, pour que la page
    // /proposer puisse chercher un titre et vérifier un lien. Même clé TMDB de secours.
    app.get('/api/public/tmdb-search', tmdbSearch(' (public)'));

    app.get('/api/public/tmdb-resolve', async (req, res) => {
        const { id, type } = req.query;
        if (!id || !type) return res.status(400).json({ error: 'id et type requis' });
        const tmdbKey = FALLBACK_TMDB_KEY;
        if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });
        try {
            const imdbId = await getImdbId(type, id, tmdbKey);
            if (!imdbId) return res.status(404).json({ error: 'Aucun IMDB ID associé à ce titre TMDB' });
            res.json({ imdbId });
        } catch (err) {
            console.error('Erreur résolution TMDB->IMDB (public):', err.message);
            res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
        }
    });

    app.get('/api/public/youtube-title', youtubeTitle(' (public)'));

    app.get('/api/public/test-link', async (req, res) => {
        const ytId = (req.query.ytId || '').toString().trim();
        const url = (req.query.url || '').toString().trim();

        if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
            try {
                const r = await fetchT(youtubeOembedUrl(ytId));
                if (!r.ok) return res.json({ ok: false, error: 'Vidéo introuvable, privée ou supprimée' });
                const data = await r.json();
                return res.json({ ok: true, kind: 'youtube', title: data.title || null, ytId });
            } catch (err) {
                return res.status(502).json({ ok: false, error: 'Erreur réseau côté serveur, réessaie.' });
            }
        }

        if (url && /^https?:\/\//i.test(url)) {
            // Vimeo et Dailymotion exposent un oEmbed public comme YouTube : on l'utilise
            // quand l'URL correspond, pour remonter un vrai titre plutôt qu'un simple HEAD.
            const isVimeo = /vimeo\.com\//i.test(url);
            const isDailymotion = /dailymotion\.com\/|dai\.ly\//i.test(url);

            if (isVimeo || isDailymotion) {
                const oembedUrl = isVimeo
                    ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
                    : `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}&format=json`;
                try {
                    const r = await fetchT(oembedUrl);
                    if (!r.ok) return res.json({ ok: false, error: 'Vidéo introuvable, privée ou supprimée', kind: isVimeo ? 'vimeo' : 'dailymotion' });
                    const data = await r.json();
                    return res.json({ ok: true, kind: isVimeo ? 'vimeo' : 'dailymotion', title: data.title || null, thumbnail: data.thumbnail_url || null, url });
                } catch (err) {
                    // oEmbed indisponible -> on retombe sur le HEAD générique plutôt que d'échouer
                }
            }

            try {
                const r = await fetchT(url, { method: 'HEAD', redirect: 'follow' });
                return res.json({ ok: r.ok || r.status < 400, kind: 'direct', url });
            } catch (err) {
                return res.json({ ok: false, error: 'URL injoignable' });
            }
        }

        res.status(400).json({ ok: false, error: 'YouTube ID ou URL requis' });
    });

    // Soumission publique d'une proposition (pseudo obligatoire, pas d'auth).
    app.post('/api/contributions', async (req, res) => {
        const { imdbId, season, title, mediaType, ytId, url, pseudo, notes } = req.body || {};
        const cleanImdb = typeof imdbId === 'string' ? imdbId.trim() : '';
        const cleanPseudo = typeof pseudo === 'string' ? pseudo.trim().slice(0, 40) : '';
        const cleanYtId = typeof ytId === 'string' ? ytId.trim() : '';
        const cleanUrl = typeof url === 'string' ? url.trim() : '';

        if (!/^tt\d{6,9}$/.test(cleanImdb)) return res.status(400).json({ error: 'IMDB ID invalide' });
        if (!cleanPseudo) return res.status(400).json({ error: 'Pseudo requis' });
        if (!cleanYtId && !cleanUrl) return res.status(400).json({ error: 'Lien requis (YouTube ou URL directe)' });

        const item = await addContribution({
            imdbId: cleanImdb,
            season: season || null,
            title: typeof title === 'string' ? title.trim().slice(0, 200) || null : null,
            mediaType: mediaType === 'series' ? 'series' : mediaType === 'movie' ? 'movie' : null,
            ytId: cleanYtId || null,
            url: cleanYtId ? null : (cleanUrl || null),
            pseudo: cleanPseudo,
            notes: typeof notes === 'string' ? notes.trim().slice(0, 300) || null : null,
        });
        if (!item) return res.status(500).json({ error: 'Erreur serveur, réessaie.' });
        await logEvent({ level: 'info', context: 'CONTRIB', event: 'contribution_submitted', message: `Proposition reçue pour ${cleanImdb} par ${cleanPseudo}`, meta: { imdbId: cleanImdb, pseudo: cleanPseudo } });
        res.json({ success: true });
    });
};
