// Point d'entrée de l'addon (Docker, VPS, Raspberry...) : applique schema.sql,
// puis écoute sur PORT.

const path = require('path');
const express = require('express');
const addon = require('../api/index');
const { ensureSchema } = require('../lib/migrate');

// Sert le dossier public/ (logo...).
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
app.use(addon);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
    // La base SQLite est locale : si elle ne s'ouvre pas (dossier de données absent ou non inscriptible), on s'arrête.
    try {
        if (await ensureSchema()) console.log('Base de données prête (schema.sql appliqué).');
    } catch (err) {
        console.error('Impossible d’ouvrir la base ni d’appliquer schema.sql :', err.message);
        console.error('Vérifie que DATA_DIR est accessible en écriture (volume monté sur /data avec Docker).');
        process.exit(1);
    }

    // Purge des entrées de cache expirées (une entrée expirée est ignorée à la lecture mais reste en base) :
    // un petit DELETE toutes les 6 h garde la base légère.
    const sql = require('../lib/db');
    const purge = () => sql`DELETE FROM kv_cache WHERE expires_at < ${Date.now()}`
        .catch(err => console.error('Purge du cache expiré impossible :', err.message));
    purge();
    setInterval(purge, 6 * 60 * 60 * 1000).unref();

    // Catalogue Netflix (ID Netflix <-> TMDB <-> IMDB) : synchro Wikidata + TMDB toutes les 6 h (NETFLIX_CATALOG_SYNC=0 pour couper).
    require('../lib/netflix-catalog').startScheduler();

    const server = app.listen(PORT, HOST, () => {
        console.log(`Addon démarré sur http://${HOST}:${PORT}`);
        if (!process.env.DASHBOARD_PASSWORD) console.warn('⚠️  DASHBOARD_PASSWORD non défini : le dashboard sera inaccessible.');
        if (!process.env.APP_BASE_URL) console.warn('⚠️  APP_BASE_URL non défini : les liens/logo pointeront vers http://localhost.');
    });

    // Arrêt propre : ferme la base SQLite (le journal WAL est alors intégré au fichier principal).
    const stop = () => server.close(() => {
        try { sql.close(); } catch { /* rien à faire */ }
        process.exit(0);
    });
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

main();
