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
        if (process.env.DASHBOARD_PASSWORD) require('../lib/session-secret').getTokenSecret();
    } catch (err) {
        console.error('Impossible de préparer la base ou la clé de session persistante :', err.message);
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

    const server = app.listen(PORT, HOST, () => {
        console.log(`Addon démarré sur http://${HOST}:${PORT}`);
        if (!process.env.DASHBOARD_PASSWORD) console.warn('⚠️  Connexion au dashboard désactivée : définis un DASHBOARD_PASSWORD non vide.');
        if (!process.env.APP_BASE_URL) console.warn('⚠️  APP_BASE_URL non défini : les liens/logo pointeront vers http://localhost.');
    });

    // Arrêt propre : ferme la base SQLite (le journal WAL est alors intégré au fichier principal),
    // sans bloquer indéfiniment sur des connexions keep-alive ouvertes (dashboard live-tail, etc.).
    let stopping = false;
    const finalize = () => {
        try { sql.close(); } catch { /* rien à faire */ }
        process.exit(0);
    };
    const stop = () => {
        if (stopping) return;
        stopping = true;
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
        setTimeout(() => {
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            finalize();
        }, 5000).unref();
        server.close(finalize);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

main();
