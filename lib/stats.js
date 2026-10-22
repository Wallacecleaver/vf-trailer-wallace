// ============================================================
// STATS — tracking des requêtes de flux, via Postgres.
// Des compteurs agrégés dans de petites tables. Best-effort : si Postgres est down
// ou mal configuré, on log l'erreur mais on ne casse JAMAIS la résolution
// du stream pour autant.
// ============================================================

const sql = require('./db');

function todayDate() {
    return new Date().toISOString().slice(0, 10);
}

// Enregistre une requête de stream. Appelé en fire-and-forget depuis index.js.
async function recordRequest({ type, title, imdbId }) {
    if (!sql) return;

    try {
        const normType = type === 'series' ? 'series' : 'movie';
        await sql`
            UPDATE request_stats_global SET total = total + 1 WHERE id = 1
        `;
        await sql`
            INSERT INTO request_stats_daily (day, total) VALUES (${todayDate()}, 1)
            ON CONFLICT (day) DO UPDATE SET total = request_stats_daily.total + 1
        `;
        await sql`
            INSERT INTO request_stats_type (type, count) VALUES (${normType}, 1)
            ON CONFLICT (type) DO UPDATE SET count = request_stats_type.count + 1
        `;
        if (title) {
            await sql`
                INSERT INTO request_stats_top_titles (title, imdb_id, count)
                VALUES (${title}, ${imdbId || ''}, 1)
                ON CONFLICT (title, imdb_id) DO UPDATE SET count = request_stats_top_titles.count + 1
            `;
        }
    } catch (err) {
        console.error('Erreur enregistrement stats:', err.message);
    }
}

// Récupère toutes les données pour le dashboard
async function getStats() {
    if (!sql) return null;

    try {
        const [globalRows, typeRows, topRows] = await Promise.all([
            sql`SELECT total FROM request_stats_global WHERE id = 1`,
            sql`SELECT type, count FROM request_stats_type`,
            sql`SELECT title, imdb_id, count FROM request_stats_top_titles ORDER BY count DESC LIMIT 15`,
        ]);

        const typeMap = Object.fromEntries(typeRows.map(r => [r.type, Number(r.count)]));
        const topTitles = topRows.map(r => ({ title: r.title, imdbId: r.imdb_id || null, count: Number(r.count) }));

        const dayKeys = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dayKeys.push(d.toISOString().slice(0, 10));
        }
        const dayRows = await sql`
            SELECT day::text AS day, total FROM request_stats_daily WHERE day = ANY(${dayKeys})
        `;
        const dayMap = Object.fromEntries(dayRows.map(r => [r.day, Number(r.total)]));
        const days = dayKeys.map(date => ({ date, count: dayMap[date] || 0 }));

        return {
            total: Number(globalRows[0]?.total) || 0,
            movieCount: typeMap.movie || 0,
            seriesCount: typeMap.series || 0,
            todayCount: days[days.length - 1]?.count || 0,
            topTitles,
            days,
        };
    } catch (err) {
        console.error('Erreur lecture stats:', err.message);
        return null;
    }
}

// Efface toutes les stats (bouton "reset" du dashboard)
async function resetStats() {
    if (!sql) return false;

    try {
        await sql`UPDATE request_stats_global SET total = 0 WHERE id = 1`;
        await sql`DELETE FROM request_stats_daily`;
        await sql`DELETE FROM request_stats_type`;
        await sql`DELETE FROM request_stats_top_titles`;
        return true;
    } catch (err) {
        console.error('Erreur reset stats:', err.message);
        return false;
    }
}

module.exports = { recordRequest, getStats, resetStats };