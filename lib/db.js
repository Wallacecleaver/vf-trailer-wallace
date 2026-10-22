// Client Postgres partagé. Un seul point de configuration : tous les autres
// modules l'importent et l'utilisent comme un « tagged template » :
//     const rows = await sql`SELECT * FROM overrides WHERE imdb_id = ${id}`;
//
// Les valeurs ${...} sont envoyées comme paramètres ($1, $2...) : jamais
// concaténées dans la requête (pas d'injection SQL possible).
//
// Si DATABASE_URL n'est pas définie, `sql` reste null : chaque module qui
// l'utilise gère ce cas en no-op silencieux (jamais bloquer l'addon).

const url = process.env.DATABASE_URL;

let sql = null;

if (!url) {
    console.error('DATABASE_URL non configurée — le stockage Postgres est désactivé.');
} else {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: url,
        max: Number(process.env.DATABASE_POOL_MAX) || 5,
        // DATABASE_SSL=true pour un Postgres distant qui impose le SSL (inutile avec le docker-compose fourni).
        ssl: /^(1|true|require)$/i.test(process.env.DATABASE_SSL || '') ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', err => console.error('Erreur pool Postgres:', err.message));

    // sql`... ${valeur} ...` -> tableau de lignes.
    sql = function sql(strings, ...values) {
        let text = strings[0];
        for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
        return pool.query(text, values).then(r => r.rows);
    };
    sql.pool = pool; // utilisé par lib/migrate.js (script multi-instructions)
}

module.exports = sql;
