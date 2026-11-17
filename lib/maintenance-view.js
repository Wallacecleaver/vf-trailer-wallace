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
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#090a0d">
<title>Maintenance — ${escapeHtml(settings.brandName)}</title>
<link rel="icon" href="/logo_transparent_check.png">
<style>
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; min-height:100svh; display:grid; place-items:center; padding:48px 24px;
    color:#f5f5f7; background:#090a0d; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    -webkit-font-smoothing:antialiased; }
  body::before { content:''; position:fixed; inset:0; pointer-events:none;
    background:radial-gradient(ellipse at 50% 25%,rgba(229,62,62,.10),transparent 55%),
      radial-gradient(ellipse at 15% 90%,rgba(103,73,124,.06),transparent 45%); }
  .maintenance-page { position:relative; width:100%; max-width:760px; }
  .maintenance-brand { display:flex; align-items:center; gap:12px; min-width:0; font-size:15px; font-weight:700; letter-spacing:.2px; }
  .maintenance-brand img { width:44px; height:44px; flex-shrink:0; object-fit:contain; }
  .maintenance-brand span { overflow-wrap:anywhere; }
  .maintenance-header { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:0 4px 24px; }
  .maintenance-status { display:inline-flex; align-items:center; gap:7px; padding:7px 11px; border:1px solid rgba(245,183,87,.16);
    border-radius:100px; background:rgba(245,183,87,.06); color:#e7bc78; font-size:11px; font-weight:600; white-space:nowrap; }
  .maintenance-dot { width:6px; height:6px; flex-shrink:0; border-radius:50%; background:currentColor; }
  .maintenance-panel { position:relative; padding:46px 48px 0; border:1px solid #2a272c; border-radius:24px; overflow:hidden;
    background:linear-gradient(155deg,#1b161b 0%,#131317 45%,#111215 100%); box-shadow:0 32px 100px rgba(0,0,0,.28); }
  .maintenance-panel::before { content:''; position:absolute; top:0; left:15%; right:15%; height:1px;
    background:linear-gradient(90deg,transparent,rgba(245,166,158,.4),transparent); }
  .maintenance-emblem { display:grid; place-items:center; width:68px; height:68px; margin-bottom:28px;
    border-radius:20px; color:#f28a83; border:1px solid rgba(238,102,94,.24);
    background:linear-gradient(145deg,rgba(228,84,76,.14),rgba(228,84,76,.03)); box-shadow:0 0 48px rgba(229,62,62,.06); }
  .maintenance-emblem svg { width:30px; height:30px; }
  .maintenance-eyebrow { margin:0 0 12px; color:#e28e83; font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase; }
  .maintenance-title { margin:0; color:#faf8fa; font-size:clamp(27px,4.5vw,38px); font-weight:700;
    letter-spacing:-1.2px; line-height:1.18; overflow-wrap:anywhere; }
  .maintenance-message { margin:18px 0 0; color:#b8b4be; font-size:16px; line-height:1.8; white-space:pre-wrap; overflow-wrap:anywhere; }
  .maintenance-info { display:flex; align-items:flex-start; gap:12px; margin-top:30px; padding:17px 18px; border-radius:12px;
    background:rgba(255,255,255,.025); border:1px solid rgba(255,255,255,.06); }
  .maintenance-info svg { width:18px; height:18px; flex-shrink:0; margin-top:2px; color:#8e8997; }
  .maintenance-info strong { display:block; color:#d6d2dc; font-size:12px; font-weight:600; line-height:1.5; }
  .maintenance-info p { margin:5px 0 0; color:#96919f; font-size:12px; line-height:1.7; }
  .maintenance-actions { display:flex; gap:12px; flex-wrap:wrap; margin:28px 0 34px; }
  .maintenance-action { display:inline-flex; align-items:center; justify-content:center; gap:9px; padding:13px 18px; border-radius:10px;
    font-size:13px; font-weight:600; line-height:1.5; text-decoration:none; transition:background .15s,border-color .15s;
    overflow-wrap:anywhere; min-width:0; }
  .maintenance-action svg { width:16px; height:16px; flex-shrink:0; }
  .maintenance-retry { color:#fff; background:#df3f46; border:1px solid #ef5960; box-shadow:0 3px 14px rgba(223,63,70,.12); }
  .maintenance-retry:hover { background:#ed4c53; }
  .maintenance-link { color:#d9d5df; border:1px solid #36323d; background:rgba(255,255,255,.025); }
  .maintenance-link:hover { background:rgba(255,255,255,.06); border-color:#615868; }
  .maintenance-action:focus-visible { outline:2px solid #f4b6ad; outline-offset:4px; }
  .maintenance-availability { display:flex; align-items:center; gap:10px; margin:0 -48px; padding:18px 48px;
    border-top:1px solid rgba(255,255,255,.06); background:rgba(0,0,0,.1); color:#9aafa4; font-size:11px; line-height:1.6; }
  .maintenance-availability .maintenance-dot { color:#6fbc91; box-shadow:0 0 9px rgba(111,188,145,.2); }
  .maintenance-footer { margin:22px 0 0; text-align:center; color:#89818f; font-size:11px; }
  @media (max-width:540px) {
    body { padding:28px 16px; }
    .maintenance-header { gap:12px; margin-bottom:20px; }
    .maintenance-brand { gap:8px; font-size:12px; }
    .maintenance-brand img { width:36px; height:36px; }
    .maintenance-status { font-size:10px; padding:6px 8px; }
    .maintenance-panel { padding:30px 24px 0; border-radius:20px; }
    .maintenance-emblem { width:58px; height:58px; border-radius:17px; margin-bottom:24px; }
    .maintenance-title { letter-spacing:-.7px; }
    .maintenance-message { font-size:14px; }
    .maintenance-info { padding:14px; margin-top:24px; }
    .maintenance-actions { gap:10px; margin:24px 0 28px; }
    .maintenance-action { width:100%; }
    .maintenance-availability { margin:0 -24px; padding:16px 24px; align-items:flex-start; }
    .maintenance-availability .maintenance-dot { margin-top:6px; }
  }
</style>
</head>
<body>
<main class="maintenance-page">
  <header class="maintenance-header">
    <div class="maintenance-brand"><img src="/logo_transparent_check.png" alt="" width="44" height="44"><span>${escapeHtml(settings.brandName)}</span></div>
    <span class="maintenance-status"><span class="maintenance-dot" aria-hidden="true"></span>Maintenance</span>
  </header>
  <section class="maintenance-panel" aria-labelledby="maintenance-heading">
    <div class="maintenance-emblem" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0L21.47 5.53a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>
      </svg>
    </div>
    <p class="maintenance-eyebrow">Configuration en pause</p>
    <h1 id="maintenance-heading" class="maintenance-title">${escapeHtml(maintenance.title || 'Maintenance en cours')}</h1>
    ${maintenance.message ? `<p class="maintenance-message">${escapeHtml(maintenance.message)}</p>` : ''}
    <div class="maintenance-info">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/></svg>
      <div><strong>La configuration est temporairement suspendue.</strong><p>Tu pourras installer ou modifier ton addon dès la fin de l’intervention.</p></div>
    </div>
    <div class="maintenance-actions">
      <a href="" class="maintenance-action maintenance-retry">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19.7 10M4.3 14A8 8 0 0 0 17.9 17.9"/></svg>
        Vérifier à nouveau
      </a>
      ${maintenance.linkUrl ? `<a class="maintenance-action maintenance-link" href="${escapeHtml(maintenance.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(maintenance.linkLabel || 'En savoir plus')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></a>` : ''}
    </div>
    <div class="maintenance-availability"><span class="maintenance-dot" aria-hidden="true"></span><span>Les profils déjà installés restent disponibles.</span></div>
  </section>
  <p class="maintenance-footer">Merci pour ta patience.</p>
</main>
</body>
</html>`;
}

module.exports = { MAINTENANCE_CSS, renderMaintenanceNotice, renderMaintenancePage };
