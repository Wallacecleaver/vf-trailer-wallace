// Applique schema.sql au démarrage (self-host). Idempotent : uniquement des
// CREATE ... IF NOT EXISTS, donc sans danger à chaque redémarrage.
// Ne fait rien avec Neon/Vercel (driver HTTP = une instruction à la fois) :
// là-bas, colle schema.sql une fois dans l'éditeur SQL de Neon.

const fs = require('fs');
const path = require('path');
const sql = require('./db');

async function ensureSchema() {
    if (!sql || !sql.pool) return false;
    const script = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await sql.pool.query(script);
    return true;
}

module.exports = { ensureSchema };
