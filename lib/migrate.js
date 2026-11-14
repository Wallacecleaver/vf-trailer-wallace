// Applique schema.sql au démarrage. Idempotent : les CREATE ... IF NOT EXISTS ne font rien si la table existe déjà,
// donc une colonne ajoutée plus tard à une table existante passe par MIGRATIONS (SQLite n'a pas
// « ADD COLUMN IF NOT EXISTS » : on regarde d'abord si la colonne est là).

const fs = require('fs');
const path = require('path');
const sql = require('./db');

// [table, colonne, définition] — à ajouter ici quand schema.sql gagne une colonne sur une table déjà déployée.
const MIGRATIONS = [];

// Index sur des colonnes ajoutées par migration : à créer APRÈS elles (sinon échec sur une base déjà déployée).
const POST_MIGRATION_INDEXES = [];

async function applyMigrations() {
    for (const [table, column, definition] of MIGRATIONS) {
        const pragma = `PRAGMA table_info(${table})`; // noms fixes ci-dessus : aucune valeur venant d'un utilisateur
        const columns = await sql([pragma]);
        if (columns.length && !columns.some(c => c.name === column)) {
            sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    }
    for (const stmt of POST_MIGRATION_INDEXES) sql.exec(stmt);
}

async function ensureSchema() {
    const script = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    sql.exec(script);
    await applyMigrations();
    return true;
}

module.exports = { ensureSchema };
