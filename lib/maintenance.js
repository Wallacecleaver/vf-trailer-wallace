// Maintenance de /configure uniquement. Les flux et manifests déjà installés
// gardent leur fonctionnement ; aucun cache ni réglage existant n'est modifié.
const sql = require('./db');

const DEFAULT_MAINTENANCE = {
    enabled: false,
    title: 'Maintenance en cours',
    message: '',
    linkUrl: '',
    linkLabel: 'En savoir plus',
    blockInstall: false,
};
const TEXT_LIMITS = { title: 70, message: 300, linkUrl: 300, linkLabel: 30 };

function invalid(message) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
}

function normalizeMaintenance(patch, current = DEFAULT_MAINTENANCE) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) invalid('Réglages de maintenance invalides.');
    const settings = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(DEFAULT_MAINTENANCE, key)) invalid('Réglage de maintenance inconnu.');
        if (key === 'enabled' || key === 'blockInstall') {
            if (typeof value !== 'boolean') invalid('Les options de maintenance doivent être des booléens.');
            settings[key] = value;
        } else {
            if (typeof value !== 'string' || value.length > TEXT_LIMITS[key]) invalid('Texte de maintenance invalide ou trop long.');
            settings[key] = value.trim();
        }
    }
    if (settings.linkUrl) {
        let url;
        try { url = new URL(settings.linkUrl); } catch { invalid('Le lien doit être une adresse HTTPS valide.'); }
        if (!/^https:\/\//i.test(settings.linkUrl) || url.protocol !== 'https:' || url.username || url.password
            || /[\s"'<>]/.test(settings.linkUrl)) invalid('Le lien doit être une adresse HTTPS valide, sans identifiants.');
    }
    return settings;
}

async function getMaintenanceSettings() {
    const [row] = await sql`SELECT * FROM configure_maintenance WHERE id = 1`;
    if (!row) return { ...DEFAULT_MAINTENANCE };
    return {
        enabled: row.enabled === 1, title: row.title, message: row.message,
        linkUrl: row.link_url, linkLabel: row.link_label, blockInstall: row.block_install === 1,
    };
}

async function setMaintenanceSettings(patch) {
    const settings = normalizeMaintenance(patch, await getMaintenanceSettings());
    await sql`UPDATE configure_maintenance SET
        enabled = ${settings.enabled}, title = ${settings.title}, message = ${settings.message},
        link_url = ${settings.linkUrl}, link_label = ${settings.linkLabel},
        block_install = ${settings.blockInstall}, updated_at = ${sql.nowIso()}
        WHERE id = 1`;
    return settings;
}

module.exports = { DEFAULT_MAINTENANCE, normalizeMaintenance, getMaintenanceSettings, setMaintenanceSettings };
