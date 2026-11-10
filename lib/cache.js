// Cache générique clé/valeur avec expiration, utilisé pour éviter de
// refaire les appels TMDB/Allociné à chaque requête sur un même titre.
// Stocké dans SQLite : une entrée expirée est ignorée à la lecture (filtrée
// par expires_at, en millisecondes) et purgée périodiquement par selfhost/server.js.

const sql = require('./db');

async function getCached(key) {
    if (!sql) return null;
    try {
        const rows = await sql`
            SELECT value FROM kv_cache WHERE cache_key = ${key} AND expires_at > ${Date.now()}
        `;
        return rows.length ? JSON.parse(rows[0].value) : null;
    } catch (err) {
        console.error('Erreur lecture cache:', err.message);
        return null;
    }
}

async function setCached(key, value, ttlSeconds) {
    if (!sql) return;
    try {
        await sql`
            INSERT INTO kv_cache (cache_key, value, expires_at)
            VALUES (${key}, ${JSON.stringify(value)}, ${Date.now() + ttlSeconds * 1000})
            ON CONFLICT (cache_key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
        `;
    } catch (err) {
        console.error('Erreur écriture cache:', err.message);
    }
}

// ---- Stats + purge (boutons du dashboard, page Réglages) ----
// Toutes les entrées de cache trailer partagent le préfixe cache:trailers: (voir index.js).
// Une entrée est un SUCCÈS si elle a des streams, sinon un ÉCHEC (rien trouvé) -- le comptage
// se fait directement en SQL, utile au dashboard ("vider uniquement les échecs"). On ne
// compte que les entrées encore valides (expires_at > maintenant) : une entrée expirée n'existe
// déjà plus fonctionnellement, même si la ligne traîne encore en base.
async function getCacheStats() {
    if (!sql) return { count: 0, success: 0, failures: 0 };
    try {
        const rows = await sql`
            SELECT COUNT(*) AS count,
                   SUM(CASE WHEN COALESCE(json_array_length(json_extract(value, '$.streams')), 0) > 0 THEN 1 ELSE 0 END) AS success
            FROM kv_cache
            WHERE cache_key LIKE 'cache:trailers:%' AND expires_at > ${Date.now()}
        `;
        const count = Number(rows[0]?.count) || 0;
        const success = Number(rows[0]?.success) || 0;
        return { count, success, failures: count - success };
    } catch (err) {
        console.error('Erreur stats cache:', err.message);
        return { count: 0, success: 0, failures: 0 };
    }
}

async function clearAllCache() {
    if (!sql) return false;
    try {
        await sql`DELETE FROM kv_cache WHERE cache_key LIKE 'cache:trailers:%'`;
        return true;
    } catch (err) {
        console.error('Erreur purge cache:', err.message);
        return false;
    }
}

// Purge ciblée : ne supprime que les entrées d'ÉCHEC (streams vides). Pratique après un
// fix d'override ou de scraping : on garde les succès encore valides, on re-teste les échecs.
async function clearCacheFailures() {
    if (!sql) return false;
    try {
        await sql`
            DELETE FROM kv_cache
            WHERE cache_key LIKE 'cache:trailers:%'
              AND COALESCE(json_array_length(json_extract(value, '$.streams')), 0) = 0
        `;
        return true;
    } catch (err) {
        console.error('Erreur purge échecs cache:', err.message);
        return false;
    }
}

module.exports = { getCached, setCached, getCacheStats, clearAllCache, clearCacheFailures };
