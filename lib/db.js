// Client SQL partagé. Un seul point de configuration : tous les autres modules
// l'importent et l'utilisent comme un « tagged template » :
//     const rows = await sql`SELECT * FROM overrides WHERE imdb_id = ${id}`;
//
// Base SQLite intégrée à Node (module `node:sqlite`, aucune dépendance à installer),
// stockée dans DATA_DIR/addon.sqlite (par défaut /data : monte un volume sur /data pour
// que réglages, mapping et stats survivent aux redéploiements).
//
// Les valeurs ${...} sont envoyées comme paramètres : jamais concaténées dans la requête
// (pas d'injection SQL possible). Conversions automatiques :
//   • booléen  -> 0 / 1          • undefined -> NULL
//   • tableau  -> liste de paramètres, pour  `WHERE x IN (${tableau})`
// Les colonnes JSON (jsonb avant) sont du texte : JSON.stringify à l'écriture, JSON.parse à la lecture.
//
// La base n'est ouverte qu'au premier usage (importer ce module n'a aucun effet de bord).

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

let db = null;
const statements = new Map(); // texte SQL -> requête préparée
const MAX_STATEMENTS = 300;

function dataDir() {
    if (process.env.DATA_DIR) return process.env.DATA_DIR;
    return fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data');
}

function open() {
    if (db) return db;
    const dir = path.resolve(dataDir());
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'addon.sqlite');
    db = new DatabaseSync(file);
    // WAL : lectures et écriture sans se bloquer, peu d'écritures disque (synchronous=NORMAL est sûr en WAL).
    // Petit cache (2 Mo) et fichier WAL borné : l'addon reste léger en mémoire et sur le disque.
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA cache_size = -2000;
        PRAGMA journal_size_limit = 4194304;
    `);
    console.log(`Base SQLite : ${file}`);
    return db;
}

function toParam(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
}

const returnsRows = text => /^\s*(select|with|pragma)\b/i.test(text) || /\breturning\b/i.test(text);

function run(text, params) {
    let stmt = statements.get(text);
    if (!stmt) {
        if (statements.size >= MAX_STATEMENTS) statements.clear();
        stmt = open().prepare(text);
        statements.set(text, stmt);
    }
    if (returnsRows(text)) return stmt.all(...params);
    stmt.run(...params);
    return [];
}

// sql`... ${valeur} ...` -> Promise<tableau de lignes> (vide pour un INSERT/UPDATE/DELETE sans RETURNING).
function sql(strings, ...values) {
    try {
        let text = strings[0];
        const params = [];
        values.forEach((v, i) => {
            if (Array.isArray(v)) {
                text += v.map(() => '?').join(',');
                v.forEach(x => params.push(toParam(x)));
            } else {
                text += '?';
                params.push(toParam(v));
            }
            text += strings[i + 1];
        });
        return Promise.resolve(run(text, params));
    } catch (err) {
        return Promise.reject(err);
    }
}

// Date/heure courante au format stocké en base (ISO 8601 UTC, triable comme du texte).
sql.nowIso = () => new Date().toISOString();
// Script SQL multi-instructions (schema.sql).
sql.exec = text => open().exec(text);
sql.close = () => {
    if (!db) return;
    statements.clear();
    db.close();
    db = null;
};
sql.mode = 'sqlite';

module.exports = sql;
