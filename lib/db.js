// Client Postgres partagé. Un seul point de configuration -> tous les autres
// modules l'importent et l'utilisent comme un « tagged template » :
//     const rows = await sql`SELECT * FROM overrides WHERE imdb_id = ${id}`;
//
// Deux modes, choisis automatiquement d'après DATABASE_URL :
//   • Neon (hébergé, Vercel)  -> driver HTTP @neondatabase/serverless
//   • Postgres classique (self-host, Docker, VPS) -> driver `pg` avec un pool
// Forçable avec DB_DRIVER=neon ou DB_DRIVER=pg.
//
// Si DATABASE_URL n'est pas définie, `sql` reste null : chaque module qui
// l'utilise gère ce cas en no-op silencieux (jamais bloquer l'addon).

const url = process.env.DATABASE_URL;

function pickDriver() {
    const forced = (process.env.DB_DRIVER || '').toLowerCase();
    if (forced === 'neon' || forced === 'pg') return forced;
    try {
        return new URL(url).hostname.endsWith('neon.tech') ? 'neon' : 'pg';
    } catch {
        return 'pg';
    }
}

let sql = null;

if (!url) {
    console.error('DATABASE_URL non configurée — le stockage Postgres est désactivé.');
} else if (pickDriver() === 'neon') {
    const { neon } = require('@neondatabase/serverless');
    sql = neon(url);
} else {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: url,
        max: Number(process.env.DATABASE_POOL_MAX) || 10,
        // DATABASE_SSL=true pour un Postgres distant qui impose le SSL (pas utile avec le docker-compose fourni).
        ssl: /^(1|true|require)$/i.test(process.env.DATABASE_SSL || '') ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', err => console.error('Erreur pool Postgres:', err.message));

    // Même contrat que neon() : sql`... ${valeur} ...` -> tableau de lignes.
    sql = function sql(strings, ...values) {
        let text = strings[0];
        for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
        return pool.query(text, values).then(r => r.rows);
    };
    sql.pool = pool; // utilisé par lib/migrate.js (script multi-instructions)
}

module.exports = sql;
