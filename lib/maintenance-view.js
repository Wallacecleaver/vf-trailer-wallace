const escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MAINTENANCE_CSS = `
    .maintenance-notice { display:flex; align-items:flex-start; gap:14px; padding:22px; margin:24px auto;
      max-width:1072px; border:1px solid #a56b27; border-radius:14px; background:#21190f; color:#f7e6c8;
      font-family:inherit; text-align:left; box-sizing:border-box; }
    .maintenance-icon { flex-shrink:0; font-size:24px; line-height:1.2; }
    .maintenance-content { min-width:0; flex:1; }
    .maintenance-title { margin:0; color:#ffcf87; font-size:17px; line-height:1.5; font-weight:700; overflow-wrap:anywhere; }
    .maintenance-message { margin:8px 0 0; color:#dcc4a4; font-size:14px; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; }
    .maintenance-link { display:inline-block; color:#ffcf87; font-size:13px; font-weight:600; margin-top:14px; text-decoration:underline; overflow-wrap:anywhere; }
    .maintenance-scope { margin:12px 0 0; font-size:12px; line-height:1.6; color:#cbb594; }
    @media (max-width:640px) { .maintenance-notice { padding:18px; margin:16px 12px; gap:10px; } }
`;

function renderMaintenanceNotice(maintenance) {
    if (!maintenance || !maintenance.enabled) return '';
    return `<section class="maintenance-notice" role="status" aria-label="Maintenance">
      <span class="maintenance-icon" aria-hidden="true">🛠️</span>
      <div class="maintenance-content">
        <h2 class="maintenance-title">${escapeHtml(maintenance.title || 'Maintenance en cours')}</h2>
        ${maintenance.message ? `<p class="maintenance-message">${escapeHtml(maintenance.message)}</p>` : ''}
        ${maintenance.linkUrl ? `<a class="maintenance-link" href="${escapeHtml(maintenance.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(maintenance.linkLabel || 'En savoir plus')} ↗</a>` : ''}
        ${maintenance.blockInstall ? '<p class="maintenance-scope">La configuration et l’installation depuis cette page sont temporairement suspendues. Les addons déjà installés continuent de fonctionner.</p>' : ''}
      </div>
    </section>`;
}

function renderMaintenancePage(settings, maintenance) {
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maintenance — ${escapeHtml(settings.brandName)}</title>
<link rel="icon" href="/logo_transparent_check.png">
<style>
  body { margin:0; background:#0a0a0b; color:#f0f0f0; font-family:system-ui,sans-serif; }
  .maintenance-page { max-width:720px; margin:10vh auto; padding:24px; }
  .maintenance-brand { font-weight:800; font-size:15px; letter-spacing:1px; margin-bottom:28px; }
  .maintenance-retry { display:inline-block; color:#f0f0f0; border:1px solid #444; border-radius:8px; padding:10px 16px; text-decoration:none; font-size:14px; }
  ${MAINTENANCE_CSS}
</style></head><body><main class="maintenance-page">
<div class="maintenance-brand">${escapeHtml(settings.brandName)}</div>
${renderMaintenanceNotice(maintenance)}
<a href="" class="maintenance-retry">↻ Réessayer</a>
</main></body></html>`;
}

module.exports = { MAINTENANCE_CSS, renderMaintenanceNotice, renderMaintenancePage };
