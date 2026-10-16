// Cache générique clé/valeur avec expiration, utilisé pour éviter de
// refaire les appels TMDB/Allociné à chaque requête sur un même titre.
// Version Postgres : contrairement à Redis, une entrée expirée n'est pas
// auto-supprimée -- elle est juste ignorée au moment de la lecture (filtrée
// par expires_at). Ça ne coûte que du stockage, jamais de commandes
// facturées comme chez Upstash, donc pas de purge urgente à prévoir.

const sql = require('./db');

async function getCached(key) {
    if (!sql) return null;
    try {
        const rows = await sql`
            SELECT value FROM kv_cache WHERE cache_key = ${key} AND expires_at > now()
        `;
        return rows.length ? rows[0].value : null;
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
            VALUES (${key}, ${JSON.stringify(value)}::jsonb, now() + (${ttlSeconds} || ' seconds')::interval)
            ON CONFLICT (cache_key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
        `;
    } catch (err) {
        console.error('Erreur écriture cache:', err.message);
    }
}

// ---- Stats + purge (boutons du dashboard, page Réglages) ----
// Toutes les entrées de cache trailer partagent le préfixe cache:trailers: (voir index.js).
// Une entrée est un SUCCÈS si elle a des streams, sinon un ÉCHEC (rien trouvé) -- on lit les
// valeurs pour la répartition, utile au dashboard ("vider uniquement les échecs"). On ne
// compte que les entrées encore valides (expires_at > now()) : une entrée expirée n'existe
// déjà plus fonctionnellement, même si la ligne traîne encore en base.
async function getCacheStats() {
    if (!sql) return { count: 0, success: 0, failures: 0 };
    try {
        const rows = await sql`
            SELECT value FROM kv_cache
            WHERE cache_key LIKE 'cache:trailers:%' AND expires_at > now()
        `;
        let success = 0;
        let failures = 0;
        for (const row of rows) {
            const v = row.value;
            if (v && Array.isArray(v.streams) && v.streams.length > 0) success++;
            else failures++;
        }
        return { count: rows.length, success, failures };
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
              AND NOT (jsonb_array_length(COALESCE(value->'streams', '[]'::jsonb)) > 0)
        `;
        return true;
    } catch (err) {
        console.error('Erreur purge échecs cache:', err.message);
        return false;
    }
}

module.exports = { getCached, setCached, getCacheStats, clearAllCache, clearCacheFailures };