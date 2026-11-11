// Routes du dashboard pour le catalogue Netflix (onglet « Netflix ») : état, synchro à la demande,
// recherche dans le catalogue, test de bande-annonce, URL Netflix -> TMDB -> IMDB. Toutes protégées par requireAuth.

const sql = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { FALLBACK_TMDB_KEY } = require('../lib/config');
const { isNid } = require('../lib/netflix-common');
const { parseNetflixId, getTrailers, relayUrl } = require('../lib/netflix-trailer');
const { addFromNetflixUrl, linkNetflixToTmdb } = require('../lib/netflix-url-link');
const scheduler = require('../lib/netflix-scheduler');
const store = require('../lib/netflix-titles');
const crawler = require('../lib/netflix-crawler');

module.exports = function registerNetflixAdminRoutes(app) {
    // Chiffres du catalogue.
    app.get('/api/netflix-catalog', requireAuth, async (req, res) => {
        try {
            const [t] = await sql`SELECT COUNT(*) AS total, SUM(CASE WHEN imdb_id IS NOT NULL THEN 1 ELSE 0 END) AS with_imdb FROM netflix_titles`;
            const [s] = await sql`SELECT COUNT(*) AS seen, SUM(CASE WHEN nid_checked_at IS NOT NULL THEN 1 ELSE 0 END) AS checked FROM netflix_tmdb_seen`;
            res.json({
                titles: t.total || 0, titlesWithImdb: t.with_imdb || 0,
                tmdbSeenOnNetflixFr: s.seen || 0, nidLookupAttempted: s.checked || 0,
                tmdbKeyConfigured: !!FALLBACK_TMDB_KEY, syncEnabled: process.env.NETFLIX_SYNC !== '0',
            });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Lance le contrôle des nouveautés tout de suite (arrière-plan ; sans effet si une synchro tourne déjà).
    app.post('/api/netflix-catalog/sync', requireAuth, (req, res) => {
        scheduler.checkNew(FALLBACK_TMDB_KEY || '');
        res.status(202).json({ started: true });
    });

    // La table : titres du catalogue, paginés (?q=&filter=all|imdb|noimdb|pending|done|error&page=&size=).
    app.get('/api/netflix-catalog/titles', requireAuth, async (req, res) => {
        try {
            res.json(await store.listTitles({ q: req.query.q, filter: req.query.filter, page: req.query.page, size: req.query.size }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Couverture concrète : lus -> liés -> vérifiés -> avec bande-annonce -> prêts à distribuer -> distribués.
    app.get('/api/netflix-catalog/coverage', requireAuth, async (req, res) => {
        try { res.json(await store.coverage()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Exploration en arrière-plan : état (réglages, progression, répartition de la table).
    app.get('/api/netflix-catalog/crawler', requireAuth, async (req, res) => {
        try { res.json(await crawler.getStatus()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Exploration : { enabled: bool } démarre/arrête ; { delayMs } règle la cadence (1,5 s minimum).
    app.post('/api/netflix-catalog/crawler', requireAuth, async (req, res) => {
        try {
            const b = req.body || {};
            if (process.env.NETFLIX_CRAWL === '0') return res.status(409).json({ error: 'Exploration désactivée par NETFLIX_CRAWL=0' });
            if (b.delayMs !== undefined) await crawler.setDelay(b.delayMs);
            if (typeof b.enabled === 'boolean') await crawler.setEnabled(b.enabled);
            res.json(await crawler.getStatus());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Cherche dans le catalogue par IMDB ID, ID Netflix ou URL Netflix.
    app.get('/api/netflix-catalog/lookup', requireAuth, async (req, res) => {
        try {
            const q = String(req.query.q || '').trim();
            const imdb = (q.match(/tt\d{5,10}/) || [])[0];
            const nid = imdb ? null : parseNetflixId(q);
            if (!imdb && !nid) return res.status(400).json({ error: 'Colle un IMDB ID (tt…), un ID Netflix ou une URL Netflix.' });
            const rows = imdb
                ? await sql`SELECT * FROM netflix_titles WHERE imdb_id = ${imdb} ORDER BY last_seen DESC`
                : await sql`SELECT * FROM netflix_titles WHERE nid = ${nid}`;
            const seen = imdb ? await sql`SELECT * FROM netflix_tmdb_seen WHERE imdb_id = ${imdb}` : [];
            res.json({ query: imdb || nid, rows, seenOnNetflixFr: seen });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Lit la page Netflix et liste les bandes-annonces trouvées (sans exposer les liens signés).
    app.post('/api/netflix-catalog/trailers', requireAuth, async (req, res) => {
        const nid = parseNetflixId(String((req.body && req.body.q) || ''));
        if (!isNid(nid)) return res.status(400).json({ error: 'ID ou URL Netflix invalide' });
        try {
            const trailers = await getTrailers(nid, { force: true });
            res.json({ nid, relayUrl: relayUrl(nid), trailers: trailers.map(t => ({ title: t.title, runtimeSec: t.runtime, expires: t.expires })) });
        } catch (err) { res.status(502).json({ error: err.message }); }
    });

    // URL Netflix -> titre lu sur la page -> TMDB -> IMDB. `dryRun` : montre le résultat sans rien enregistrer.
    app.post('/api/netflix-catalog/from-url', requireAuth, async (req, res) => {
        try {
            const b = req.body || {};
            res.json(await addFromNetflixUrl(String(b.url || ''), FALLBACK_TMDB_KEY, { dryRun: b.dryRun === true }));
        } catch (err) { res.status(400).json({ error: err.message }); }
    });

    // Confirmation manuelle d'un candidat TMDB pour un ID Netflix (cas « ambigu »).
    app.post('/api/netflix-catalog/link', requireAuth, async (req, res) => {
        try {
            const b = req.body || {};
            res.json({ status: 'linked', row: await linkNetflixToTmdb(String(b.nid || ''),
                { type: b.type, tmdbId: b.tmdbId, title: b.title, year: b.year }, FALLBACK_TMDB_KEY) });
        } catch (err) { res.status(400).json({ error: err.message }); }
    });
};
