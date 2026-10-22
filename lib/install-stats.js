// ============================================================
// INSTALLS — tracking des installations actives de l'addon.
// Une table `installs` (une ligne par install) + une table
// `install_activity` (une ligne par jour où l'install a été vue, pour le graphe
// 14 jours).
// L'identifiant reste un HASH du segment de config brut, jamais la clé TMDB
// en clair : impossible de la retrouver depuis la base.
// ============================================================

const crypto = require('crypto');
const sql = require('./db');

function hashConfig(rawConfig) {
    return crypto.createHash('sha256').update(rawConfig).digest('hex').slice(0, 16);
}

function todayDate() {
    return new Date().toISOString().slice(0, 10);
}

// Appelé à chaque requête manifest.json accompagnée d'une config. `pseudo` peut être null.
// Renvoie true si c'est la toute première fois qu'on voit cette config (nouvelle install).
async function recordInstallActivity(rawConfig, pseudo) {
    if (!sql || !rawConfig) return false;
    try {
        const id = hashConfig(rawConfig);
        const existing = await sql`SELECT pseudo FROM installs WHERE id = ${id}`;
        const isNewInstall = !existing.length;

        await sql`
            INSERT INTO installs (id, pseudo, first_seen, last_seen, request_count)
            VALUES (${id}, ${pseudo || null}, now(), now(), 1)
            ON CONFLICT (id) DO UPDATE SET
                pseudo = COALESCE(${pseudo || null}, installs.pseudo),
                last_seen = now(),
                request_count = installs.request_count + 1
        `;
        await sql`
            INSERT INTO install_activity (install_id, day) VALUES (${id}, ${todayDate()})
            ON CONFLICT (install_id, day) DO NOTHING
        `;

        return isNewInstall;
    } catch (err) {
        console.error('Erreur tracking install:', err.message);
        return false;
    }
}

// Récupère toutes les données pour le dashboard : total, activité 14 jours,
// et liste des utilisateurs (pseudo + dernière activité + nb de requêtes).
async function getInstallStats() {
    if (!sql) return null;
    try {
        const totalRows = await sql`SELECT COUNT(*)::int AS n FROM installs`;
        const total = totalRows[0]?.n || 0;

        const dayKeys = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dayKeys.push(d.toISOString().slice(0, 10));
        }
        const dayRows = await sql`
            SELECT day::text AS day, COUNT(DISTINCT install_id)::int AS n
            FROM install_activity
            WHERE day = ANY(${dayKeys})
            GROUP BY day
        `;
        const dayMap = Object.fromEntries(dayRows.map(r => [r.day, r.n]));
        const days = dayKeys.map(date => ({ date, count: dayMap[date] || 0 }));

        const userRows = await sql`SELECT * FROM installs ORDER BY last_seen DESC`;
        const users = userRows.map(r => ({
            id: r.id,
            pseudo: r.pseudo,
            firstSeen: r.first_seen,
            lastSeen: r.last_seen,
            requestCount: r.request_count,
        }));

        return {
            total,
            activeToday: days[days.length - 1]?.count || 0,
            days,
            users,
        };
    } catch (err) {
        console.error('Erreur lecture stats installs:', err.message);
        return null;
    }
}

// Efface toutes les données d'installation (bouton "reset" du dashboard)
async function resetInstalls() {
    if (!sql) return false;
    try {
        await sql`DELETE FROM install_activity`;
        await sql`DELETE FROM installs`;
        return true;
    } catch (err) {
        console.error('Erreur reset installs:', err.message);
        return false;
    }
}

// Supprime UNE install individuellement (bouton 🗑️ par ligne dans le dashboard).
// Ne touche jamais au manifest de la personne : c'est juste une ligne de stats en moins,
// pas une révocation d'accès.
async function removeInstall(id) {
    if (!sql || !id) return false;
    try {
        await sql`DELETE FROM install_activity WHERE install_id = ${id}`;
        await sql`DELETE FROM installs WHERE id = ${id}`;
        return true;
    } catch (err) {
        console.error('Erreur suppression install:', err.message);
        return false;
    }
}

module.exports = { recordInstallActivity, getInstallStats, resetInstalls, removeInstall };