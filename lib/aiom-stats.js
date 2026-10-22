// ============================================================
// AIOMETADATA — compteurs des requêtes reçues en mode "A trailer addon".
// Le journal (event_logs) dédoublonne et ne garde que ~500 lignes : impossible d'y lire des
// totaux fiables. Ici, une ligne par (jour, résultat) incrémentée à CHAQUE requête.
// Résultats : ytId | url | aucun | timeout | masque
// ============================================================

// La table `aiom_stats` est définie dans schema.sql.

const sql = require('./db');

const OUTCOMES = ['ytId', 'url', 'aucun', 'timeout', 'masque'];

async function recordAiomStat({ outcome, fromCache, ms }) {
    if (!sql || !OUTCOMES.includes(outcome)) return false;
    try {
        const day = new Date().toISOString().slice(0, 10);
        await sql`
            INSERT INTO aiom_stats (day, outcome, count, cache_hits, total_ms)
            VALUES (${day}, ${outcome}, 1, ${fromCache ? 1 : 0}, ${Math.max(0, Math.round(ms) || 0)})
            ON CONFLICT (day, outcome) DO UPDATE SET
                count = aiom_stats.count + 1,
                cache_hits = aiom_stats.cache_hits + ${fromCache ? 1 : 0},
                total_ms = aiom_stats.total_ms + ${Math.max(0, Math.round(ms) || 0)}
        `;
        return true;
    } catch (err) {
        console.error('Erreur stats AIOM:', err.message);
        return false;
    }
}

async function getAiomStats() {
    if (!sql) return null;
    try {
        const dayKeys = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dayKeys.push(d.toISOString().slice(0, 10));
        }
        const rows = await sql`
            SELECT day::text AS day, outcome, count, cache_hits, total_ms::bigint AS total_ms
            FROM aiom_stats WHERE day = ANY(${dayKeys})
        `;
        const byOutcome = { ytId: 0, url: 0, aucun: 0, timeout: 0, masque: 0 };
        const perDay = Object.fromEntries(dayKeys.map(d => [d, 0]));
        let total = 0, cacheHits = 0, totalMs = 0;
        for (const r of rows) {
            const n = Number(r.count) || 0;
            byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + n;
            perDay[r.day] = (perDay[r.day] || 0) + n;
            total += n;
            cacheHits += Number(r.cache_hits) || 0;
            totalMs += Number(r.total_ms) || 0;
        }
        const found = byOutcome.ytId + byOutcome.url;
        return {
            total,
            found,
            byOutcome,
            hitRate: total ? Math.round((found / total) * 100) : 0,         // % de requêtes où un trailer VF est renvoyé
            cacheRate: total ? Math.round((cacheHits / total) * 100) : 0,   // % servies par le cache
            avgMs: total ? Math.round(totalMs / total) : 0,
            today: perDay[dayKeys[dayKeys.length - 1]] || 0,
            days: dayKeys.map(date => ({ date, count: perDay[date] || 0 })),
        };
    } catch (err) {
        console.error('Erreur lecture stats AIOM:', err.message);
        return null;
    }
}

async function resetAiomStats() {
    if (!sql) return false;
    try {
        await sql`DELETE FROM aiom_stats`;
        return true;
    } catch (err) {
        console.error('Erreur reset stats AIOM:', err.message);
        return false;
    }
}

module.exports = { recordAiomStat, getAiomStats, resetAiomStats };
