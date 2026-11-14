// Routes du dashboard d'administration (toutes protégées par requireAuth, sauf le login).

const sql = require('../lib/db');
const { fetchT, checkServices, toUpDown, youtubeOembedUrl } = require('../lib/net');
const { FALLBACK_TMDB_KEY } = require('../lib/config');
const { findByImdb, fetchConfiguration, getImdbId } = require('../lib/tmdb');
const { requireAuth, login } = require('../lib/auth');
const { getCached, setCached, getCacheStats, clearAllCache, clearCacheFailures } = require('../lib/cache');
const { logEvent, getLogs, clearLogs } = require('../lib/logs');
const { getStats, resetStats } = require('../lib/stats');
const { getInstallStats, resetInstalls, removeInstall } = require('../lib/install-stats');
const { getAiomStats, resetAiomStats } = require('../lib/aiom-stats');
const {
    getOverrides, setOverride, deleteOverride,
    getFailedLog, clearFailedLog, getResolvedLog, clearResolvedLog } = require('../lib/overrides');
const { getContributions, updateContributionStatus, deleteContribution } = require('../lib/contributions');
const {
    getConfigureSettings, setConfigureSettings, resetConfigureSettings,
    getBehaviorSettings, setBehaviorSettings, resetBehaviorSettings,
} = require('../lib/settings');
const { searchYoutubeRaw } = require('../lib/youtube-search');
const { probeDirectLink } = require('../lib/media-link');
const { testResolve } = require('../lib/resolver');
const { tmdbSearch, youtubeTitle } = require('./lookups');

module.exports = function registerDashboardRoutes(app) {
    // ---- Recherche TMDB pour le formulaire "Mapping des liens" du dashboard ----
    // Utilise la clé de secours serveur (réservée à l'admin), jamais celle d'un visiteur.
    app.get('/api/tmdb-search', requireAuth, tmdbSearch());

    // Sens inverse de /api/tmdb-resolve : à partir d'un IMDB ID déjà connu (tapé ou collé
    // directement dans le formulaire), retrouve le titre TMDB pour pré-remplir le champ titre.
    app.get('/api/tmdb-lookup', requireAuth, async (req, res) => {
        const imdbId = (req.query.imdbId || '').toString().trim();
        if (!/^tt\d{6,9}$/.test(imdbId)) return res.status(400).json({ error: 'IMDB ID invalide' });
        const tmdbKey = FALLBACK_TMDB_KEY;
        if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });

        try {
            const data = await findByImdb(imdbId, tmdbKey, 'fr-FR');
            const movie = data.movie_results?.[0];
            const tv = data.tv_results?.[0];

            const result = movie
                ? { mediaType: 'movie', title: movie.title, year: movie.release_date?.slice(0, 4) || null }
                : tv
                    ? { mediaType: 'tv', title: tv.name, year: tv.first_air_date?.slice(0, 4) || null }
                    : null;

            if (!result) return res.status(404).json({ error: 'Aucun titre TMDB trouvé pour cet IMDB ID' });
            res.json(result);
        } catch (err) {
            console.error('Erreur lookup TMDB par IMDB ID:', err.message);
            res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
        }
    });

    // Titre d'une vidéo YouTube à partir de son ID, via l'API oEmbed publique de YouTube
    // (pas de clé API nécessaire) -- sert à pré-remplir "Titre affiché dans Stremio" dans le
    // formulaire d'override, symétrique au lookup TMDB par IMDB ID.
    app.get('/api/youtube-title', requireAuth, youtubeTitle());

    // Recherche YouTube pour le formulaire "Mapping des liens" : résultats BRUTS (sans filtre
    // VF/pertinence -- l'admin choisit le lien qu'il veut mapper), classés par pertinence.
    app.get('/api/youtube-search', requireAuth, async (req, res) => {
        const q = (req.query.q || '').toString().trim();
        if (!q) return res.json([]);
        try {
            const results = await searchYoutubeRaw(q);
            res.json(results);
        } catch (err) {
            console.error('Erreur recherche YouTube:', err.message);
            res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
        }
    });

    // Vérifie qu'un lien (YouTube ID ou URL directe) est jouable AVANT de l'enregistrer en override.
    // Pour YouTube : vérifie via oEmbed que la vidéo existe et est publique (titre renvoyé).
    // Pour une URL directe : simple test de joignabilité HEAD (le serveur répond, pas forcément
    // un vrai média -- suffisant pour attraper les fautes de frappe/liens morts au moment de saisir).
    app.get('/api/test-link', requireAuth, async (req, res) => {
        const ytId = (req.query.ytId || '').toString().trim();
        const url = (req.query.url || '').toString().trim();

        if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
            try {
                const r = await fetchT(youtubeOembedUrl(ytId));
                if (!r.ok) return res.json({ ok: false, error: 'Vidéo introuvable, privée ou supprimée' });
                const data = await r.json();
                return res.json({ ok: true, kind: 'youtube', title: data.title || null, ytId });
            } catch (err) {
                console.error('Erreur test lien YouTube:', err.message);
                return res.status(502).json({ ok: false, error: 'Erreur réseau côté serveur, réessaie.' });
            }
        }

        if (url && /^https?:\/\//i.test(url)) {
            const p = await probeDirectLink(url);
            return res.json({ ok: p.ok, kind: 'url', media: p.media, url, error: p.error });
        }

        res.status(400).json({ ok: false, error: 'YouTube ID ou URL requis' });
    });

    // Récupère l'IMDB ID d'un titre TMDB déjà choisi dans les résultats de recherche.
    app.get('/api/tmdb-resolve', requireAuth, async (req, res) => {
        const { id, type } = req.query;
        if (!id || !type) return res.status(400).json({ error: 'id et type requis' });
        const tmdbKey = FALLBACK_TMDB_KEY;
        if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });

        try {
            const mediaType = type === 'tv' ? 'tv' : 'movie';
            const imdbId = await getImdbId(mediaType, encodeURIComponent(id), tmdbKey);
            if (!imdbId) return res.status(404).json({ error: 'IMDB ID introuvable pour ce titre' });
            res.json({ imdbId });
        } catch (err) {
            console.error('Erreur résolution TMDB:', err.message);
            res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
        }
    });

    // ---- Statut des services (dashboard, page Logs) ----
    // Contrairement à /api/health (public, live, pour le badge de /configure), celui-ci est
    // authentifié et volontairement mis en cache 6h en base : pas besoin de re-pinguer TMDB/
    // YouTube/Allociné à chaque ouverture de la page Logs, un statut par demi-journée suffit.
    const SERVICES_STATUS_CACHE_KEY = 'system:services-status';
    const SERVICES_STATUS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

    app.get('/api/services-status', requireAuth, async (req, res) => {
        try {
            const cached = await getCached(SERVICES_STATUS_CACHE_KEY);
            if (cached && Date.now() - new Date(cached.checkedAt).getTime() < SERVICES_STATUS_TTL_MS) {
                return res.json({ ...cached, nextCheckAt: new Date(new Date(cached.checkedAt).getTime() + SERVICES_STATUS_TTL_MS).toISOString() });
            }

            const result = { ...toUpDown(await checkServices()), checkedAt: new Date().toISOString() };

            try { await setCached(SERVICES_STATUS_CACHE_KEY, result, SERVICES_STATUS_TTL_MS / 1000); }
            catch (err) { console.error('Erreur cache statut services:', err.message); }

            res.json({ ...result, nextCheckAt: new Date(Date.now() + SERVICES_STATUS_TTL_MS).toISOString() });
        } catch (err) {
            console.error('Erreur statut services:', err.message);
            res.status(502).json({ error: 'Erreur lors de la vérification des services.' });
        }
    });

    app.post('/api/login', login);

    app.get('/api/dashboard-stats', requireAuth, async (req, res) => {
        const stats = await getStats();
        res.json(stats ? { configured: true, ...stats } : { configured: false });
    });

    app.post('/api/dashboard-stats/reset', requireAuth, async (req, res) => {
        res.json({ success: await resetStats() });
    });

    // ---- Installations actives ----
    app.get('/api/install-stats', requireAuth, async (req, res) => {
        const stats = await getInstallStats();
        res.json(stats ? { configured: true, ...stats } : { configured: false });
    });

    app.post('/api/install-stats/reset', requireAuth, async (req, res) => {
        res.json({ success: await resetInstalls() });
    });

    app.delete('/api/install-stats/:id', requireAuth, async (req, res) => {
        res.json({ success: await removeInstall(req.params.id) });
    });

    // ---- AIOMetadata (onglet dédié du dashboard) ----
    app.get('/api/aiom-stats', requireAuth, async (req, res) => {
        const stats = await getAiomStats();
        if (!stats) return res.json({ configured: false });
        const behavior = await getBehaviorSettings();
        const logs = (await getLogs()).filter(l => l.context === 'AIOM').slice(0, 30);
        res.json({ configured: true, ...stats, timeoutSeconds: behavior.aiomTimeoutSeconds, recent: logs });
    });

    app.post('/api/aiom-stats/reset', requireAuth, async (req, res) => {
        res.json({ success: await resetAiomStats() });
    });

    app.get('/api/overrides', requireAuth, async (req, res) => {
        res.json(await getOverrides());
    });

    app.post('/api/overrides', requireAuth, async (req, res) => {
        const { imdbId, season, ytId, url, links, title, hidden, mediaType, notes } = req.body || {};
        const isHidden = hidden === true;
        // `links` = liste prioritaire de liens de repli [{ytId}|{url}, ...]. Si absent, on
        // construit depuis ytId/url (compat). Validation : il faut au moins un lien exploitable.
        const cleanLinks = Array.isArray(links)
            ? links.filter(l => l && (typeof l.ytId === 'string' && l.ytId.trim() || typeof l.url === 'string' && l.url.trim()))
            : [];
        const hasYt = (typeof ytId === 'string' && ytId.trim()) || cleanLinks.some(l => l.ytId);
        const hasUrl = (typeof url === 'string' && url.trim()) || cleanLinks.some(l => l.url);
        if (!imdbId || (!hasYt && !hasUrl && !isHidden)) return res.status(400).json({ error: 'imdbId et (ytId, url ou hidden) requis' });
        const ok = await setOverride({
            imdbId,
            season: season || null,
            ytId: ytId || null,
            url: ytId ? null : (url || null),
            links: cleanLinks.length ? cleanLinks.map(l => ({ ytId: l.ytId ? l.ytId.trim() : null, url: l.ytId ? null : (l.url ? l.url.trim() : null) })) : undefined,
            title: title || null,
            hidden: isHidden,
            mediaType: mediaType || null,
            notes: typeof notes === 'string' ? notes.trim() || null : null,
        });
        if (ok) await logEvent({ level: 'info', context: 'OVERRIDE', event: 'override_set', message: `Override enregistré pour ${imdbId}${isHidden ? ' (masqué)' : ''}`, meta: { imdbId, season: season || null, hidden: isHidden, links: cleanLinks.length } });
        res.json({ success: ok });
    });

    app.delete('/api/overrides', requireAuth, async (req, res) => {
        const { imdbId, season } = req.query;
        if (!imdbId) return res.status(400).json({ error: 'imdbId requis' });
        const ok = await deleteOverride(imdbId, season || null);
        if (ok) await logEvent({ level: 'info', context: 'OVERRIDE', event: 'override_deleted', message: `Override supprimé pour ${imdbId}`, meta: { imdbId, season: season || null } });
        res.json({ success: ok });
    });

    // ---- Gestion admin (dashboard, requireAuth) ----
    app.get('/api/contributions', requireAuth, async (req, res) => {
        res.json(await getContributions());
    });

    app.post('/api/contributions/:id/accept', requireAuth, async (req, res) => {
        const item = await updateContributionStatus(req.params.id, 'accepted');
        if (!item) return res.status(404).json({ error: 'Proposition introuvable' });
        const ok = await setOverride({
            imdbId: item.imdbId,
            season: item.season || null,
            ytId: item.ytId || null,
            url: item.ytId ? null : (item.url || null),
            title: item.title || null,
            hidden: false,
            mediaType: item.mediaType || null,
            notes: `Proposé par ${item.pseudo}${item.notes ? ' — ' + item.notes : ''}`,
            contributedBy: item.pseudo,
        });
        if (ok) await logEvent({ level: 'info', context: 'CONTRIB', event: 'contribution_accepted', message: `Proposition acceptée pour ${item.imdbId} (${item.pseudo}) — override créé`, meta: { imdbId: item.imdbId, pseudo: item.pseudo } });
        res.json({ success: ok });
    });

    app.post('/api/contributions/:id/reject', requireAuth, async (req, res) => {
        const item = await updateContributionStatus(req.params.id, 'rejected');
        if (!item) return res.status(404).json({ error: 'Proposition introuvable' });
        await logEvent({ level: 'info', context: 'CONTRIB', event: 'contribution_rejected', message: `Proposition refusée pour ${item.imdbId} (${item.pseudo})`, meta: { imdbId: item.imdbId, pseudo: item.pseudo } });
        res.json({ success: true });
    });

    app.delete('/api/contributions/:id', requireAuth, async (req, res) => {
        res.json({ success: await deleteContribution(req.params.id) });
    });

    app.get('/api/failed-log', requireAuth, async (req, res) => {
        res.json(await getFailedLog());
    });

    app.delete('/api/failed-log', requireAuth, async (req, res) => {
        res.json({ success: await clearFailedLog() });
    });

    // ---- Résolutions récentes (trailers trouvés automatiquement) ----
    app.get('/api/resolved-log', requireAuth, async (req, res) => {
        res.json(await getResolvedLog());
    });

    app.delete('/api/resolved-log', requireAuth, async (req, res) => {
        res.json({ success: await clearResolvedLog() });
    });

    app.get('/api/settings/configure', requireAuth, async (req, res) => {
        res.json(await getConfigureSettings());
    });

    app.post('/api/settings/configure', requireAuth, async (req, res) => {
        const ok = await setConfigureSettings(req.body || {});
        if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_configure_updated', message: 'Page configure mise à jour' });
        res.json({ success: ok });
    });

    app.post('/api/settings/configure/reset', requireAuth, async (req, res) => {
        const ok = await resetConfigureSettings();
        if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_configure_reset', message: 'Page configure réinitialisée' });
        res.json({ success: ok });
    });

    app.get('/api/settings/behavior', requireAuth, async (req, res) => {
        res.json(await getBehaviorSettings());
    });

    app.post('/api/settings/behavior', requireAuth, async (req, res) => {
        const ok = await setBehaviorSettings(req.body || {});
        if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_behavior_updated', message: 'Réglages de comportement mis à jour' });
        res.json({ success: ok });
    });

    app.post('/api/settings/behavior/reset', requireAuth, async (req, res) => {
        const ok = await resetBehaviorSettings();
        if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_behavior_reset', message: 'Réglages de comportement réinitialisés' });
        res.json({ success: ok });
    });

    // ---- Cache trailers : stats + purge manuelle (page Réglages du dashboard) ----
    app.get('/api/cache/stats', requireAuth, async (req, res) => {
        res.json(await getCacheStats());
    });

    app.delete('/api/cache', requireAuth, async (req, res) => {
        const only = req.query.only === 'failures' ? 'failures' : null;
        const ok = only ? await clearCacheFailures() : await clearAllCache();
        if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'cache_cleared', message: only ? 'Échecs du cache des bandes-annonces purgés' : 'Cache des bandes-annonces vidé manuellement' });
        res.json({ success: ok });
    });

    // Joignabilité réelle de la base SQLite (pas juste « configurée »).
    async function dbOk() {
        if (!sql) return false;
        try { await sql`SELECT 1`; return true; } catch (err) { return false; }
    }

    // État système : base joignable + clé TMDB de secours présente.
    // Utile car tout le reste de l'app est best-effort silencieux si la base est down -> sans ça,
    // aucun moyen de savoir que quelque chose déconne avant de constater des stats vides.
    app.get('/api/system-status', requireAuth, async (req, res) => {
        res.json({ db: await dbOk(), tmdbFallback: !!FALLBACK_TMDB_KEY });
    });

    // ---- Diagnostic complet (page Réglages du dashboard) ----
    // Regroupe en un appel tout ce qu'un admin veut savoir en arrivant sur la page : base
    // joignable, clé TMDB serveur présente + valide (testée), services externes joignables,
    // et état du cache. Le test de clé TMDB est volontairement fait côté serveur : on ne
    // renvoie jamais la clé elle-même, juste sa présence + les 4 derniers caractères + validité.
    app.get('/api/diagnostics', requireAuth, async (req, res) => {
        const dbReachable = await dbOk();

        const tmdbKeyLast4 = FALLBACK_TMDB_KEY ? String(FALLBACK_TMDB_KEY).slice(-4) : null;
        let tmdbKeyValid = null; // null = pas de clé, true/false sinon
        if (FALLBACK_TMDB_KEY) {
            try {
                const r = await fetchConfiguration(FALLBACK_TMDB_KEY);
                tmdbKeyValid = r.ok;
            } catch (err) {
                tmdbKeyValid = false;
            }
        }

        const [services, cache] = await Promise.all([
            checkServices(),
            getCacheStats(),
        ]);

        res.json({
            db: dbReachable,
            tmdbKey: { present: !!FALLBACK_TMDB_KEY, last4: tmdbKeyLast4, valid: tmdbKeyValid },
            services,
            cache,
        });
    });

    // Testeur admin : simule une résolution avec les réglages actuels, sans polluer cache/stats/logs.
    app.post('/api/test-resolve', requireAuth, async (req, res) => {
        try {
            const { type, imdbId, season, ignoreOverride, aiom } = req.body || {};
            if (!imdbId || !type) return res.status(400).json({ error: 'imdbId et type requis' });
            const result = await testResolve(type, imdbId.trim(), season ? String(season).trim() : null, ignoreOverride === true, aiom === true);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ---- Logs ----
    app.get('/api/logs', requireAuth, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store'); // le polling live-tail a besoin de données toujours fraîches
        res.json(await getLogs());
    });

    app.delete('/api/logs', requireAuth, async (req, res) => {
        res.json({ success: await clearLogs() });
    });
};
