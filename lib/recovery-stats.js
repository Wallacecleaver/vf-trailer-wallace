// ============================================================
// RÉCUPÉRATION — suivi des gens qui refont leur config via /recuperation.
// Entonnoir en 2 temps :
//   1. "clic"      : la personne a cliqué sur Installer / Copier sur la page /recuperation
//   2. "confirmé"  : son addon a ensuite répondu sur la nouvelle adresse
//                    (une ligne `installs` avec le même id, vue APRÈS le clic)
// L'identifiant est le même HASH que lib/install-stats.js, calculé côté navigateur :
// la clé TMDB ne quitte jamais l'appareil de la personne.
// ============================================================

const sql = require('./db');

let tableReady = null;
function ensureTable() {
    if (!sql) return Promise.resolve(false);
    if (!tableReady) {
        tableReady = sql`
            CREATE TABLE IF NOT EXISTS recovery_events (
                install_id  text PRIMARY KEY,
                first_click timestamptz NOT NULL DEFAULT now(),
                last_click  timestamptz NOT NULL DEFAULT now(),
                click_count integer NOT NULL DEFAULT 1
            )
        `.then(() => true).catch(err => {
            tableReady = null; // on retentera à la prochaine requête
            console.error('Erreur création table recovery_events:', err.message);
            return false;
        });
    }
    return tableReady;
}

// Appelé par la page publique /recuperation. `id` = 16 caractères hexadécimaux.
async function recordRecoveryClick(id) {
    if (!sql || typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return null;
    try {
        if (!(await ensureTable())) return null;
        const rows = await sql`
            INSERT INTO recovery_events (install_id) VALUES (${id})
            ON CONFLICT (install_id) DO UPDATE SET
                last_click = now(),
                click_count = recovery_events.click_count + 1
            RETURNING (xmax = 0) AS inserted
        `;
        return { ok: true, isNew: !!(rows && rows[0] && rows[0].inserted) };
    } catch (err) {
        console.error('Erreur tracking récupération:', err.message);
        return null;
    }
}

// Données du dashboard : totaux, 14 jours, et liste (avec pseudo si connu).
async function getRecoveryStats() {
    if (!sql) return null;
    try {
        if (!(await ensureTable())) return null;

        const rows = await sql`
            SELECT r.install_id AS id, r.first_click, r.last_click, r.click_count,
                   i.pseudo, i.last_seen,
                   (i.id IS NOT NULL AND i.last_seen >= r.first_click) AS confirmed
            FROM recovery_events r
            LEFT JOIN installs i ON i.id = r.install_id
            ORDER BY r.first_click DESC
        `;
        const users = rows.map(r => ({
            id: r.id,
            pseudo: r.pseudo || null,
            firstClick: r.first_click,
            lastClick: r.last_click,
            clickCount: r.click_count,
            lastSeen: r.last_seen || null,
            confirmed: !!r.confirmed,
        }));

        const dayKeys = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dayKeys.push(d.toISOString().slice(0, 10));
        }
        const dayMap = {};
        for (const u of users) {
            const day = new Date(u.firstClick).toISOString().slice(0, 10);
            dayMap[day] = (dayMap[day] || 0) + 1;
        }
        const days = dayKeys.map(date => ({ date, count: dayMap[date] || 0 }));

        const total = users.length;
        const confirmed = users.filter(u => u.confirmed).length;
        return {
            total,
            confirmed,
            pending: total - confirmed,
            today: days[days.length - 1]?.count || 0,
            days,
            users,
        };
    } catch (err) {
        console.error('Erreur lecture stats récupération:', err.message);
        return null;
    }
}

async function resetRecoveryStats() {
    if (!sql) return false;
    try {
        if (!(await ensureTable())) return false;
        await sql`DELETE FROM recovery_events`;
        return true;
    } catch (err) {
        console.error('Erreur reset récupération:', err.message);
        return false;
    }
}

module.exports = { recordRecoveryClick, getRecoveryStats, resetRecoveryStats };
