// Client SQL partagé. Un seul point de configuration : tous les autres modules
// l'importent et l'utilisent comme un « tagged template » :
//     const rows = await sql`SELECT * FROM overrides WHERE imdb_id = ${id}`;
//
// Les valeurs ${...} sont envoyées comme paramètres ($1, $2...) : jamais
// concaténées dans la requête (pas d'injection SQL possible).
//
// Deux modes, même dialecte SQL (Postgres) :
//   • DATABASE_URL définie  -> Postgres externe (ou celui du docker-compose)
//   • sinon                 -> Postgres embarqué (PGlite) stocké dans DATA_DIR/pgdata
//                              (par défaut /data/pgdata : monte un volume sur /data pour
//                              que réglages, mapping et stats survivent aux redéploiements)

const path = require('path');
const fs = require('fs');

const url = process.env.DATABASE_URL;

let sql = null;
let mode = 'postgres';

function makeTag(query) {
    // sql`... ${valeur} ...` -> tableau de lignes.
    return function sql(strings, ...values) {
        let text = strings[0];
        for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
        return query(text, values).then(r => r.rows);
    };
}

if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: url,
        max: Number(process.env.DATABASE_POOL_MAX) || 5,
        // DATABASE_SSL=true pour un Postgres distant qui impose le SSL (inutile avec le docker-compose fourni).
        ssl: /^(1|true|require)$/i.test(process.env.DATABASE_SSL || '') ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', err => console.error('Erreur pool Postgres:', err.message));
    sql = makeTag((text, values) => pool.query(text, values));
    sql.pool = pool; // utilisé par lib/migrate.js (script multi-instructions)
} else if (/^(0|false|off)$/i.test(process.env.DATABASE_EMBEDDED || '')) {
    console.error('DATABASE_URL non configurée et DATABASE_EMBEDDED=0 — le stockage est désactivé.');
} else {
    const { PGlite } = require('@electric-sql/pglite');
    mode = 'embedded';
    const dir = path.resolve(process.env.DATA_DIR || '/data', 'pgdata');
    fs.mkdirSync(dir, { recursive: true });
    // Comme le driver `pg`, renvoie les bigint (OID 20) en chaîne : le reste du code est écrit pour ça.
    const db = new PGlite(dir, { parsers: { 20: v => v } });
    const pool = {
        // Sans paramètres : script éventuellement multi-instructions (schema.sql) -> exec.
        query: (text, values) => (values === undefined
            ? db.exec(text).then(res => res[res.length - 1] || { rows: [] })
            : db.query(text, values)),
        end: () => db.close(),
    };
    sql = makeTag(pool.query);
    sql.pool = pool;
    sql.close = pool.end;
    console.log(`Base embarquée (PGlite) : ${dir}`);
}

sql && (sql.mode = mode);
module.exports = sql;
