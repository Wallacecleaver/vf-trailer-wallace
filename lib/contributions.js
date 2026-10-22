// ============================================================
// Propositions communautaires de liens (page publique /proposer)
// Une table `contributions` (une ligne par proposition).
// ============================================================

const sql = require('./db');

function rowToItem(row) {
    return {
        id: row.id,
        imdbId: row.imdb_id,
        season: row.season,
        title: row.title,
        mediaType: row.media_type,
        ytId: row.yt_id,
        url: row.url,
        pseudo: row.pseudo,
        notes: row.notes,
        status: row.status,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
    };
}

async function getContributions() {
    if (!sql) return [];
    try {
        const rows = await sql`SELECT * FROM contributions ORDER BY created_at DESC`;
        return rows.map(rowToItem);
    } catch (e) {
        console.error('Erreur lecture contributions:', e.message);
        return [];
    }
}

async function addContribution(entry) {
    if (!sql) return null;
    try {
        const rows = await sql`
            INSERT INTO contributions (imdb_id, season, title, media_type, yt_id, url, pseudo, notes, status)
            VALUES (${entry.imdbId}, ${entry.season || null}, ${entry.title || null}, ${entry.mediaType || null},
                    ${entry.ytId || null}, ${entry.url || null}, ${entry.pseudo}, ${entry.notes || null}, 'pending')
            RETURNING *
        `;
        return rows.length ? rowToItem(rows[0]) : null;
    } catch (e) {
        console.error('Erreur écriture contributions:', e.message);
        return null;
    }
}

async function updateContributionStatus(id, status) {
    if (!sql) return null;
    try {
        const rows = await sql`
            UPDATE contributions SET status = ${status}, reviewed_at = now()
            WHERE id = ${id}
            RETURNING *
        `;
        return rows.length ? rowToItem(rows[0]) : null;
    } catch (e) {
        console.error('Erreur mise à jour contribution:', e.message);
        return null;
    }
}

async function deleteContribution(id) {
    if (!sql) return false;
    try {
        await sql`DELETE FROM contributions WHERE id = ${id}`;
        return true;
    } catch (e) {
        console.error('Erreur suppression contribution:', e.message);
        return false;
    }
}

module.exports = { getContributions, addContribution, updateContributionStatus, deleteContribution };