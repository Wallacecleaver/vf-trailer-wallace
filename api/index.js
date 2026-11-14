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
app.use(express.json({ limit: '64kb' })); // limite les corps de requête (anti-abus)
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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

require('../routes/stremio')(app);
require('../routes/pages')(app);
require('../routes/public')(app);
require('../routes/dashboard')(app);

// ---- Gestion d'erreurs globales ----
// Toutes les routes renvoient du JSON : les erreurs (body trop gros, JSON invalide...)
// doivent aussi être du JSON propre, sans stack trace leakée au client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err instanceof SyntaxError)) {
        res.status(413).json({ error: 'Payload too large' });
        return;
    }
    res.status(err && err.statusCode || 500).json({ error: err && err.message || 'Internal Server Error' });
});

module.exports = app;
