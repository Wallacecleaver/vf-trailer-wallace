// Applique schema.sql au démarrage. Idempotent : les CREATE ... IF NOT EXISTS ne font rien si la table existe déjà,
// donc une colonne ajoutée plus tard à une table existante passe par MIGRATIONS (SQLite n'a pas
// « ADD COLUMN IF NOT EXISTS » : on regarde d'abord si la colonne est là).

const fs = require('fs');
const path = require('path');
const sql = require('./db');

// [table, colonne, définition] — à ajouter ici quand schema.sql gagne une colonne sur une table déjà déployée.
const MIGRATIONS = [
    ['netflix_tmdb_seen', 'imdb_checked_at', 'TEXT'],
    ['netflix_titles', 'crawl_status', 'TEXT'],
    ['netflix_titles', 'crawl_attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['netflix_titles', 'crawled_at', 'TEXT'],
    ['netflix_titles', 'discovered_from', 'TEXT'],
    ['netflix_titles', 'has_trailer', 'INTEGER'],
    ['netflix_titles', 'link_status', 'TEXT'],
    ['netflix_titles', 'served_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['netflix_titles', 'played_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['netflix_titles', 'last_served_at', 'TEXT'],
];

// Index sur des colonnes ajoutées par migration : à créer APRÈS elles (sinon échec sur une base déjà déployée).
const POST_MIGRATION_INDEXES = [
    'CREATE INDEX IF NOT EXISTS netflix_titles_crawl_idx ON netflix_titles (crawl_status, crawl_attempts)',
    'CREATE INDEX IF NOT EXISTS netflix_titles_trailer_idx ON netflix_titles (has_trailer, link_status)',
];

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
