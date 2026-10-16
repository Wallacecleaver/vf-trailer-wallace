// ============================================================
// LOGS — journal d'événements applicatifs, stocké dans Postgres.
// Version Postgres : une vraie table plutôt qu'une liste Redis (LPUSH/LTRIM),
// bornée à ~500 lignes de la même façon. Mêmes exports que l'ancienne version.
// ============================================================

const sql = require('./db');

const MAX_LOGS = 500; // 200 avant : les requêtes AIOMetadata (contexte AIOM) remplissent plus vite le journal

function rowToEntry(row) {
    return {
        level: row.level,
        context: row.context,
        event: row.event,
        message: row.message,
        meta: row.meta,
        time: row.created_at,
        timestamp: new Date(row.created_at).getTime(),
    };
}

// level: 'info' | 'warn' | 'error'
// context: catégorie fonctionnelle pour le filtrage dashboard (AUTH, STREAM, OVERRIDE, SETTINGS, SYSTEM...)
async function logEvent({ level = 'info', context = 'SYSTEM', event, message, meta }) {
    if (!sql) return; // Postgres pas configuré -> no-op silencieux

    try {
        await sql`
            INSERT INTO event_logs (level, context, event, message, meta)
            VALUES (${level}, ${context}, ${event || 'generic'}, ${message || ''}, ${meta ? JSON.stringify(meta) : null}::jsonb)
        `;
        // Garde la table bornée à MAX_LOGS lignes, comme le LTRIM Redis d'origine.
        // Fait à chaque écriture pour préserver exactement le même comportement
        // (jamais plus de 200 lignes) -- si ça devient coûteux à volume élevé,
        // ça peut être déplacé vers un nettoyage périodique plutôt qu'à chaque insert.
        // Purge sur ~1 insert sur 10 seulement : avec le trafic AIOMetadata, une purge à chaque
        // écriture doublait le nombre de requêtes Postgres. getLogs() est de toute façon borné par
        // LIMIT, la table peut donc dépasser MAX_LOGS de quelques dizaines de lignes sans effet visible.
        if (Math.random() < 0.1) {
            await sql`
                DELETE FROM event_logs WHERE id NOT IN (
                    SELECT id FROM event_logs ORDER BY created_at DESC LIMIT ${MAX_LOGS}
                )
            `;
        }
    } catch (err) {
        // On ne log jamais une erreur de logging dans le journal lui-même
        // (risque de boucle), juste en console.
        console.error('Erreur écriture log:', err.message);
    }
}

async function getLogs() {
    if (!sql) return [];
    try {
        const rows = await sql`SELECT * FROM event_logs ORDER BY created_at DESC LIMIT ${MAX_LOGS}`;
        return rows.map(rowToEntry);
    } catch (err) {
        console.error('Erreur lecture logs:', err.message);
        return [];
    }
}

async function clearLogs() {
    if (!sql) return false;
    try {
        await sql`DELETE FROM event_logs`;
        return true;
    } catch (err) {
        console.error('Erreur purge logs:', err.message);
        return false;
    }
}

module.exports = { logEvent, getLogs, clearLogs };