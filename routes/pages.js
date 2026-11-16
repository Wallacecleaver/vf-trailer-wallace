// Pages HTML publiques : racine, /configure, /dashboard, /proposer, favicon.

const { renderDashboardShell } = require('../lib/dashboard-view');
const { renderConfigureHtml } = require('../lib/configure-view');
const { renderContributeHtml } = require('../lib/contribute-view');
const { getConfigureSettings } = require('../lib/settings');
const { getMaintenanceSettings } = require('../lib/maintenance');
const { renderMaintenancePage } = require('../lib/maintenance-view');
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

    app.get(['/configure', '/:config/configure'], async (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const [settings, maintenance] = await Promise.all([getConfigureSettings(), getMaintenanceSettings()]);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            if (maintenance.enabled && maintenance.blockInstall) {
                res.setHeader('Retry-After', '300');
                return res.status(503).send(renderMaintenancePage(settings, maintenance));
            }
            res.send(renderConfigureHtml(settings, maintenance));
        } catch (error) { next(error); }
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
