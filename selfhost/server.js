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
    // Réessaie quelques fois : au premier démarrage, Postgres peut mettre quelques secondes à être prêt.
    for (let attempt = 1; attempt <= 15; attempt++) {
        try {
            if (await ensureSchema()) console.log('Base de données prête (schema.sql appliqué).');
            break;
        } catch (err) {
            if (attempt === 15) {
                console.error('Impossible d’appliquer schema.sql :', err.message);
                process.exit(1);
            }
            console.log(`Postgres pas encore prêt (${err.message}) — nouvel essai dans 2 s (${attempt}/15)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Purge des entrées de cache expirées (une entrée expirée est ignorée à la lecture mais reste en base) :
    // un petit DELETE toutes les 6 h garde la base légère.
    const sql = require('../lib/db');
    const purge = () => sql`DELETE FROM kv_cache WHERE expires_at < now()`
        .catch(err => console.error('Purge du cache expiré impossible :', err.message));
    if (sql) {
        purge();
        setInterval(purge, 6 * 60 * 60 * 1000).unref();
    }

    const server = app.listen(PORT, HOST, () => {
        console.log(`Addon démarré sur http://${HOST}:${PORT}`);
        if (!process.env.DASHBOARD_PASSWORD) console.warn('⚠️  DASHBOARD_PASSWORD non défini : le dashboard sera inaccessible.');
        if (!process.env.APP_BASE_URL) console.warn('⚠️  APP_BASE_URL non défini : les liens/logo pointeront vers le domaine par défaut.');
    });

    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

main();
