// Génère le shell HTML du dashboard. Tout est en client-side :
// login -> fetch API avec header x-admin-token -> rendu par page.

function renderDashboardShell() {
    return `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/png" href="/logo_transparent_check.png">
  <title>Bandes-Annonces VF — Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root[data-theme="dark"] {
    --bg:#0a0a0b; --surface:#111113; --surface2:#18181b; --border:rgba(255,255,255,0.06);
    --accent:#e53e3e; --accent-dim:rgba(229,62,62,0.08); --green:#48bb78;
    --text:#f0f0f0; --text2:#888; --muted:#666; --input-bg:#0a0a0b; --card-hover:rgba(255,255,255,0.02);
    --ts-glow2:#ff8a3d; --ts-signal:#2dd9c4; --ts-signal-dim:rgba(45,217,196,0.1); --ts-fail:#ff5577;
  }
  :root[data-theme="light"] {
    --bg:#f1f5f9; --surface:#ffffff; --surface2:#f8fafc; --border:rgba(0,0,0,0.08);
    --accent:#e53e3e; --accent-dim:rgba(229,62,62,0.08); --green:#38a169;
    --text:#0f172a; --text2:#475569; --muted:#94a3b8; --input-bg:#f8fafc; --card-hover:rgba(0,0,0,0.02);
    --ts-glow2:#e8720f; --ts-signal:#0d9488; --ts-signal-dim:rgba(13,148,136,0.08); --ts-fail:#e11d48;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; transition:background .3s,color .3s; }

  /* LOGIN */
  #login-screen { min-height:100vh; display:flex; align-items:center; justify-content:center; position:relative; }
  #login-screen::before { content:''; position:fixed; top:-200px; left:50%; transform:translateX(-50%);
    width:600px; height:500px; background:radial-gradient(ellipse,rgba(229,62,62,0.06) 0%,transparent 70%); pointer-events:none; }
  .login-card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:40px; width:340px;
    box-shadow:0 24px 80px rgba(0,0,0,0.3); position:relative; z-index:1; }
  .login-logo { text-align:center; font-size:36px; margin-bottom:8px; }
  .login-title { font-size:19px; font-weight:800; text-align:center; color:var(--text); margin-bottom:4px; }
  .login-sub { font-size:11px; color:var(--muted); text-align:center; margin-bottom:26px; letter-spacing:.5px; text-transform:uppercase; }
  .field label { display:block; font-size:12px; color:var(--text2); margin-bottom:6px; font-weight:600; }
  .field input { width:100%; background:var(--input-bg); border:1px solid var(--border); border-radius:8px; padding:11px 14px;
    color:var(--text); font-family:'Rajdhani',monospace; font-size:14px; transition:border-color .2s; margin-bottom:16px; }
  .field input:focus { outline:none; border-color:var(--accent); }
  .login-error { font-size:12px; color:var(--accent); text-align:center; margin-bottom:12px; padding:8px 12px;
    background:rgba(229,62,62,0.08); border:1px solid rgba(229,62,62,0.2); border-radius:8px; display:none; }
  .btn-primary { width:100%; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:12px;
    font-family:'DM Sans',sans-serif; font-size:14px; font-weight:700; cursor:pointer; transition:background .2s; }
  .btn-primary:hover { background:#c53030; }
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)}
    60%{transform:translateX(-6px)} 80%{transform:translateX(6px)} }
  .shake { animation: shake .4s; }

  /* LAYOUT */
  #dashboard { display:none; }
  .layout { display:flex; min-height:100vh; }
  .sidebar { width:250px; background:var(--surface); border-right:1px solid var(--border); display:flex; flex-direction:column;
    position:fixed; top:0; bottom:0; left:0; z-index:10; overflow-y:auto; }
  .sidebar-logo { padding:18px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .sidebar-logo-brand { display:flex; align-items:center; gap:10px; min-width:0; }
  .sidebar-logo-text .title { font-size:14px; font-weight:800; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sidebar-logo-text .sub { font-size:10px; color:var(--muted); margin-top:1px; text-transform:uppercase; letter-spacing:.5px; }
  .theme-btn { background:var(--surface2); border:1px solid var(--border); border-radius:8px; width:32px; height:32px;
    display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:15px; transition:all .2s; flex-shrink:0; }
  .theme-btn:hover { border-color:var(--accent); }
  .sidebar-nav { flex:1; padding:14px 10px; }
  .nav-section-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.8px; padding:8px 10px 6px; font-weight:700; }
  .nav-section-label:not(:first-child) { margin-top:10px; }
  .nav-item { display:flex; align-items:center; gap:9px; padding:9px 12px; border-radius:8px; font-size:13px; font-weight:600;
    color:var(--text2); cursor:pointer; margin-bottom:2px; border:none; background:none; width:100%; text-align:left;
    font-family:'DM Sans',sans-serif; transition:all .15s; }
  .nav-item:hover { background:var(--surface2); color:var(--text); }
  .nav-item.active { background:var(--accent-dim); color:var(--accent); }
  .nav-badge { margin-left:auto; background:var(--accent); color:#fff; font-size:10px; font-weight:800; border-radius:20px;
    padding:1px 7px; min-width:16px; text-align:center; }
  .sidebar-bottom { padding:12px 10px; border-top:1px solid var(--border); }
  .btn-logout { width:100%; background:none; border:1px solid var(--border); border-radius:8px; padding:8px; font-size:12px;
    color:var(--muted); cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .2s; }
  .btn-logout:hover { color:var(--accent); border-color:var(--accent); }

  .main { margin-left:250px; padding:28px 32px 60px; }
  .page { display:none; }
  .page.active { display:block; }
  .page-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
  .page-title { font-size:24px; font-weight:800; color:var(--text); margin-bottom:3px; }
  .page-sub { font-size:13px; color:var(--text2); }
  .header-actions { display:flex; gap:10px; flex-wrap:wrap; }

  .btn-add, .btn-outline-sm { display:flex; align-items:center; gap:6px; border-radius:7px; padding:8px 14px; font-size:12px;
    font-weight:700; font-family:'DM Sans',sans-serif; cursor:pointer; transition:all .2s; text-decoration:none; }
  .btn-add { background:var(--accent-dim); border:1px solid rgba(229,62,62,0.2); color:var(--accent); }
  .btn-add:hover { background:var(--accent); color:#fff; }
  .btn-outline-sm { background:none; border:1px solid var(--border); color:var(--text2); }
  .btn-outline-sm:hover { color:var(--text); border-color:var(--text2); }

  .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
  .stat-card { position:relative; overflow:hidden; border-radius:16px; padding:18px 20px;
    background:var(--surface); border:1px solid var(--border);
    display:flex; flex-direction:column; gap:4px;
    transition:border-color .2s, transform .2s; }
  .stat-card::after { content:''; position:absolute; top:-45%; right:-18%; width:150px; height:150px; border-radius:50%;
    background:radial-gradient(circle, var(--card-glow,rgba(229,62,62,.16)), transparent 70%); pointer-events:none; }
  .stat-card:hover { transform:translateY(-2px); }
  .stat-card.c-red { --card-glow:rgba(229,62,62,.26); --card-icon-bg:rgba(229,62,62,.14); }
  .stat-card.c-blue { --card-glow:rgba(96,165,250,.26); --card-icon-bg:rgba(96,165,250,.14); }
  .stat-card.c-purple { --card-glow:rgba(167,139,250,.26); --card-icon-bg:rgba(167,139,250,.14); }
  .stat-card.c-green { --card-glow:rgba(72,187,120,.26); --card-icon-bg:rgba(72,187,120,.14); }
  .stat-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1.1px; font-weight:700; }
  .stat-value { font-size:32px; font-weight:800; color:var(--text); line-height:1.05;
    font-family:'Rajdhani',monospace; letter-spacing:.5px; padding-right:42px; }
  .stat-icon { position:absolute; top:16px; right:16px; width:34px; height:34px; border-radius:10px;
    display:flex; align-items:center; justify-content:center; font-size:16px;
    background:var(--card-icon-bg,rgba(229,62,62,.12)); }
  .stat-trend { display:flex; align-items:center; gap:5px; font-size:11px; font-weight:700; margin-top:4px; }
  .trend-up { color:var(--green); }
  .trend-down { color:#fc8181; }
  .trend-flat { color:var(--muted); }
  .ov-updated { font-size:11px; color:var(--muted); font-weight:600; align-self:center; }
  .ov-grid-2 { display:grid; grid-template-columns:1.55fr 1fr; gap:20px; margin-bottom:20px; }
  .ov-chart-wrap { width:100%; }
  .ov-chart { width:100%; height:auto; display:block; }
  .ov-chart-grid { stroke:var(--border); stroke-width:1; stroke-dasharray:3 5; }
  .ov-chart-xlabel { font-size:9px; fill:var(--muted); font-family:'DM Sans',sans-serif; }
  .ov-split { display:flex; align-items:center; gap:24px; padding:8px 4px; }
  .ov-donut { width:132px; height:132px; flex-shrink:0; }
  .ov-donut-total { font-size:20px; font-weight:800; fill:var(--text); font-family:'Rajdhani',monospace; }
  .ov-donut-sub { font-size:8px; fill:var(--muted); text-transform:uppercase; letter-spacing:1px; font-weight:700; font-family:'DM Sans',sans-serif; }
  .ov-split-legend { display:flex; flex-direction:column; gap:12px; }
  .ov-legend-item { display:flex; align-items:center; gap:9px; font-size:13px; color:var(--text2); font-weight:600; }
  .ov-legend-item b { margin-left:auto; font-family:'Rajdhani',monospace; font-size:16px; color:var(--text); }
  .ov-legend-dot { width:10px; height:10px; border-radius:3px; flex-shrink:0; }
  .top-share { height:3px; border-radius:100px; background:var(--surface2); margin-top:7px; max-width:180px; overflow:hidden; }
  .top-share-bar { height:100%; border-radius:100px; background:linear-gradient(90deg,var(--accent),var(--accent)); }
  .user-cell { display:flex; align-items:center; gap:12px; }
  .user-avatar { width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg,var(--accent),#ff8a65);
    color:#fff; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; }
  .user-avatar.anon { background:var(--surface2); color:var(--muted); }
  .user-name { font-weight:700; font-size:13px; }
  .user-anon-badge { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    background:var(--surface2); color:var(--muted); padding:1px 6px; border-radius:100px; margin-left:4px; }
  .user-sub { font-size:11px; margin-top:2px; }

  .section-label { font-size:12px; font-weight:800; color:var(--text2); text-transform:uppercase; letter-spacing:1.2px; margin:4px 2px 12px; }
  .stats-grid-mini { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
  .mini-stat { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px 18px;
    display:flex; align-items:center; gap:14px; cursor:pointer; transition:border-color .2s,transform .2s,background .2s; }
  .mini-stat:hover { border-color:rgba(255,255,255,0.14); transform:translateY(-1px); background:var(--card-hover); }
  .mini-stat-icon { width:42px; height:42px; border-radius:10px; display:flex; align-items:center; justify-content:center;
    font-size:19px; flex-shrink:0; transition:background .2s; }
  .mini-stat-icon.c-blue2 { background:rgba(96,165,250,0.12); }
  .mini-stat-icon.c-orange { background:rgba(245,158,11,0.12); }
  .mini-stat-icon.c-green2 { background:rgba(72,187,120,0.14); }
  .mini-stat-icon.c-red2 { background:rgba(230,57,70,0.14); }
  .mini-stat-body { min-width:0; }
  .mini-stat-label { font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
  .mini-stat-value { font-size:19px; font-weight:800; color:var(--text); line-height:1.1; }

  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:20px; }
  .card-head { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--border);
    flex-wrap:wrap; gap:8px; background:linear-gradient(180deg, rgba(230,57,70,0.05), rgba(230,57,70,0)); }
  .card-title { font-size:15px; font-weight:800; color:var(--text); letter-spacing:.01em; }
  .card-body { padding:20px; }
  .card-desc { font-size:12px; color:var(--text2); margin-top:2px; }

  .mapping-tabs-head { padding-bottom:0; gap:12px; }
  .mapping-tabs { display:flex; gap:6px; flex-wrap:wrap; }
  .maptab { display:flex; align-items:center; gap:7px; padding:9px 14px; border-radius:9px 9px 0 0; border:1px solid transparent;
    background:transparent; color:var(--text2); font-family:'DM Sans',sans-serif; font-size:13px; font-weight:700; cursor:pointer;
    transition:all .15s; margin-bottom:-1px; }
  .maptab:hover { color:var(--text); background:var(--card-hover); }
  .maptab.active { color:var(--text); background:var(--surface); border-color:var(--border); border-bottom-color:var(--surface); }
  .tab-count { background:var(--surface2); color:var(--muted); font-size:11px; font-weight:700; padding:1px 7px; border-radius:100px; }
  .maptab.active .tab-count { background:var(--accent-dim); color:var(--accent); }
  .mapping-tab-panel table { margin-top:0; }

  .bars { display:flex; align-items:flex-end; gap:6px; height:120px; padding:20px; }
  .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; }
  .bar { width:100%; background:var(--accent); border-radius:3px 3px 0 0; min-height:3px; opacity:.85; cursor:default; transition:opacity .1s; }
  .bar:hover { opacity:1; }
  .bar-label { font-size:9px; color:var(--muted); margin-top:6px; }

  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); padding:12px 20px; border-bottom:1px solid var(--border); }
  td { padding:11px 20px; border-bottom:1px solid var(--border); font-size:13px; color:var(--text); vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  .rank { color:var(--accent); font-weight:800; width:34px; font-size:15px; }
  .muted { color:var(--muted); }
  .count { text-align:right; font-weight:700; font-family:'Rajdhani',monospace; }
  .empty-row td { text-align:center; padding:28px; color:var(--muted); }
  .mono { font-family:'Rajdhani',monospace; font-weight:600; }

  /* FORMS */
  .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .form-field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
  .form-field.full { grid-column:1/-1; }
  .form-field label { font-size:12px; color:var(--text2); font-weight:600; }
  .form-field .hint { font-size:11px; color:var(--muted); font-weight:400; }
  .form-field input, .form-field textarea, .form-field select {
    background:var(--input-bg); border:1px solid var(--border); border-radius:8px; padding:9px 12px;
    color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; transition:border-color .2s; width:100%;
  }
  .form-field input:focus, .form-field textarea:focus, .form-field select:focus { outline:none; border-color:var(--accent); }
  .form-field textarea { resize:vertical; min-height:64px; font-family:'DM Sans',sans-serif; }
  .form-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:4px; }
  .btn-save { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:10px 22px; font-size:13px;
    font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; transition:background .2s; }
  .btn-save:hover { background:#c53030; }
  .btn-save2 { background:var(--surface2); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:10px 22px;
    font-size:13px; font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .2s; }
  .btn-save2:hover { border-color:var(--text2); }
  .btn-test { background:var(--accent-dim); color:var(--accent); border:1px solid rgba(229,62,62,0.35); border-radius:8px;
    padding:10px 22px; font-size:13px; font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .2s; }
  .btn-test:hover { background:rgba(229,62,62,0.18); border-color:var(--accent); }

  /* Regroupe les champs du formulaire en étapes numérotées, pour casser le mur de
     champs identiques et guider l'admin dans l'ordre logique (identifier -> choisir
     la vidéo -> personnaliser) plutôt que de tout présenter à plat sans hiérarchie. */
  .form-step { padding-top:20px; margin-top:20px; border-top:1px solid var(--border); }
  .form-step:first-child { padding-top:0; margin-top:0; border-top:none; }
  .form-step-head { display:flex; align-items:flex-start; gap:11px; margin-bottom:16px; }
  .step-num { flex-shrink:0; width:24px; height:24px; border-radius:50%; background:var(--accent-dim); color:var(--accent);
    font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; }
  .step-title { font-size:14px; font-weight:700; color:var(--text); }
  .step-desc { font-size:12px; color:var(--muted); margin-top:1px; }

  .form-mode-badge { display:inline-block; vertical-align:middle; margin-left:10px; font-size:10px; font-weight:800;
    padding:3px 10px; border-radius:100px; letter-spacing:.5px; text-transform:uppercase;
    background:var(--surface2); color:var(--text2); }
  .form-mode-badge[data-mode="Édition"] { background:rgba(96,165,250,0.14); color:#93c5fd; }
  .form-mode-badge[data-mode="Correction"] { background:rgba(245,158,11,0.14); color:#fbbf24; }

  .form-section { margin-bottom:18px; }
  .form-section-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.6px;
    color:var(--muted); margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid var(--border); }

  .form-preview { display:none; align-items:center; gap:14px; margin:4px 0 16px; padding:12px 14px;
    border:1px solid var(--border); border-radius:10px; background:var(--card-hover); }
  .form-preview.show { display:flex; }
  .form-preview-thumb { width:120px; height:70px; object-fit:cover; border-radius:8px; flex-shrink:0; cursor:pointer; }
  .form-preview-info { min-width:0; flex:1; }
  .form-preview-title { font-size:13px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .form-preview-meta { font-size:11px; color:var(--muted); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .form-preview-play { flex-shrink:0; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 14px;
    font-size:12px; font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; }

  .mapping-sort { display:flex; align-items:center; gap:3px; background:var(--input-bg);
    border:1px solid var(--border); border-radius:100px; padding:3px; flex-shrink:0; }
  .mapping-sort-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.6px;
    color:var(--muted); padding:0 8px 0 6px; }
  .mapping-sort-opt { border:none; background:none; color:var(--text2); font-size:11px; font-weight:700;
    padding:5px 11px; border-radius:100px; cursor:pointer; font-family:'DM Sans',sans-serif;
    transition:all .15s; white-space:nowrap; }
  .mapping-sort-opt:hover { color:var(--text); }
  .mapping-sort-opt.active { background:var(--accent); color:#fff; box-shadow:0 2px 8px rgba(229,62,62,0.35); }

  .override-hidden-row { opacity:.55; }

  .bulk-bar { display:flex; align-items:center; gap:10px; padding:10px 20px; border-bottom:1px solid var(--border);
    background:var(--accent-dim); font-size:12px; font-weight:600; color:var(--text2); }
  .override-check { width:14px; height:14px; accent-color:var(--accent); cursor:pointer; }
  .override-note { font-size:11px; color:var(--muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }
  .uses-badge { display:inline-block; min-width:28px; text-align:center; font-size:11px; font-weight:700;
    padding:2px 8px; border-radius:100px; background:var(--surface2); color:var(--text2); }

  .toggle-row { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--border); gap:16px; transition:background .15s; }
  .toggle-row:last-child { border-bottom:none; }
  .toggle-row:hover { background:var(--card-hover); }
  .toggle-row .label { font-size:14px; font-weight:800; color:var(--text); letter-spacing:.01em; }
  .toggle-row .desc { font-size:12px; color:var(--text2); margin-top:3px; line-height:1.5; }
  .toggle-row .field-inline { display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .toggle-row input[type="number"] { width:70px; background:var(--input-bg); border:1px solid var(--border); border-radius:6px;
    padding:6px 8px; color:var(--text); font-family:'Rajdhani',monospace; font-size:13px; }
  .switch { position:relative; width:42px; height:24px; flex-shrink:0; display:inline-block; }
  .switch input { opacity:0; width:0; height:0; }
  .slider { position:absolute; cursor:pointer; inset:0; background:var(--surface2); border:1px solid var(--border); border-radius:24px; transition:.2s; }
  .slider::before { content:''; position:absolute; height:16px; width:16px; left:2px; top:2px; background:var(--muted); border-radius:50%; transition:.2s; }
  input:checked + .slider { background:var(--accent-dim); border-color:var(--accent); }
  input:checked + .slider::before { transform:translateX(18px); background:var(--accent); }

  .small-btn { background:none; border:1px solid var(--border); border-radius:6px; padding:5px 10px; font-size:11px; font-weight:700;
    color:var(--text2); cursor:pointer; transition:all .15s; font-family:'DM Sans',sans-serif; white-space:nowrap; }
  .small-btn:hover { border-color:var(--accent); color:var(--accent); }
  .small-btn.danger:hover { border-color:#ef4444; color:#ef4444; }
  .badge-type { font-size:10px; padding:2px 8px; border-radius:4px; font-weight:700; text-transform:uppercase; background:var(--surface2); color:var(--text2); }
  .link-fallback-warn { font-size:10px; color:#ecc94b; margin-top:5px; font-weight:700; cursor:help; }

  /* LOGS — terminal live-tail */
  .logs-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .logs-group { display:flex; align-items:center; gap:6px; }
  .logs-group label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; font-weight:700; }
  .logs-select, .logs-search input { background:var(--surface); border:1px solid var(--border); border-radius:7px; padding:7px 10px;
    font-size:12px; font-weight:600; color:var(--text); font-family:'DM Sans',sans-serif; cursor:pointer; }
  .logs-search input { cursor:text; min-width:180px; font-weight:500; }
  .logs-search input:focus, .logs-select:focus { outline:none; border-color:var(--accent); }
  .logs-pausebtn { display:flex; align-items:center; gap:6px; background:var(--surface2); border:1px solid var(--border); border-radius:7px;
    padding:7px 12px; font-size:12px; font-weight:700; color:var(--text2); cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .15s; }
  .logs-pausebtn:hover { color:var(--text); border-color:var(--text2); }
  .logs-pausebtn.paused { background:var(--accent-dim); border-color:rgba(229,62,62,0.3); color:var(--accent); }
  .logs-status { display:flex; align-items:center; gap:7px; font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .logs-dot { width:8px; height:8px; border-radius:50%; background:var(--green); animation:logsPulse 1.6s infinite; flex-shrink:0; }
  .logs-dot.paused { background:var(--muted); animation:none; }
  @keyframes logsPulse { 0%,100%{opacity:1} 50%{opacity:.35} }

  .services-status-card { margin-bottom: 18px; }
  .services-status-grid { display:flex; flex-wrap:wrap; gap:10px; padding: 4px 0 2px; }
  .svc-pill { display:inline-flex; align-items:center; gap:8px; padding:8px 16px; border-radius:10px;
    background:var(--card); border:1px solid var(--border); font-weight:700; font-size:13px; color:var(--text); }
  .svc-dot { width:9px; height:9px; border-radius:50%; background:var(--muted); flex-shrink:0; }
  .svc-pill.svc-up { border-color:rgba(72,187,120,0.35); background:rgba(72,187,120,0.08); }
  .svc-pill.svc-up .svc-dot { background:#48bb78; box-shadow:0 0 6px rgba(72,187,120,0.7); }
  .svc-pill.svc-down { border-color:rgba(230,57,70,0.4); background:rgba(230,57,70,0.08); color:var(--accent); }
  .svc-pill.svc-down .svc-dot { background:var(--accent); box-shadow:0 0 6px rgba(230,57,70,0.7); }
  .svc-pill.svc-pending .svc-dot { animation: svcPulse 1.4s ease-in-out infinite; }
  @keyframes svcPulse { 0%,100% { opacity:.3; } 50% { opacity:1; } }

  .logs-term { height:520px; overflow-y:auto; background:var(--bg); font-family:'Rajdhani',ui-monospace,Consolas,monospace;
    font-size:13px; line-height:1.7; border-radius:12px; }
  .logs-term::-webkit-scrollbar { width:8px; }
  .logs-term::-webkit-scrollbar-thumb { background:var(--border); border-radius:8px; }
  .log-row { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px; padding:7px 18px 7px 15px; border-bottom:1px solid var(--border); border-left:3px solid transparent; }
  .log-row:hover { background:var(--card-hover); }
  .log-row.row-lv-warn { border-left-color:#f59e0b; background:rgba(245,158,11,0.04); }
  .log-row.row-lv-error { border-left-color:var(--accent); background:rgba(230,57,70,0.05); }
  .log-time { color:var(--muted); flex-shrink:0; font-size:12px; }
  .log-level { font-weight:800; flex-shrink:0; min-width:60px; font-size:12px; }
  .log-level.lv-info { color:#60a5fa; }
  .log-level.lv-warn { color:#f59e0b; }
  .log-level.lv-error { color:var(--accent); }
  .log-ctx { padding:2px 9px; border-radius:5px; font-size:11px; font-weight:700; flex-shrink:0; }
  .log-msg { color:var(--text); flex:1; min-width:0; word-break:break-word; font-weight:500; }
  .log-meta { flex-basis:100%; display:flex; flex-wrap:wrap; gap:6px; padding-left:18px; margin-top:3px; margin-bottom:2px; }
  .meta-chip { display:inline-flex; align-items:center; gap:5px; background:var(--card); border:1px solid var(--border); border-radius:6px; padding:2px 9px; font-size:11px; color:var(--text2); line-height:1.6; }
  .meta-chip b { color:var(--muted); font-weight:700; text-transform:uppercase; font-size:9px; letter-spacing:.04em; }
  .meta-chip.chip-pseudo { background:rgba(230,57,70,0.1); border-color:rgba(230,57,70,0.35); color:var(--accent); }
  .meta-chip.chip-pseudo b { color:var(--accent); opacity:.85; }
  .logs-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;
    color:var(--muted); font-family:'DM Sans',sans-serif; gap:8px; }
  .logs-empty .icon { font-size:32px; opacity:.4; }

  .info-box { background:var(--accent-dim); border:1px solid rgba(229,62,62,0.2); border-radius:10px; padding:12px 16px;
    font-size:12px; color:var(--text2); line-height:1.6; margin-bottom:16px; }
  .info-box code { background:var(--surface2); padding:1px 6px; border-radius:4px; font-family:'Rajdhani',monospace; color:var(--text); }

  .toast { position:fixed; bottom:24px; right:24px; background:var(--surface); border:1px solid var(--border); border-radius:10px;
    padding:12px 18px; font-size:13px; font-weight:600; color:var(--text); box-shadow:0 8px 32px rgba(0,0,0,0.3);
    opacity:0; transform:translateY(10px); transition:all .3s; z-index:200; }
  .toast.show { opacity:1; transform:translateY(0); }

  /* MAPPING — recherche TMDB */
  .tmdb-search-wrap { position:relative; }
  .tmdb-results { position:absolute; top:calc(100% + 4px); left:0; right:0; background:var(--surface2);
    border:1px solid var(--border); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,0.35); z-index:30;
    max-height:320px; overflow-y:auto; display:none; }
  .tmdb-results.show { display:block; }
  .tmdb-result-item { display:flex; align-items:center; gap:10px; padding:9px 12px; cursor:pointer; transition:background .15s; }
  .tmdb-result-item:hover { background:var(--card-hover); }
  .tmdb-result-item:not(:last-child) { border-bottom:1px solid var(--border); }
  .tmdb-result-poster { width:32px; height:46px; border-radius:4px; object-fit:cover; background:var(--bg); flex-shrink:0; }
  .tmdb-result-poster.empty { display:flex; align-items:center; justify-content:center; font-size:14px; opacity:.3; }
  .tmdb-result-info { min-width:0; flex:1; }
  .tmdb-result-title { font-size:13px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tmdb-result-meta { font-size:11px; color:var(--muted); margin-top:1px; }
  .tmdb-loading, .tmdb-empty { padding:14px; text-align:center; font-size:12px; color:var(--muted); }
  .yt-search-wrap { position:relative; }  .link-status { font-size:11px; font-weight:600; margin-top:5px; min-height:14px; }
  .link-status.ok { color:#48bb78; }
  .link-status.bad { color:#fc8181; }
  .link-status.pending { color:var(--muted); }
  .fallback-item { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .fallback-item .fallback-yt { flex:1; background:var(--input-bg); border:1px solid var(--border); border-radius:8px;
    padding:8px 12px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; }
  .fallback-item .fallback-url { flex:1; background:var(--input-bg); border:1px solid var(--border); border-radius:8px;
    padding:8px 12px; color:var(--text); font-family:'DM Sans',sans-serif; font-size:13px; }
  .fallback-item .fallback-status { flex-shrink:0; font-size:11px; min-width:16px; text-align:center; }
  .fallback-item .fallback-remove { background:none; border:1px solid var(--border); border-radius:6px; color:var(--muted);
    cursor:pointer; font-size:12px; width:26px; height:26px; flex-shrink:0; transition:all .15s; }
  .fallback-item .fallback-remove:hover { border-color:var(--accent); color:var(--accent); }
  .form-actions-inline { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  .link-test-result { font-size:12px; font-weight:600; }
  .edit-banner { display:none; align-items:center; justify-content:space-between; gap:10px; background:var(--accent-dim);
    border:1px solid rgba(229,62,62,0.25); border-radius:9px; padding:9px 14px; font-size:12px; color:var(--accent);
    font-weight:600; margin-bottom:16px; }
  .edit-banner.show { display:flex; }
  .edit-banner button { background:none; border:1px solid rgba(229,62,62,0.3); color:var(--accent); border-radius:6px;
    padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; }

  /* MAPPING — toolbar table (recherche/export/import) */
  .table-toolbar { display:flex; align-items:center; gap:10px; padding:12px 20px; border-bottom:1px solid var(--border); flex-wrap:wrap; }
  .table-toolbar input[type="text"] { flex:1; min-width:160px; background:var(--input-bg); border:1px solid var(--border);
    border-radius:7px; padding:8px 12px; color:var(--text); font-size:12px; font-family:'DM Sans',sans-serif; }
  .table-toolbar input[type="text"]:focus { outline:none; border-color:var(--accent); }

  /* MAPPING — aperçu (thumbnail + preview inline) */
  .preview-thumb { width:54px; height:32px; border-radius:5px; object-fit:cover; background:var(--surface2); cursor:pointer;
    display:block; transition:transform .15s, opacity .15s; }
  .preview-thumb:hover { transform:scale(1.06); opacity:.9; }
  .preview-link { font-size:11px; color:var(--text2); text-decoration:underline; cursor:pointer; }
  .preview-link:hover { color:var(--accent); }
  .row-actions { display:flex; gap:6px; flex-wrap:wrap; }

  .mapping-pagination { display:flex; align-items:center; justify-content:center; gap:10px; padding:12px 20px;
    border-top:1px solid var(--border); flex-wrap:wrap; }
  .mapping-page-info { font-size:12px; color:var(--muted); }
  .mapping-pagination .small-btn:disabled { opacity:.4; cursor:default; }

  /* CONFIGURE — aperçu en direct + couleur de marque */
  .config-preview-card { margin-bottom:16px; }
  .config-preview-frame { width:100%; height:480px; border:1px solid var(--border); border-radius:10px;
    background:var(--bg); display:block; }
  .color-pick-row { display:flex; gap:8px; align-items:center; }
  .color-pick-row input[type="color"] { width:46px; height:36px; border:1px solid var(--border); border-radius:7px;
    background:var(--input-bg); cursor:pointer; padding:3px; flex-shrink:0; }
  .color-pick-row input[type="text"] { flex:1; background:var(--input-bg); border:1px solid var(--border);
    border-radius:7px; padding:8px 12px; color:var(--text); font-size:12px; font-family:'DM Sans',sans-serif; }
  .color-pick-row input[type="text"]:focus { outline:none; border-color:var(--accent); }

  /* SETTINGS — diagnostic + état d'enregistrement */
  .diagnostics-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; padding:16px 20px; }
  .diag-item { display:flex; flex-direction:column; gap:4px; background:var(--surface2); border:1px solid var(--border);
    border-radius:10px; padding:12px 14px; }
  .diag-label { font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
  .diag-val { font-size:13px; font-weight:800; color:var(--text); }
  .diag-val.diag-pending { color:var(--muted); }
  .diag-val.diag-ok { color:var(--green); }
  .diag-val.diag-bad { color:var(--accent); }
  .diag-val .diag-sub { display:block; font-size:11px; font-weight:500; color:var(--muted); margin-top:2px; }
  .save-state { font-size:12px; font-weight:600; padding:5px 12px; border-radius:100px; color:var(--muted); }
  .save-state.dirty { background:rgba(229,62,62,0.1); border:1px solid rgba(229,62,62,0.3); color:var(--accent); }
  .save-state.saving { background:var(--surface2); border:1px solid var(--border); color:var(--text2); }
  .save-state.saved { background:rgba(72,187,120,0.1); border:1px solid rgba(72,187,120,0.3); color:var(--green); }

  .preview-link-nav { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
  .preview-link-nav .small-btn.active { border-color:var(--accent); color:var(--accent); }
  .preview-player { position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:10px; overflow:hidden; }
  .preview-player iframe, .preview-player video { width:100%; height:100%; border:0; display:block; }

  /* TEST FLUX — trace de résolution */
  .trace-box { margin-top:14px; border:1px solid var(--border); border-radius:9px; background:var(--surface);
    padding:12px 16px; font-size:12px; }
  .trace-title { font-weight:800; color:var(--text); margin-bottom:8px; letter-spacing:.02em; }
  .trace-step { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px dashed var(--border); }
  .trace-step:last-child { border-bottom:none; }
  .trace-icon { flex-shrink:0; width:16px; text-align:center; }
  .trace-step-name { flex-shrink:0; font-weight:700; color:var(--text2); }
  .trace-step-detail { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
  .trace-ms { flex-shrink:0; color:var(--muted); font-size:11px; }
  .trace-step.fail .trace-step-name { color:var(--accent); }
  .trace-step.ok .trace-step-name { color:var(--green); }

  /* MODAL preview */
  .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:300;
    align-items:center; justify-content:center; padding:20px; }
  .modal-overlay.show { display:flex; }
  .modal-box { background:var(--surface); border:1px solid var(--border); border-radius:14px; width:100%; max-width:720px;
    overflow:hidden; box-shadow:0 24px 80px rgba(0,0,0,0.5); }
  .modal-head { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--border); }
  .modal-head .title { font-size:13px; font-weight:700; color:var(--text); }
  .modal-close { background:none; border:none; color:var(--muted); font-size:18px; cursor:pointer; line-height:1; padding:4px; }
  .modal-close:hover { color:var(--text); }
  .modal-body { background:#000; aspect-ratio:16/9; display:flex; align-items:center; justify-content:center; }
  .modal-body.preview-multi { aspect-ratio:auto; display:block; background:var(--surface); padding:14px; }
  .modal-body iframe, .modal-body video { width:100%; height:100%; border:none; }
  .ts-player { display:none; margin-top:16px; background:#000; aspect-ratio:16/9; border-radius:10px; overflow:hidden; }
  .ts-player.show { display:block; }
  .ts-player iframe, .ts-player video { width:100%; height:100%; border:none; display:block; }

  /* ==== Test des flux — thème "signal réseau" : dégradés, glow, typo technique ==== */
  #page-teststream .page-title { font-family:'Space Grotesk',sans-serif; letter-spacing:-.3px;
    background:linear-gradient(90deg, var(--text) 40%, var(--ts-signal)); -webkit-background-clip:text; background-clip:text; }
  #page-teststream .page-title { -webkit-text-fill-color:transparent; }

  #page-teststream .card { position:relative; overflow:visible; }
  #page-teststream .card::before { content:''; position:absolute; left:16px; right:16px; top:0; height:1px;
    background:linear-gradient(90deg, transparent, var(--ts-glow2), var(--ts-signal), transparent); opacity:.55; }
  #page-teststream .card-head { gap:11px; }
  #page-teststream .ts-head-icon { display:flex; align-items:center; justify-content:center; width:30px; height:30px;
    border-radius:8px; background:linear-gradient(135deg, var(--accent), var(--ts-glow2)); font-size:14px; flex-shrink:0;
    box-shadow:0 0 14px rgba(255,138,61,.35); }
  #page-teststream .card-title { font-size:14.5px; font-weight:700; font-family:'Space Grotesk',sans-serif; letter-spacing:.2px; }
  #page-teststream .mono { font-family:'JetBrains Mono',monospace; font-weight:500; letter-spacing:-.2px; }

  #page-teststream .form-field input:focus { box-shadow:0 0 0 3px rgba(255,138,61,.12); }
  #page-teststream #ts-imdb { font-family:'JetBrains Mono',monospace; letter-spacing:.3px; }

  #page-teststream .ts-imdb-label-row { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
  #page-teststream .ts-override-badge { display:none; align-items:center; gap:6px; font-size:10.5px; font-weight:700; color:var(--ts-signal);
    background:var(--ts-signal-dim); border:1px solid rgba(45,217,196,.3); border-radius:20px; padding:3px 10px 3px 8px; white-space:nowrap; }
  #page-teststream .ts-override-badge::before { content:''; width:5px; height:5px; border-radius:50%; background:var(--ts-signal);
    box-shadow:0 0 6px var(--ts-signal); animation:tsBlip 1.6s ease-in-out infinite; }
  #page-teststream .ts-override-badge.show { display:inline-flex; }
  @keyframes tsBlip { 0%,100%{ opacity:1; } 50%{ opacity:.35; } }

  #page-teststream .ts-seg { display:flex; background:var(--input-bg); border:1px solid var(--border); border-radius:9px; padding:3px; gap:3px; position:relative; }
  #page-teststream .ts-seg-btn { flex:1; text-align:center; padding:8px 0; border-radius:7px; font-size:13px; font-weight:600;
    color:var(--text2); cursor:pointer; transition:color .2s; user-select:none; position:relative; z-index:1; }
  #page-teststream .ts-seg-btn.active { color:#fff; }
  #page-teststream .ts-seg-btn:not(.active):hover { color:var(--text); }
  #page-teststream .ts-seg-btn.active::before { content:''; position:absolute; inset:0; z-index:-1; border-radius:6px;
    background:linear-gradient(135deg, var(--accent), var(--ts-glow2)); box-shadow:0 0 12px rgba(255,138,61,.3); }

  #page-teststream #ts-season-field { display:grid; grid-template-rows:1fr; opacity:1; transition:grid-template-rows .22s ease, opacity .18s ease, margin .22s ease; margin-bottom:14px; }
  #page-teststream #ts-season-field.ts-hidden { grid-template-rows:0fr; opacity:0; margin-bottom:0; pointer-events:none; }
  #page-teststream #ts-season-field > div { overflow:hidden; min-height:0; }

  #page-teststream .form-actions { justify-content:space-between; }
  #page-teststream .btn-save { background:linear-gradient(135deg, var(--accent), var(--ts-glow2)); box-shadow:0 6px 18px -6px rgba(255,77,61,.5); border:none; }
  #page-teststream .btn-save:hover { filter:brightness(1.07); background:linear-gradient(135deg, var(--accent), var(--ts-glow2)); }
  #page-teststream .ts-kbd-hint { text-align:center; font-size:10.5px; color:var(--muted); margin-top:9px; }
  #page-teststream .ts-kbd-hint kbd { background:var(--surface2); border:1px solid var(--border); border-radius:4px; padding:1px 5px; font-family:inherit; }

  #page-teststream .ts-result-empty { display:flex; flex-direction:column; align-items:center; justify-content:center;
    text-align:center; padding:44px 20px; color:var(--muted); }
  #page-teststream .ts-result-empty .ico { width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center;
    font-size:19px; margin-bottom:14px; background:radial-gradient(circle, rgba(45,217,196,.12), transparent 70%); border:1px solid var(--border); }
  #page-teststream .ts-result-empty .t1 { font-family:'Space Grotesk',sans-serif; font-size:13.5px; font-weight:700; color:var(--text2); margin-bottom:4px; }
  #page-teststream .ts-result-empty .t2 { font-size:12px; max-width:260px; line-height:1.5; }

  #page-teststream .ts-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:50px 20px; }
  #page-teststream .ts-eq { display:flex; align-items:flex-end; gap:4px; height:26px; }
  #page-teststream .ts-eq span { width:4px; border-radius:2px; background:linear-gradient(180deg, var(--ts-glow2), var(--ts-signal)); animation:tsEq .85s ease-in-out infinite; }
  #page-teststream .ts-eq span:nth-child(1){ animation-delay:0s; } #page-teststream .ts-eq span:nth-child(2){ animation-delay:.12s; }
  #page-teststream .ts-eq span:nth-child(3){ animation-delay:.24s; } #page-teststream .ts-eq span:nth-child(4){ animation-delay:.36s; }
  #page-teststream .ts-eq span:nth-child(5){ animation-delay:.48s; }
  @keyframes tsEq { 0%,100%{ height:5px; } 50%{ height:26px; } }
  #page-teststream .ts-loading .lbl { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--text2); }

  #page-teststream .ts-result-head { display:flex; align-items:center; gap:12px; padding:13px 15px; margin-top:16px;
    border-radius:9px; background:var(--surface); border:1px solid var(--border); position:relative; overflow:hidden; }
  #page-teststream .ts-result-head::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--muted); }
  #page-teststream .ts-result-head.ok::before { background:linear-gradient(180deg, var(--ts-signal), var(--ts-glow2)); box-shadow:0 0 10px rgba(45,217,196,.5); }
  #page-teststream .ts-result-head .ts-result-title { font-weight:700; font-family:'Space Grotesk',sans-serif; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #page-teststream .ts-result-head .ts-result-time { color:var(--muted); font-size:11px; flex-shrink:0; }

  #page-teststream .ts-stream-list { margin-top:12px; border:1px solid var(--border); border-radius:9px; overflow:hidden; }
  #page-teststream .ts-stream-row { display:flex; align-items:center; gap:13px; padding:11px 14px; background:var(--surface); transition:background .15s; }
  #page-teststream .ts-stream-row:hover { background:var(--card-hover); }
  #page-teststream .ts-stream-row + .ts-stream-row { border-top:1px solid var(--border); }
  #page-teststream .ts-stream-row .preview-thumb, #page-teststream .ts-stream-row .preview-link { flex-shrink:0; width:64px; height:37px; border-radius:6px; transition:box-shadow .15s; }
  #page-teststream .ts-stream-row .preview-thumb:hover { box-shadow:0 0 0 2px var(--ts-signal); }
  #page-teststream .ts-stream-row .preview-link { display:flex; align-items:center; justify-content:center; background:var(--surface2);
    font-size:15px; text-decoration:none; }
  #page-teststream .ts-stream-row .ts-stream-info { flex:1; min-width:0; }
  #page-teststream .ts-stream-row .ts-stream-title { font-size:13px; font-weight:600; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #page-teststream .ts-stream-row .ts-stream-meta { font-size:11.5px; color:var(--muted); }

  #page-teststream .trace-box { margin-top:14px; border:1px solid var(--border); border-radius:9px; background:var(--surface); padding:13px 16px; }
  #page-teststream .trace-title { font-family:'Space Grotesk',sans-serif; }
  #page-teststream .trace-step { position:relative; display:flex; align-items:center; gap:9px; padding:6px 0 6px 16px; border-bottom:none; }
  #page-teststream .trace-step::before { content:''; position:absolute; left:1px; top:50%; transform:translateY(-50%);
    width:7px; height:7px; border-radius:50%; background:var(--muted); transition:box-shadow .2s; }
  #page-teststream .trace-step.ok::before { background:var(--ts-signal); box-shadow:0 0 7px var(--ts-signal); }
  #page-teststream .trace-step.fail::before { background:var(--ts-fail); box-shadow:0 0 7px var(--ts-fail); }
  #page-teststream .trace-step.ok .trace-step-name { color:var(--ts-signal); }
  #page-teststream .trace-step.fail .trace-step-name { color:var(--ts-fail); }
  #page-teststream .trace-step::after { content:''; position:absolute; left:4.5px; top:calc(50% + 7px); bottom:-6px; width:1px; background:var(--border); }
  #page-teststream .trace-step:last-child::after { display:none; }
  #page-teststream .trace-step .trace-ms { font-family:'JetBrains Mono',monospace; }
  #page-teststream .trace-icon { display:none; }

  #page-teststream .ts-history { margin-top:18px; }
  #page-teststream .ts-history-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin-bottom:9px; }
  #page-teststream .ts-history-list { display:flex; flex-direction:column; gap:6px; }
  #page-teststream .ts-hist-item { display:flex; align-items:center; gap:10px; background:var(--surface); border:1px solid var(--border);
    border-radius:9px; padding:9px 13px; cursor:pointer; transition:border-color .15s, transform .15s; }
  #page-teststream .ts-hist-item:hover { border-color:var(--ts-signal); transform:translateX(2px); }
  #page-teststream .ts-hist-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  #page-teststream .ts-hist-dot.ok { background:var(--ts-signal); box-shadow:0 0 6px var(--ts-signal); }
  #page-teststream .ts-hist-dot.fail { background:var(--ts-fail); box-shadow:0 0 6px var(--ts-fail); }
  #page-teststream .ts-hist-name { font-size:12.5px; font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #page-teststream .ts-hist-meta { font-size:11px; color:var(--muted); flex-shrink:0; font-family:'JetBrains Mono',monospace; }


  @media (max-width:800px) {
    .sidebar { display:none; }
    .main { margin-left:0; padding:20px 16px 60px; }
    .stats-grid { grid-template-columns:repeat(2,1fr); }
    .ov-grid-2 { grid-template-columns:1fr; }
    .form-grid { grid-template-columns:1fr; }
  }
</style>
</head>
<body>

  <div id="login-screen">
    <div class="login-card">
      <div class="login-logo"><img src="/logo_transparent_check.png" alt="Logo" style="width:56px;height:56px"></div>
      <div class="login-title">Bandes-Annonces VF</div>
      <div class="login-sub">Accès dashboard</div>
      <div class="login-error" id="login-error">Mot de passe incorrect</div>
      <div class="field">
        <label>Mot de passe</label>
        <input type="password" id="login-password" placeholder="••••••••" onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <button class="btn-primary" onclick="doLogin()">Se connecter</button>
    </div>
  </div>

  <div id="dashboard">
    <div class="layout">
      <div class="sidebar">
        <div class="sidebar-logo">
          <div class="sidebar-logo-brand">
            <img src="/logo_transparent_check.png" alt="Logo" style="width:28px;height:28px;flex-shrink:0">
            <div class="sidebar-logo-text">
              <div class="title">Bandes-Annonces VF</div>
              <div class="sub">Dashboard</div>
            </div>
          </div>
          <button class="theme-btn" id="theme-btn" onclick="toggleTheme()">🌙</button>
        </div>
        <div class="sidebar-nav">
          <div class="nav-section-label">Menu</div>
          <button class="nav-item active" data-page="overview" onclick="showPage('overview')">📊 Vue d'ensemble</button>
          <button class="nav-item" data-page="users" onclick="showPage('users')">👥 Utilisateurs</button>
          <button class="nav-item" data-page="recovery" onclick="showPage('recovery')">🔄 Récupération</button>
          <button class="nav-item" data-page="configure" onclick="showPage('configure')">🎨 Page Configure</button>
          <button class="nav-item" data-page="logs" onclick="showPage('logs')">📋 Logs<span class="nav-badge" id="logs-badge" style="display:none">0</span></button>

          <div class="nav-section-label">Stremio</div>
          <button class="nav-item" data-page="mapping" onclick="showPage('mapping')">🔗 Mapping des liens<span class="nav-badge" id="failed-badge" style="display:none">0</span></button>
          <button class="nav-item" data-page="requests" onclick="showPage('requests')">📥 Demandes<span class="nav-badge" id="requests-badge" style="display:none">0</span></button>
          <button class="nav-item" data-page="teststream" onclick="showPage('teststream')">🔬 Test des flux</button>

          <div class="nav-section-label">Réglages</div>
          <button class="nav-item" data-page="settings" onclick="showPage('settings')">⚙️ Réglages</button>
        </div>
        <div class="sidebar-bottom">
          <button class="btn-logout" onclick="logout()">Déconnexion</button>
        </div>
      </div>

      <div class="main">

        <!-- PAGE: OVERVIEW -->
        <div class="page active" id="page-overview">
          <div class="page-header">
            <div><div class="page-title">Vue d'ensemble</div><div class="page-sub">Statistiques d'utilisation de l'addon</div></div>
            <div class="header-actions">
              <span class="ov-updated" id="ov-updated">—</span>
              <button class="btn-outline-sm" onclick="loadOverview()">↻ Actualiser</button>
              <button class="btn-add" onclick="resetStats()">🗑️ Vider les stats</button>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card c-red">
              <div class="stat-icon">📡</div>
              <div class="stat-label">Requêtes totales</div>
              <div class="stat-value" id="stat-total">—</div>
              <div class="stat-trend" id="trend-total"></div>
            </div>
            <div class="stat-card c-blue">
              <div class="stat-icon">🎬</div>
              <div class="stat-label">Films</div>
              <div class="stat-value" id="stat-movies">—</div>
              <div class="stat-trend" id="trend-movies"></div>
            </div>
            <div class="stat-card c-purple">
              <div class="stat-icon">📺</div>
              <div class="stat-label">Séries</div>
              <div class="stat-value" id="stat-series">—</div>
              <div class="stat-trend" id="trend-series"></div>
            </div>
            <div class="stat-card c-green">
              <div class="stat-icon">📅</div>
              <div class="stat-label">Aujourd'hui</div>
              <div class="stat-value" id="stat-today">—</div>
              <div class="stat-trend" id="trend-today"></div>
            </div>
          </div>

          <div class="card" id="aiom-card">
            <div class="card-head">
              <div>
                <div class="card-title">🧩 AIOMetadata</div>
                <div class="card-desc" id="aiom-desc">Chargement...</div>
              </div>
              <button class="btn-outline-sm" onclick="openAiomLogs()">Voir dans les logs</button>
            </div>
            <div class="card-body">
              <div class="stats-grid-mini" style="margin-bottom:0">
                <div class="mini-stat" onclick="openAiomLogs()">
                  <div class="mini-stat-icon c-blue2">📨</div>
                  <div><div class="stat-value" style="font-size:22px" id="aiom-stat-total">—</div><div class="stat-label">Requêtes loguées</div></div>
                </div>
                <div class="mini-stat" onclick="openAiomLogs()">
                  <div class="mini-stat-icon c-green2">✅</div>
                  <div><div class="stat-value" style="font-size:22px" id="aiom-stat-hit">—</div><div class="stat-label">Trailer renvoyé</div></div>
                </div>
                <div class="mini-stat" onclick="openAiomLogs()">
                  <div class="mini-stat-icon c-orange">⚡</div>
                  <div><div class="stat-value" style="font-size:22px" id="aiom-stat-ms">—</div><div class="stat-label">Durée médiane</div></div>
                </div>
                <div class="mini-stat" onclick="openAiomLogs()">
                  <div class="mini-stat-icon c-red2">⏱️</div>
                  <div><div class="stat-value" style="font-size:22px" id="aiom-stat-timeout">—</div><div class="stat-label">Trop lent</div></div>
                </div>
              </div>
            </div>
          </div>

          <div class="ov-grid-2">
            <div class="card">
              <div class="card-head"><div class="card-title">Activité — 14 derniers jours</div></div>
              <div class="card-body"><div class="ov-chart-wrap" id="chart-svg"></div></div>
            </div>
            <div class="card">
              <div class="card-head"><div class="card-title">Répartition Film / Série</div></div>
              <div class="card-body" id="split-body"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Titres les plus demandés</div></div>
            <table><thead><tr><th>#</th><th>Titre</th><th>IMDB ID</th><th style="text-align:right">Demandes</th><th></th></tr></thead>
            <tbody id="top-titles-body"><tr class="empty-row"><td colspan="5">Chargement...</td></tr></tbody></table>
          </div>
        </div>

        <!-- PAGE: USERS -->
        <div class="page" id="page-users">
          <div class="page-header">
            <div><div class="page-title">Utilisateurs</div><div class="page-sub">Installations actives de l'addon — une install = une combinaison clé TMDB + pseudo</div></div>
            <div class="header-actions">
              <span class="ov-updated" id="install-updated">—</span>
              <button class="btn-outline-sm" onclick="loadInstallStats()">↻ Actualiser</button>
              <button class="btn-add" onclick="resetInstallStats()">🗑️ Vider les données</button>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card c-red">
              <div class="stat-icon">📦</div>
              <div class="stat-label">Installations actives</div>
              <div class="stat-value" id="install-stat-total">—</div>
              <div class="stat-trend" id="install-trend-total"></div>
            </div>
            <div class="stat-card c-green">
              <div class="stat-icon">✅</div>
              <div class="stat-label">Actives aujourd'hui</div>
              <div class="stat-value" id="install-stat-today">—</div>
              <div class="stat-trend" id="install-trend-today"></div>
            </div>
            <div class="stat-card c-blue">
              <div class="stat-icon">👥</div>
              <div class="stat-label">Utilisateurs suivis</div>
              <div class="stat-value" id="install-stat-users">—</div>
              <div class="stat-trend" id="install-trend-users"></div>
            </div>
            <div class="stat-card c-purple">
              <div class="stat-icon">📊</div>
              <div class="stat-label">Requêtes manifest</div>
              <div class="stat-value" id="install-stat-req">—</div>
              <div class="stat-trend" id="install-trend-req"></div>
            </div>
          </div>

          <div class="ov-grid-2">
            <div class="card">
              <div class="card-head"><div class="card-title">Activité — 14 derniers jours</div></div>
              <div class="card-body"><div class="ov-chart-wrap" id="install-chart-svg"></div></div>
            </div>
            <div class="card">
              <div class="card-head"><div class="card-title">Pseudo renseigné ou anonyme</div></div>
              <div class="card-body" id="user-split-body"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Liste des utilisateurs</div></div>
            <div class="table-toolbar">
              <input type="text" id="users-filter" placeholder="🔍 Filtrer par pseudo..." oninput="renderUsersTable()">
            </div>
            <table><thead><tr><th>Utilisateur</th><th>Première activité</th><th>Dernière activité</th><th style="text-align:right">Requêtes</th><th></th></tr></thead>
            <tbody id="users-body"><tr class="empty-row"><td colspan="5">Chargement...</td></tr></tbody></table>
          </div>
        </div>

        <!-- PAGE: RECOVERY -->
        <div class="page" id="page-recovery">
          <div class="page-header">
            <div><div class="page-title">Récupération</div><div class="page-sub">Personnes qui refont leur config via la page /recuperation (nouvelle adresse)</div></div>
            <div class="header-actions">
              <span class="ov-updated" id="recovery-updated">—</span>
              <button class="btn-outline-sm" onclick="loadRecoveryStats()">↻ Actualiser</button>
              <button class="btn-add" onclick="resetRecoveryStats()">🗑️ Vider les données</button>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-card c-red">
              <div class="stat-icon">🔄</div>
              <div class="stat-label">Ont lancé la récupération</div>
              <div class="stat-value" id="rec-stat-total">—</div>
              <div class="stat-trend" id="rec-trend-total"></div>
            </div>
            <div class="stat-card c-green">
              <div class="stat-icon">✅</div>
              <div class="stat-label">Confirmés (addon actif)</div>
              <div class="stat-value" id="rec-stat-confirmed">—</div>
              <div class="stat-trend" id="rec-trend-confirmed"></div>
            </div>
            <div class="stat-card c-blue">
              <div class="stat-icon">⏳</div>
              <div class="stat-label">En attente</div>
              <div class="stat-value" id="rec-stat-pending">—</div>
              <div class="stat-trend"><span class="trend-flat">cliqué, pas encore vu actif</span></div>
            </div>
            <div class="stat-card c-purple">
              <div class="stat-icon">📅</div>
              <div class="stat-label">Aujourd'hui</div>
              <div class="stat-value" id="rec-stat-today">—</div>
              <div class="stat-trend" id="rec-trend-today"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Récupérations — 14 derniers jours</div></div>
            <div class="card-body"><div class="ov-chart-wrap" id="recovery-chart-svg"></div></div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Liste</div></div>
            <table><thead><tr><th>Utilisateur</th><th>Premier clic</th><th>Statut</th><th style="text-align:right">Clics</th></tr></thead>
            <tbody id="recovery-body"><tr class="empty-row"><td colspan="4">Chargement...</td></tr></tbody></table>
          </div>
        </div>

        <!-- PAGE: MAPPING -->
        <div class="page" id="page-mapping">
          <div class="page-header">
            <div><div class="page-title">Mapping des liens</div><div class="page-sub">Force une bande-annonce précise pour un film/série, ou corrige un mauvais résultat</div></div>
            <div class="header-actions">
              <button class="btn-outline-sm" onclick="exportOverrides()">⬇️ Exporter</button>
              <button class="btn-outline-sm" onclick="document.getElementById('import-file').click()">⬆️ Importer</button>
              <input type="file" id="import-file" accept="application/json" style="display:none" onchange="importOverrides(event)">
            </div>
          </div>

          <div class="stats-grid-mini">
            <div class="mini-stat">
              <div class="mini-stat-icon c-blue2">🎯</div>
              <div class="mini-stat-body">
                <div class="mini-stat-label">Overrides actifs</div>
                <div class="mini-stat-value" id="map-stat-overrides">0</div>
              </div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-icon c-green2">✅</div>
              <div class="mini-stat-body">
                <div class="mini-stat-label">Résolutions (1h)</div>
                <div class="mini-stat-value" id="map-stat-resolved">0</div>
              </div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-icon c-red2">⚠️</div>
              <div class="mini-stat-body">
                <div class="mini-stat-label">Échecs (50)</div>
                <div class="mini-stat-value" id="map-stat-failed">0</div>
              </div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-icon c-orange">🚫</div>
              <div class="mini-stat-body">
                <div class="mini-stat-label">Masqués</div>
                <div class="mini-stat-value" id="map-stat-hidden">0</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title" id="mapping-form-title">🎯 Ajouter / modifier un override <span class="form-mode-badge" id="form-mode-badge">Nouveau</span></div></div>
            <div class="card-body">
              <div class="edit-banner" id="edit-banner">
                <span id="edit-banner-text">Modification d'un override existant</span>
                <button onclick="cancelEditOverride()">Annuler</button>
              </div>

              <div class="form-step">
                <div class="form-step-head"><span class="step-num">1</span><div><div class="step-title">Identifier le titre</div><div class="step-desc">Le film ou la série concerné, et son IMDB ID</div></div></div>
                <div class="form-field">
                  <label>Chercher un titre <span class="hint">(recherche TMDB — remplit l'IMDB ID automatiquement)</span></label>
                  <div class="tmdb-search-wrap">
                    <input type="text" id="tmdb-search" placeholder="Ex: Duel au soleil, The Bear..." autocomplete="off" oninput="onTmdbSearchInput()">
                    <div class="tmdb-results" id="tmdb-results"></div>
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-field">
                    <label>IMDB ID <span class="hint">(ex: tt15239678, ou colle l'URL IMDB complète)</span></label>
                    <input type="text" id="ov-imdb" placeholder="tt15239678 ou https://www.imdb.com/title/..." oninput="checkDuplicateOverride()" onblur="normalizeImdbField()">
                  </div>
                  <div class="form-field">
                    <label>Saison <span class="hint">(séries uniquement, laisser vide sinon)</span></label>
                    <input type="number" id="ov-season" placeholder="ex: 2" min="1" oninput="checkDuplicateOverride()">
                  </div>
                </div>
                <div class="dup-warning" id="dup-warning" style="display:none; font-size:12px; padding:8px 12px; border-radius:8px; margin-top:-4px; background:rgba(229,62,62,0.08); border:1px solid rgba(229,62,62,0.25); color:#fc8181;"></div>
              </div>

              <div class="form-step">
                <div class="form-step-head"><span class="step-num">2</span><div><div class="step-title">Choisir la bande-annonce</div><div class="step-desc">Cherche la vidéo VF, ou colle un lien directement</div></div></div>
                <div class="form-field">
                  <label>Chercher sur YouTube <span class="hint">(recherche la bande-annonce VF — remplit l'ID + le titre)</span></label>
                  <div class="yt-search-wrap">
                    <input type="text" id="yt-search" placeholder="Ex: bande-annonce VF + titre du film..." autocomplete="off" oninput="onYtSearchInput()">
                    <div class="tmdb-results" id="yt-results"></div>
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-field">
                    <label>Lien 1 — YouTube ID <span class="hint">(collé ou choisi ci-dessus)</span></label>
                    <input type="text" id="ov-ytid" placeholder="dQw4w9WgXcQ ou https://youtube.com/watch?v=..." oninput="onOverrideLinkInput(0)" onblur="normalizeYoutubeField()">
                    <div class="link-status" id="link-status-0"></div>
                  </div>
                  <div class="form-field">
                    <label>Lien 1 — OU URL directe <span class="hint">(mp4/hls, si pas YouTube)</span></label>
                    <input type="text" id="ov-url" placeholder="https://..." oninput="onOverrideLinkInput(0)">
                    <div class="link-status" id="link-status-url"></div>
                  </div>
                  <div class="form-field full" id="ov-fallbacks-wrap" style="display:none">
                    <label>Liens de repli <span class="hint">(servis si le lien 1 devient indisponible, par ordre de priorité)</span></label>
                    <div id="ov-fallbacks"></div>
                    <button class="btn-save2" type="button" onclick="addFallbackLink()">➕ Ajouter un lien de repli</button>
                  </div>
                </div>
                <div class="form-actions-inline">
                  <button class="btn-test" type="button" onclick="testOverrideLink()">🧪 Tester le lien</button>
                  <span class="link-test-result" id="link-test-result"></span>
                </div>
                <div class="form-preview" id="form-preview-wrap">
                  <button class="form-preview-play" onclick="openPreviewFromForm()">▶️ Lire</button>
                  <img class="form-preview-thumb" id="form-preview-thumb" alt="">
                  <div class="form-preview-info">
                    <div class="form-preview-title" id="form-preview-name">Aperçu de la bande-annonce</div>
                    <div class="form-preview-meta" id="form-preview-meta"></div>
                  </div>
                </div>
              </div>

              <div class="form-step">
                <div class="form-step-head"><span class="step-num">3</span><div><div class="step-title">Personnaliser <span class="hint">(optionnel)</span></div><div class="step-desc">Titre affiché dans Stremio, notes, masquage</div></div></div>
                <div class="form-field full">
                  <label>Titre affiché dans Stremio <span class="hint">(optionnel)</span></label>
                  <input type="text" id="ov-title" placeholder="Bande-annonce VF - Officielle">
                </div>
                <div class="form-field full">
                  <label>Notes internes <span class="hint">(raison de ce mapping — non affichées dans Stremio)</span></label>
                  <textarea id="ov-notes" placeholder="Ex: trailer officiel en 720p, la source auto donnait une mauvaise vidéo"></textarea>
                </div>
                <input type="hidden" id="ov-mediatype">

                <div class="toggle-row" style="border:1px solid var(--border); border-radius:9px; padding:12px 16px">
                  <div>
                    <div class="label">🚫 Masquer ce titre</div>
                    <div class="desc">Aucune bande-annonce ne sera proposée dans Stremio pour cet IMDB ID (utile si aucune version VF correcte n'existe)</div>
                  </div>
                  <label class="switch"><input type="checkbox" id="ov-hidden" oninput="toggleHiddenMode()"><span class="slider"></span></label>
                </div>
              </div>

              <div class="form-actions">
                <button class="btn-save" id="ov-submit-btn" onclick="submitOverride()">Enregistrer l'override</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head mapping-tabs-head">
              <div class="mapping-tabs">
                <button class="maptab active" data-tab="overrides" onclick="switchMappingTab('overrides')">🎯 Overrides actifs <span class="tab-count" id="tab-count-overrides">0</span></button>
                <button class="maptab" data-tab="resolved" onclick="switchMappingTab('resolved')">✅ Résolutions récentes <span class="tab-count" id="tab-count-resolved">0</span></button>
                <button class="maptab" data-tab="failed" onclick="switchMappingTab('failed')">⚠️ Échecs récents <span class="tab-count" id="tab-count-failed">0</span></button>
              </div>
              <button class="btn-outline-sm" id="mapping-clear-btn" style="display:none" onclick="clearActiveMappingLog()">Vider le journal</button>
            </div>
            <div class="card-desc" id="mapping-tab-desc" style="padding:0 20px 14px">Overrides que tu as configurés manuellement</div>
            <div class="table-toolbar">
              <input type="text" id="mapping-filter" placeholder="🔍 Filtrer par IMDB ID ou titre..." oninput="mappingPage=0;renderActiveMappingTab()">
              <div class="mapping-sort" id="mapping-sort">
                <span class="mapping-sort-label">Tri</span>
                <button class="mapping-sort-opt active" data-sort="imdb" onclick="setMappingSort('imdb')">IMDB</button>
                <button class="mapping-sort-opt" data-sort="title" onclick="setMappingSort('title')">Titre</button>
                <button class="mapping-sort-opt" data-sort="uses" onclick="setMappingSort('uses')">Usages</button>
                <button class="mapping-sort-opt" data-sort="hidden" onclick="setMappingSort('hidden')">Masqués</button>
              </div>
            </div>

            <div id="mapping-tab-overrides" class="mapping-tab-panel">
              <div class="table-toolbar bulk-bar" id="bulk-bar" style="display:none">
                <span id="bulk-count">0 sélectionné(s)</span>
                <button class="btn-outline-sm" onclick="bulkToggleHidden()">🚫 Masquer / ✅ Afficher</button>
                <button class="btn-outline-sm danger" onclick="bulkDelete()">🗑️ Supprimer</button>
                <button class="btn-outline-sm" onclick="clearSelection()">Annuler</button>
              </div>
              <table><thead><tr><th style="width:30px"><input type="checkbox" id="overrides-checkall" onchange="toggleCheckAll()"></th><th>Aperçu</th><th>IMDB ID</th><th>Saison</th><th>Titre</th><th>Source</th><th style="text-align:right">Usages</th><th></th></tr></thead>
              <tbody id="overrides-body"><tr class="empty-row"><td colspan="8">Chargement...</td></tr></tbody></table>
              <div class="mapping-pagination" id="mapping-pagination" style="display:none"></div>
            </div>

            <div id="mapping-tab-resolved" class="mapping-tab-panel" style="display:none">
              <table><thead><tr><th>Aperçu</th><th>Titre</th><th>IMDB ID</th><th>Saison</th><th>Source</th><th></th></tr></thead>
              <tbody id="resolved-body"><tr class="empty-row"><td colspan="6">Chargement...</td></tr></tbody></table>
            </div>

            <div id="mapping-tab-failed" class="mapping-tab-panel" style="display:none">
              <table><thead><tr><th>Titre</th><th>IMDB ID</th><th>Type</th><th>Saison</th><th style="text-align:right">Échecs</th><th>Dernière fois</th><th></th></tr></thead>
              <tbody id="failed-body"><tr class="empty-row"><td colspan="7">Chargement...</td></tr></tbody></table>
            </div>
          </div>
        </div>

        <!-- PAGE: DEMANDES (propositions communautaires) -->
        <div class="page" id="page-requests">
          <div class="page-header">
            <div><div class="page-title">Demandes</div><div class="page-sub">Propositions de liens envoyées par les visiteurs via la page publique — accepte pour remplacer le lien, ou refuse.</div></div>
          </div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
              <div>
                <div style="font-size:13px;font-weight:700;margin-bottom:3px">🔗 Page publique de proposition</div>
                <div style="font-size:12px;color:var(--text2)">Partage ce lien : n'importe qui peut proposer un lien, sans accès au dashboard.</div>
              </div>
              <button class="btn-outline-sm" onclick="copyContributeLink()">⧉ Copier le lien /proposer</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head mapping-tabs-head">
              <div class="mapping-tabs">
                <button class="maptab active" data-tab="pending" onclick="switchRequestsTab('pending')">🕓 En attente <span class="tab-count" id="tab-count-req-pending">0</span></button>
                <button class="maptab" data-tab="accepted" onclick="switchRequestsTab('accepted')">✅ Acceptées <span class="tab-count" id="tab-count-req-accepted">0</span></button>
                <button class="maptab" data-tab="rejected" onclick="switchRequestsTab('rejected')">🚫 Refusées <span class="tab-count" id="tab-count-req-rejected">0</span></button>
              </div>
            </div>

            <div id="requests-tab-pending" class="mapping-tab-panel">
              <table><thead><tr><th>Aperçu</th><th>Titre</th><th>Proposé par</th><th>Note</th><th>Date</th><th></th></tr></thead>
              <tbody id="requests-pending-body"><tr class="empty-row"><td colspan="6">Chargement...</td></tr></tbody></table>
            </div>
            <div id="requests-tab-accepted" class="mapping-tab-panel" style="display:none">
              <table><thead><tr><th>Aperçu</th><th>Titre</th><th>Proposé par</th><th>Date</th></tr></thead>
              <tbody id="requests-accepted-body"><tr class="empty-row"><td colspan="4">Chargement...</td></tr></tbody></table>
            </div>
            <div id="requests-tab-rejected" class="mapping-tab-panel" style="display:none">
              <table><thead><tr><th>Aperçu</th><th>Titre</th><th>Proposé par</th><th>Date</th></tr></thead>
              <tbody id="requests-rejected-body"><tr class="empty-row"><td colspan="4">Chargement...</td></tr></tbody></table>
            </div>
          </div>
        </div>

        <!-- PAGE: TEST FLUX -->
        <div class="page" id="page-teststream">
          <div class="page-header">
            <div><div class="page-title">Test des flux</div><div class="page-sub">Simule une résolution avec les réglages actuels — ne touche ni au cache, ni aux stats, ni aux logs</div></div>
          </div>

          <div class="card">
            <div class="card-head"><div class="ts-head-icon">🎬</div><div class="card-title">Tester un film ou une série</div></div>
            <div class="card-body">
              <div class="form-field">
                <label>Chercher un titre <span class="hint">(recherche TMDB — remplit l'IMDB ID, le type et lance le test automatiquement)</span></label>
                <div class="tmdb-search-wrap">
                  <input type="text" id="test-tmdb-search" placeholder="Ex: Duel au soleil, The Bear..." autocomplete="off" oninput="onTestTmdbSearchInput()">
                  <div class="tmdb-results" id="test-tmdb-results"></div>
                </div>
              </div>

              <div class="form-grid">
                <div class="form-field ts-imdb-field">
                  <div class="ts-imdb-label-row">
                    <label>IMDB ID <span class="hint">(ex: tt15239678, ou colle l'URL IMDB complète)</span></label>
                    <span class="ts-override-badge" id="ts-override-badge" title="Un override existe pour ce titre — il sera utilisé sauf si tu coches « Ignorer l'override »">Override existant</span>
                  </div>
                  <input type="text" id="ts-imdb" placeholder="tt15239678 ou https://www.imdb.com/title/..."
                         onblur="normalizeTsImdbField()" oninput="scheduleOverrideCheck()"
                         onkeydown="if(event.key==='Enter'){event.preventDefault();runStreamTest();}">
                </div>
                <div class="form-field">
                  <label>Type</label>
                  <div class="ts-seg">
                    <div class="ts-seg-btn active" id="ts-seg-movie" onclick="setTsType('movie')">🎬 Film</div>
                    <div class="ts-seg-btn" id="ts-seg-series" onclick="setTsType('series')">📺 Série</div>
                  </div>
                  <select id="ts-type" style="display:none"><option value="movie">Film</option><option value="series">Série</option></select>
                </div>
                <div class="form-field ts-hidden" id="ts-season-field">
                  <div>
                    <label>Saison</label>
                    <input type="number" id="ts-season" min="1" placeholder="ex: 2"
                           onkeydown="if(event.key==='Enter'){event.preventDefault();runStreamTest();}">
                  </div>
                </div>
              </div>
              <div class="toggle-row" style="margin-top:6px">
                <div><div class="label">Ignorer l'override</div><div class="desc">Tester la chaîne normale (TMDB → Allociné → YouTube) même si un override existe pour ce titre</div></div>
                <label class="switch"><input type="checkbox" id="ts-ignore-override" onchange="scheduleOverrideCheck()"><span class="slider"></span></label>
              </div>
              <div class="toggle-row" style="margin-top:6px">
                <div><div class="label">Simuler AIOMetadata</div><div class="desc">Montre ce que renvoie le mode « Compatible AIOMetadata » : un seul flux YouTube ou lien direct, sans lien externe ni « Proposer »</div></div>
                <label class="switch"><input type="checkbox" id="ts-aiom"><span class="slider"></span></label>
              </div>
              <div class="form-actions">
                <button class="btn-outline-sm" onclick="resetTsForm()">Effacer</button>
                <button class="btn-save" id="ts-btn" onclick="runStreamTest()">🔬 Tester</button>
              </div>
              <div class="ts-kbd-hint">Astuce : <kbd>Entrée</kbd> dans un champ lance le test</div>
              <div id="ts-result">
                <div class="ts-result-empty" id="ts-result-empty">
                  <div class="ico">🔬</div>
                  <div class="t1">Aucun test lancé</div>
                  <div class="t2">Cherche un titre ou colle un IMDB ID, puis clique sur Tester.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="ts-history" id="ts-history" style="display:none">
            <div class="ts-history-label">Derniers tests de cette session</div>
            <div class="ts-history-list" id="ts-history-list"></div>
          </div>
        </div>

        <!-- PAGE: CONFIGURE -->
        <div class="page" id="page-configure">
          <div class="page-header">
            <div><div class="page-title">Page Configure</div><div class="page-sub">Textes et apparence de la page publique /configure (installation de l'addon)</div></div>
            <div class="header-actions">
              <a href="/configure" target="_blank" class="btn-outline-sm">👁️ Voir en direct ↗</a>
              <button class="btn-add" onclick="resetConfigureDefaults()">↺ Réinitialiser</button>
            </div>
          </div>

          <div class="config-preview-card">
            <div class="card-head"><div class="card-title">👁️ Aperçu en direct</div></div>
            <div class="card-body">
              <iframe id="cfg-preview" class="config-preview-frame" title="Aperçu /configure" sandbox="allow-scripts" loading="lazy"></iframe>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Navigation</div></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="form-field"><label>Nom affiché en haut à gauche</label><input type="text" id="cfg-brandName" placeholder="ex: Wallace"></div>
                <div class="form-field"></div>
                <div class="form-field"><label>Texte du lien en haut à droite</label><input type="text" id="cfg-navLinkText" placeholder="ex: Discord"></div>
                <div class="form-field"><label>URL du lien</label><input type="text" id="cfg-navLinkUrl" placeholder="https://discord.gg/..."></div>
              </div>
              <div class="hint" style="margin-top:-4px;margin-bottom:14px">Laisse l'URL vide pour masquer complètement ce lien.</div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">En-tête</div></div>
            <div class="card-body">
              <div class="hint" style="margin-top:-4px;margin-bottom:14px">Le badge "test" a été remplacé par un vrai check en direct de TMDB/YouTube/Allociné (point vert/rouge), non éditable ici.</div>
              <div class="form-grid">
                <div class="form-field"><label>Titre principal (blanc)</label><input type="text" id="cfg-heroTitleWhite"></div>
                <div class="form-field"><label>Titre principal (rouge)</label><input type="text" id="cfg-heroTitleRed"></div>
              </div>
              <div class="form-field full"><label>Sous-titre <span class="hint">(laisser vide pour masquer)</span></label><textarea id="cfg-heroSubtitle"></textarea></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">🎨 Apparence</div></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="form-field"><label>Couleur de marque <span class="hint">(boutons, titre, accents de la page)</span></label>
                  <div class="color-pick-row">
                    <input type="color" id="cfg-accentColor" value="#e53e3e">
                    <input type="text" id="cfg-accentColorText" placeholder="#e53e3e" maxlength="7">
                  </div>
                </div>
                <div class="form-field"></div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Textes des sections</div></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="form-field"><label>Section « Configuration »</label><input type="text" id="cfg-sectionConfigLabel"></div>
                <div class="form-field"><label>Section « Profil »</label><input type="text" id="cfg-sectionProfileLabel"></div>
                <div class="form-field"><label>Section « Affichage des liens »</label><input type="text" id="cfg-sectionLinksLabel"></div>
              </div>
              <div class="form-field full"><label>Indice clé TMDB</label><textarea id="cfg-tmdbKeyHint"></textarea></div>
              <div class="form-field full"><label>Indice pseudo Discord</label><textarea id="cfg-pseudoHint"></textarea></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Textes du formulaire & barre d'installation</div></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="form-field"><label>Titre du toggle « liens externes »</label><input type="text" id="cfg-externalToggleTitle"></div>
                <div class="form-field"><label>Description du toggle</label><input type="text" id="cfg-externalToggleDesc"></div>
                <div class="form-field"><label>Label « nombre max de liens »</label><input type="text" id="cfg-maxLinksLabel"></div>
                <div class="form-field"><label>Indice « nombre max de liens »</label><input type="text" id="cfg-maxLinksHint"></div>
                <div class="form-field"><label>Label « extras »</label><input type="text" id="cfg-extrasSelectLabel"></div>
                <div class="form-field"><label>Indice « extras »</label><input type="text" id="cfg-extrasSelectHint"></div>
                <div class="form-field"><label>Bouton « Installer dans Stremio »</label><input type="text" id="cfg-installAppLabel"></div>
                <div class="form-field"><label>Bouton « Web »</label><input type="text" id="cfg-installWebLabel"></div>
                <div class="form-field"><label>Bouton « Copier le lien »</label><input type="text" id="cfg-installCopyLabel"></div>
              </div>
              <div class="form-actions"><button class="btn-save" onclick="saveConfigureSettings()">💾 Enregistrer les modifications</button></div>
            </div>
          </div>

        </div>

        <!-- PAGE: SETTINGS -->
        <div class="page" id="page-settings">
          <div class="page-header">
            <div><div class="page-title">Réglages</div><div class="page-sub">Comportement de résolution des bandes-annonces</div></div>
            <div class="header-actions">
              <span id="settings-save-state" class="save-state"></span>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">🩺 Diagnostic</div>
                <div class="card-desc" id="diag-desc">Vérification en cours...</div>
              </div>
              <button class="btn-outline-sm" onclick="loadDiagnostics(true)">🔄 Re-vérifier</button>
            </div>
            <div class="diagnostics-grid" id="diag-grid">
              <div class="diag-item"><span class="diag-label">Redis</span><span class="diag-val diag-pending" data-diag="redis">…</span></div>
              <div class="diag-item"><span class="diag-label">Clé TMDB serveur</span><span class="diag-val diag-pending" data-diag="tmdbkey">…</span></div>
              <div class="diag-item"><span class="diag-label">TMDB</span><span class="diag-val diag-pending" data-diag="svc-tmdb">…</span></div>
              <div class="diag-item"><span class="diag-label">YouTube</span><span class="diag-val diag-pending" data-diag="svc-youtube">…</span></div>
              <div class="diag-item"><span class="diag-label">Allociné</span><span class="diag-val diag-pending" data-diag="svc-allocine">…</span></div>
              <div class="diag-item"><span class="diag-label">Cache</span><span class="diag-val diag-pending" data-diag="cache">…</span></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div><div class="card-title">🔗 Sources de résolution</div><div class="card-desc">Ordre de repli : TMDB d'abord, puis Allociné, puis YouTube en dernier recours</div></div></div>
            <div class="toggle-row">
              <div><div class="label">Repli sur Allociné</div><div class="desc">Si TMDB ne trouve rien, tenter le scraping Allociné en dernier recours</div></div>
              <label class="switch"><input type="checkbox" id="set-allocineFallback"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Repli sur recherche YouTube</div><div class="desc">Si TMDB et Allociné ne trouvent rien, chercher directement sur YouTube (scraping, pas d'API/quota — source la moins fiable des trois, filtrée mais pas curatée)</div></div>
              <label class="switch"><input type="checkbox" id="set-youtubeSearchFallback"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Repli sur Dailymotion</div><div class="desc">Tout dernier recours, après YouTube. Via l'API publique Dailymotion (pas de scraping) — résultat proposé uniquement en "ouvrir en externe", pas jouable dans le lecteur intégré</div></div>
              <label class="switch"><input type="checkbox" id="set-dailymotionFallback"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Ignorer les teasers</div><div class="desc">Ne renvoyer que les bandes-annonces (type "Trailer"), pas les "Teaser" — utile quand un teaser passe avant le vrai trailer</div></div>
              <label class="switch"><input type="checkbox" id="set-ignoreTeasers"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Inclure les extras</div><div class="desc">En plus des bandes-annonces et teasers, renvoyer les vidéos "extras" de TMDB : récaps de saison, extraits (clips), making-of, coulisses, bêtisiers, génériques. Surchargeable par utilisateur sur /configure (par défaut : ce réglage)</div></div>
              <label class="switch"><input type="checkbox" id="set-includeExtras"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Langue des vidéos TMDB</div><div class="desc">"Français puis autre" cherche d'abord les vidéos fr-FR puis la langue par défaut TMDB ; "Français uniquement" ne garde que les vidéos fr-FR</div></div>
              <select id="set-trailerLanguage" class="logs-select">
                <option value="fr-first">Français puis autre langue (recommandé)</option>
                <option value="fr-only">Français uniquement</option>
              </select>
            </div>
            <div class="toggle-row">
              <div><div class="label">Nombre max de bandes-annonces</div><div class="desc">Combien de résultats renvoyer au maximum par titre (1 à 3)</div></div>
              <div class="field-inline"><input type="number" id="set-maxTrailers" min="1" max="3"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div><div class="card-title">🧩 AIOMetadata</div><div class="card-desc">Réglages du mode « Compatible AIOMetadata » (case à cocher sur /configure)</div></div></div>
            <div class="toggle-row">
              <div><div class="label">Délai maximum de réponse (secondes)</div><div class="desc">Au-delà, l'addon répond sans trailer et AIOMetadata garde celui de son fournisseur. La recherche continue en arrière-plan : le résultat sera dans le cache à la requête suivante. De 1 à 12 s, 5 par défaut</div></div>
              <div class="field-inline"><input type="number" id="set-aiomTimeoutSeconds" min="1" max="12"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div><div class="card-title">💾 Cache</div><div class="card-desc">Mémorise les résultats déjà résolus pour aller plus vite et économiser les appels TMDB</div></div></div>
            <div class="toggle-row">
              <div><div class="label">Cache Redis</div><div class="desc">Activer ou désactiver la mise en cache</div></div>
              <label class="switch"><input type="checkbox" id="set-cacheEnabled"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Durée du cache TMDB (heures)</div><div class="desc">Résultats trouvés via TMDB (catalogué, stable)</div></div>
              <div class="field-inline"><input type="number" id="set-cacheTtlHours" min="1" max="72"></div>
            </div>
            <div class="toggle-row">
              <div><div class="label">Durée du cache Allociné (heures)</div><div class="desc">Plus courte que TMDB : le HTML scrapé peut changer</div></div>
              <div class="field-inline"><input type="number" id="set-allocineCacheTtlHours" min="1" max="72"></div>
            </div>
            <div class="toggle-row">
              <div><div class="label">Durée du cache YouTube search (heures)</div><div class="desc">La plus courte : source la moins fiable, re-vérifiée souvent</div></div>
              <div class="field-inline"><input type="number" id="set-youtubeSearchCacheTtlHours" min="1" max="72"></div>
            </div>
            <div class="toggle-row">
              <div><div class="label">Mettre aussi en cache les échecs</div><div class="desc">Si rien n'est trouvé pour un titre, mémoriser cet échec aussi — évite de re-scraper Allociné/YouTube à chaque requête pour un titre qui échoue systématiquement</div></div>
              <label class="switch"><input type="checkbox" id="set-cacheFailures"><span class="slider"></span></label>
            </div>
            <div class="toggle-row">
              <div><div class="label">Durée du cache d'échec (minutes)</div><div class="desc">Volontairement plus courte que le cache de succès : un override ou une nouvelle vidéo peut corriger le problème entre-temps</div></div>
              <div class="field-inline"><input type="number" id="set-failureCacheTtlMinutes" min="5" max="180"></div>
            </div>
            <div class="toggle-row">
              <div><div class="label">Purger le cache</div><div class="desc" id="cache-stats-desc">Vérification en cours...</div></div>
              <div class="field-inline">
                <button class="btn-outline-sm" onclick="clearTrailerCache('failures')">🧹 Vider les échecs</button>
                <button class="btn-outline-sm" onclick="clearTrailerCache()">🗑️ Tout vider</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">🔤 Mots-clés VOST supplémentaires</div></div>
            <div class="card-body">
              <div class="form-field full">
                <label>Mots-clés à exclure, séparés par des virgules <span class="hint">(en plus de la liste de base : vost, vo, sub...)</span></label>
                <textarea id="set-extraVfKeywords" placeholder="teaser non officiel, fan made"></textarea>
              </div>
              <div class="form-actions">
                <button class="btn-add" onclick="resetBehaviorDefaults()">↺ Réinitialiser</button>
                <button class="btn-save" onclick="saveBehaviorSettings()">Enregistrer les réglages</button>
              </div>
            </div>
          </div>

          <div class="info-box">
            🔒 Le mot de passe du dashboard (<code>DASHBOARD_PASSWORD</code>) se change dans les variables d'environnement Vercel, pas ici — pour des raisons de sécurité.
          </div>
        </div>

        <!-- PAGE: LOGS -->
        <div class="page" id="page-logs">
          <div class="page-header">
            <div><div class="page-title">Logs</div><div class="page-sub">Journal en direct : connexions, réglages, overrides et vrais problèmes de mapping, requêtes AIOMetadata (500 derniers événements)</div></div>
          </div>

          <div class="card services-status-card">
            <div class="card-head">
              <div>
                <div class="card-title">Statut des services</div>
                <div class="card-desc" id="svc-status-desc">Vérification en cours...</div>
              </div>
              <button class="btn-outline-sm" onclick="loadServicesStatus(true)">🔄 Vérifier maintenant</button>
            </div>
            <div class="services-status-grid" id="svc-status-grid">
              <div class="svc-pill svc-pending"><span class="svc-dot"></span>TMDB</div>
              <div class="svc-pill svc-pending"><span class="svc-dot"></span>YouTube</div>
              <div class="svc-pill svc-pending"><span class="svc-dot"></span>Allociné</div>
            </div>
          </div>

          <div class="card">
            <div class="card-head logs-toolbar">
              <div class="logs-group">
                <label>Contexte</label>
                <select class="logs-select" id="logs-ctx" onchange="renderLogs()">
                  <option value="">Tous</option>
                  <option value="AUTH">🔐 Auth</option>
                  <option value="INSTALL">📦 Install</option>
                  <option value="STREAM">🎬 Stream</option>
                  <option value="OVERRIDE">🎯 Override</option>
                  <option value="SETTINGS">⚙️ Réglages</option>
                  <option value="META">ℹ️ Meta</option>
                  <option value="AIOM">🧩 AIOMetadata</option>
                  <option value="SYSTEM">🚀 Système</option>
                </select>
              </div>
              <div class="logs-group">
                <label>Niveau</label>
                <select class="logs-select" id="logs-level" onchange="renderLogs()">
                  <option value="">Tous</option>
                  <option value="info">Info+</option>
                  <option value="warn">Warning+</option>
                  <option value="error">Erreur</option>
                </select>
              </div>
              <div class="logs-group logs-search">
                <input type="text" id="logs-search" placeholder="Rechercher..." oninput="renderLogs()">
              </div>
              <div class="logs-group">
                <label>Rafraîchissement</label>
                <select class="logs-select" id="logs-interval" onchange="restartLogPolling()">
                  <option value="2000">2s</option>
                  <option value="5000" selected>5s</option>
                  <option value="10000">10s</option>
                  <option value="0">Off</option>
                </select>
              </div>
              <button class="logs-pausebtn" id="logs-pausebtn" onclick="toggleLogPause()">⏸️ Pause</button>
              <button class="btn-outline-sm" onclick="exportLogs()">⬇️ Exporter</button>
              <button class="btn-outline-sm" onclick="clearLogs()">🗑️ Vider</button>
              <div class="logs-status" style="margin-left:auto">
                <div class="logs-dot" id="logs-dot"></div>
                <span id="logs-statustext">Live</span>
              </div>
            </div>
            <div class="logs-term" id="logs-term">
              <div class="logs-empty"><div class="icon">📋</div><p>En attente de logs...</p></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <div class="modal-overlay" id="preview-modal" onclick="if(event.target===this) closePreview()">
    <div class="modal-box">
      <div class="modal-head"><div class="title" id="preview-modal-title">Aperçu</div><button class="modal-close" onclick="closePreview()">✕</button></div>
      <div class="modal-body" id="preview-modal-body"></div>
    </div>
  </div>

<script>
  let token = localStorage.getItem('vftrailers_token') || '';
  let isDark = true;

  async function doLogin() {
    const pwd = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    const card = document.querySelector('.login-card');
    err.style.display = 'none';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        token = data.token;
        localStorage.setItem('vftrailers_token', token);
        showDashboard();
      } else {
        err.textContent = data.error || 'Mot de passe incorrect';
        err.style.display = 'block';
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      }
    } catch (e) {
      err.textContent = 'Erreur de connexion';
      err.style.display = 'block';
    }
  }

  function logout() {
    localStorage.removeItem('vftrailers_token');
    token = '';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  }

  async function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    const initialPage = DASHBOARD_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    showPage(initialPage);
    await refreshFailedBadge();
    await refreshRequestsBadge();
    await refreshLogsBadge();
  }

  function authHeaders(extra) {
    return Object.assign({ 'x-admin-token': token }, extra || {});
  }

  const DASHBOARD_PAGES = ['overview', 'users', 'recovery', 'mapping', 'requests', 'teststream', 'configure', 'settings', 'logs'];

  function showPage(name) {
    if (location.hash.slice(1) !== name) history.pushState(null, '', '#' + name);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.querySelector('.nav-item[data-page="' + name + '"]').classList.add('active');
    if (name === 'overview') loadOverview();
    if (name === 'users') loadInstallStats();
    if (name === 'recovery') loadRecoveryStats();
    if (name === 'mapping') loadMapping();
    if (name === 'requests') loadRequests();
    if (name === 'configure') loadConfigureSettings();
    if (name === 'settings') loadBehaviorSettings();
    if (name === 'logs') initLogsPage();
    else if (logsInterval) { clearInterval(logsInterval); logsInterval = null; } // pas de polling hors de la page logs
  }

  // Bouton précédent/suivant du navigateur : resynchronise la page affichée sur le hash.
  window.addEventListener('popstate', () => {
    const page = DASHBOARD_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    showPage(page);
  });

  // ---- LECTEUR YOUTUBE (aperçus dashboard) ----
  // Contrairement à la lecture dans Stremio (ytId natif transmis au lecteur intégré de
  // l'appli, hors de portée de l'addon), les aperçus ci-dessous tournent DANS ce navigateur.
  // On peut donc piloter le vrai lecteur YouTube via son API officielle (script JS chargé
  // depuis youtube.com, pas de scraping serveur, donc aucun risque de blocage anti-bot) et
  // lui demander la meilleure qualité disponible. YouTube ne garantit pas 1080p à 100% (ça
  // dépend de ce que la vidéo propose et des heuristiques internes du lecteur), donc on le
  // redemande à chaque étape clé (prêt + tout changement d'état) plutôt qu'une seule fois.
  let ytApiReadyPromise = null;
  function loadYoutubeIframeApi() {
    if (ytApiReadyPromise) return ytApiReadyPromise;
    ytApiReadyPromise = new Promise(resolve => {
      if (window.YT && window.YT.Player) { resolve(); return; }
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prevCb) prevCb(); resolve(); };
      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    });
    return ytApiReadyPromise;
  }

  let ytPreviewPlayerSeq = 0;
  // Monte un lecteur YouTube dans le conteneur donné (id d'un élément vide déjà présent
  // dans le DOM) et force la 1080p dès que possible. containerId est consommé par l'API
  // YouTube elle-même (elle remplace l'élément par son propre iframe).
  async function mountYoutubePlayer(containerId, ytId) {
    const mySeq = ++ytPreviewPlayerSeq; // évite qu'un montage obsolète (fermé/changé entre-temps) ne s'exécute encore
    try {
      await loadYoutubeIframeApi();
    } catch {
      return; // API indisponible (réseau coupé...) -> tant pis, pas de lecteur, pas de crash
    }
    if (mySeq !== ytPreviewPlayerSeq || !document.getElementById(containerId)) return;
    const forceHd = player => { try { player.setPlaybackQuality('hd1080'); } catch {} };
    new YT.Player(containerId, {
      videoId: ytId,
      playerVars: { autoplay: 1, vq: 'hd1080' },
      events: {
        onReady: e => forceHd(e.target),
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) forceHd(e.target);
        },
      },
    });
  }

  // ---- OVERVIEW ----
  async function loadOverview() {
    try {
      const res = await fetch('/api/dashboard-stats', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      const data = await res.json();

      document.getElementById('ov-updated').textContent = 'MAJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (!data.configured) {
        ['stat-total', 'stat-movies', 'stat-series', 'stat-today'].forEach(id => document.getElementById(id).textContent = '⚠️');
        document.getElementById('top-titles-body').innerHTML =
          '<tr class="empty-row"><td colspan="5">Redis non configuré — ajoute UPSTASH_REDIS_REST_URL / TOKEN sur Vercel</td></tr>';
        document.getElementById('chart-svg').innerHTML = '';
        document.getElementById('split-body').innerHTML = '';
        return;
      }

      animateNumber(document.getElementById('stat-total'), data.total);
      animateNumber(document.getElementById('stat-movies'), data.movieCount);
      animateNumber(document.getElementById('stat-series'), data.seriesCount);
      animateNumber(document.getElementById('stat-today'), data.todayCount);

      const pctMovie = data.total ? Math.round((data.movieCount / data.total) * 100) : 0;
      document.getElementById('trend-movies').innerHTML = '<span class="trend-flat">' + pctMovie + '% des demandes</span>';
      document.getElementById('trend-series').innerHTML = '<span class="trend-flat">' + (100 - pctMovie) + '% des demandes</span>';
      document.getElementById('trend-total').innerHTML = '<span class="trend-up">+' + data.todayCount + ' aujourd\\'hui</span>';

      const days = data.days || [];
      const yesterday = days.length >= 2 ? days[days.length - 2].count : 0;
      const diff = data.todayCount - yesterday;
      const tEl = document.getElementById('trend-today');
      if (diff > 0) tEl.innerHTML = '<span class="trend-up">▲ +' + diff + ' vs hier</span>';
      else if (diff < 0) tEl.innerHTML = '<span class="trend-down">▼ ' + diff + ' vs hier</span>';
      else tEl.innerHTML = '<span class="trend-flat">• stable vs hier</span>';

      document.getElementById('chart-svg').innerHTML = renderTrendChart(days);
      renderSplit(data.movieCount, data.seriesCount);

      const body = document.getElementById('top-titles-body');
      const topMax = Math.max(1, ...data.topTitles.map(t => t.count));
      body.innerHTML = !data.topTitles.length
        ? '<tr class="empty-row"><td colspan="5">Aucune donnée pour l\\'instant</td></tr>'
        : data.topTitles.map((t, i) => renderTopTitle(t, i, topMax)).join('');
      loadAiomStats();
    } catch (e) { toast('❌ Erreur de chargement des stats'); }
  }

  // ---- Carte AIOMetadata (calculée à partir du journal : contexte AIOM) ----
  // Le journal est borné (500 lignes) et dédoublonné (5 min par titre) : ce sont des tendances
  // sur les dernières requêtes loguées, pas un compteur exact. Les stats globales ne les comptent pas.
  async function loadAiomStats() {
    const desc = document.getElementById('aiom-desc');
    const set = function (id, v) { document.getElementById(id).textContent = v; };
    try {
      const res = await fetch('/api/logs', { headers: authHeaders() });
      if (!res.ok) return;
      const logs = (await res.json()).filter(function (l) { return l.context === 'AIOM' && l.event === 'aiom_request' && l.meta; });
      if (!logs.length) {
        set('aiom-stat-total', '0'); set('aiom-stat-hit', '—'); set('aiom-stat-ms', '—'); set('aiom-stat-timeout', '0');
        desc.textContent = 'Aucune requête pour l’instant — coche « Compatible AIOMetadata » sur /configure et colle le lien dans AIOMetadata › Trailers.';
        return;
      }
      const hits = logs.filter(function (l) { return l.meta.result === 'ytId' || l.meta.result === 'url'; }).length;
      const timeouts = logs.filter(function (l) { return l.meta.result === 'timeout'; }).length;
      const msList = logs.map(function (l) { return parseInt(l.meta.ms, 10); })
        .filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
      const median = msList.length ? msList[Math.floor(msList.length / 2)] : null;
      set('aiom-stat-total', String(logs.length));
      set('aiom-stat-hit', Math.round((hits / logs.length) * 100) + '%');
      set('aiom-stat-ms', median === null ? '—' : (median >= 1000 ? (median / 1000).toFixed(1) + ' s' : median + ' ms'));
      set('aiom-stat-timeout', String(timeouts));
      const oldest = logs[logs.length - 1].time;
      desc.textContent = 'Sur les ' + logs.length + ' dernières requêtes loguées (depuis ' + timeAgoFr(oldest).replace('il y a ', '') + ') — hors stats globales';
    } catch (e) {
      desc.textContent = 'Impossible de lire le journal AIOMetadata pour le moment.';
    }
  }

  function openAiomLogs() {
    showPage('logs');
    document.getElementById('logs-ctx').value = 'AIOM';
    renderLogs();
  }

  function renderTopTitle(t, i, topMax) {
    const hasImdb = t.imdbId && /^tt\\d+$/.test(t.imdbId);
    const medal = ['🥇', '🥈', '🥉'][i] || String(i + 1).padStart(2, '0');
    const share = Math.max(Math.round((t.count / topMax) * 100), 4);
    const actions = hasImdb
      ? '<button class="small-btn" onclick="testFromOverview(\\'' + escapeAttr(t.imdbId) + '\\',\\'' + escapeAttr(t.title || '') + '\\')" title="Tester ce titre">🔬</button>' +
        '<button class="small-btn" onclick="overrideFromOverview(\\'' + escapeAttr(t.imdbId) + '\\',\\'' + escapeAttr(t.title || '') + '\\')" title="Créer un override">🎯</button>'
      : '';
    return '<tr>' +
      '<td class="rank">' + medal + '</td>' +
      '<td>' + escapeHtml(t.title || 'Inconnu') + '<div class="top-share"><div class="top-share-bar" style="width:' + share + '%"></div></div></td>' +
      '<td class="muted mono">' + escapeHtml(t.imdbId || '—') + '</td>' +
      '<td class="count">' + t.count + '</td>' +
      '<td class="row-actions">' + actions + '</td>' +
      '</tr>';
  }

  // Graphique en aires (SVG) des 14 derniers jours.
  function renderTrendChart(days) {
    if (!days || !days.length) return '<div class="empty-row">Aucune donnée</div>';
    const W = 600, H = 170, PX = 12, PY = 24, PB = 32;
    const maxDay = Math.max(1, ...days.map(d => d.count));
    const n = days.length;
    const stepX = n > 1 ? (W - PX * 2) / (n - 1) : 0;
    const yOf = v => H - PB - (v / maxDay) * (H - PY - PB);
    const pts = days.map((d, i) => ({ x: PX + i * stepX, y: yOf(d.count), c: d.count }));
    const baseY = H - PB;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const area = line + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + baseY + ' L' + pts[0].x.toFixed(1) + ' ' + baseY + ' Z';
    const last = pts[pts.length - 1];
    const grid = [0.25, 0.5, 0.75, 1].map(f => {
      const gy = baseY - f * (H - PY - PB);
      return '<line x1="' + PX + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PX) + '" y2="' + gy.toFixed(1) + '" class="ov-chart-grid"/>';
    }).join('');
    const labelEvery = Math.max(1, Math.round(n / 6));
    const labels = pts.map((p, i) => {
      if (i !== n - 1 && i % labelEvery !== 0) return '';
      return '<text x="' + p.x.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="ov-chart-xlabel"' + (i === n - 1 ? ' style="fill:var(--accent);font-weight:800"' : '') + '>' +
        new Date(days[i].date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + '</text>';
    }).join('');
    const dots = pts.map((p, i) => '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" style="fill:var(--surface);stroke:var(--accent);stroke-width:2"><title>' + p.c + ' requêtes le ' + new Date(days[i].date).toLocaleDateString('fr-FR') + '</title></circle>').join('');
    return '<svg class="ov-chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="ov-fill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" style="stop-color:var(--accent);stop-opacity:0.32"/>' +
      '<stop offset="100%" style="stop-color:var(--accent);stop-opacity:0"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#ov-fill)"/>' +
      '<path d="' + line + '" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="9" fill="var(--accent)" opacity="0.18"/>' +
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="4" fill="var(--accent)"/>' +
      dots + labels +
      '</svg>';
  }

  // Donut de répartition Film / Série.
  function renderSplit(movieCount, seriesCount) {
    renderDonut('split-body', [
      { label: 'Films', value: movieCount, color: '#60a5fa' },
      { label: 'Séries', value: seriesCount, color: '#a78bfa' },
    ], 'demandes');
  }

  // Donut de répartition Pseudo renseigné / Anonyme.
  function renderUserSplit(pseudos, anons) {
    renderDonut('user-split-body', [
      { label: 'Pseudos renseignés', value: pseudos, color: '#48bb78' },
      { label: 'Anonymes', value: anons, color: '#94a3b8' },
    ], 'utilisateurs');
  }

  // Donut générique : segments = [{ label, value, color }].
  function renderDonut(bodyId, segments, totalText) {
    const body = document.getElementById(bodyId);
    const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);
    if (!total) { body.innerHTML = '<div class="empty-row">Aucune donnée pour l\\'instant</div>'; return; }
    const R = 40, C = 2 * Math.PI * R;
    let acc = 0;
    let arcs = '<circle cx="50" cy="50" r="' + R + '" fill="none" style="stroke:var(--surface2)" stroke-width="13"/>';
    segments.forEach(seg => {
      const len = ((seg.value || 0) / total) * C;
      arcs += '<circle cx="50" cy="50" r="' + R + '" fill="none" style="stroke:' + seg.color + '" stroke-width="13" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 50 50)"/>';
      acc += len;
    });
    const legend = segments.map(seg => {
      const pct = Math.round(((seg.value || 0) / total) * 100);
      return '<div class="ov-legend-item"><span class="ov-legend-dot" style="background:' + seg.color + '"></span><span>' + seg.label + '</span><b>' + pct + '%</b></div>';
    }).join('');
    body.innerHTML =
      '<div class="ov-split">' +
      '<svg viewBox="0 0 100 100" class="ov-donut">' + arcs +
      '<text x="50" y="46" text-anchor="middle" class="ov-donut-total">' + total.toLocaleString('fr-FR') + '</text>' +
      '<text x="50" y="59" text-anchor="middle" class="ov-donut-sub">' + (totalText || '') + '</text>' +
      '</svg>' +
      '<div class="ov-split-legend">' + legend + '</div>' +
      '</div>';
  }

  // Compteur animé pour les valeurs des cartes.
  function animateNumber(el, target) {
    const dur = 600;
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString('fr-FR');
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Depuis le top titres : tester la résolution de ce titre sur la page Test des flux.
  async function testFromOverview(imdbId, title) {
    if (!/^tt\\d+$/.test(imdbId || '')) { toast('⚠️ Pas d\\'IMDB ID utilisable pour ce titre'); return; }
    document.getElementById('ts-imdb').value = imdbId;
    document.getElementById('ts-season').value = '';
    document.getElementById('test-tmdb-search').value = title || '';
    const typeEl = document.getElementById('ts-type');
    typeEl.value = 'movie';
    onTsTypeChange();
    showPage('teststream');
    try {
      const res = await fetch('/api/tmdb-lookup?imdbId=' + encodeURIComponent(imdbId), { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.mediaType === 'tv') { typeEl.value = 'series'; onTsTypeChange(); }
      }
    } catch (e) { /* silencieux */ }
    scheduleOverrideCheck();
    runStreamTest();
  }

  // Depuis le top titres : pré-remplir le formulaire Mapping pour créer un override.
  function overrideFromOverview(imdbId, title) {
    if (!/^tt\\d+$/.test(imdbId || '')) { toast('⚠️ Pas d\\'IMDB ID utilisable pour ce titre'); return; }
    cancelEditOverride();
    document.getElementById('ov-imdb').value = imdbId;
    document.getElementById('ov-season').value = '';
    document.getElementById('ov-title').value = title || '';
    document.getElementById('ov-mediatype').value = '';
    updateFormPreview();
    document.getElementById('mapping-form-title').textContent = '🎯 Créer un override';
    document.getElementById('edit-banner-text').textContent = 'Nouvel override pour ' + imdbId + ' — renseigne le lien puis enregistre';
    document.getElementById('edit-banner').classList.add('show');
    checkDuplicateOverride();
    showPage('mapping');
    toast('ℹ️ Lien à renseigner — enregistre pour créer l\\'override');
  }

  async function resetStats() {
    if (!confirm('Vider toutes les stats ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/dashboard-stats/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Stats réinitialisées'); await loadOverview(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ---- USERS (installations actives) ----
  async function loadInstallStats() {
    try {
      const res = await fetch('/api/install-stats', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      const data = await res.json();

      document.getElementById('install-updated').textContent = 'MAJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (!data.configured) {
        ['install-stat-total', 'install-stat-today', 'install-stat-users', 'install-stat-req'].forEach(id => document.getElementById(id).textContent = '⚠️');
        document.getElementById('users-body').innerHTML =
          '<tr class="empty-row"><td colspan="5">Redis non configuré — ajoute UPSTASH_REDIS_REST_URL / TOKEN sur Vercel</td></tr>';
        document.getElementById('install-chart-svg').innerHTML = '';
        document.getElementById('user-split-body').innerHTML = '';
        return;
      }

      const users = data.users || [];
      const totalRequests = users.reduce((s, u) => s + (u.requestCount || 0), 0);
      const pseudos = users.filter(u => u.pseudo).length;

      animateNumber(document.getElementById('install-stat-total'), data.total);
      animateNumber(document.getElementById('install-stat-today'), data.activeToday);
      animateNumber(document.getElementById('install-stat-users'), users.length);
      animateNumber(document.getElementById('install-stat-req'), totalRequests);

      document.getElementById('install-trend-total').innerHTML = '<span class="trend-up">+' + data.activeToday + ' aujourd\\'hui</span>';
      document.getElementById('install-trend-users').innerHTML = '<span class="trend-flat">' + pseudos + ' pseudo(s) renseigné(s)</span>';
      document.getElementById('install-trend-req').innerHTML = '<span class="trend-flat">moy. ' + (users.length ? Math.round(totalRequests / users.length) : 0) + ' / install</span>';

      const days = data.days || [];
      const yesterday = days.length >= 2 ? days[days.length - 2].count : 0;
      const diff = data.activeToday - yesterday;
      const tEl = document.getElementById('install-trend-today');
      if (diff > 0) tEl.innerHTML = '<span class="trend-up">▲ +' + diff + ' vs hier</span>';
      else if (diff < 0) tEl.innerHTML = '<span class="trend-down">▼ ' + diff + ' vs hier</span>';
      else tEl.innerHTML = '<span class="trend-flat">• stable vs hier</span>';

      document.getElementById('install-chart-svg').innerHTML = renderTrendChart(days);
      renderUserSplit(pseudos, users.length - pseudos);

      usersData = users;
      renderUsersTable();
    } catch (e) { toast('❌ Erreur de chargement des utilisateurs'); }
  }

  function renderUsersTable() {
    const filter = (document.getElementById('users-filter').value || '').toLowerCase().trim();
    const body = document.getElementById('users-body');
    const filtered = !filter ? usersData : usersData.filter(u => (u.pseudo || 'anonyme').toLowerCase().includes(filter));
    const maxReq = Math.max(1, ...usersData.map(u => u.requestCount || 0));

    body.innerHTML = !filtered.length
      ? '<tr class="empty-row"><td colspan="5">' + (usersData.length ? 'Aucun résultat pour ce filtre' : "Aucune installation pour l'instant") + '</td></tr>'
      : filtered.map(u => {
          const pseudo = u.pseudo || 'Anonyme';
          const isAnon = !u.pseudo;
          const req = u.requestCount || 0;
          const share = Math.max(Math.round((req / maxReq) * 100), 4);
          return '<tr>' +
            '<td><div class="user-cell">' +
            '<div class="user-avatar' + (isAnon ? ' anon' : '') + '">' + escapeHtml((pseudo.charAt(0) || '?').toUpperCase()) + '</div>' +
            '<div><div class="user-name">' + escapeHtml(pseudo) + (isAnon ? ' <span class="user-anon-badge">anonyme</span>' : '') + '</div>' +
            '<div class="user-sub muted">' + timeAgo(u.lastSeen) + '</div></div></div></td>' +
            '<td class="muted">' + new Date(u.firstSeen).toLocaleDateString('fr-FR') + '<div class="user-sub muted">' + timeAgo(u.firstSeen) + '</div></td>' +
            '<td class="muted">' + new Date(u.lastSeen).toLocaleString('fr-FR') + '</td>' +
            '<td class="count">' + req + '<div class="top-share" style="margin-top:5px"><div class="top-share-bar" style="width:' + share + '%"></div></div></td>' +
            '<td class="row-actions"><button class="small-btn danger" onclick="deleteInstallUser(\\'' + escapeAttr(u.id) + '\\',\\'' + escapeAttr(pseudo) + '\\')" title="Supprimer">🗑️</button></td>' +
            '</tr>';
        }).join('');
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "à l\\'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    const h = Math.floor(min / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    const d = Math.floor(h / 24);
    if (d < 30) return 'il y a ' + d + ' j';
    return 'il y a ' + Math.floor(d / 30) + ' mois';
  }

  async function deleteInstallUser(id, pseudo) {
    if (!confirm(\`Supprimer \${pseudo} de la liste ? Ses stats seront effacées, mais son addon continuera de fonctionner normalement (ce n'est qu'une ligne de suivi, pas un accès).\`)) return;
    try {
      const res = await fetch(\`/api/install-stats/\${encodeURIComponent(id)}\`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Utilisateur supprimé'); await loadInstallStats(); }
      else toast('❌ Erreur lors de la suppression');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function resetInstallStats() {
    if (!confirm('Vider toutes les données d\\'installation ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/install-stats/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Données réinitialisées'); await loadInstallStats(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ---- RÉCUPÉRATION (gens qui ont refait leur config via /recuperation) ----
  async function loadRecoveryStats() {
    try {
      const res = await fetch('/api/recovery-stats', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      const data = await res.json();
      document.getElementById('recovery-updated').textContent = 'MAJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (!data.configured) {
        ['rec-stat-total', 'rec-stat-confirmed', 'rec-stat-pending', 'rec-stat-today'].forEach(id => document.getElementById(id).textContent = '⚠️');
        document.getElementById('recovery-body').innerHTML = '<tr class="empty-row"><td colspan="4">Base de données non configurée (DATABASE_URL)</td></tr>';
        document.getElementById('recovery-chart-svg').innerHTML = '';
        return;
      }

      animateNumber(document.getElementById('rec-stat-total'), data.total);
      animateNumber(document.getElementById('rec-stat-confirmed'), data.confirmed);
      animateNumber(document.getElementById('rec-stat-pending'), data.pending);
      animateNumber(document.getElementById('rec-stat-today'), data.today);

      const pct = data.total ? Math.round((data.confirmed / data.total) * 100) : 0;
      document.getElementById('rec-trend-total').innerHTML = '<span class="trend-flat">personnes uniques</span>';
      document.getElementById('rec-trend-confirmed').innerHTML = '<span class="trend-up">' + pct + ' % des clics</span>';
      document.getElementById('rec-trend-today').innerHTML = '<span class="trend-flat">nouveaux clics</span>';

      document.getElementById('recovery-chart-svg').innerHTML = renderTrendChart(data.days || []);

      const users = data.users || [];
      document.getElementById('recovery-body').innerHTML = !users.length
        ? '<tr class="empty-row"><td colspan="4">Personne pour le moment</td></tr>'
        : users.map(u => {
            const pseudo = u.pseudo || 'Anonyme';
            const isAnon = !u.pseudo;
            const status = u.confirmed
              ? '<span class="trend-up">✅ Confirmé</span><div class="user-sub muted">actif ' + timeAgo(u.lastSeen) + '</div>'
              : '<span class="trend-flat">⏳ En attente</span>';
            return '<tr>' +
              '<td><div class="user-cell">' +
              '<div class="user-avatar' + (isAnon ? ' anon' : '') + '">' + escapeHtml((pseudo.charAt(0) || '?').toUpperCase()) + '</div>' +
              '<div><div class="user-name">' + escapeHtml(pseudo) + (isAnon ? ' <span class="user-anon-badge">anonyme</span>' : '') + '</div></div></div></td>' +
              '<td class="muted">' + new Date(u.firstClick).toLocaleString('fr-FR') + '<div class="user-sub muted">' + timeAgo(u.firstClick) + '</div></td>' +
              '<td>' + status + '</td>' +
              '<td class="count">' + u.clickCount + '</td>' +
              '</tr>';
          }).join('');
    } catch (e) { toast('❌ Erreur de chargement de la récupération'); }
  }

  async function resetRecoveryStats() {
    if (!confirm('Vider les données de récupération ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/recovery-stats/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Données réinitialisées'); await loadRecoveryStats(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ---- MAPPING ----
  let overridesData = [];
  let failedData = [];
  let resolvedData = [];
  let usersData = [];
  let editingKey = null; // { imdbId, season } de l'override en cours d'édition, null si création
  let tmdbSearchTimer = null;
  let tmdbSearchSeq = 0;
  let ytSearchTimer = null;
  let ytSearchSeq = 0;
  let overrideLinks = []; // liens de repli [{ ytId }|{ url }] au-delà du lien 1 (champ ov-ytid/ov-url)
  let linkTestTimer = null;
  let linkTestSeq = 0;

  async function loadMapping() {
    mappingPage = 0;
    try {
      const [ovRes, failRes, resRes] = await Promise.all([
        fetch('/api/overrides', { headers: authHeaders() }),
        fetch('/api/failed-log', { headers: authHeaders() }),
        fetch('/api/resolved-log', { headers: authHeaders() }),
      ]);
      overridesData = await ovRes.json();
      failedData = await failRes.json();
      resolvedData = await resRes.json();

      document.getElementById('tab-count-overrides').textContent = overridesData.length;
      document.getElementById('tab-count-failed').textContent = failedData.length;
      document.getElementById('tab-count-resolved').textContent = resolvedData.length;

      document.getElementById('map-stat-overrides').textContent = overridesData.length;
      document.getElementById('map-stat-resolved').textContent = resolvedData.length;
      document.getElementById('map-stat-failed').textContent = failedData.length;
      document.getElementById('map-stat-hidden').textContent = overridesData.filter(o => o.hidden).length;

      renderActiveMappingTab();

      const badge = document.getElementById('failed-badge');
      if (failedData.length) { badge.style.display = 'inline-block'; badge.textContent = failedData.length; }
      else badge.style.display = 'none';
    } catch (e) { toast('❌ Erreur de chargement du mapping'); }
  }

  // ---- MAPPING — onglets unifiés (Overrides actifs / Résolutions récentes / Échecs récents) ----
  let mappingActiveTab = 'overrides';
  let mappingSort = 'imdb';
  let mappingPage = 0;
  const MAPPING_PAGE_SIZE = 10;
  const MAPPING_TAB_DESC = {
    overrides: 'Overrides que tu as configurés manuellement',
    resolved: "Bandes-annonces trouvées automatiquement dans la dernière heure — utile pour override un mauvais résultat même sans échec",
    failed: "Titres pour lesquels aucun trailer n'a été trouvé — bons candidats pour un override",
  };
  function switchMappingTab(tab) {
    mappingActiveTab = tab;
    document.querySelectorAll('.maptab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.mapping-tab-panel').forEach(p => p.style.display = p.id === 'mapping-tab-' + tab ? '' : 'none');
    document.getElementById('mapping-tab-desc').textContent = MAPPING_TAB_DESC[tab];
    document.getElementById('mapping-clear-btn').style.display = tab === 'overrides' ? 'none' : 'inline-flex';
    document.getElementById('mapping-sort').style.display = tab === 'overrides' ? '' : 'none';
    renderActiveMappingTab();
  }
  // Change le tri des overrides (contrôle segmenté) et re-rend la liste active.
  function setMappingSort(sort) {
    mappingSort = sort;
    document.querySelectorAll('.mapping-sort-opt').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
    renderActiveMappingTab();
  }
  function renderActiveMappingTab() {
    if (mappingActiveTab === 'overrides') renderOverridesTable();
    else if (mappingActiveTab === 'resolved') renderResolvedTable();
    else renderFailedTable();
  }
  function clearActiveMappingLog() {
    if (mappingActiveTab === 'resolved') clearResolvedLog();
    else if (mappingActiveTab === 'failed') clearFailedLog();
  }

  // Liste prioritaire des liens d'un override : lien principal (ytId/url) puis replis (links).
  function overrideLinkList(o) {
    const links = [];
    const seen = new Set();
    const push = (ytId, url) => {
      const yt = ytId ? extractYoutubeId(ytId) : null;
      const u = url && url.trim() ? url.trim() : null;
      if (!yt && !u) return;
      const key = (yt || '') + '|' + (u || '');
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ ytId: yt, url: u });
    };
    if (Array.isArray(o.links) && o.links.length) {
      for (const l of o.links) push(l.ytId, l.url);
    } else {
      push(o.ytId, o.url);
    }
    return links;
  }

  // Ouvre l'aperçu de TOUS les liens d'un override (principal + replis), avec
  // navigation entre eux dans la modale.
  function openOverridePreview(o) {
    const links = overrideLinkList(o);
    if (!links.length) return;
    const title = o.title || 'Aperçu';
    document.getElementById('preview-modal-title').textContent = title;
    const body = document.getElementById('preview-modal-body');
    body.classList.add('preview-multi');
    const render = (idx) => {
      const l = links[idx];
      const useYt = l.ytId && /^[a-zA-Z0-9_-]{11}$/.test(l.ytId);
      const player = useYt
        ? \`<div id="ov-preview-player"></div>\`
        : (l.url && /^https?:\\/\\//.test(l.url)
          ? \`<video src="\${escapeAttr(l.url)}" controls autoplay></video>\`
          : '<div class="info-box" style="padding:24px;text-align:center;color:var(--muted)">Lien invalide — vérifie le mapping</div>');
      body.innerHTML = (links.length > 1
        ? \`<div class="preview-link-nav">\${links.map((x, i) =>
            \`<button class="small-btn \${i === idx ? 'active' : ''}" onclick="openOverridePreviewAt(\${i})">\${i === 0 ? 'Lien 1' : 'Repli ' + i}\${x.ytId ? '' : ' (URL)'}</button>\`
          ).join('')}</div>\`
        : '') +
        \`<div class="preview-player">\${player}</div>\`;
      if (useYt) mountYoutubePlayer('ov-preview-player', l.ytId);
    };
    window._overridePreviewLinks = links;
    window.openOverridePreviewAt = render;
    render(0);
    document.getElementById('preview-modal').classList.add('show');
  }

  function openOverridePreviewByKey(imdbId, season) {
    const o = overridesData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    if (o) openOverridePreview(o);
  }

  function overrideThumb(o) {
    if (o.hidden) return '<span class="muted">🚫</span>';
    const links = overrideLinkList(o);
    if (!links.length) return '<span class="muted">—</span>';
    const key = escapeAttr(o.imdbId) + "','" + escapeAttr(o.season || '');
    if (links[0].ytId) return \`<img class="preview-thumb" src="https://img.youtube.com/vi/\${links[0].ytId}/mqdefault.jpg" onclick="openOverridePreviewByKey('\${key}')" alt="">\`;
    return \`<span class="preview-link" onclick="openOverridePreviewByKey('\${key}')">▶️ Tester</span>\`;
  }

  function renderOverridesTable() {
    const filter = (document.getElementById('mapping-filter').value || '').toLowerCase().trim();
    const ovBody = document.getElementById('overrides-body');
    let filtered = !filter ? overridesData.slice() : overridesData.filter(o =>
      (o.imdbId || '').toLowerCase().includes(filter) || (o.title || '').toLowerCase().includes(filter));
    const sort = mappingSort;
    if (sort === 'title') filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'));
    else if (sort === 'hidden') filtered.sort((a, b) => (!!b.hidden) - (!!a.hidden));
    else if (sort === 'uses') filtered.sort((a, b) => (b.uses || 0) - (a.uses || 0));
    else filtered.sort((a, b) => (a.imdbId || '').localeCompare(b.imdbId || ''));

    // Pagination : clamp si la page courante dépasse le nouveau nombre de pages.
    const pageCount = Math.max(1, Math.ceil(filtered.length / MAPPING_PAGE_SIZE));
    if (mappingPage >= pageCount) mappingPage = pageCount - 1;
    const pageItems = filtered.slice(mappingPage * MAPPING_PAGE_SIZE, (mappingPage + 1) * MAPPING_PAGE_SIZE);

    const selected = selectedOverrideKeys();
    const allVisibleSelected = pageItems.length > 0 && pageItems.every(o => selected.has(o.imdbId + ':' + (o.season || '')));
    const checkAll = document.getElementById('overrides-checkall');
    if (checkAll) checkAll.checked = allVisibleSelected;

    ovBody.innerHTML = !pageItems.length
      ? \`<tr class="empty-row"><td colspan="8">\${filtered.length ? 'Aucun résultat pour ce filtre' : 'Aucun override configuré'}</td></tr>\`
      : pageItems.map(o => {
          const key = o.imdbId + ':' + (o.season || '');
          return \`
          <tr class="\${o.hidden ? 'override-hidden-row' : ''}">
            <td><input type="checkbox" class="override-check" data-key="\${escapeAttr(key)}" onchange="renderBulkBar()" \${selected.has(key) ? 'checked' : ''}></td>
            <td>\${overrideThumb(o)}</td>
            <td class="mono">\${escapeHtml(o.imdbId)}</td>
            <td class="muted">\${o.season || '—'}</td>
            <td>\${escapeHtml(o.title || '—')}\${o.notes ? \`<div class="override-note" title="\${escapeAttr(o.notes)}">📝 \${escapeHtml(o.notes)}</div>\` : ''}</td>
            <td><span class="badge-type" style="\${o.hidden ? 'background:rgba(229,62,62,0.12);color:var(--accent)' : ''}">\${o.hidden ? '🚫 Masqué' : (o.ytId ? 'YouTube' : 'URL directe')}\${Array.isArray(o.links) && o.links.length > 1 ? ' +' + (o.links.length - 1) : ''}</span>\${Array.isArray(o.links) && o.links.length > 1 && typeof o.activeLinkIndex === 'number' && o.activeLinkIndex > 0 ? \`<div class="link-fallback-warn" title="Le lien principal semble mort : Stremio sert actuellement le repli n°\${o.activeLinkIndex + 1} à sa place — vérifie/remplace le lien principal">⚠️ repli \${o.activeLinkIndex + 1} actif</div>\` : ''}</td>
            <td style="text-align:right"><span class="uses-badge" title="Nombre de fois que cet override a servi">\${o.uses || 0}</span></td>
            <td class="row-actions">
              <button class="small-btn" onclick="toggleOverrideHidden('\${escapeAttr(o.imdbId)}','\${o.season||''}')">\${o.hidden ? '✅ Afficher' : '🚫 Masquer'}</button>
              <button class="small-btn" onclick="editOverride('\${escapeAttr(o.imdbId)}','\${o.season||''}')">Modifier</button>
              <button class="small-btn danger" onclick="deleteOverride('\${escapeAttr(o.imdbId)}','\${o.season||''}')">Supprimer</button>
            </td>
          </tr>
        \`;
        }).join('');
    renderBulkBar();
    renderMappingPagination(filtered.length);
  }

  function renderMappingPagination(total) {
    const el = document.getElementById('mapping-pagination');
    if (!el) return;
    if (total <= MAPPING_PAGE_SIZE) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const pageCount = Math.ceil(total / MAPPING_PAGE_SIZE);
    const start = mappingPage * MAPPING_PAGE_SIZE + 1;
    const end = Math.min(total, (mappingPage + 1) * MAPPING_PAGE_SIZE);
    el.style.display = 'flex';
    el.innerHTML = \`
      <button class="small-btn" onclick="mappingGoPage(0)" \${mappingPage === 0 ? 'disabled' : ''}>⏮</button>
      <button class="small-btn" onclick="mappingGoPage(\${mappingPage - 1})" \${mappingPage === 0 ? 'disabled' : ''}>◀ Précédent</button>
      <span class="mapping-page-info">\${start}–\${end} sur \${total} · page \${mappingPage + 1}/\${pageCount}</span>
      <button class="small-btn" onclick="mappingGoPage(\${mappingPage + 1})" \${mappingPage >= pageCount - 1 ? 'disabled' : ''}>Suivant ▶</button>
      <button class="small-btn" onclick="mappingGoPage(\${pageCount - 1})" \${mappingPage >= pageCount - 1 ? 'disabled' : ''}>⏭</button>
    \`;
  }

  function mappingGoPage(page) {
    mappingPage = page;
    renderOverridesTable();
  }

  // ---- MAPPING — sélection multiple + actions groupées ----
  function selectedOverrideKeys() {
    const set = new Set();
    document.querySelectorAll('.override-check:checked').forEach(cb => set.add(cb.dataset.key));
    return set;
  }

  function toggleCheckAll() {
    const checked = document.getElementById('overrides-checkall').checked;
    document.querySelectorAll('.override-check').forEach(cb => cb.checked = checked);
    renderBulkBar();
  }

  function renderBulkBar() {
    const keys = selectedOverrideKeys();
    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-count');
    if (keys.size) { bar.style.display = 'flex'; count.textContent = keys.size + ' sélectionné(s)'; }
    else { bar.style.display = 'none'; count.textContent = '0 sélectionné(s)'; }
  }

  function clearSelection() {
    document.querySelectorAll('.override-check').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('overrides-checkall');
    if (checkAll) checkAll.checked = false;
    renderBulkBar();
  }

  async function bulkToggleHidden() {
    const keys = [...selectedOverrideKeys()];
    if (!keys.length) return;
    const targets = overridesData.filter(o => keys.includes(o.imdbId + ':' + (o.season || '')));
    if (!confirm(\`\${targets.length} override(s) — basculer masqué/affiché ?\`)) return;
    let ok = 0;
    for (const o of targets) {
      try {
        const res = await fetch('/api/overrides', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ imdbId: o.imdbId, season: o.season || null, ytId: o.ytId || null, url: o.url || null, title: o.title || null, mediaType: o.mediaType || null, links: Array.isArray(o.links) ? o.links : undefined, notes: o.notes || null, hidden: !o.hidden }),
        });
        if (res.ok) ok++;
      } catch (e) { /* silencieux */ }
    }
    toast(\`✅ \${ok}/\${targets.length} basculé(s)\`);
    clearSelection();
    await loadMapping();
  }

  async function bulkDelete() {
    const keys = [...selectedOverrideKeys()];
    if (!keys.length) return;
    const targets = overridesData.filter(o => keys.includes(o.imdbId + ':' + (o.season || '')));
    if (!confirm(\`Supprimer définitivement \${targets.length} override(s) ?\`)) return;
    let ok = 0;
    for (const o of targets) {
      try {
        const res = await fetch('/api/overrides?imdbId=' + encodeURIComponent(o.imdbId) + '&season=' + encodeURIComponent(o.season || ''), { method: 'DELETE', headers: authHeaders() });
        if (res.ok) ok++;
      } catch (e) { /* silencieux */ }
    }
    toast(\`✅ \${ok}/\${targets.length} supprimé(s)\`);
    clearSelection();
    await loadMapping();
  }

  // Bascule l'état "masqué" d'un override (sert à cacher un titre sans supprimer son lien).
  async function toggleOverrideHidden(imdbId, season) {
    const o = overridesData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    if (!o) return;
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          imdbId: o.imdbId,
          season: o.season || null,
          ytId: o.ytId || null,
          url: o.url || null,
          title: o.title || null,
          mediaType: o.mediaType || null,
          links: Array.isArray(o.links) ? o.links : undefined,
          notes: o.notes || null,
          hidden: !o.hidden,
        }),
      });
      if (res.ok) {
        await loadMapping();
        toast(o.hidden ? '✅ Override réactivé' : '🚫 Override masqué — le titre ne sera plus servi');
      } else {
        const err = await res.json().catch(() => null);
        toast('❌ ' + (err && err.error ? err.error : 'Erreur lors de la mise à jour'));
      }
    } catch (e) {
      toast('❌ Erreur réseau');
    }
  }

  function renderFailedTable() {
    const filter = (document.getElementById('mapping-filter').value || '').toLowerCase().trim();
    const failBody = document.getElementById('failed-body');
    const filtered = !filter ? failedData : failedData.filter(f => (f.imdbId || '').toLowerCase().includes(filter) || (f.title || '').toLowerCase().includes(filter));
    // Le titre le plus demandé en échec en premier -- c'est celui qui vaut le plus la
    // peine d'être mappé en priorité (déjà trié par dernière apparition côté serveur,
    // on affine ici par nombre d'échecs pour remonter les cas les plus fréquents).
    const sorted = filtered.slice().sort((a, b) => (b.count || 1) - (a.count || 1));
    failBody.innerHTML = !sorted.length
      ? \`<tr class="empty-row"><td colspan="7">\${failedData.length ? 'Aucun résultat pour ce filtre' : 'Aucun échec récent 🎉'}</td></tr>\`
      : sorted.map(f => \`
          <tr>
            <td>\${escapeHtml(f.title || '—')}</td>
            <td class="mono">\${escapeHtml(f.imdbId)}</td>
            <td><span class="badge-type">\${f.type === 'series' ? 'Série' : 'Film'}</span></td>
            <td class="muted">\${f.season || '—'}</td>
            <td style="text-align:right"><span class="uses-badge" title="Nombre de requêtes en échec pour ce titre">\${f.count || 1}</span></td>
            <td class="muted">\${timeAgo(f.lastSeen || f.time)}</td>
            <td class="row-actions">
              <button class="small-btn" onclick="prefillOverride('\${escapeAttr(f.imdbId)}','\${f.season||''}','\${escapeAttr(f.title||'')}')">🎯 Mapper</button>
            </td>
          </tr>
        \`).join('');
  }

  function resolvedThumb(r) {
    const s = (r.streams || [])[0];
    if (!s) return '<span class="muted">—</span>';
    if (s.ytId) return \`<img class="preview-thumb" src="https://img.youtube.com/vi/\${s.ytId}/mqdefault.jpg" onclick="openPreview('\${s.ytId}', null, '\${escapeAttr(r.title||'Aperçu')}')" alt="">\`;
    if (s.url) return \`<span class="preview-link" onclick="openPreview(null, '\${escapeAttr(s.url)}', '\${escapeAttr(r.title||'Aperçu')}')">▶️ Tester</span>\`;
    return '<span class="muted">—</span>';
  }

  function sourceLabel(src) {
    return src === 'allocine' ? 'Allociné' : src === 'youtube_search' ? 'Recherche YouTube' : src === 'tmdb' ? 'TMDB' : '—';
  }

  function renderResolvedTable() {
    const filter = (document.getElementById('mapping-filter').value || '').toLowerCase().trim();
    const resBody = document.getElementById('resolved-body');
    const filtered = !filter ? resolvedData : resolvedData.filter(r =>
      (r.imdbId || '').toLowerCase().includes(filter) || (r.title || '').toLowerCase().includes(filter));

    resBody.innerHTML = !filtered.length
      ? \`<tr class="empty-row"><td colspan="6">\${resolvedData.length ? 'Aucun résultat pour ce filtre' : 'Aucune résolution récente'}</td></tr>\`
      : filtered.map(r => \`
          <tr>
            <td>\${resolvedThumb(r)}</td>
            <td>\${escapeHtml(r.title || '—')}</td>
            <td class="mono">\${escapeHtml(r.imdbId)}</td>
            <td class="muted">\${r.season || '—'}</td>
            <td><span class="badge-type">\${sourceLabel(r.source)}</span></td>
            <td class="row-actions">
              <button class="small-btn" onclick="testFromOverview('\${escapeAttr(r.imdbId)}','\${escapeAttr(r.title||'')}')">🔬 Tester</button>
              <button class="small-btn" onclick="editOverrideFromResolved('\${escapeAttr(r.imdbId)}','\${r.season||''}','\${escapeAttr(r.title||'')}','\${r.type||''}')">✏️ Modifier</button>
            </td>
          </tr>
        \`).join('');
  }

  async function refreshFailedBadge() {
    try {
      const res = await fetch('/api/failed-log', { headers: authHeaders() });
      const failed = await res.json();
      const badge = document.getElementById('failed-badge');
      if (failed.length) { badge.style.display = 'inline-block'; badge.textContent = failed.length; }
    } catch (e) { /* silencieux */ }
  }

  // ---- DEMANDES (propositions communautaires) ----
  let requestsAll = [];
  let requestsActiveTab = 'pending';

  function copyContributeLink() {
    const link = location.origin + '/proposer';
    navigator.clipboard.writeText(link)
      .then(() => toast('✅ Lien copié : ' + link))
      .catch(() => toast('❌ Impossible de copier, voici le lien : ' + link));
  }

  async function refreshRequestsBadge() {
    try {
      const res = await fetch('/api/contributions', { headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } return; }
      const all = await res.json();
      const pending = all.filter(c => c.status === 'pending');
      const badge = document.getElementById('requests-badge');
      if (pending.length) { badge.style.display = 'inline-block'; badge.textContent = pending.length; }
      else badge.style.display = 'none';
    } catch (e) { /* silencieux */ }
  }

  async function loadRequests() {
    try {
      const res = await fetch('/api/contributions', { headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } toast('❌ Erreur de chargement des demandes'); return; }
      requestsAll = await res.json();
      document.getElementById('tab-count-req-pending').textContent = requestsAll.filter(c => c.status === 'pending').length;
      document.getElementById('tab-count-req-accepted').textContent = requestsAll.filter(c => c.status === 'accepted').length;
      document.getElementById('tab-count-req-rejected').textContent = requestsAll.filter(c => c.status === 'rejected').length;
      renderActiveRequestsTab();
      refreshRequestsBadge();
    } catch (e) { toast('❌ Erreur de chargement des demandes'); }
  }

  function switchRequestsTab(tab) {
    requestsActiveTab = tab;
    document.querySelectorAll('#page-requests .maptab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('#page-requests .mapping-tab-panel').forEach(p => p.style.display = p.id === 'requests-tab-' + tab ? '' : 'none');
    renderActiveRequestsTab();
  }

  function requestThumb(item) {
    const Q = "'";
    if (item.ytId) return '<img class="preview-thumb" src="https://img.youtube.com/vi/' + item.ytId + '/mqdefault.jpg" onclick="openPreview(' + Q + item.ytId + Q + ', null, ' + Q + escapeAttr(item.title || 'Aperçu') + Q + ')" alt="">';
    if (item.url) return '<span class="preview-link" onclick="openPreview(null, ' + Q + escapeAttr(item.url) + Q + ', ' + Q + escapeAttr(item.title || 'Aperçu') + Q + ')">▶️ Tester</span>';
    return '<span class="muted">—</span>';
  }

  function requestDate(item) {
    try { return new Date(item.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (e) { return '—'; }
  }

  function renderActiveRequestsTab() {
    const list = requestsAll.filter(c => c.status === requestsActiveTab);
    if (requestsActiveTab === 'pending') renderRequestsPending(list);
    else renderRequestsReadonly(requestsActiveTab, list);
  }

  function renderRequestsPending(list) {
    const Q2 = "'";
    const body = document.getElementById('requests-pending-body');
    body.innerHTML = !list.length
      ? '<tr class="empty-row"><td colspan="6">Aucune demande en attente</td></tr>'
      : list.map(c => (
          '<tr>' +
          '<td>' + requestThumb(c) + '</td>' +
          '<td>' + escapeHtml(c.title || c.imdbId) + (c.season ? ' <span class="muted">S' + escapeHtml(c.season) + '</span>' : '') + '<div class="muted mono" style="font-size:11px">' + escapeHtml(c.imdbId) + '</div></td>' +
          '<td>' + escapeHtml(c.pseudo) + '</td>' +
          '<td class="muted" style="max-width:220px">' + (c.notes ? escapeHtml(c.notes) : '—') + '</td>' +
          '<td class="muted">' + requestDate(c) + '</td>' +
          '<td class="row-actions">' +
          '<button class="small-btn" onclick="acceptRequest(' + Q2 + c.id + Q2 + ')">✅ Accepter</button>' +
          '<button class="small-btn" onclick="rejectRequest(' + Q2 + c.id + Q2 + ')">🚫 Refuser</button>' +
          '</td>' +
          '</tr>'
        )).join('');
  }

  function renderRequestsReadonly(tab, list) {
    const body = document.getElementById('requests-' + tab + '-body');
    body.innerHTML = !list.length
      ? '<tr class="empty-row"><td colspan="4">' + (tab === 'accepted' ? 'Aucune demande acceptée' : 'Aucune demande refusée') + '</td></tr>'
      : list.map(c => (
          '<tr>' +
          '<td>' + requestThumb(c) + '</td>' +
          '<td>' + escapeHtml(c.title || c.imdbId) + (c.season ? ' <span class="muted">S' + escapeHtml(c.season) + '</span>' : '') + '</td>' +
          '<td>' + escapeHtml(c.pseudo) + '</td>' +
          '<td class="muted">' + requestDate(c) + '</td>' +
          '</tr>'
        )).join('');
  }

  async function acceptRequest(id) {
    try {
      const res = await fetch('/api/contributions/' + encodeURIComponent(id) + '/accept', { method: 'POST', headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } toast("❌ Erreur lors de l'acceptation"); return; }
      const data = await res.json();
      if (data.success) toast('✅ Proposition acceptée — override mis à jour');
      else toast("❌ Échec de la création de l'override");
      loadRequests();
    } catch (e) { toast('❌ Erreur réseau'); }
  }

  async function rejectRequest(id) {
    try {
      const res = await fetch('/api/contributions/' + encodeURIComponent(id) + '/reject', { method: 'POST', headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } toast('❌ Erreur lors du refus'); return; }
      toast('🚫 Proposition refusée');
      loadRequests();
    } catch (e) { toast('❌ Erreur réseau'); }
  }

  function prefillOverride(imdbId, season, title) {
    cancelEditOverride();
    document.getElementById('ov-imdb').value = imdbId;
    document.getElementById('ov-season').value = season || '';
    checkDuplicateOverride();
    if (title) document.getElementById('ov-title').value = title; // déjà connu (journal des échecs) -> pas besoin de relookup TMDB
    else lookupTitleFromImdb(imdbId);
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Pré-remplit le formulaire à partir d'une résolution réussie, pour permettre d'écraser
  // un résultat automatique jugé mauvais (langue, qualité, mauvaise vidéo...) par un override.
  // Le lien actuellement trouvé est prérempli (via resolvedData) pour que l'admin voie ce
  // qu'il corrige, et puisse soit l'ajuster, soit le remplacer entièrement.
  function editOverrideFromResolved(imdbId, season, title, type) {
    cancelEditOverride();
    const r = resolvedData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    const stream = r && r.streams && r.streams[0] ? r.streams[0] : null;
    document.getElementById('ov-imdb').value = imdbId;
    document.getElementById('ov-season').value = season || '';
    document.getElementById('ov-title').value = title || '';
    document.getElementById('ov-mediatype').value = type || '';
    document.getElementById('ov-ytid').value = stream && stream.ytId ? stream.ytId : '';
    document.getElementById('ov-url').value = stream && stream.url ? stream.url : '';
    updateFormPreview();
    onOverrideLinkInput();
    document.getElementById('mapping-form-title').textContent = '✏️ Corriger le résultat trouvé';
    setFormMode('Correction');
    document.getElementById('edit-banner-text').textContent = \`Correction du résultat automatique pour \${imdbId}\${season ? ' (saison ' + season + ')' : ''} — modifie le lien puis enregistre\`;
    document.getElementById('edit-banner').classList.add('show');
    checkDuplicateOverride();
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(stream ? 'ℹ️ Lien actuel préaffiché — modifie-le puis enregistre' : 'ℹ️ Renseigne le nouveau lien pour écraser le résultat automatique');
  }

  // Affiche le badge du mode actuel du formulaire (Nouveau / Édition / Correction)
  function setFormMode(mode) {
    const badge = document.getElementById('form-mode-badge');
    badge.textContent = mode;
    badge.dataset.mode = mode;
  }

  // Passe le formulaire en mode édition d'un override déjà actif : tous les champs
  // sont pré-remplis (y compris le lien), et le bouton devient "Mettre à jour".
  function editOverride(imdbId, season) {
    const o = overridesData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    if (!o) return;
    editingKey = { imdbId: o.imdbId, season: o.season || '' };
    document.getElementById('ov-imdb').value = o.imdbId || '';
    document.getElementById('ov-season').value = o.season || '';
    document.getElementById('ov-ytid').value = o.ytId || '';
    document.getElementById('ov-url').value = o.url || '';
    document.getElementById('ov-title').value = o.title || '';
    document.getElementById('ov-mediatype').value = o.mediaType || '';
    document.getElementById('ov-notes').value = o.notes || '';
    // Liens de repli : on exclut le lien principal (déjà dans ov-ytid/ov-url)
    const links = Array.isArray(o.links) ? o.links.slice() : [];
    overrideLinks = links.filter(l => {
      const isPrimary = (l.ytId && l.ytId === o.ytId) || (l.url && l.url === o.url);
      return !isPrimary;
    });
    renderFallbacks();
    document.getElementById('ov-hidden').checked = !!o.hidden;
    toggleHiddenMode();
    document.getElementById('mapping-form-title').textContent = '✏️ Modifier l\\'override';
    setFormMode('Édition');
    document.getElementById('ov-submit-btn').textContent = 'Mettre à jour';
    document.getElementById('edit-banner-text').textContent = \`Modification de l'override pour \${o.imdbId}\${o.season ? ' (saison ' + o.season + ')' : ''}\`;
    document.getElementById('edit-banner').classList.add('show');
    updateFormPreview();
    onOverrideLinkInput();
    checkDuplicateOverride();
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelEditOverride() {
    editingKey = null;
    overrideLinks = [];
    renderFallbacks();
    ['ov-imdb','ov-season','ov-ytid','ov-url','ov-title','ov-mediatype','ov-notes','tmdb-search','yt-search'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('link-status-0').textContent = '';
    document.getElementById('link-status-0').className = 'link-status';
    document.getElementById('link-status-url').textContent = '';
    document.getElementById('link-status-url').className = 'link-status';
    document.getElementById('link-test-result').textContent = '';
    document.getElementById('link-test-result').style.color = '';
    const hiddenEl = document.getElementById('ov-hidden');
    hiddenEl.checked = false;
    toggleHiddenMode();
    document.getElementById('mapping-form-title').textContent = '🎯 Ajouter / modifier un override';
    setFormMode('Nouveau');
    document.getElementById('ov-submit-btn').textContent = 'Enregistrer l\\'override';
    document.getElementById('edit-banner').classList.remove('show');
    document.getElementById('form-preview-wrap').classList.remove('show');
    document.getElementById('tmdb-results').classList.remove('show');
    document.getElementById('yt-results').classList.remove('show');
    document.getElementById('dup-warning').style.display = 'none';
  }

  async function submitOverride() {
    const imdbId = extractImdbId(document.getElementById('ov-imdb').value.trim());
    const season = document.getElementById('ov-season').value.trim();
    const ytId = extractYoutubeId(document.getElementById('ov-ytid').value.trim());
    const url = document.getElementById('ov-url').value.trim();
    const title = document.getElementById('ov-title').value.trim();
    const mediaType = document.getElementById('ov-mediatype').value.trim();
    const hidden = document.getElementById('ov-hidden').checked;
    const notes = document.getElementById('ov-notes').value.trim();
    const fallbacks = overrideLinks
      .map(l => ({ ytId: extractYoutubeId((l.ytId || '').trim()), url: (l.url || '').trim() }))
      .filter(l => (l.ytId && /^[a-zA-Z0-9_-]{11}$/.test(l.ytId)) || l.url);

    if (!imdbId.startsWith('tt')) { toast('❌ IMDB ID invalide (doit commencer par "tt")'); return; }
    if (!ytId && !url && !fallbacks.length && !hidden) { toast('❌ Renseigne un YouTube ID, une URL directe, un lien de repli, ou coche "Masquer ce titre"'); return; }
    if (ytId && url) {
      toast('⚠️ YouTube ID ET URL directe remplis : seule la piste YouTube ID est enregistrée (l\\'URL est ignorée — mets-la en lien de repli si besoin)');
    }

    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ imdbId, season: season ? Number(season) : null, ytId: ytId || null, url: ytId ? null : (url || null), links: fallbacks.length ? fallbacks : undefined, title: title || null, hidden, mediaType: mediaType || null, notes: notes || null }),
      });
      if (res.ok) {
        // En édition, si la saison a changé, l'entrée d'origine devient orpheline -> on la supprime.
        if (editingKey && (editingKey.imdbId !== imdbId || String(editingKey.season || '') !== String(season || ''))) {
          await fetch('/api/overrides?imdbId=' + encodeURIComponent(editingKey.imdbId) + '&season=' + encodeURIComponent(editingKey.season || ''), {
            method: 'DELETE', headers: authHeaders(),
          });
        }
        toast(editingKey ? '✅ Override mis à jour' : '✅ Override enregistré');
        cancelEditOverride();
        await loadMapping();
      } else toast('❌ Erreur lors de l\\'enregistrement');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function deleteOverride(imdbId, season) {
    if (!confirm('Supprimer cet override ?')) return;
    try {
      const res = await fetch('/api/overrides?imdbId=' + encodeURIComponent(imdbId) + '&season=' + encodeURIComponent(season), {
        method: 'DELETE', headers: authHeaders(),
      });
      if (res.ok) {
        toast('✅ Override supprimé');
        if (editingKey && editingKey.imdbId === imdbId && String(editingKey.season || '') === String(season || '')) cancelEditOverride();
        await loadMapping();
      } else toast('❌ Erreur lors de la suppression');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function clearFailedLog() {
    if (!confirm('Vider le journal des échecs ?')) return;
    try {
      const res = await fetch('/api/failed-log', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Journal vidé'); await loadMapping(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function clearResolvedLog() {
    if (!confirm('Vider le journal des résolutions récentes ?')) return;
    try {
      const res = await fetch('/api/resolved-log', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Journal vidé'); await loadMapping(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ---- MAPPING — recherche TMDB ----
  function onTmdbSearchInput() {
    const q = document.getElementById('tmdb-search').value.trim();
    const box = document.getElementById('tmdb-results');
    clearTimeout(tmdbSearchTimer);
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
    box.classList.add('show');
    box.innerHTML = '<div class="tmdb-loading">Recherche...</div>';
    tmdbSearchTimer = setTimeout(() => runTmdbSearch(q), 400);
  }

  async function runTmdbSearch(q) {
    const seq = ++tmdbSearchSeq;
    const box = document.getElementById('tmdb-results');
    try {
      const res = await fetch('/api/tmdb-search?q=' + encodeURIComponent(q), { headers: authHeaders() });
      const data = await res.json();
      if (seq !== tmdbSearchSeq) return; // une recherche plus récente est partie entre-temps
      if (!res.ok) { box.innerHTML = \`<div class="tmdb-empty">\${escapeHtml(data.error || 'Erreur de recherche')}</div>\`; return; }
      if (!data.length) { box.innerHTML = '<div class="tmdb-empty">Aucun résultat</div>'; return; }
      box.innerHTML = data.map((r, i) => \`
        <div class="tmdb-result-item" onclick="pickTmdbResult(\${i})">
          \${r.poster ? \`<img class="tmdb-result-poster" src="\${r.poster}" alt="">\` : '<div class="tmdb-result-poster empty">🎬</div>'}
          <div class="tmdb-result-info">
            <div class="tmdb-result-title">\${escapeHtml(r.title)}</div>
            <div class="tmdb-result-meta">\${r.mediaType === 'tv' ? 'Série' : 'Film'}\${r.year ? ' · ' + r.year : ''}</div>
          </div>
        </div>
      \`).join('');
      window._tmdbLastResults = data;
    } catch (e) {
      if (seq === tmdbSearchSeq) box.innerHTML = '<div class="tmdb-empty">Erreur de recherche</div>';
    }
  }

  async function pickTmdbResult(i) {
    const r = (window._tmdbLastResults || [])[i];
    if (!r) return;
    const box = document.getElementById('tmdb-results');
    box.innerHTML = '<div class="tmdb-loading">Récupération de l\\'IMDB ID...</div>';
    try {
      const res = await fetch(\`/api/tmdb-resolve?id=\${r.tmdbId}&type=\${r.mediaType}\`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.imdbId) { toast('❌ IMDB ID introuvable pour ce titre'); box.classList.remove('show'); return; }
      document.getElementById('ov-imdb').value = data.imdbId;
      document.getElementById('ov-mediatype').value = r.mediaType;
      if (!document.getElementById('ov-title').value.trim()) document.getElementById('ov-title').value = r.title;
      document.getElementById('tmdb-search').value = \`\${r.title}\${r.year ? ' (' + r.year + ')' : ''}\`;
      box.classList.remove('show');
      checkDuplicateOverride();
      toast(\`✅ \${r.mediaType === 'tv' ? 'Série' : 'Film'} trouvé\${r.mediaType === 'tv' ? 'e' : ''} — IMDB ID rempli\`);
    } catch (e) { toast('❌ ' + e.message); box.classList.remove('show'); }
  }

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.tmdb-search-wrap, .yt-search-wrap').forEach((wrap) => {
      if (!wrap.contains(e.target)) {
        const box = wrap.querySelector('.tmdb-results');
        if (box) box.classList.remove('show');
      }
    });
  });

  // ---- MAPPING — recherche YouTube dans le formulaire ----
  function onYtSearchInput() {
    const q = document.getElementById('yt-search').value.trim();
    const box = document.getElementById('yt-results');
    clearTimeout(ytSearchTimer);
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
    box.classList.add('show');
    box.innerHTML = '<div class="tmdb-loading">Recherche...</div>';
    ytSearchTimer = setTimeout(() => runYtSearch(q), 400);
  }

  async function runYtSearch(q) {
    const seq = ++ytSearchSeq;
    const box = document.getElementById('yt-results');
    try {
      const res = await fetch('/api/youtube-search?q=' + encodeURIComponent(q), { headers: authHeaders() });
      const data = await res.json();
      if (seq !== ytSearchSeq) return;
      if (!res.ok || !Array.isArray(data)) { box.innerHTML = '<div class="tmdb-empty">Erreur de recherche</div>'; return; }
      if (!data.length) { box.innerHTML = '<div class="tmdb-empty">Aucun résultat</div>'; return; }
      box.innerHTML = data.map((r, i) => \`
        <div class="tmdb-result-item" onclick="pickYtResult(\${i})">
          \${r.thumb ? \`<img class="tmdb-result-poster" src="\${r.thumb}" alt="" style="height:32px;width:44px">\` : '<div class="tmdb-result-poster empty">🎬</div>'}
          <div class="tmdb-result-info">
            <div class="tmdb-result-title">\${escapeHtml(r.title)}</div>
            <div class="tmdb-result-meta">\${escapeHtml(r.channel || '')}\${r.duration ? ' · ' + escapeHtml(r.duration) : ''}</div>
          </div>
        </div>
      \`).join('');
      window._ytLastResults = data;
    } catch (e) {
      if (seq === ytSearchSeq) box.innerHTML = '<div class="tmdb-empty">Erreur de recherche</div>';
    }
  }

  function pickYtResult(i) {
    const r = (window._ytLastResults || [])[i];
    if (!r) return;
    document.getElementById('ov-ytid').value = r.videoId;
    if (!document.getElementById('ov-title').value.trim()) document.getElementById('ov-title').value = r.title;
    document.getElementById('yt-search').value = r.title;
    document.getElementById('yt-results').classList.remove('show');
    onOverrideLinkInput(0);
    checkOverrideLinkDispo(0);
    toast('✅ YouTube ID rempli — vérifie le lien puis enregistre');
  }

  // ---- MAPPING — liens de repli (overrideLinks) ----
  function renderFallbacks() {
    const wrap = document.getElementById('ov-fallbacks-wrap');
    const box = document.getElementById('ov-fallbacks');
    wrap.style.display = overrideLinks.length ? '' : 'none';
    box.innerHTML = overrideLinks.map((l, i) => \`
      <div class="fallback-item" data-i="\${i}">
        <input class="fallback-yt" value="\${escapeAttr(l.ytId || '')}" placeholder="YouTube ID" oninput="updateFallbackLink(\${i}, 'ytId', this.value)">
        <input class="fallback-url" value="\${escapeAttr(l.url || '')}" placeholder="OU URL directe" oninput="updateFallbackLink(\${i}, 'url', this.value)">
        <span class="fallback-status" id="fallback-status-\${i}"></span>
        <button class="fallback-remove" onclick="removeFallbackLink(\${i})">✕</button>
      </div>
    \`).join('');
    overrideLinks.forEach((_, i) => checkFallbackDispo(i));
  }

  function addFallbackLink() {
    overrideLinks.push({ ytId: '', url: '' });
    renderFallbacks();
  }

  function updateFallbackLink(i, field, value) {
    if (!overrideLinks[i]) return;
    overrideLinks[i][field] = value;
    if (field === 'ytId' && value.trim()) overrideLinks[i].url = '';
    if (field === 'url' && value.trim()) overrideLinks[i].ytId = '';
    checkFallbackDispo(i);
  }

  function removeFallbackLink(i) {
    overrideLinks.splice(i, 1);
    renderFallbacks();
  }

  const fallbackDispoSeq = {};
  async function checkFallbackDispo(i) {
    const l = overrideLinks[i];
    const el = document.getElementById('fallback-status-' + i);
    if (!el) return;
    const id = extractYoutubeId((l && l.ytId || '').trim());
    const url = (l && l.url || '').trim();
    if (!id && !url) { el.textContent = ''; el.className = 'fallback-status'; return; }
    const seq = (fallbackDispoSeq[i] = (fallbackDispoSeq[i] || 0) + 1);
    el.textContent = '…';
    el.className = 'fallback-status pending';
    try {
      const res = await fetch('/api/test-link?ytId=' + encodeURIComponent(id) + '&url=' + encodeURIComponent(url), { headers: authHeaders() });
      const data = await res.json();
      if (seq !== fallbackDispoSeq[i]) return;
      el.textContent = data.ok ? '✅' : '❌';
      el.className = 'fallback-status ' + (data.ok ? 'ok' : 'bad');
    } catch (e) { if (seq === fallbackDispoSeq[i]) el.textContent = ''; }
  }

  // ---- MAPPING — pastille dispo du champ YouTube principal + bouton tester ----
  function onOverrideLinkInput() {
    updateFormPreview();
    checkOverrideLinkDispo();
  }

  let linkDispoTimer = null;
  let linkUrlDispoTimer = null;
  function checkOverrideLinkDispo() {
    checkYtDispo();
    checkUrlDispo();
  }

  function checkYtDispo() {
    const el = document.getElementById('link-status-0');
    const yt = extractYoutubeId(document.getElementById('ov-ytid').value.trim());
    clearTimeout(linkDispoTimer);
    if (!yt) { el.textContent = ''; el.className = 'link-status'; return; }
    el.textContent = '…';
    el.className = 'link-status pending';
    linkDispoTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/test-link?ytId=' + encodeURIComponent(yt) + '&url=', { headers: authHeaders() });
        const data = await res.json();
        el.textContent = data.ok ? (data.title ? '✅ ' + data.title : '✅ Lien jouable') : '❌ ' + (data.error || 'Lien injoignable');
        el.className = 'link-status ' + (data.ok ? 'ok' : 'bad');
      } catch (e) { el.textContent = ''; el.className = 'link-status'; }
    }, 500);
  }

  function checkUrlDispo() {
    const el = document.getElementById('link-status-url');
    const url = document.getElementById('ov-url').value.trim();
    clearTimeout(linkUrlDispoTimer);
    if (!url) { el.textContent = ''; el.className = 'link-status'; return; }
    el.textContent = '…';
    el.className = 'link-status pending';
    linkUrlDispoTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/test-link?ytId=&url=' + encodeURIComponent(url), { headers: authHeaders() });
        const data = await res.json();
        el.textContent = data.ok ? '✅ Lien jouable' : '❌ ' + (data.error || 'Lien injoignable');
        el.className = 'link-status ' + (data.ok ? 'ok' : 'bad');
      } catch (e) { el.textContent = ''; el.className = 'link-status'; }
    }, 500);
  }

  async function testOverrideLink() {
    const yt = extractYoutubeId(document.getElementById('ov-ytid').value.trim());
    const url = document.getElementById('ov-url').value.trim();
    const out = document.getElementById('link-test-result');
    const fallbacks = overrideLinks
      .map(l => ({ ytId: extractYoutubeId((l.ytId || '').trim()), url: (l.url || '').trim() }))
      .filter(l => (l.ytId && /^[a-zA-Z0-9_-]{11}$/.test(l.ytId)) || l.url);
    if (!yt && !url && !fallbacks.length) { out.textContent = 'Renseigne un lien à tester'; out.className = 'link-test-result'; out.style.color = ''; return; }
    out.textContent = 'Test en cours...';
    out.className = 'link-test-result';

    const candidates = [
      ...(yt ? [{ label: 'Lien 1 (YouTube)', ytId: yt, url: '' }] : []),
      ...(url && !yt ? [{ label: 'Lien 1 (URL directe)', ytId: '', url }] : []),
      ...fallbacks.map((f, i) => ({ label: 'Repli ' + (i + 1), ytId: f.ytId || '', url: f.url || '' })),
    ];

    const details = [];
    let okCount = 0;
    for (const c of candidates) {
      try {
        const res = await fetch('/api/test-link?ytId=' + encodeURIComponent(c.ytId) + '&url=' + encodeURIComponent(c.url), { headers: authHeaders() });
        const data = await res.json();
        if (data.ok) {
          okCount++;
          details.push(c.label + ' : ✅' + (data.kind === 'youtube' && data.title ? ' « ' + data.title + ' »' : ' jouable'));
        } else {
          details.push(c.label + ' : ❌ ' + (data.error || 'injoignable'));
        }
      } catch (e) {
        details.push(c.label + ' : ❌ erreur réseau');
      }
    }

    out.style.color = okCount === candidates.length ? '#48bb78' : (okCount > 0 ? '#ecc94b' : '#fc8181');
    out.textContent = okCount === candidates.length
      ? '✅ Tous les liens jouables (' + candidates.length + ')'
      : okCount > 0
        ? '⚠️ ' + okCount + '/' + candidates.length + ' jouable(s)'
        : '❌ Aucun lien jouable';
    out.title = details.join('\\n');
    if (candidates.length === 1) {
      const one = details[0];
      if (one && one.includes('✅')) out.textContent = one;
      else out.textContent = one || '❌ Lien injoignable';
    }
  }

  // ---- MAPPING — extraction d'ID depuis une URL collée ----
  // Permet de coller une URL IMDB ou YouTube complète directement dans le champ ID :
  // on extrait l'identifiant nous-mêmes plutôt que d'obliger à le copier à la main.
  function extractImdbId(input) {
    const s = (input || '').trim();
    const m = s.match(/tt\\d{6,9}/);
    return m ? m[0] : s;
  }

  function extractYoutubeId(input) {
    const s = (input || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s; // déjà un ID nu
    const m = s.match(/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/|v\\/|shorts\\/)|youtu\\.be\\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : s;
  }

  function normalizeImdbField() {
    const el = document.getElementById('ov-imdb');
    el.value = extractImdbId(el.value);
    checkDuplicateOverride();
    lookupTitleFromImdb(el.value);
  }

  // ---- MAPPING — sens inverse de la recherche TMDB : IMDB ID -> titre ----
  // Utile quand on connaît déjà l'IMDB ID (copié depuis Stremio, un lien IMDB, le
  // journal des échecs...) et qu'on veut juste que le titre se remplisse tout seul.
  let imdbLookupSeq = 0;
  async function lookupTitleFromImdb(imdbId) {
    if (!/^tt\\d{6,9}$/.test(imdbId)) return;
    const titleEl = document.getElementById('ov-title');
    const mediaTypeEl = document.getElementById('ov-mediatype');
    if (titleEl.value.trim()) return; // un titre déjà tapé à la main ne doit jamais être écrasé

    const seq = ++imdbLookupSeq;
    try {
      const res = await fetch(\`/api/tmdb-lookup?imdbId=\${imdbId}\`, { headers: authHeaders() });
      if (seq !== imdbLookupSeq) return; // un lookup plus récent est parti entre-temps
      if (!res.ok) return; // silencieux : TMDB ne connaît pas ce titre, pas grave, on laisse vide
      const data = await res.json();
      if (!titleEl.value.trim()) titleEl.value = data.title;
      if (!mediaTypeEl.value) mediaTypeEl.value = data.mediaType;
    } catch (e) { /* silencieux, pas bloquant */ }
  }

  function normalizeYoutubeField() {
    const el = document.getElementById('ov-ytid');
    el.value = extractYoutubeId(el.value);
    updateFormPreview();
    onOverrideLinkInput();
    lookupTitleFromYoutube(el.value);
  }

  // ---- MAPPING — pré-remplir le titre depuis l'ID YouTube (API oEmbed publique) ----
  let ytLookupSeq = 0;
  async function lookupTitleFromYoutube(ytId) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(ytId)) return;
    const titleEl = document.getElementById('ov-title');
    if (titleEl.value.trim()) return; // ne jamais écraser un titre déjà tapé à la main

    const seq = ++ytLookupSeq;
    try {
      const res = await fetch(\`/api/youtube-title?id=\${ytId}\`, { headers: authHeaders() });
      if (seq !== ytLookupSeq) return; // un lookup plus récent est parti entre-temps
      if (!res.ok) return; // vidéo privée/supprimée -> pas grave, le champ reste vide
      const data = await res.json();
      if (!titleEl.value.trim()) titleEl.value = data.title;
    } catch (e) { /* silencieux, pas bloquant */ }
  }

  // ---- MAPPING — détection de doublon avant écrasement silencieux ----
  // setOverride() écrase déjà l'entrée existante côté serveur (clé = imdbId:season),
  // donc ça ne casse rien techniquement -- mais sans avertissement, on peut écraser
  // un override existant par erreur sans s'en rendre compte.
  function checkDuplicateOverride() {
    const warn = document.getElementById('dup-warning');
    const imdbId = extractImdbId(document.getElementById('ov-imdb').value);
    const season = document.getElementById('ov-season').value.trim();
    if (!imdbId.startsWith('tt')) { warn.style.display = 'none'; return; }

    const match = overridesData.find(o => o.imdbId === imdbId && String(o.season || '') === String(season || ''));
    const isSameAsEditing = editingKey && editingKey.imdbId === imdbId && String(editingKey.season || '') === String(season || '');

    if (match && !isSameAsEditing) {
      warn.textContent = \`⚠️ Un override existe déjà pour \${imdbId}\${season ? ' (saison ' + season + ')' : ''} — l'enregistrer va le remplacer.\`;
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
  }

  // ---- MAPPING — aperçu formulaire + modal ----
  function updateFormPreview() {
    const ytId = document.getElementById('ov-ytid').value.trim();
    const url = document.getElementById('ov-url').value.trim();
    const title = document.getElementById('ov-title').value.trim();
    const wrap = document.getElementById('form-preview-wrap');
    const thumb = document.getElementById('form-preview-thumb');
    const name = document.getElementById('form-preview-name');
    const meta = document.getElementById('form-preview-meta');
    const imdb = document.getElementById('ov-imdb').value.trim();
    const season = document.getElementById('ov-season').value.trim();

    if (ytId && !document.getElementById('ov-hidden').checked) {
      wrap.classList.add('show');
      thumb.src = \`https://img.youtube.com/vi/\${ytId}/mqdefault.jpg\`;
      name.textContent = title || 'Bande-annonce';
      meta.textContent = \`YouTube · \${ytId}\`;
    } else if (url && !document.getElementById('ov-hidden').checked) {
      wrap.classList.add('show');
      thumb.src = '';
      name.textContent = title || 'Bande-annonce';
      meta.textContent = \`Flux direct · \${url}\`;
    } else {
      wrap.classList.remove('show');
    }
    if (imdb && imdb.trim()) {
      name.textContent = title || name.textContent;
      meta.textContent = \`\${meta.textContent ? meta.textContent + ' · ' : ''}\${imdb}\${season ? ' (saison ' + season + ')' : ''}\`;
    }
  }

  // "🚫 Masquer ce titre" : en mode masqué, on neutralise les champs de lien (aucun
  // lien n'est nécessaire) et on cache l'aperçu. Les champs sont réactivés à la
  // désactivation, et remis à l'état initial par cancelEditOverride / editOverride.
  function toggleHiddenMode() {
    const hidden = document.getElementById('ov-hidden').checked;
    ['ov-ytid', 'ov-url'].forEach(id => { document.getElementById(id).disabled = hidden; });
    updateFormPreview();
  }

  function openPreviewFromForm() {
    const ytId = extractYoutubeId(document.getElementById('ov-ytid').value.trim());
    const url = document.getElementById('ov-url').value.trim();
    openPreview(ytId || null, ytId ? null : (url || null), document.getElementById('ov-title').value.trim() || 'Aperçu');
  }

  function openPreview(ytId, url, title) {
    if (!ytId && !url) return;
    document.getElementById('preview-modal-title').textContent = title || 'Aperçu';
    const body = document.getElementById('preview-modal-body');
    if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
      body.innerHTML = '<div id="ov-preview-player"></div>';
      mountYoutubePlayer('ov-preview-player', ytId);
    } else if (url && /^https?:\\/\\//.test(url)) {
      body.innerHTML = \`<video src="\${escapeAttr(url)}" controls autoplay></video>\`;
    } else {
      body.innerHTML = '<div class="info-box" style="padding:24px;text-align:center;color:var(--muted)">Lien YouTube ou URL invalide — vérifie le champ avant de lire</div>';
    }
    document.getElementById('preview-modal').classList.add('show');
  }

  function closePreview() {
    document.getElementById('preview-modal').classList.remove('show');
    document.getElementById('preview-modal-body').innerHTML = '';
    document.getElementById('preview-modal-body').classList.remove('preview-multi');
  }

  // ---- TEST DES FLUX ----
  const SOURCE_LABELS = {
    tmdb: 'TMDB',
    allocine: 'Allociné',
    youtube_search: 'YouTube (recherche)',
    dailymotion_search: 'Dailymotion (recherche)',
    override: 'Override manuel',
  };
  const TRACE_STEP_LABELS = {
    override: 'Override',
    'tmdb-find': 'TMDB find',
    'tmdb-meta': 'Titre & titres alt.',
    'tmdb-videos': 'TMDB vidéos',
    'tmdb-pick': 'Sélection',
    allocine: 'Allociné',
    'youtube-search': 'YouTube (recherche)',
    'dailymotion-search': 'Dailymotion (recherche)',
  };
  let tsLast = null; // dernier résultat de test : { imdbId, season, type, streams }

  // ---- Saison masquée automatiquement en mode Film ----
  function setTsType(value) {
    document.getElementById('ts-type').value = value;
    onTsTypeChange();
  }

  function onTsTypeChange() {
    const isSeries = document.getElementById('ts-type').value === 'series';
    const field = document.getElementById('ts-season-field');
    field.classList.toggle('ts-hidden', !isSeries);
    if (!isSeries) document.getElementById('ts-season').value = '';
    document.getElementById('ts-seg-movie').classList.toggle('active', !isSeries);
    document.getElementById('ts-seg-series').classList.toggle('active', isSeries);
  }

  const TS_EMPTY_HTML = '<div class="ts-result-empty" id="ts-result-empty">' +
    '<div class="ico">🔬</div><div class="t1">Aucun test lancé</div>' +
    '<div class="t2">Cherche un titre ou colle un IMDB ID, puis clique sur Tester.</div></div>';

  // ---- Badge "override existant" — vérifié dès qu'on tape un IMDB ID, avant même de lancer le test ----
  let tsOverridesCache = null;
  let tsOverridesCacheAt = 0;
  let tsOverrideCheckTimer = null;

  function scheduleOverrideCheck() {
    clearTimeout(tsOverrideCheckTimer);
    tsOverrideCheckTimer = setTimeout(checkOverrideNow, 250);
  }

  async function checkOverrideNow() {
    const badge = document.getElementById('ts-override-badge');
    const imdbId = extractImdbId(document.getElementById('ts-imdb').value.trim());
    const season = document.getElementById('ts-season').value.trim() || null;
    if (!/^tt\\d{6,9}$/.test(imdbId)) { badge.classList.remove('show'); return; }
    try {
      if (!tsOverridesCache || Date.now() - tsOverridesCacheAt > 60000) {
        const res = await fetch('/api/overrides', { headers: authHeaders() });
        if (!res.ok) { if (res.status === 401) { logout(); return; } return; }
        tsOverridesCache = await res.json();
        tsOverridesCacheAt = Date.now();
      }
      const match = (tsOverridesCache || []).some(o => o.imdbId === imdbId && String(o.season || '') === String(season || ''));
      badge.classList.toggle('show', match);
    } catch (e) { /* pas bloquant */ }
  }

  function resetTsForm() {
    document.getElementById('test-tmdb-search').value = '';
    document.getElementById('ts-imdb').value = '';
    document.getElementById('ts-season').value = '';
    document.getElementById('ts-type').value = 'movie';
    document.getElementById('ts-ignore-override').checked = false;
    document.getElementById('ts-override-badge').classList.remove('show');
    document.getElementById('test-tmdb-results').innerHTML = '';
    onTsTypeChange();
    document.getElementById('ts-result').innerHTML = TS_EMPTY_HTML;
    document.getElementById('ts-imdb').focus();
  }


  // ---- Historique des tests de cette session (en mémoire, pas persisté) ----
  let tsHistory = [];

  function addTsHistory(entry) {
    tsHistory = tsHistory.filter(h => !(h.imdbId === entry.imdbId && String(h.season || '') === String(entry.season || '')));
    tsHistory.unshift(entry);
    tsHistory = tsHistory.slice(0, 6);
    renderTsHistory();
  }

  function renderTsHistory() {
    const wrap = document.getElementById('ts-history');
    const list = document.getElementById('ts-history-list');
    if (!tsHistory.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    list.innerHTML = tsHistory.map((h, i) => (
      '<div class="ts-hist-item" onclick="loadTsHistory(' + i + ')">' +
      '<span class="ts-hist-dot ' + (h.ok ? 'ok' : 'fail') + '"></span>' +
      '<span class="ts-hist-name">' + escapeHtml(h.title) + '</span>' +
      '<span class="ts-hist-meta">' + escapeHtml(h.imdbId) + (h.season ? ' · S' + escapeHtml(h.season) : '') + ' · ' + escapeHtml(h.sourceLabel) + '</span>' +
      '</div>'
    )).join('');
  }

  function loadTsHistory(i) {
    const h = tsHistory[i];
    if (!h) return;
    document.getElementById('test-tmdb-search').value = h.title || '';
    document.getElementById('ts-imdb').value = h.imdbId;
    document.getElementById('ts-type').value = h.type;
    onTsTypeChange();
    document.getElementById('ts-season').value = h.season || '';
    scheduleOverrideCheck();
    runStreamTest();
  }

  async function runStreamTest() {
    const btn = document.getElementById('ts-btn');
    const imdbId = extractImdbId(document.getElementById('ts-imdb').value.trim());
    const type = document.getElementById('ts-type').value;
    const season = document.getElementById('ts-season').value.trim();
    const ignoreOverride = document.getElementById('ts-ignore-override').checked;
    const aiom = document.getElementById('ts-aiom').checked;

    if (!/^tt\\d{6,9}$/.test(imdbId)) { toast('❌ IMDB ID invalide (doit ressembler à tt15239678)'); return; }

    const out = document.getElementById('ts-result');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '...';
    out.innerHTML = '<div class="ts-loading"><div class="ts-eq"><span></span><span></span><span></span><span></span><span></span></div><div class="lbl">résolution en cours…</div></div>';

    try {
      const res = await fetch('/api/test-resolve', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type, imdbId, season: season || null, ignoreOverride, aiom }),
      });
      if (!res.ok) { logout(); return; }
      const data = await res.json();
      renderStreamTestResult(data, imdbId, season || null, type);
    } catch (e) {
      out.innerHTML = '<div class="info-box" style="color:var(--accent)">❌ Erreur réseau : ' + escapeHtml(e.message) + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function renderTrace(trace) {
    if (!trace || !trace.length) return '';
    const rows = trace.map(t => {
      const icon = t.ok ? '✅' : '❌';
      const ms = t.ms != null ? '<span class="trace-ms">' + t.ms + ' ms</span>' : '';
      return '<div class="trace-step ' + (t.ok ? 'ok' : 'fail') + '">' +
        '<span class="trace-icon">' + icon + '</span>' +
        '<span class="trace-step-name">' + escapeHtml(TRACE_STEP_LABELS[t.step] || t.step) + '</span>' +
        '<span class="trace-step-detail">' + escapeHtml(t.detail || '') + '</span>' +
        ms + '</div>';
    }).join('');
    return '<div class="trace-box"><div class="trace-title">🔍 Trace de résolution</div>' + rows + '</div>';
  }

  function renderStreamTestResult(data, imdbId, season, type) {
    const out = document.getElementById('ts-result');
    tsLast = { imdbId, season, type, streams: data.streams || [] };
    const titleForHistory = document.getElementById('test-tmdb-search').value.trim() || imdbId;
    const srcLabel = data.source ? (SOURCE_LABELS[data.source] || data.source) : '—';

    if (data.error) {
      out.innerHTML = '<div class="info-box" style="color:var(--accent)">❌ ' + escapeHtml(data.error) + '</div>' + renderTrace(data.trace);
      addTsHistory({ imdbId, season, type, title: titleForHistory, ok: false, sourceLabel: 'Erreur' });
      return;
    }

    const officialTitle = data.officialTitle || 'Titre inconnu';

    if (!data.streams || !data.streams.length) {
      const failSteps = (data.trace || []).filter(t => !t.ok).map(t => TRACE_STEP_LABELS[t.step] || t.step);
      const why = data.hidden
        ? ' (titre masqué par un override)'
        : failSteps.length
          ? ' — <b>' + escapeHtml(failSteps.join(' → ')) + '</b>'
          : ' — source : <b>' + escapeHtml(srcLabel) + '</b>';
      const aiomNote = data.aiom ? ' — AIOMetadata garderait alors le trailer de son fournisseur' : '';
      out.innerHTML = '<div class="info-box">🚫 Aucun flux trouvé' + why + aiomNote + '</div>' + renderTrace(data.trace);
      addTsHistory({ imdbId, season, type, title: titleForHistory, ok: false, sourceLabel: 'Aucun flux' });
      return;
    }

    const rows = data.streams.map((s, i) => {
      const ytIdForThumb = s.ytId || (s.externalUrl ? extractYoutubeId(s.externalUrl) : null);
      const thumb = ytIdForThumb
        ? '<img class="preview-thumb" src="https://img.youtube.com/vi/' + ytIdForThumb + '/mqdefault.jpg" onclick="playStream(' + i + ')" alt="">'
        : '<span class="preview-link" onclick="playStream(' + i + ')">▶️</span>';
      return '<div class="ts-stream-row">' + thumb +
        '<div class="ts-stream-info">' +
        '<div class="ts-stream-title">' + escapeHtml(displayStreamTitle(s, officialTitle)) + '</div>' +
        '<div class="ts-stream-meta mono">' + (s.ytId ? 'YouTube · ' + s.ytId : s.externalUrl ? 'Externe' : 'URL directe') + '</div>' +
        '</div>' +
        '<button class="small-btn" onclick="overrideFromTest(' + i + ')">🎯 Override</button>' +
        '</div>';
    }).join('');

    const totalMs = (data.trace || []).reduce((sum, t) => sum + (t.ms || 0), 0);

    out.innerHTML =
      '<div class="ts-result-head ok">' +
      '<span class="ts-result-title">' + escapeHtml(officialTitle) + '</span>' +
      '<span class="badge-type">' + escapeHtml(srcLabel) + '</span>' +
      (data.aiom ? '<span class="badge-type">🧩 Vue AIOMetadata</span>' : '') +
      (totalMs ? '<span class="ts-result-time mono">' + totalMs + ' ms</span>' : '') + '</div>' +
      '<div class="ts-stream-list">' + rows + '</div>' +
      renderTrace(data.trace) +
      '<div id="ts-player" class="ts-player"></div>';

    addTsHistory({ imdbId, season, type, title: officialTitle, ok: true, sourceLabel: srcLabel });
    checkOverrideNow();
  }

  function displayStreamTitle(s, officialTitle) {
    const t = s.title || officialTitle || '';
    return String(t).replace(/\\(ouvrir dans YouTube\\)/g, '').replace(/\\n/g, ' ').trim();
  }

  // Lecteur intégré directement dans la page test (iframe YouTube ou <video> pour URL directe).
  function playStream(i) {
    const r = tsLast;
    if (!r) return;
    const s = r.streams[i];
    if (!s) return;
    const slot = document.getElementById('ts-player');
    const ytId = s.ytId || (s.externalUrl ? extractYoutubeId(s.externalUrl) : null);
    const url = ytId ? null : (s.url || s.externalUrl || null);

    if (slot.classList.contains('show') && slot.dataset.yt === ytId) {
      slot.classList.remove('show');
      slot.innerHTML = '';
      delete slot.dataset.yt;
      return;
    }
    slot.dataset.yt = ytId || '';

    if (ytId) {
      slot.innerHTML = '<div id="ts-preview-player" style="width:100%;height:100%"></div>';
      mountYoutubePlayer('ts-preview-player', ytId);
    } else if (url && /^https?:\\/\\//.test(url)) {
      slot.innerHTML = '<video src="' + escapeAttr(url) + '" controls autoplay></video>';
    } else {
      slot.innerHTML = '<div class="info-box" style="height:100%;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--muted)">Aucune lecture possible pour ce flux</div>';
    }
    slot.classList.add('show');
    slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Prépare le formulaire Mapping avec le flux testé sélectionné, pour en faire un override.
  function overrideFromTest(i) {
    const r = tsLast;
    if (!r) return;
    const stream = r.streams[i] || {};
    cancelEditOverride();
    document.getElementById('ov-imdb').value = r.imdbId || '';
    document.getElementById('ov-season').value = r.season || '';
    document.getElementById('ov-title').value = stream.title || '';
    document.getElementById('ov-mediatype').value = r.type || '';
    document.getElementById('ov-ytid').value = stream.ytId || '';
    document.getElementById('ov-url').value = stream.url || '';
    updateFormPreview();
    document.getElementById('mapping-form-title').textContent = '🎯 Créer un override';
    document.getElementById('edit-banner-text').textContent = 'Nouvel override pour ' + (r.imdbId || '') + (r.season ? ' (saison ' + r.season + ')' : '') + ' — vérifie le lien puis enregistre';
    document.getElementById('edit-banner').classList.add('show');
    checkDuplicateOverride();
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('ℹ️ Lien préaffiché — enregistre pour créer l\\'override');
  }

  // ---- TEST DES FLUX — recherche TMDB (même principe que le formulaire Mapping) ----
  let testTmdbSearchTimer = null;
  let testTmdbSearchSeq = 0;

  function normalizeTsImdbField() {
    const el = document.getElementById('ts-imdb');
    el.value = extractImdbId(el.value);
  }

  function onTestTmdbSearchInput() {
    const q = document.getElementById('test-tmdb-search').value.trim();
    const box = document.getElementById('test-tmdb-results');
    clearTimeout(testTmdbSearchTimer);
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
    box.classList.add('show');
    box.innerHTML = '<div class="tmdb-loading">Recherche...</div>';
    testTmdbSearchTimer = setTimeout(() => runTestTmdbSearch(q), 400);
  }

  async function runTestTmdbSearch(q) {
    const seq = ++testTmdbSearchSeq;
    const box = document.getElementById('test-tmdb-results');
    try {
      const res = await fetch('/api/tmdb-search?q=' + encodeURIComponent(q), { headers: authHeaders() });
      const data = await res.json();
      if (seq !== testTmdbSearchSeq) return; // une recherche plus récente est partie entre-temps
      if (!res.ok) { box.innerHTML = '<div class="tmdb-empty">' + escapeHtml(data.error || 'Erreur de recherche') + '</div>'; return; }
      if (!data.length) { box.innerHTML = '<div class="tmdb-empty">Aucun résultat</div>'; return; }
      box.innerHTML = data.map((r, i) => '<div class="tmdb-result-item" onclick="pickTestTmdbResult(' + i + ')">' +
        (r.poster ? '<img class="tmdb-result-poster" src="' + r.poster + '" alt="">' : '<div class="tmdb-result-poster empty">🎬</div>') +
        '<div class="tmdb-result-info">' +
        '<div class="tmdb-result-title">' + escapeHtml(r.title) + '</div>' +
        '<div class="tmdb-result-meta">' + (r.mediaType === 'tv' ? 'Série' : 'Film') + (r.year ? ' · ' + r.year : '') + '</div>' +
        '</div></div>').join('');
      window._testTmdbLastResults = data;
    } catch (e) {
      if (seq === testTmdbSearchSeq) box.innerHTML = '<div class="tmdb-empty">Erreur de recherche</div>';
    }
  }

  async function pickTestTmdbResult(i) {
    const r = (window._testTmdbLastResults || [])[i];
    if (!r) return;
    const box = document.getElementById('test-tmdb-results');
    box.innerHTML = '<div class="tmdb-loading">Récupération de l\\'IMDB ID...</div>';
    try {
      const res = await fetch('/api/tmdb-resolve?id=' + r.tmdbId + '&type=' + r.mediaType, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.imdbId) { toast('❌ IMDB ID introuvable pour ce titre'); box.classList.remove('show'); return; }
      document.getElementById('ts-imdb').value = data.imdbId;
      document.getElementById('ts-type').value = r.mediaType === 'tv' ? 'series' : 'movie';
      onTsTypeChange();
      document.getElementById('test-tmdb-search').value = r.title + (r.year ? ' (' + r.year + ')' : '');
      box.classList.remove('show');
      toast('✅ ' + (r.mediaType === 'tv' ? 'Série trouvée' : 'Film trouvé') + ' — IMDB ID rempli, test lancé');
      scheduleOverrideCheck();
      runStreamTest();
    } catch (e) { toast('❌ ' + e.message); box.classList.remove('show'); }
  }

  // ---- MAPPING — export / import JSON ----
  function exportOverrides() {
    if (!overridesData.length) { toast('ℹ️ Aucun override à exporter'); return; }
    const blob = new Blob([JSON.stringify(overridesData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = \`overrides-backup-\${new Date().toISOString().slice(0,10)}.json\`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('✅ Export téléchargé');
  }

  async function importOverrides(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const items = JSON.parse(text);
      if (!Array.isArray(items)) throw new Error('Le fichier doit contenir un tableau d\\'overrides');
      if (!items.length) { toast('ℹ️ Fichier vide'); return; }

      // Détection des doublons avec les overrides existants (même IMDB ID + saison).
      const existing = new Map(overridesData.map(o => [o.imdbId + ':' + String(o.season || ''), o]));
      const dupRows = items
        .map(item => {
          const key = (item.imdbId || '') + ':' + String(item.season || '');
          const match = existing.get(key);
          return match ? { imdbId: item.imdbId, season: item.season || null, oldTitle: match.title || '', newTitle: item.title || '' } : null;
        })
        .filter(Boolean);
      let msg = \`Importer \${items.length} override(s) ?\`;
      if (dupRows.length) {
        msg += \`\\n\\n⚠️ \${dupRows.length} entrée(s) existante(s) seront ÉCRASÉES :\\n\` +
          dupRows.slice(0, 8).map(d => \`• \${d.imdbId}\${d.season ? ' (saison ' + d.season + ')' : ''} — \${d.oldTitle || d.newTitle || 'sans titre'}\`).join('\\n') +
          (dupRows.length > 8 ? \`\\n… et \${dupRows.length - 8} autre(s)\` : '');
      }
      if (!confirm(msg)) return;

      let ok = 0, fail = 0;
      for (const item of items) {
        const isHidden = item.hidden === true;
        const hasLink = (item.ytId && item.ytId.trim()) || (item.url && item.url.trim()) || (Array.isArray(item.links) && item.links.some(l => l && (l.ytId || l.url)));
        if (!item.imdbId || (!hasLink && !isHidden)) { fail++; continue; }
        try {
          const res = await fetch('/api/overrides', {
            method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ imdbId: item.imdbId, season: item.season || null, ytId: item.ytId || null, url: item.ytId ? null : (item.url || null), links: Array.isArray(item.links) && item.links.length ? item.links : undefined, title: item.title || null, hidden: isHidden, mediaType: item.mediaType || null, notes: item.notes || null }),
          });
          if (res.ok) ok++; else fail++;
        } catch (e) { fail++; }
      }
      toast(\`✅ \${ok} importé(s)\${fail ? \`, ❌ \${fail} échoué(s)\` : ''}\`);
      await loadMapping();
    } catch (e) { toast('❌ Fichier invalide : ' + e.message); }
  }

  // ---- LOGS (live-tail, façon terminal) ----
  let allLogs = [];
  let logsInterval = null;
  let logsPaused = false;

  const LOG_LEVEL_PRIORITY = { info: 0, warn: 1, error: 2 };
  const CTX_META = {
    AUTH:     { icon: '🔐', color: '#60a5fa' },
    INSTALL:  { icon: '📦', color: '#48bb78' },
    STREAM:   { icon: '🎬', color: '#eab308' },
    OVERRIDE: { icon: '🎯', color: '#a78bfa' },
    SETTINGS: { icon: '⚙️', color: '#48bb78' },
    META:     { icon: 'ℹ️', color: '#38bdf8' },
    SYSTEM:   { icon: '🚀', color: '#94a3b8' },
    AIOM:     { icon: '🧩', color: '#f472b6' },
  };

  function initLogsPage() {
    loadLogs();
    loadServicesStatus(false);
    restartLogPolling();
  }

  // ---- Statut des services (TMDB/YouTube/Allociné), vérifié côté serveur toutes les 6h ----
  const SVC_LABELS = { tmdb: 'TMDB', youtube: 'YouTube', allocine: 'Allociné' };
  function timeAgoFr(iso) {
    const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return \`il y a \${diffMin} min\`;
    const h = Math.round(diffMin / 60);
    return \`il y a \${h}h\`;
  }
  function timeUntilFr(iso) {
    const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (diffMin <= 0) return 'bientôt';
    if (diffMin < 60) return \`dans \${diffMin} min\`;
    return \`dans \${Math.round(diffMin / 60)}h\`;
  }
  async function loadServicesStatus(forceRefreshFeedback) {
    const grid = document.getElementById('svc-status-grid');
    const desc = document.getElementById('svc-status-desc');
    if (forceRefreshFeedback) desc.textContent = 'Vérification en cours...';
    try {
      const res = await fetch('/api/services-status', { headers: authHeaders() });
      if (!res.ok) throw new Error('Requête échouée');
      const data = await res.json();
      grid.innerHTML = ['tmdb', 'youtube', 'allocine'].map(svc => {
        const up = data[svc] === 'up';
        return \`<div class="svc-pill \${up ? 'svc-up' : 'svc-down'}"><span class="svc-dot"></span>\${SVC_LABELS[svc]} — \${up ? 'OK' : 'HS'}</div>\`;
      }).join('');
      desc.textContent = \`Vérifié \${timeAgoFr(data.checkedAt)} — prochaine vérification \${timeUntilFr(data.nextCheckAt)}\`;
    } catch (e) {
      desc.textContent = 'Impossible de vérifier le statut des services pour le moment.';
    }
  }

  function restartLogPolling() {
    if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
    if (logsPaused) return;
    const ms = Number(document.getElementById('logs-interval').value);
    if (ms > 0) logsInterval = setInterval(loadLogs, ms);
  }

  function toggleLogPause() {
    logsPaused = !logsPaused;
    const btn = document.getElementById('logs-pausebtn');
    const dot = document.getElementById('logs-dot');
    const text = document.getElementById('logs-statustext');
    if (logsPaused) {
      if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
      btn.textContent = '▶️ Reprendre'; btn.classList.add('paused');
      dot.classList.add('paused'); text.textContent = 'Paused';
    } else {
      btn.textContent = '⏸️ Pause'; btn.classList.remove('paused');
      dot.classList.remove('paused'); text.textContent = 'Live';
      restartLogPolling();
    }
  }

  async function loadLogs() {
    if (logsPaused) return;
    try {
      const res = await fetch('/api/logs', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      allLogs = await res.json(); // le plus récent en premier (Redis lpush)
      renderLogs();
      refreshLogsBadgeFrom(allLogs);
    } catch (e) { /* silencieux, on retentera au prochain tick */ }
  }

  function renderLogs() {
    const ctxFilter = document.getElementById('logs-ctx').value;
    const levelFilter = document.getElementById('logs-level').value;
    const search = document.getElementById('logs-search').value.trim().toLowerCase();

    // du plus ancien au plus récent, comme un vrai terminal qui défile vers le bas
    let filtered = [...allLogs].reverse();
    if (ctxFilter) filtered = filtered.filter(l => l.context === ctxFilter);
    if (levelFilter) filtered = filtered.filter(l => (LOG_LEVEL_PRIORITY[l.level] ?? 0) >= LOG_LEVEL_PRIORITY[levelFilter]);
    if (search) {
      const haystackOf = l => String(l.message || l.event || '').toLowerCase() + (l.meta ? ' ' + JSON.stringify(l.meta).toLowerCase() : '');
      filtered = filtered.filter(l => haystackOf(l).includes(search));
    }

    const term = document.getElementById('logs-term');
    if (!filtered.length) {
      term.innerHTML = '<div class="logs-empty"><div class="icon">📋</div><p>Aucun log ne correspond</p></div>';
      return;
    }

    const META_LABELS = { ip: 'IP', imdbId: 'IMDB', season: 'Saison', pseudo: 'Pseudo', source: 'Source', path: 'Route', type: 'Type', service: 'Service', ytId: 'YouTube', requested: 'Demandé', actual: 'Servi', error: 'Erreur', links: 'Liens', hidden: 'Masqué', title: 'Titre', result: 'Résultat', ms: 'Durée', cache: 'Cache' };
    function formatMetaValue(v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }
    function formatMeta(meta) {
      if (!meta) return '';
      const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (!entries.length) return '';
      // Le pseudo passe toujours en premier et en évidence : c'est l'info la
      // plus utile pour retrouver qui a rencontré quoi.
      entries.sort(([ka], [kb]) => (ka === 'pseudo' ? -1 : kb === 'pseudo' ? 1 : 0));
      const chips = entries.map(([k, v]) => {
        const isPseudo = k === 'pseudo';
        return \`<span class="meta-chip\${isPseudo ? ' chip-pseudo' : ''}"><b>\${isPseudo ? '👤' : (META_LABELS[k] || k)}</b>\${escapeHtml(formatMetaValue(v))}</span>\`;
      });
      return \`<div class="log-meta">\${chips.join('')}</div>\`;
    }

    const wasAtBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 40;
    term.innerHTML = filtered.map(l => {
      const ctx = CTX_META[l.context] || CTX_META.SYSTEM;
      const lv = LOG_LEVEL_PRIORITY[l.level] !== undefined ? l.level : 'info';
      const d = new Date(l.time || l.timestamp || 0);
      const time = isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('fr-FR');
      return \`<div class="log-row row-lv-\${lv}">
        <span class="log-time">\${time}</span>
        <span class="log-level lv-\${lv}">\${lv.toUpperCase()}</span>
        <span class="log-ctx" style="background:\${ctx.color}20;color:\${ctx.color}">\${ctx.icon} \${l.context || 'SYSTEM'}</span>
        <span class="log-msg">\${escapeHtml(l.message || l.event || '—')}</span>
        \${formatMeta(l.meta)}
      </div>\`;
    }).join('');
    if (wasAtBottom) term.scrollTop = term.scrollHeight;
  }

  function refreshLogsBadgeFrom(logs) {
    const errorCount = logs.filter(l => l.level === 'error').length;
    const badge = document.getElementById('logs-badge');
    if (errorCount) { badge.style.display = 'inline-block'; badge.textContent = errorCount; }
    else badge.style.display = 'none';
  }

  async function refreshLogsBadge() {
    try {
      const res = await fetch('/api/logs', { headers: authHeaders() });
      refreshLogsBadgeFrom(await res.json());
    } catch (e) { /* silencieux */ }
  }

  function exportLogs() {
    if (!allLogs.length) { toast('⚠️ Aucun log à exporter'); return; }
    const lines = [...allLogs].reverse().map(l => {
      const time = new Date(l.time).toLocaleString('fr-FR');
      const meta = l.meta ? ' ' + JSON.stringify(l.meta) : '';
      return \`[\${time}] \${(l.level || 'info').toUpperCase()} (\${l.context || 'SYSTEM'}) \${l.message || l.event || ''}\${meta}\`;
    });
    const blob = new Blob([lines.join('\\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = \`vftrailers-logs-\${stamp}.txt\`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('✅ Export téléchargé');
  }

  async function clearLogs() {
    if (!confirm('Vider tous les logs ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/logs', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Logs vidés'); await loadLogs(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ---- CONFIGURE ----
  const CFG_FIELDS = ['brandName','navLinkText','navLinkUrl','heroTitleWhite','heroTitleRed','heroSubtitle',
    'accentColor','sectionConfigLabel','sectionProfileLabel','sectionLinksLabel','tmdbKeyHint','pseudoHint',
    'externalToggleTitle','externalToggleDesc','maxLinksLabel','maxLinksHint','extrasSelectLabel','extrasSelectHint',
    'installAppLabel','installWebLabel','installCopyLabel'];

  let cfgPreviewTimer = null;

  function setAccentInputs(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
    const color = document.getElementById('cfg-accentColor');
    const text = document.getElementById('cfg-accentColorText');
    if (color && color.value !== hex) color.value = hex;
    if (text && text.value !== hex) text.value = hex;
  }

  function refreshConfigurePreview() {
    clearTimeout(cfgPreviewTimer);
    cfgPreviewTimer = setTimeout(async () => {
      const frame = document.getElementById('cfg-preview');
      if (!frame) return;
      try {
        const res = await fetch('/api/configure-preview', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(collectConfigurePayload()) });
        const data = await res.json();
        frame.srcdoc = data.html || '';
      } catch (e) { /* silencieux : pas bloquant */ }
    }, 300);
  }

  function collectConfigurePayload() {
    const payload = {};
    CFG_FIELDS.forEach(f => { const el = document.getElementById('cfg-' + f); if (el) payload[f] = el.value; });
    return payload;
  }

  async function loadConfigureSettings() {
    try {
      const res = await fetch('/api/settings/configure', { headers: authHeaders() });
      const data = await res.json();
      CFG_FIELDS.forEach(f => { const el = document.getElementById('cfg-' + f); if (el) el.value = data[f] || ''; });
      setAccentInputs(data.accentColor);
      refreshConfigurePreview();
    } catch (e) { toast('❌ Erreur de chargement'); }
  }

  async function saveConfigureSettings() {
    const payload = collectConfigurePayload();
    try {
      const res = await fetch('/api/settings/configure', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      });
      if (res.ok) { toast('✅ Page configure mise à jour'); refreshConfigurePreview(); }
      else toast('❌ Erreur lors de l\\'enregistrement');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function resetConfigureDefaults() {
    if (!confirm('Réinitialiser tous les textes de la page configure ?')) return;
    try {
      const res = await fetch('/api/settings/configure/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Réinitialisé'); await loadConfigureSettings(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  function bindConfigureLivePreview() {
    CFG_FIELDS.forEach(f => {
      const el = document.getElementById('cfg-' + f);
      if (el) el.addEventListener('input', () => {
        if (f === 'accentColor') setAccentInputs(el.value);
        refreshConfigurePreview();
      });
    });
    const color = document.getElementById('cfg-accentColor');
    const text = document.getElementById('cfg-accentColorText');
    if (color) color.addEventListener('input', () => {
      const c = document.getElementById('cfg-accentColor');
      const t = document.getElementById('cfg-accentColorText');
      if (t) t.value = c.value;
      refreshConfigurePreview();
    });
    if (text) text.addEventListener('input', () => {
      const v = text.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { if (color) color.value = v; refreshConfigurePreview(); }
    });
  }

  // ---- SETTINGS (comportement) ----
  const SETTING_FIELDS = [
    { id: 'set-allocineFallback', get: el => el.checked },
    { id: 'set-youtubeSearchFallback', get: el => el.checked },
    { id: 'set-dailymotionFallback', get: el => el.checked },
    { id: 'set-ignoreTeasers', get: el => el.checked },
    { id: 'set-includeExtras', get: el => el.checked },
    { id: 'set-trailerLanguage', get: el => el.value },
    { id: 'set-maxTrailers', get: el => Math.min(3, Math.max(1, Number(el.value) || 2)) },
    { id: 'set-cacheEnabled', get: el => el.checked },
    { id: 'set-cacheTtlHours', get: el => Math.min(72, Math.max(1, Number(el.value) || 6)) },
    { id: 'set-allocineCacheTtlHours', get: el => Math.min(72, Math.max(1, Number(el.value) || 2)) },
    { id: 'set-youtubeSearchCacheTtlHours', get: el => Math.min(72, Math.max(1, Number(el.value) || 1)) },
    { id: 'set-cacheFailures', get: el => el.checked },
    { id: 'set-failureCacheTtlMinutes', get: el => Math.min(180, Math.max(5, Number(el.value) || 30)) },
    { id: 'set-extraVfKeywords', get: el => el.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) },
    { id: 'set-aiomTimeoutSeconds', get: el => Math.min(12, Math.max(1, Number(el.value) || 5)) },
  ];
  const SETTING_NAMES = {
    allocineFallback: 'set-allocineFallback', youtubeSearchFallback: 'set-youtubeSearchFallback',
    dailymotionFallback: 'set-dailymotionFallback',
    ignoreTeasers: 'set-ignoreTeasers', includeExtras: 'set-includeExtras',
    trailerLanguage: 'set-trailerLanguage', maxTrailers: 'set-maxTrailers',
    cacheEnabled: 'set-cacheEnabled', cacheTtlHours: 'set-cacheTtlHours',
    allocineCacheTtlHours: 'set-allocineCacheTtlHours', youtubeSearchCacheTtlHours: 'set-youtubeSearchCacheTtlHours',
    cacheFailures: 'set-cacheFailures', failureCacheTtlMinutes: 'set-failureCacheTtlMinutes',
    extraVfKeywords: 'set-extraVfKeywords', aiomTimeoutSeconds: 'set-aiomTimeoutSeconds',
  };

  let settingsSaveTimer = null;
  let settingsDirty = false;

  function setSaveState(state) {
    const el = document.getElementById('settings-save-state');
    if (!el) return;
    el.className = 'save-state ' + state;
    el.textContent = state === 'dirty' ? '⏳ Modifications à enregistrer'
      : state === 'saving' ? '💾 Enregistrement…'
      : state === 'saved' ? '✅ Enregistré'
      : '';
  }

  function collectBehaviorPayload() {
    const payload = {};
    SETTING_FIELDS.forEach(f => { const el = document.getElementById(f.id); if (el) payload[f.id.replace('set-', '')] = f.get(el); });
    return payload;
  }

  async function loadBehaviorSettings() {
    try {
      const res = await fetch('/api/settings/behavior', { headers: authHeaders() });
      const data = await res.json();
      Object.keys(SETTING_NAMES).forEach(k => {
        const el = document.getElementById(SETTING_NAMES[k]);
        if (!el) return;
        const v = data[k];
        if (el.type === 'checkbox') el.checked = !!v;
        else if (Array.isArray(v)) el.value = v.join(', ');
        else el.value = v ?? '';
      });
      setSaveState('');
      settingsDirty = false;
    } catch (e) { toast('❌ Erreur de chargement'); }
    loadCacheStats();
    loadDiagnostics(false);
  }

  async function saveBehaviorSettings(silent) {
    setSaveState('saving');
    try {
      const res = await fetch('/api/settings/behavior', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(collectBehaviorPayload()),
      });
      if (res.ok) { setSaveState('saved'); settingsDirty = false; setTimeout(() => { if (!settingsDirty) setSaveState(''); }, 2500); }
      else { setSaveState('dirty'); if (!silent) toast('❌ Erreur lors de l\\'enregistrement'); }
    } catch (e) { setSaveState('dirty'); if (!silent) toast('❌ ' + e.message); }
  }

  function bindSettingsAutosave() {
    SETTING_FIELDS.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      el.addEventListener('input', () => {
        settingsDirty = true;
        setSaveState('dirty');
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => saveBehaviorSettings(true), 800);
      });
      el.addEventListener('change', () => {
        settingsDirty = true;
        setSaveState('dirty');
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => saveBehaviorSettings(true), 800);
      });
    });
  }

  async function loadCacheStats() {
    const desc = document.getElementById('cache-stats-desc');
    try {
      const res = await fetch('/api/cache/stats', { headers: authHeaders() });
      const data = await res.json();
      desc.textContent = data.count > 0
        ? \`\${data.count} entrée\${data.count > 1 ? 's' : ''} en cache (\${data.success || 0} succès · \${data.failures || 0} échec\${data.failures === 1 ? '' : 's'})\`
        : 'Aucune entrée en cache actuellement';
    } catch (e) {
      desc.textContent = 'Impossible de récupérer les statistiques du cache';
    }
  }

  async function clearTrailerCache(only) {
    const label = only === 'failures' ? 'les échecs du cache' : 'tout le cache des bandes-annonces';
    if (!confirm(only === 'failures'
      ? 'Vider uniquement les échecs en cache ? Les titres qui échouaient seront re-testés à la prochaine requête, les succès sont conservés.'
      : 'Vider tout le cache des bandes-annonces ? Les prochaines requêtes re-vérifieront auprès de TMDB.')) return;
    try {
      const res = await fetch('/api/cache' + (only === 'failures' ? '?only=failures' : ''), { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ ' + (only === 'failures' ? 'Échecs vidés' : 'Cache vidé')); loadCacheStats(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function loadDiagnostics(force) {
    const grid = document.getElementById('diag-grid');
    const desc = document.getElementById('diag-desc');
    if (!grid) return;
    const setVal = (key, label, ok, sub) => {
      const el = grid.querySelector('[data-diag="' + key + '"]');
      if (!el) return;
      el.className = 'diag-val ' + (ok === null ? 'diag-pending' : ok ? 'diag-ok' : 'diag-bad');
      el.innerHTML = escapeHtml(label) + (sub ? '<span class="diag-sub">' + escapeHtml(sub) + '</span>' : '');
    };
    try {
      if (force) { desc.textContent = 'Vérification en cours...'; setVal('redis', '…', null); setVal('tmdbkey', '…', null); setVal('svc-tmdb', '…', null); setVal('svc-youtube', '…', null); setVal('svc-allocine', '…', null); setVal('cache', '…', null); }
      const res = await fetch('/api/diagnostics', { headers: authHeaders() });
      const d = await res.json();
      setVal('redis', d.redis ? '✓ Connecté' : '✗ Indisponible', d.redis, d.redis ? 'Redis opérationnel' : 'Vérifie UPSTASH_REDIS_REST_URL / TOKEN');
      if (d.tmdbKey && d.tmdbKey.present) {
        setVal('tmdbkey', d.tmdbKey.valid === true ? '✓ Valide' : '✗ Invalide', d.tmdbKey.valid === true, 'Clé …' + (d.tmdbKey.last4 || ''));
      } else {
        setVal('tmdbkey', '⚠️ Absente', null, 'TMDB_API_KEY non configurée');
      }
      setVal('svc-tmdb', d.services && d.services.tmdb ? '✓ Joignable' : '✗ Down', !!(d.services && d.services.tmdb), 'themoviedb.org');
      setVal('svc-youtube', d.services && d.services.youtube ? '✓ Joignable' : '✗ Down', !!(d.services && d.services.youtube), 'youtube.com');
      setVal('svc-allocine', d.services && d.services.allocine ? '✓ Joignable' : '✗ Down', !!(d.services && d.services.allocine), 'allocine.fr');
      setVal('cache', d.cache && d.cache.count ? (d.cache.count + ' entrée' + (d.cache.count > 1 ? 's' : '')) : 'Vide', true, (d.cache && d.cache.success ? d.cache.success + ' succès · ' : '') + (d.cache && d.cache.failures ? d.cache.failures + ' échecs' : '0 échec'));
      desc.textContent = d.redis ? 'Tout est opérationnel' : '⚠️ Redis indisponible — le cache et les stats ne fonctionneront pas';
    } catch (e) {
      desc.textContent = 'Impossible de récupérer le diagnostic';
    }
  }

  async function resetBehaviorDefaults() {
    if (!confirm('Réinitialiser tous les réglages de comportement aux valeurs par défaut ?')) return;
    try {
      const res = await fetch('/api/settings/behavior/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Réinitialisé'); await loadBehaviorSettings(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  // ---- UTILS ----
  function toggleTheme() {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';
    localStorage.setItem('vftrailers_theme', isDark ? 'dark' : 'light');
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escapeAttr(str) { return String(str).replace(/'/g, "\\\\'"); }

  // Init
  const savedTheme = localStorage.getItem('vftrailers_theme') || 'dark';
  isDark = savedTheme === 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';

  bindConfigureLivePreview();
  bindSettingsAutosave();

  if (token) { showDashboard(); }
</script>
</body>
</html>`;
}

module.exports = { renderDashboardShell };