// ============================================================
// ADDON STREMIO — Bandes-Annonces VF
// Application Express : assemble les routes (dossier routes/) sur les modules (dossier lib/).
// Lancée par selfhost/server.js.
//
// Configuration par utilisateur (clé TMDB perso + qualité) encodée en
// base64url dans l'URL, comme les gros addons Stremio : /<config>/manifest.json
// ============================================================

const express = require('express');

const app = express();
app.disable('x-powered-by');
// Nombre de reverse proxies de confiance : req.ip devient l'IP réelle du client, utilisée
// par la limitation de débit. 0 par défaut (accès direct) : on ne croit pas X-Forwarded-For.
app.set('trust proxy', (() => {
    const raw = process.env.TRUST_PROXY;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : false;
})());
app.use(express.json({ limit: '64kb' })); // limite les corps de requête (anti-abus)
// CORS uniquement là où Stremio en a besoin (manifest/streams/meta). Les routes /api/*
// (dashboard, contributions, tests de liens) restent même-origine : une page tierce ne
// peut donc pas les appeler ni lire leurs réponses.
const ADDON_PATH = /(^\/manifest\.json$|\/manifest\.json$|\/(stream|meta|catalog)\/)/;
app.use((req, res, next) => {
    if (ADDON_PATH.test(req.path)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            return res.status(204).end();
        }
    }
    next();
});
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // CSP : `unsafe-inline` reste nécessaire pour les scripts inline générés par les pages
    // (dashboard/configure). Les autres directives sont verrouillées ; frame-ancestors 'none'
    // empêche l'encadrement de l'interface.
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
        "media-src https: blob: data:; " +
        "frame-ancestors 'none';"
    );
    next();
});

// Express 4 n'intercepte pas les promesses rejetées des handlers `async (req, res) => ...`.
// Envelopper automatiquement l'enregistrement des routes évite qu'une erreur imprévue ne fasse
// tomber le processus Node 22 sur un `unhandledRejection`.
const wrapAsync = fn => (typeof fn !== 'function' || fn.length === 4)
    ? fn
    : function asyncRouteGuard(req, res, next) {
        try {
            const out = fn(req, res, next);
            if (out && typeof out.catch === 'function') out.catch(next);
        } catch (err) {
            next(err);
        }
    };
for (const method of ['get', 'post', 'put', 'delete']) {
    const orig = app[method].bind(app);
    app[method] = (routePath, ...handlers) => orig(routePath, ...handlers.map(wrapAsync));
}

require('../routes/stremio')(app);
require('../routes/pages')(app);
require('../routes/public')(app);
require('../routes/dashboard')(app);

// ---- Gestion d'erreurs globales ----
// Toutes les routes renvoient du JSON : les erreurs (body trop gros, JSON invalide...)
// doivent aussi être du JSON propre, sans stack trace leakée au client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
        res.status(413).json({ error: 'Payload too large' });
        return;
    }
    res.status((err && err.statusCode) || 500).json({
        // Ne jamais exposer le détail d'une erreur interne au client.
        error: err && err.statusCode ? err.message : 'Internal Server Error',
    });
});

module.exports = app;
