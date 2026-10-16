// Client Postgres (Neon, driver HTTP officiel — pas de pool de connexions à gérer,
// pensé pour le serverless, exactement comme redis.js l'était pour Upstash).
// Un seul point de configuration -> tous les autres modules l'importent.
// Si DATABASE_URL n'est pas définie, `sql` reste null : chaque module qui
// l'utilise doit gérer ce cas en no-op silencieux (jamais bloquer l'addon),
// exactement le même contrat que l'ancien lib/redis.js.

const { neon } = require('@neondatabase/serverless');

let sql = null;
if (process.env.DATABASE_URL) {
    sql = neon(process.env.DATABASE_URL);
} else {
    console.error('DATABASE_URL non configurée — le stockage Postgres est désactivé.');
}

module.exports = sql;
