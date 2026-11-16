// Pages HTML publiques : racine, /configure, /dashboard, /proposer, favicon.

const { renderDashboardShell } = require('../lib/dashboard-view');
const { renderConfigureHtml } = require('../lib/configure-view');
const { renderContributeHtml } = require('../lib/contribute-view');
const { getConfigureSettings } = require('../lib/settings');
const { requireAuth } = require('../lib/auth');
const { DISPLAY_MODES } = require('../lib/stream-format');
const { resolvePreview } = require('../lib/preview');
const { rateLimit } = require('../lib/security');

module.exports = function registerPageRoutes(app) {
    // Favicon embarqué en base64 -> évite les 404
    // répétés que les navigateurs génèrent automatiquement en demandant /favicon.ico.
    const FAVICON_BUFFER = Buffer.from('AAABAAEAEBAAAAAAIABCAwAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAwlJREFUeJwt0r1rnXUUwPHvOc/Lfe5b0mtMMqR0uIJm0aVEhDoIxloMYqtdXKSBdAxk6KC7Ujchq6tEK8WioFYJviSRtNRCW6cKaZNKjCSNuUnuW+5zf+c41C98/oOvAIyOjpZ7ve5HZrwr7k8HXLruEtwBiETIRDxCzEX+jqLo093d3Q9FBBkaGqrmIf9GXF4Rd5pmVFWpJwk1VRxomPGgn3MYjIoqLqAqC5OTp9+TWm1w3oxZ3PO2W3wqK8p4krDd77NnhuPUNGIkjvkzz1npdrwkGhBi1egDGRio7iky0HSTs6WypCIstlt0DFQEAYIbRRUmS2V6wNetppdEHWFHFTnWNNOXs6KkIlw9OCRCGVClJEJRhAGNiFCuHhyQAqeyorTMVNxHNeBUVRlPEhZbbYYLKWaBIBAsPCGOWWC4UGCx1WY8SahGSgCPu+68kKbsAjutJp9cvswzzz3L2bPnuHbtK9K0wNTUFF9eucI/m5vMXrrE42qFepxwr3ckGhxqUcS/5mDG+vpDJk+/Tv34GCcnXuTkxAT1sTFeO3OGRxsbmBkNM2qREhxi/s+CUUhSfltaotvtMj1zkVs3byAIF2ZmCCGwsvQrhTjBzNAni6CRwF4I1FRIs4xH6+v8tbHB7Nwcv6+usrq8zOzcHFubmzxcWyPNChwToWFGJKCZKA/ynJE4ohzHHLTa3Lx9G6tUuL60xPeLi1CtcuvOHRoHh5STmJEoYi3PyUSJI+DQjPt5j1ezjM+yjOvz8wz//Avn+4YeP85PF6b59t5d2lmBc1mR+3nOoTsVEWKDZkW1tNLpyDuVWN48VmO6e8TU6AhvnX8byhVYWKCQ53QGawSc5U7HSyLuQjtW1c/d/WIRza81m8nzacqPR0dU7twl3WsQtrfpP97hh17OVt7jj7xHNUn6UaRJv59/ISdOnKjtH+x/h/MS7nTcCe6kZgyFgMQxuyIcuROpkgFpoUCSJDe2trbeEIB6vT7YaDQ+NgvncX9KHDUR+gI4xO6oCO5uqOwBVxuN/feBxn+BdHdInbz8WwAAAABJRU5ErkJggg==', 'base64');
    app.get('/favicon.ico', (req, res) => {
        res.setHeader('Content-Type', 'image/x-icon');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        res.send(FAVICON_BUFFER);
    });

    // Racine du site : redirection vers la page de configuration.
    app.get('/', (req, res) => {
        res.redirect(302, '/configure');
    });

    app.get(['/configure', '/:config/configure'], async (req, res) => {
        const settings = await getConfigureSettings();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderConfigureHtml(settings));
    });

    // Recherche réelle, en lecture seule. GET reste accepté pour les pages déjà ouvertes.
    const previewLimit = rateLimit({ windowMs: 60_000, max: 30, name: 'preview' });
    async function preview(req, res) {
        const q = (req.method === 'POST' ? req.body : req.query) || {};
        res.setHeader('Cache-Control', 'no-store');
        const tmdbId = Number(q.tmdbId);
        if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !['movie', 'tv'].includes(q.type)) {
            return res.status(400).json({ error: 'Choisis un film ou une série pour afficher ses bandes-annonces.' });
        }
        const n = Number(q.maxLinks);
        const config = {
            display: DISPLAY_MODES.includes(q.display) ? q.display : 'default',
            externalOnly: q.externalOnly === true || q.externalOnly === '1',
            maxLinks: Number.isInteger(n) && n > 0 && n <= 10 ? n : null,
            aiom: q.aiom === true || q.aiom === '1',
        };
        if (q.includeExtras === true || q.includeExtras === 'on') config.includeExtras = true;
        else if (q.includeExtras === false || q.includeExtras === 'off') config.includeExtras = false;
        try {
            const result = await resolvePreview(q.type, tmdbId, config);
            // Seuls les textes de l'aperçu sont publics : aucune trace ni clé de connexion.
            res.json({ source: result.source, message: result.message,
                streams: result.streams.map(s => ({ name: s.name, title: s.title })) });
        } catch {
            res.status(502).json({ error: 'Impossible de charger les bandes-annonces pour le moment. Réessaie.' });
        }
    }
    app.get('/api/preview-streams', previewLimit, preview);
    app.post('/api/preview-streams', previewLimit, preview);

    // Aperçu en direct pour le dashboard : rend /configure à partir du payload en cours
    // d'édition (non encore enregistré), pour que l'admin voie le résultat sans quitter la page.
    app.post('/api/configure-preview', requireAuth, async (req, res) => {
        const body = req.body || {};
        const current = await getConfigureSettings();
        const merged = { ...current };
        ['brandName','navLinkText','navLinkUrl','heroTitleWhite','heroTitleRed','heroSubtitle',
         'accentColor','sectionConfigLabel','sectionProfileLabel','sectionLinksLabel','tmdbKeyHint','pseudoHint',
         'externalToggleTitle','externalToggleDesc','maxLinksLabel','maxLinksHint','extrasSelectLabel','extrasSelectHint',
         'installAppLabel','installWebLabel','installCopyLabel']
            .forEach(f => { if (typeof body[f] === 'string') merged[f] = body[f]; });
        res.setHeader('Content-Type', 'application/json');
        res.json({ html: renderConfigureHtml(merged) });
    });

    // ---- Dashboard ----
    app.get('/dashboard', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderDashboardShell());
    });

    // Page HTML publique de proposition (recherche de titre + lien).
    app.get('/proposer', async (req, res) => {
        const settings = await getConfigureSettings();
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(renderContributeHtml(settings));
    });
};
