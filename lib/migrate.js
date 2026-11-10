// Applique schema.sql au démarrage. Idempotent : uniquement des
// CREATE ... IF NOT EXISTS, donc sans danger à chaque redémarrage.

const fs = require('fs');
const path = require('path');
const sql = require('./db');

async function ensureSchema() {
    const script = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    sql.exec(script);
    return true;
}

module.exports = { ensureSchema };
