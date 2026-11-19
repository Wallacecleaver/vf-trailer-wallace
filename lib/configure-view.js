// Génère la page publique /configure : textes éditables depuis le dashboard,
// + un vrai formulaire de configuration par utilisateur (clé TMDB perso,
// qualité vidéo) encodé dans l'URL du manifest, à la manière des gros addons
// Stremio (Torrentio etc.) : /<config>/manifest.json

const { MAINTENANCE_CSS, renderMaintenanceNotice } = require('./maintenance-view');

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderConfigureHtml(s, maintenance = null) {
    // Couleur de marque éditée depuis le dashboard : on override --red/--red-dark dans :root.
    const accent = /^#[0-9a-fA-F]{6}$/.test(s.accentColor || '') ? s.accentColor : '#e53e3e';
    const accentDark = darkenHex(accent, 0.12);
    const discordLink = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)/i.test(s.navLinkUrl || '');
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/logo_transparent_check.png">
  <title>${escapeHtml(s.brandName)} — Installation</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    ${MAINTENANCE_CSS}
    :root {
      --red: ${accent}; --red-dark: ${accentDark}; --bg: #0a0a0b; --bg2: #111113; --bg3: #18181b;
      --border: rgba(255,255,255,0.06); --text: #f0f0f0; --muted: #666; --muted2: #444;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; overflow-x: hidden; }
    body::before {
      content: ''; position: fixed; top: -200px; left: 50%; transform: translateX(-50%);
      width: 800px; height: 600px; background: radial-gradient(ellipse, rgba(229,62,62,0.07) 0%, transparent 70%);
      pointer-events: none; z-index: 0;
    }
    nav {
      position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between;
      padding: 0 40px; height: 60px; background: rgba(10,10,11,0.85); backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }
    .nav-name { font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 2px; color: #fff; text-transform: uppercase; }
    .nav-links { display: flex; align-items: center; gap: 8px; }
    .nav-link {
      display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px;
      border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 13px;
      font-family: 'DM Sans', sans-serif; text-decoration: none; cursor: pointer; transition: all 0.2s;
    }
    .nav-link:hover { color: var(--text); border-color: var(--muted2); background: var(--bg3); }
    .nav-link-logo { width: 22px; height: 22px; border-radius: 6px; object-fit: contain; flex-shrink: 0; }
    .hero { position: relative; z-index: 1; text-align: center; padding: 48px 40px 28px; }
    .status-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 28px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px;
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: 100px; font-size: 12px; font-weight: 500; color: var(--muted);
      letter-spacing: 0.5px; cursor: default;
    }
    .status-logo { display:block; width:16px; height:16px; object-fit:contain; flex:0 0 16px; }
    .status-logo-tvdb { width:19px; height:16px; flex-basis:19px; }
    .status-logo-allocine { filter:brightness(0) invert(1); }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #666; flex-shrink: 0; animation: pulse 2s infinite; }
    .status-dot.up { background: #48bb78; animation: none; }
    .status-dot.down { background: var(--red); animation: none; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
    .hero-title { font-family: 'Bebas Neue', sans-serif; font-size: clamp(44px, 6vw, 72px); line-height: 0.9; letter-spacing: 4px; color: #fff; margin-bottom: 8px; }
    .hero-title span { color: var(--red); display: block; }
    .hero-sub { font-size: 15px; color: var(--muted); max-width: 480px; margin: 14px auto 0; line-height: 1.6; font-weight: 300; }
    main { position: relative; z-index: 1; max-width: 1120px; margin: 0 auto; padding: 0 24px 140px; }
    .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; margin-top: 40px; }
    .section-line { flex: 1; height: 1px; background: var(--border); }
    .section-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; }
    .config-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-top: 12px; }
    .config-field { margin-bottom: 16px; }
    .config-field:last-child { margin-bottom: 0; }
    .api-key-optional { border-top: 1px solid var(--border); padding-top: 20px; }
    .config-field label { display: block; font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
    .config-field .hint { font-size: 11px; color: var(--muted); font-weight: 300; margin-top: 5px; line-height: 1.5; }
    .config-field .hint a { color: var(--red); text-decoration: none; }
    .config-field .hint a:hover { text-decoration: underline; }
    .config-field input, .config-field select {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px;
      color: var(--text); font-family: 'Rajdhani', monospace; font-size: 14px; transition: border-color .2s;
    }
    .config-field input:focus, .config-field select:focus { outline: none; border-color: var(--red); }
    .checkbox-row { display: flex !important; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 0 !important; }
    .checkbox-row input[type="checkbox"] { width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--red); cursor: pointer; }
    .toggle-card {
      display: flex !important; align-items: center; gap: 16px; background: var(--bg);
      border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px;
      margin-bottom: 0 !important; cursor: pointer; transition: border-color .2s, background .2s;
    }
    .toggle-card:hover { border-color: var(--muted2); }
    .toggle-card:has(input:checked) { border-color: rgba(229,62,62,0.5); background: rgba(229,62,62,0.06); }
    .toggle-card input[type="checkbox"] {
      width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--red); cursor: pointer;
    }
    .toggle-card .toggle-text { display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
    .toggle-card .toggle-text .toggle-title { font-size: 13px; font-weight: 600; color: var(--text); line-height: 1.3; }
    .toggle-card .toggle-text .toggle-desc { font-size: 11px; color: var(--muted); font-weight: 300; line-height: 1.5; }
    .config-status { font-size: 12px; padding: 8px 12px; border-radius: 8px; margin-top: 14px; display: none; }
    .config-status.ok { display: block; background: rgba(72,187,120,0.08); border: 1px solid rgba(72,187,120,0.25); color: #68d391; }
    .tmdb-key-row { display: flex; gap: 8px; }
    .tmdb-key-row input { flex: 1; min-width: 0; }
    .btn-test {
      flex-shrink: 0; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg3); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 13px;
      font-weight: 500; cursor: pointer; transition: all .2s; white-space: nowrap;
    }
    .btn-test:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
    .btn-test:disabled { opacity: .5; cursor: wait; }
    .test-result { display: none; align-items: center; gap: 6px; font-size: 12px; margin-top: 8px; }
    .test-result.show { display: flex; }
    .test-result.ok { color: #68d391; }
    .test-result.error { color: #fc8181; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 390px; gap: 28px; align-items: start; }
    .col-main { display: flex; flex-direction: column; gap: 18px; }
    .col-main .config-card { margin-top: 0; }
    .aside { position: sticky; top: 80px; display: flex; flex-direction: column; gap: 16px; }
    .aside .config-card { margin-top: 0; padding: 18px; }
    .step-head { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .step-num { width: 32px; height: 32px; border-radius: 9px; background: rgba(229,62,62,0.12); border: 1px solid rgba(229,62,62,0.35); color: var(--red); display: grid; place-items: center; font-weight: 700; font-size: 14px; flex-shrink: 0; transition:all .2s ease; }
    .step-num.done { color:#7ae5aa; border-color:rgba(72,187,120,.48); background:rgba(72,187,120,.12); }
    .step-num.optional { width:auto; min-width:58px; padding:0 7px; color:#aaa8b6; border-color:var(--border); background:var(--bg3); font-size:10px; text-transform:uppercase; letter-spacing:.4px; }
    .step-heading { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
    .step-type { border-radius:6px; padding:3px 6px; font-size:10px; font-weight:700; letter-spacing:.2px; background:rgba(229,62,62,.11); color:#f9a0a0; }
    .step-type.optional { color:var(--muted); background:var(--bg3); }
    .step-title { font-size: 16px; font-weight: 600; color: #fff; }
    .step-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .seg { display: flex; gap: 4px; background: var(--bg); border: 1px solid var(--border); border-radius: 11px; padding: 4px; }
    .seg button { flex: 1; padding: 9px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--muted); font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; }
    .seg button:hover { color: var(--text); }
    .seg button.on { background: rgba(229,62,62,0.14); border-color: rgba(229,62,62,0.5); color: #fff; }
    .toggle-card input[type="checkbox"] { appearance: none; -webkit-appearance: none; width: 40px; height: 22px; border-radius: 22px; background: #2a2a2e; position: relative; transition: background .2s; flex-shrink: 0; }
    .toggle-card input[type="checkbox"]::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; }
    .toggle-card input[type="checkbox"]:checked { background: var(--red); }
    .toggle-card input[type="checkbox"]:checked::after { transform: translateX(18px); }
    .ready-card { display:block; background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:17px 18px; transition:border-color .2s ease; }
    .ready-card.ok { border-color:rgba(72,187,120,.4); background:rgba(72,187,120,.045); }
    .setup-progress-head { display:flex; align-items:center; gap:13px; }
    .setup-circle { width:46px; height:46px; border-radius:50%; display:grid; place-items:center; flex-shrink:0; border:2px solid rgba(229,62,62,.5); background:rgba(229,62,62,.08); color:#fff; font-size:12px; font-weight:800; font-variant-numeric:tabular-nums; }
    .ready-card.ok .setup-circle { border-color:#48bb78; background:rgba(72,187,120,.13); color:#8aefb5; }
    .ready-title { font-size:14px; font-weight:700; color:#fff; }
    .ready-sub { font-size:12px; color:var(--muted); margin-top:4px; line-height:1.45; }
    .setup-progress-track { height:6px; background:rgba(255,255,255,.09); border-radius:9px; overflow:hidden; margin-top:17px; }
    .setup-progress-fill { height:100%; width:0; background:linear-gradient(90deg,var(--red),#ef7575); border-radius:9px; transition:width .22s ease; }
    .ready-card.ok .setup-progress-fill { background:#48bb78; }
    .setup-progress-meta { display:flex; justify-content:space-between; align-items:center; margin:7px 0 13px; gap:8px; font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; }
    .setup-checklist { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
    .setup-checklist li { display:flex; align-items:center; gap:9px; border:1px solid transparent; padding:6px 7px; border-radius:8px; font-size:12px; line-height:1.35; color:#bbb8be; }
    .setup-checklist li.is-next { color:#fff; background:rgba(229,62,62,.08); border-color:rgba(229,62,62,.2); }
    .setup-checklist li.is-optional { opacity:.85; color:var(--muted); border-top:1px solid var(--border); padding-top:10px; margin-top:2px; }
    .setup-checklist li.is-optional .setup-check-icon { border-style:dashed; }
    .setup-checklist li[hidden] { display:none; }
    .setup-checklist li.is-done { color:#82d8a8; }
    .setup-check-icon { width:18px; height:18px; border:1px solid rgba(255,255,255,.22); border-radius:50%; display:grid; place-items:center; flex-shrink:0; color:#aaa; font-size:11px; }
    .setup-checklist li.is-done .setup-check-icon { border-color:rgba(72,187,120,.5); background:rgba(72,187,120,.14); color:#85efb4; }
    .setup-checklist li.is-next .setup-check-icon { border-color:var(--red); color:#fff; }
    .setup-optional { color:var(--muted); font-size:11px; margin-top:12px; line-height:1.5; }
    .setup-optional strong { color:#c5c2c9; font-weight:600; }
    @media (max-width:420px) { .ready-card { padding:14px; } .setup-progress-head { gap:10px; } }
    .preview-top { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); margin-bottom: 14px; }
    .preview-film { padding: 12px 14px; border-radius: 10px; background: var(--bg3); margin-bottom: 10px; font-size: 12px; color: var(--muted); }
    .preview-film-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 2px; }
    .pv-search { position: relative; margin-bottom: 10px; }
    .pv-search input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 13px; }
    .pv-search input:focus { outline: none; border-color: var(--red); }
    .pv-results { display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 20; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; max-height: 320px; overflow-y: auto; }
    .pv-results.show { display: block; }
    .pv-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; cursor: pointer; }
    .pv-item:hover { background: rgba(255,255,255,0.05); }
    .pv-item img, .pv-item .pv-ph { width: 32px; height: 46px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
    .pv-item .t { font-size: 13px; color: #fff; }
    .pv-item .y { font-size: 11px; color: var(--muted); }
    .pv-empty { padding: 12px; font-size: 12px; color: var(--muted); }
    .preview-film { display: flex; align-items: center; gap: 12px; }
    .pv-poster, .pv-ph { width: 46px; height: 66px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
    .pv-ph { background: var(--bg); border: 1px solid var(--border); }
    .pv-credit { margin-top: 12px; font-size: 10px; color: var(--muted2); text-align: center; }
    .preview-list { display: flex; flex-direction: column; gap: 8px; }
    .preview-row { display: flex; gap: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 11px 13px; }
    .preview-name { flex: 0 0 84px; font-size: 12px; font-weight: 600; line-height: 1.5; white-space: pre-line; color: var(--text); }
    .preview-title { flex: 1; min-width: 0; font-size: 12px; line-height: 1.55; white-space: pre-line; color: var(--muted); overflow-wrap: anywhere; }
    .preview-title::first-line { color: var(--text); font-weight: 600; }
    .url-field { flex: 1 1 260px; max-width: 520px; min-width: 0; background: var(--bg); border: 1px solid var(--border); border-radius: 9px; padding: 11px 14px; color: var(--muted); font-family: 'Rajdhani', monospace; font-size: 13px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .aside { position: static; order: -1; } }

    .install-bar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; padding: 18px 32px;
      background: rgba(10,10,11,0.97); backdrop-filter: blur(20px);
      border-top: 1px solid rgba(229,62,62,0.25); box-shadow: 0 -4px 30px rgba(229,62,62,0.06);
      display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;
    }
    .btn { display: flex; align-items: center; gap: 7px; padding: 11px 22px; border-radius: 9px; font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-red { background: var(--red); color: #fff; animation: btnPulse 2.5s ease-in-out infinite; }
    .btn-red:hover { background: var(--red-dark); transform: translateY(-1px); box-shadow: 0 4px 15px rgba(229,62,62,0.4); }
    @keyframes btnPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(229,62,62,0.35); } 50% { box-shadow: 0 0 0 8px rgba(229,62,62,0); } }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { background: var(--bg3); transform: translateY(-1px); }
    .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
    .btn-ghost:hover { color: var(--text); background: var(--bg3); }
    .toast {
      position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%) translateY(10px);
      background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 10px 20px;
      border-radius: 10px; font-size: 13px; opacity: 0; transition: all 0.25s; pointer-events: none; z-index: 999; white-space: nowrap;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    @media (max-width: 640px) {
      .hero { padding: 60px 20px 30px; }
      .hero-title { font-size: clamp(48px, 14vw, 80px); }
      main { padding: 0 12px 160px; }
      .install-bar { padding: 14px 16px; }
      .btn { flex: 1; justify-content: center; }
      .url-field { flex: 1 1 100%; max-width: none; }
      nav { padding: 0 16px; }
      .nav-links { gap: 6px; }
      .nav-link { padding: 6px 10px; font-size: 12px; }
      .nl-long { display: none; }
    }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--muted2); border-radius: 4px; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-brand"><span class="nav-name">${escapeHtml(s.brandName)}</span></div>
    <div class="nav-links">
      <a href="/proposer" class="nav-link" target="_blank">📥 Proposer un lien</a>
      ${/^https?:\/\//i.test(s.navLinkUrl || '') ? `<a href="${escapeHtml(s.navLinkUrl)}" class="nav-link" target="_blank" rel="noopener noreferrer">${discordLink ? '<img class="nav-link-logo" src="/logos/discord-community.png" alt="" width="22" height="22">' : ''}${escapeHtml(s.navLinkText || 'Lien')}</a>` : ''}
    </div>
  </nav>

  ${renderMaintenanceNotice(maintenance)}
  <div class="hero">
    <div class="status-row" id="status-row" aria-label="Disponibilité des sources">
      <div class="status-badge" data-service="tmdb"><span class="status-dot"></span><img class="status-logo" src="/logos/tmdb.svg" alt=""><span>TMDB</span></div>
      <div class="status-badge" data-service="tvdb"><span class="status-dot"></span><img class="status-logo status-logo-tvdb" src="https://www.thetvdb.com/images/attribution/logo1.png" alt=""><span>TheTVDB</span></div>
      <div class="status-badge" data-service="youtube"><span class="status-dot"></span><img class="status-logo" src="/logos/youtube.svg" alt=""><span>YouTube</span></div>
      <div class="status-badge" data-service="allocine"><span class="status-dot"></span><img class="status-logo status-logo-allocine" src="https://assets.allocine.fr/skin/img/allocine/logo-main-grey.5de8867c.svg" alt=""><span>Allociné</span></div>
      <div class="status-badge" data-service="anilist"><span class="status-dot"></span><img class="status-logo" src="/logos/anilist.svg" alt=""><span>AniList</span></div>
    </div>
    <h1 class="hero-title">${escapeHtml(s.heroTitleWhite)}<span>${escapeHtml(s.heroTitleRed)}</span></h1>
    <p class="hero-sub">${escapeHtml(s.heroSubtitle)}</p>
  </div>

  <main>
    <div class="layout">
      <div class="col-main">
        <section class="config-card" data-step="pseudo">
          <div class="step-head"><span class="step-num" id="step-pseudo-badge">1</span><div><div class="step-heading"><div class="step-title">${escapeHtml(s.sectionProfileLabel || 'Ton profil')}</div><span class="step-type">Obligatoire</span></div><div class="step-sub">Ton pseudo aide à identifier les demandes de bandes-annonces manquantes</div></div></div>
          <div class="config-field">
            <label for="cfg-pseudo">Ton pseudo Discord</label>
            <input type="text" id="cfg-pseudo" maxlength="40" placeholder="Ton pseudo">
            <div class="hint">${escapeHtml(s.pseudoHint || "Si jamais une bande-annonce manque pour un film que tu ouvres, ton pseudo apparaîtra dans le journal admin — plus facile de savoir qui a eu le souci.")}</div>
          </div>
        </section>

        <section class="config-card" data-step="tmdb">
          <div class="step-head"><span class="step-num" id="step-tmdb-badge">2</span><div><div class="step-heading"><div class="step-title">${escapeHtml(s.sectionConfigLabel || 'Ta configuration')}</div><span class="step-type">Obligatoire</span></div><div class="step-sub">Ajoute tes clés API : TMDB est obligatoire, TheTVDB est facultatif</div></div></div>
          <div class="config-field">
            <label for="cfg-tmdbkey">Ta clé API TMDB (gratuite, obligatoire)</label>
            <div class="tmdb-key-row">
              <input type="text" id="cfg-tmdbkey" placeholder="Colle ta clé TMDB ici">
              <button type="button" class="btn-test" id="test-tmdb-btn" onclick="testTmdbKey()">Tester</button>
            </div>
            <div class="test-result" id="test-tmdb-result"></div>
            <div class="hint">${escapeHtml(s.tmdbKeyHint || 'Obtiens la tienne gratuitement sur themoviedb.org/settings/api (compte gratuit, 2 min).')} <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org ↗</a></div>
            <div class="config-status" id="cfg-status">✅ Clé testée, tout est bon</div>
          </div>
          <div class="config-field api-key-optional">
            <label for="cfg-tvdbkey">Ta clé API TheTVDB (facultatif)</label>
            <div class="tmdb-key-row">
              <input type="password" id="cfg-tvdbkey" autocomplete="off" spellcheck="false" placeholder="Colle ta clé TheTVDB ici">
              <button type="button" class="btn-test" id="test-tvdb-btn" onclick="testTvdbKey()">Tester</button>
            </div>
            <div class="test-result" id="test-tvdb-result" role="status" aria-live="polite"></div>
            <div class="hint">Tu peux laisser ce champ vide si l'administrateur fournit déjà une clé. Les clés user-supported qui exigent un PIN ne sont pas compatibles avec ce mode. <a href="https://thetvdb.com/api-information" target="_blank" rel="noopener">Obtenir une clé TheTVDB ↗</a></div>
          </div>
        </section>

        <section class="config-card">
          <div class="step-head"><span class="step-num optional">Option</span><div><div class="step-title">${escapeHtml(s.sectionLinksLabel || 'Affichage des liens')}</div><div class="step-sub">Facultatif — l'aperçu se met à jour en direct</div></div></div>
          <div class="config-field">
            <label for="cfg-display">Format des liens dans Stremio</label>
            <select id="cfg-display">
              <option value="">Par défaut</option>
              <option value="compact">Compact</option>
              <option value="detailed">Détaillé</option>
            </select>
            <div class="hint">Change la présentation des liens dans Stremio : regarde l'aperçu à droite. « Détaillé » ajoute la source, la qualité et le type de lecture.</div>
          </div>
          <div class="config-field">
            <label class="toggle-card" for="cfg-external-only">
              <input type="checkbox" id="cfg-external-only">
              <span class="toggle-text">
                <span class="toggle-title">${escapeHtml(s.externalToggleTitle || "Uniquement les liens d'ouverture externe (YouTube)")}</span>
                <span class="toggle-desc">${escapeHtml(s.externalToggleDesc || 'Ne propose que le lien qui ouvre YouTube directement, sans la version lue dans le lecteur intégré de Stremio.')}</span>
              </span>
            </label>
          </div>
          <div class="config-field">
            <label for="cfg-max-links">${escapeHtml(s.maxLinksLabel || 'Nombre maximum de liens affichés')}</label>
            <select id="cfg-max-links">
              <option value="">Tous</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
            <div class="hint">${escapeHtml(s.maxLinksHint || "Certains films/séries proposent plusieurs bandes-annonces (trailer + teaser, jouable + externe...) : limite le nombre total de liens si tu préfères n'en voir qu'un.")}</div>
          </div>
          <div class="config-field">
            <label for="cfg-extras">${escapeHtml(s.extrasSelectLabel || 'Extras (récaps, making-of…)')}</label>
            <select id="cfg-extras">
              <option value="">Par défaut</option>
              <option value="on">Activés</option>
              <option value="off">Désactivés</option>
            </select>
            <div class="hint">${escapeHtml(s.extrasSelectHint || "En plus des bandes-annonces et teasers, certaines fiches TMDB proposent des vidéos dites « extras » : récaps de saison, extraits (clips), making-of, coulisses, bêtisiers, génériques. « Par défaut » suit les réglages admin.")}</div>
          </div>
        </section>
      </div>

      <aside class="aside">
        <section class="ready-card" id="ready-card" aria-label="Progression avant installation">
          <div class="setup-progress-head">
            <div class="setup-circle" id="setup-counter" aria-hidden="true">0/3</div>
            <div>
              <div class="ready-title" id="ready-title">Encore 3 étapes</div>
              <div class="ready-sub" id="ready-sub">Complète les étapes obligatoires pour installer l'addon.</div>
            </div>
          </div>
          <div class="setup-progress-track" id="setup-progress-track" role="progressbar" aria-label="Progression de la configuration" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0">
            <div class="setup-progress-fill" id="setup-progress-fill"></div>
          </div>
          <div class="setup-progress-meta">
            <span id="setup-progress-label">0 sur 3 étapes validées</span>
            <span id="setup-progress-percent">0 %</span>
          </div>
          <ul class="setup-checklist" id="setup-checklist">
            <li data-check="pseudo"><span class="setup-check-icon" aria-hidden="true">○</span><span>Renseigner le pseudo Discord</span></li>
            <li data-check="tmdb-key"><span class="setup-check-icon" aria-hidden="true">○</span><span>TMDB — renseigner la clé API</span></li>
            <li data-check="tmdb-test"><span class="setup-check-icon" aria-hidden="true">○</span><span>TMDB — tester et valider la clé</span></li>
            <li data-check="tvdb-test" class="is-optional"><span class="setup-check-icon" aria-hidden="true">+</span><span class="setup-check-label">TheTVDB — clé facultative, à renseigner ou ignorer</span></li>
          </ul>
          <div class="setup-optional">TheTVDB est <strong>facultatif</strong> : sans clé personnelle, tu peux quand même installer l'addon.</div>
        </section>
        <div class="config-card preview-card">
          <div class="preview-top"><span>Aperçu dans Stremio</span><span id="pv-type">Film</span></div>
          <div class="pv-search">
            <input type="text" id="pv-search" placeholder="Essaie avec un film ou une série…" autocomplete="off" aria-label="Choisir un film ou une série pour l'aperçu">
            <div class="pv-results" id="pv-results"></div>
          </div>
          <div class="preview-film">
            <img class="pv-poster" id="pv-poster" alt="" style="display:none">
            <div class="pv-ph" id="pv-ph"></div>
            <div><div class="preview-film-title" id="pv-title">Dune : Deuxième partie</div><div id="pv-meta">Film · 2024</div></div>
          </div>
          <div class="preview-list" id="preview-list" aria-live="polite"></div>
          <div class="pv-credit">Plateformes et VOD (achat/location) : disponibilité fournie par JustWatch via TMDB</div>
          <div class="pv-credit">Données de séries et saisons fournies en partie par <a href="https://thetvdb.com/" target="_blank" rel="noopener">TheTVDB.com</a>.</div>
        </div>
      </aside>
    </div>
  </main>

  <div class="install-bar">
    <input type="text" class="url-field" id="manifest-url" readonly aria-label="Lien d'installation">
    <button class="btn btn-red" onclick="install('app')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      ${escapeHtml(s.installAppLabel || 'Installer dans Stremio')}
    </button>
    <button class="btn btn-outline" onclick="install('web')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      ${escapeHtml(s.installWebLabel || 'Web')}
    </button>
    <button class="btn btn-ghost" onclick="copyLink()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
      ${escapeHtml(s.installCopyLabel || 'Copier le lien')}
    </button>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // Le mode AIOMetadata reste conservé lors de la reconfiguration d'un ancien lien,
    // mais n'est plus proposé parmi les options de cette page.
    let aiomMode = false;

    function b64urlEncode(str) {
      return btoa(unescape(encodeURIComponent(str))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }

    function buildConfig() {
      const pseudo = document.getElementById('cfg-pseudo').value.trim();
      const tmdbKey = document.getElementById('cfg-tmdbkey').value.trim();
      const tvdbKey = document.getElementById('cfg-tvdbkey').value.trim();
      const externalOnly = document.getElementById('cfg-external-only').checked;
      const maxLinks = document.getElementById('cfg-max-links').value;
      const extras = document.getElementById('cfg-extras').value;
      const display = document.getElementById('cfg-display').value;
      const cfg = {};
      if (pseudo) cfg.pseudo = pseudo.slice(0, 40);
      if (tmdbKey) cfg.tmdbKey = tmdbKey;
      if (tvdbKey) cfg.tvdbKey = tvdbKey;
      if (externalOnly) cfg.externalOnly = true;
      if (maxLinks) cfg.maxLinks = parseInt(maxLinks, 10);
      if (extras === 'on') cfg.includeExtras = true;
      else if (extras === 'off') cfg.includeExtras = false;
      if (aiomMode) cfg.aiom = true;
      if (display) cfg.display = display;
      return Object.keys(cfg).length ? b64urlEncode(JSON.stringify(cfg)) : '';
    }

    function getManifestUrl() {
      const config = buildConfig();
      const base = window.location.origin;
      return config ? \`\${base}/\${config}/manifest.json\` : \`\${base}/manifest.json\`;
    }

    let tmdbKeyValidated = false;
    let tvdbKeyValidated = false;

    function updateStatus() {
      const status = document.getElementById('cfg-status');
      status.classList.toggle('ok', tmdbKeyValidated);
      if (typeof refreshAside === 'function') refreshAside();
    }

    // ---- Mémorisation locale (pseudo / clé TMDB) ----
    // Pratique si la personne revient sur la page plus tard : pas besoin de tout retaper.
    // Reste 100% côté navigateur, rien n'est envoyé nulle part avant de cliquer "Installer".
    const STORAGE_KEYS = {
      pseudo: 'vftrailer_pseudo', tmdbKey: 'vftrailer_tmdbkey',
      externalOnly: 'vftrailer_external_only', maxLinks: 'vftrailer_max_links',
      extras: 'vftrailer_extras', display: 'vftrailer_display',
    };

    function loadSavedValues() {
      try {
        const pseudo = localStorage.getItem(STORAGE_KEYS.pseudo);
        const tmdbKey = localStorage.getItem(STORAGE_KEYS.tmdbKey);
        const externalOnly = localStorage.getItem(STORAGE_KEYS.externalOnly);
        const maxLinks = localStorage.getItem(STORAGE_KEYS.maxLinks);
        const extras = localStorage.getItem(STORAGE_KEYS.extras);
        const display = localStorage.getItem(STORAGE_KEYS.display);
        if (pseudo) document.getElementById('cfg-pseudo').value = pseudo;
        if (tmdbKey) document.getElementById('cfg-tmdbkey').value = tmdbKey;
        if (externalOnly) document.getElementById('cfg-external-only').checked = externalOnly === '1';
        if (maxLinks) document.getElementById('cfg-max-links').value = maxLinks;
        if (extras) document.getElementById('cfg-extras').value = extras;
        if (display) document.getElementById('cfg-display').value = display;
      } catch (e) { /* navigation privée ou storage bloqué -> tant pis, pas bloquant */ }
    }

    function saveValuesLocally() {
      try {
        localStorage.setItem(STORAGE_KEYS.pseudo, document.getElementById('cfg-pseudo').value.trim());
        localStorage.setItem(STORAGE_KEYS.tmdbKey, document.getElementById('cfg-tmdbkey').value.trim());
        localStorage.setItem(STORAGE_KEYS.externalOnly, document.getElementById('cfg-external-only').checked ? '1' : '0');
        localStorage.setItem(STORAGE_KEYS.maxLinks, document.getElementById('cfg-max-links').value);
        localStorage.setItem(STORAGE_KEYS.extras, document.getElementById('cfg-extras').value);
        localStorage.setItem(STORAGE_KEYS.display, document.getElementById('cfg-display').value);
      } catch (e) { /* idem, silencieux */ }
    }

    document.getElementById('cfg-pseudo').addEventListener('input', saveValuesLocally);
    document.getElementById('cfg-tmdbkey').addEventListener('input', saveValuesLocally);
    document.getElementById('cfg-external-only').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-max-links').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-extras').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-display').addEventListener('change', saveValuesLocally);

    loadSavedValues();

    var previewSeq = 0;
    function previewMessage(message) {
      var list = document.getElementById('preview-list');
      list.textContent = '';
      var info = document.createElement('div');
      info.className = 'pv-empty';
      info.textContent = message;
      list.appendChild(info);
    }
    function renderPreview() {
      var seq = ++previewSeq;
      if (!pvFilm.tmdbId || !pvFilm.type) {
        previewMessage('Choisis un film ou une série pour voir ses bandes-annonces.');
        return;
      }
      previewMessage('Recherche des bandes-annonces…');
      var payload = {
        display: document.getElementById('cfg-display').value,
        externalOnly: document.getElementById('cfg-external-only').checked,
        maxLinks: document.getElementById('cfg-max-links').value,
        includeExtras: document.getElementById('cfg-extras').value,
        aiom: aiomMode,
        tmdbId: pvFilm.tmdbId,
        type: pvFilm.type
      };
      fetch('/api/preview-streams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (seq !== previewSeq) return;
          if (d.error || !(d.streams || []).length) {
            previewMessage(d.error || d.message || 'Aucune bande-annonce trouvée avec ces options.');
            return;
          }
          var list = document.getElementById('preview-list');
          list.textContent = '';
          (d.streams || []).forEach(function (s) {
            var row = document.createElement('div'); row.className = 'preview-row';
            var name = document.createElement('div'); name.className = 'preview-name'; name.textContent = s.name;
            var title = document.createElement('div'); title.className = 'preview-title'; title.textContent = s.title;
            row.appendChild(name); row.appendChild(title); list.appendChild(row);
          });
        })
        .catch(function () {
          if (seq === previewSeq) previewMessage('Impossible de charger l’aperçu pour le moment. Réessaie.');
        });
    }
    ['cfg-display', 'cfg-max-links', 'cfg-external-only', 'cfg-extras'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', renderPreview);
    });

    // ---- Config portée par l'adresse (/<config>/configure) ----
    // Le bouton "Configurer" de Stremio ouvre /<config>/configure : la config EST dans le lien.
    // On la relit pour pré-remplir la page (prioritaire sur la mémoire locale du navigateur, qui est
    // vide sur une nouvelle adresse ou un autre appareil).
    function b64urlDecode(str) {
      let b = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return decodeURIComponent(escape(atob(b)));
    }

    function loadConfigFromUrl() {
      try {
        const parts = window.location.pathname.split('/').filter(Boolean);
        if (parts.length < 2 || parts[parts.length - 1] !== 'configure') return false;
        const cfg = JSON.parse(b64urlDecode(decodeURIComponent(parts[parts.length - 2])));
        if (!cfg || typeof cfg !== 'object') return false;
        document.getElementById('cfg-pseudo').value = typeof cfg.pseudo === 'string' ? cfg.pseudo : '';
        document.getElementById('cfg-tmdbkey').value = typeof cfg.tmdbKey === 'string' ? cfg.tmdbKey : '';
        document.getElementById('cfg-tvdbkey').value = typeof cfg.tvdbKey === 'string' ? cfg.tvdbKey : '';
        document.getElementById('cfg-external-only').checked = cfg.externalOnly === true;
        document.getElementById('cfg-max-links').value = cfg.maxLinks ? String(cfg.maxLinks) : '';
        document.getElementById('cfg-extras').value = cfg.includeExtras === true ? 'on' : cfg.includeExtras === false ? 'off' : '';
        if (['default', 'compact', 'detailed'].includes(cfg.display)) {
          document.getElementById('cfg-display').value = cfg.display;
        }
        aiomMode = cfg.aiom === true;
        saveValuesLocally();
        return true;
      } catch (e) { return false; /* lien invalide : on garde la page vide, pas bloquant */ }
    }
    loadConfigFromUrl();

    function seg(id) {
      var sel = document.getElementById(id), box = document.createElement('div');
      box.className = 'seg'; sel.parentNode.insertBefore(box, sel); sel.style.display = 'none';
      function sync() { Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.v === sel.value); }); }
      Array.prototype.forEach.call(sel.options, function (o) {
        var b = document.createElement('button'); b.type = 'button'; b.dataset.v = o.value; b.textContent = o.textContent;
        b.addEventListener('click', function () { sel.value = o.value; sel.dispatchEvent(new Event('change')); });
        box.appendChild(b);
      });
      sel.addEventListener('change', sync); sync();
    }
    ['cfg-display', 'cfg-max-links', 'cfg-extras'].forEach(seg);

    // Une « étape » correspond à une action réelle, pas à une section du formulaire :
    // 3 actions de base (pseudo, clé TMDB, validation TMDB) et, seulement si renseignée,
    // la validation facultative de TheTVDB. Fonction pure pour faciliter les tests.
    function computeSetupProgress(data) {
      const steps = [
        { id: 'pseudo', label: 'Renseigner le pseudo Discord', field: 'cfg-pseudo', done: !!data.pseudo },
        { id: 'tmdb-key', label: 'Renseigner la clé TMDB', field: 'cfg-tmdbkey', done: !!data.tmdbKey },
        { id: 'tmdb-test', label: 'Tester et valider la clé TMDB', field: 'test-tmdb-btn', done: !!data.tmdbKey && !!data.tmdbValidated },
      ];
      if (data.tvdbKey) {
        steps.push({ id: 'tvdb-test', label: 'Valider la clé TheTVDB ajoutée', field: 'test-tvdb-btn', done: !!data.tvdbValidated });
      }
      const completed = steps.filter(step => step.done).length;
      return { steps, completed, total: steps.length, remaining: steps.length - completed };
    }

    function currentSetupProgress() {
      return computeSetupProgress({
        pseudo: document.getElementById('cfg-pseudo').value.trim(),
        tmdbKey: document.getElementById('cfg-tmdbkey').value.trim(),
        tmdbValidated: tmdbKeyValidated,
        tvdbKey: document.getElementById('cfg-tvdbkey').value.trim(),
        tvdbValidated: tvdbKeyValidated,
      });
    }

    function refreshAside() {
      const progress = currentSetupProgress();
      const next = progress.steps.find(step => !step.done);
      const ready = progress.remaining === 0;
      const percent = Math.round(100 * progress.completed / progress.total);
      const readyCard = document.getElementById('ready-card');

      readyCard.classList.toggle('ok', ready);
      document.getElementById('ready-title').textContent = ready
        ? 'Tout est prêt !'
        : 'Encore ' + progress.remaining + ' étape' + (progress.remaining > 1 ? 's' : '');
      document.getElementById('ready-sub').textContent = ready
        ? 'Ton lien Stremio est prêt à être installé.'
        : 'Prochaine action : ' + next.label.toLowerCase() + '.';
      document.getElementById('setup-counter').textContent = progress.completed + '/' + progress.total;
      document.getElementById('setup-progress-label').textContent = progress.completed + ' sur ' + progress.total + ' étapes validées';
      document.getElementById('setup-progress-percent').textContent = percent + ' %';
      document.getElementById('setup-progress-fill').style.width = percent + '%';
      const track = document.getElementById('setup-progress-track');
      track.setAttribute('aria-valuemax', String(progress.total));
      track.setAttribute('aria-valuenow', String(progress.completed));

      const steps = new Map(progress.steps.map(step => [step.id, step]));
      document.querySelectorAll('#setup-checklist [data-check]').forEach(item => {
        const step = steps.get(item.dataset.check);
        // L'option TheTVDB reste visible même lorsqu'aucune clé n'est renseignée.
        // Elle n'ajoute une étape au compteur que lorsqu'un utilisateur la choisit.
        if (item.dataset.check === 'tvdb-test' && !step) {
          item.hidden = false;
          item.classList.remove('is-next', 'is-done');
          item.classList.add('is-optional');
          item.querySelector('.setup-check-icon').textContent = '+';
          item.querySelector('.setup-check-label').textContent =
            'TheTVDB — facultatif, ajouter une clé ou ignorer';
          return;
        }
        item.hidden = !step;
        if (!step) return;
        const nextStep = next && next.id === step.id;
        item.classList.toggle('is-optional', false);
        item.classList.toggle('is-done', step.done);
        item.classList.toggle('is-next', !!nextStep);
        item.querySelector('.setup-check-icon').textContent =
          step.done ? '✓' : nextStep ? '→' : '○';
        if (item.dataset.check === 'tvdb-test') {
          item.querySelector('.setup-check-label').textContent =
            step.done ? 'TheTVDB — clé validée (facultatif)'
                      : 'TheTVDB — tester la clé renseignée (facultatif)';
        }
      });

      // Les cartes obligatoires se valident visuellement quand leur contenu est prêt.
      document.getElementById('step-tmdb-badge').classList.toggle('done',
        !!steps.get('tmdb-test').done && (!steps.has('tvdb-test') || steps.get('tvdb-test').done));
      document.getElementById('step-pseudo-badge').classList.toggle('done',
        !!steps.get('pseudo').done);

      document.getElementById('manifest-url').value = getManifestUrl();
    }
    document.addEventListener('input', refreshAside);
    document.addEventListener('change', refreshAside);
    var pvFilm = { title: 'Dune : Deuxième partie' }, pvSeq = 0, pvTimer = null;
    function setFilm(f) {
      pvFilm = f;
      document.getElementById('pv-title').textContent = f.title;
      document.getElementById('pv-type').textContent = f.type === 'tv' ? 'Série' : 'Film';
      document.getElementById('pv-meta').textContent = f.meta || '';
      var img = document.getElementById('pv-poster'), ph = document.getElementById('pv-ph');
      if (f.poster) { img.src = f.poster; img.style.display = 'block'; ph.style.display = 'none'; }
      else { img.style.display = 'none'; ph.style.display = 'block'; }
      renderPreview();
    }
    function pvMeta(r) { return (r.mediaType === 'tv' ? 'Série' : 'Film') + (r.year ? ' · ' + r.year : ''); }
    function pvPoster(r) { return r.poster ? r.poster.replace('/w92/', '/w185/') : null; }
    function pvFetch(q) {
      return fetch('/api/public/tmdb-search?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); });
    }
    function showResults(data) {
      var box = document.getElementById('pv-results');
      box.textContent = '';
      if (!Array.isArray(data) || !data.length) {
        var empty = document.createElement('div'); empty.className = 'pv-empty';
        empty.textContent = Array.isArray(data) ? 'Aucun résultat' : 'Recherche indisponible pour le moment';
        box.appendChild(empty);
      } else {
        data.slice(0, 6).forEach(function (r) {
          var item = document.createElement('div'); item.className = 'pv-item';
          var p = pvPoster(r), pic;
          if (p) { pic = document.createElement('img'); pic.src = p; pic.alt = ''; } else { pic = document.createElement('div'); pic.className = 'pv-ph'; }
          var txt = document.createElement('div');
          var t = document.createElement('div'); t.className = 't'; t.textContent = r.title;
          var y = document.createElement('div'); y.className = 'y'; y.textContent = pvMeta(r);
          txt.appendChild(t); txt.appendChild(y); item.appendChild(pic); item.appendChild(txt);
          item.addEventListener('click', function () {
            setFilm({ title: r.title, meta: pvMeta(r), poster: p, tmdbId: r.tmdbId, type: r.mediaType });
            box.classList.remove('show'); document.getElementById('pv-search').value = '';
          });
          box.appendChild(item);
        });
      }
      box.classList.add('show');
    }
    document.getElementById('pv-search').addEventListener('input', function (e) {
      var q = e.target.value.trim();
      clearTimeout(pvTimer);
      if (q.length < 2) { document.getElementById('pv-results').classList.remove('show'); return; }
      pvTimer = setTimeout(function () {
        var seq = ++pvSeq;
        pvFetch(q).then(function (d) { if (seq === pvSeq) showResults(d); }).catch(function () { if (seq === pvSeq) showResults(null); });
      }, 300);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.pv-search')) document.getElementById('pv-results').classList.remove('show');
    });
    function loadDefaultFilm() {
      pvFetch('Dune Deuxième partie').then(function (d) {
        var r = Array.isArray(d) && d.filter(function (x) { return x.mediaType === 'movie' && x.year === '2024'; })[0];
        if (r) setFilm({ title: r.title, meta: pvMeta(r), poster: pvPoster(r), tmdbId: r.tmdbId, type: r.mediaType });
        else document.getElementById('pv-ph').style.display = 'block';
      }).catch(function () { document.getElementById('pv-ph').style.display = 'block'; });
    }
    renderPreview();
    loadDefaultFilm();

    document.getElementById('cfg-tmdbkey').addEventListener('input', () => {
      tmdbKeyValidated = false;
      updateStatus();
      document.getElementById('test-tmdb-result').classList.remove('show');
      document.getElementById('cfg-tmdbkey').style.borderColor = '';
    });
    document.getElementById('cfg-tmdbkey').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); testTmdbKey(); }
    });
    updateStatus(); // applique l'état initial si des valeurs viennent d'être restaurées

    async function testTmdbKey() {
      const btn = document.getElementById('test-tmdb-btn');
      const result = document.getElementById('test-tmdb-result');
      const key = document.getElementById('cfg-tmdbkey').value.trim();

      if (!key) {
        result.textContent = '⚠️ Colle une clé avant de tester';
        result.className = 'test-result show error';
        return;
      }

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '...';
      result.className = 'test-result';

      try {
        const res = await fetch(\`/api/test-tmdb?key=\${encodeURIComponent(key)}\`);
        const data = await res.json();
        if (document.getElementById('cfg-tmdbkey').value.trim() !== key) return;
        if (data.valid) {
          result.textContent = '✅ Clé valide';
          result.className = 'test-result show ok';
          tmdbKeyValidated = true;
        } else {
          result.textContent = '❌ ' + (data.error || 'Clé invalide');
          result.className = 'test-result show error';
          tmdbKeyValidated = false;
        }
      } catch (e) {
        result.textContent = '❌ Erreur réseau, réessaie';
        result.className = 'test-result show error';
        tmdbKeyValidated = false;
      } finally {
        updateStatus();
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    async function testTvdbKey() {
      const btn = document.getElementById('test-tvdb-btn');
      const result = document.getElementById('test-tvdb-result');
      const key = document.getElementById('cfg-tvdbkey').value.trim();
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '...';
      result.className = 'test-result';
      try {
        const response = await fetch('/api/test-tvdb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const data = await response.json();
        if (document.getElementById('cfg-tvdbkey').value.trim() !== key) return;
        tvdbKeyValidated = response.ok && data.valid === true;
        result.textContent = tvdbKeyValidated
          ? '✅ Clé TheTVDB valide'
          : '❌ ' + (data.error || 'Clé TheTVDB invalide');
        result.className = 'test-result show ' + (tvdbKeyValidated ? 'ok' : 'error');
      } catch (e) {
        tvdbKeyValidated = false;
        result.textContent = '❌ Impossible de joindre TheTVDB';
        result.className = 'test-result show error';
      } finally {
        if (typeof refreshAside === 'function') refreshAside();
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    document.getElementById('cfg-tvdbkey').addEventListener('input', () => {
      tvdbKeyValidated = false;
      const result = document.getElementById('test-tvdb-result');
      result.className = 'test-result';
      document.getElementById('cfg-tvdbkey').style.borderColor = '';
      if (typeof refreshAside === 'function') refreshAside();
    });
    document.getElementById('cfg-tvdbkey').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); testTvdbKey(); }
    });
    if (document.getElementById('cfg-tmdbkey').value.trim()) testTmdbKey();
    if (document.getElementById('cfg-tvdbkey').value.trim()) testTvdbKey();

    function validateReady() {
      const progress = currentSetupProgress();
      ['cfg-pseudo', 'cfg-tmdbkey', 'cfg-tvdbkey'].forEach(id => {
        document.getElementById(id).style.borderColor = '';
      });
      if (progress.remaining === 0) return true;

      const firstMissing = progress.steps.find(step => !step.done);
      const target = document.getElementById(firstMissing.field);
      const input = firstMissing.id === 'tmdb-test'
        ? document.getElementById('cfg-tmdbkey')
        : firstMissing.id === 'tvdb-test'
          ? document.getElementById('cfg-tvdbkey')
          : target;
      if (input) input.style.borderColor = 'var(--red)';
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus({ preventScroll: true });
      }
      toast('Il reste ' + progress.remaining + ' étape' + (progress.remaining > 1 ? 's' : '') + ' à compléter 👇');
      refreshAside();
      return false;
    }

    document.getElementById('cfg-pseudo').addEventListener('input', () => {
      document.getElementById('cfg-pseudo').style.borderColor = '';
    });

    function install(method) {
      if (!validateReady()) return;
      const url = getManifestUrl();
      if (method === 'app') window.open(\`stremio://\${url.replace(/https?:\\/\\//, '')}\`, '_blank');
      else window.open(\`https://web.stremio.com/#/addons?addon=\${encodeURIComponent(url)}\`, '_blank');
    }
    function copyLink() {
      if (!validateReady()) return;
      navigator.clipboard.writeText(getManifestUrl()).then(() => toast('✅ Lien copié !'));
    }
    function toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    }

    async function checkServicesStatus() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        ['tmdb', 'tvdb', 'youtube', 'allocine', 'anilist'].forEach(svc => {
          const badge = document.querySelector(\`.status-badge[data-service="\${svc}"]\`);
          if (!badge) return;
          const dot = badge.querySelector('.status-dot');
          const up = data[svc] === 'up';
          dot.classList.add(up ? 'up' : 'down');
          badge.title = up ? 'Opérationnel' : 'Indisponible actuellement';
        });
      } catch (e) { /* réseau down -> les points restent en pulse neutre, pas grave */ }
    }
    checkServicesStatus();
  </script>
</body>
</html>`;
}

// Assombrit un hex (#rrggbb) de `fraction` (0..1) : utilisé pour dériver --red-dark
// de la couleur de marque choisie par l'admin, comme avant avec #e53e3e -> #c53030.
function darkenHex(hex, fraction) {
    const n = parseInt(hex.slice(1), 16);
    const factor = 1 - fraction;
    const r = Math.round(((n >> 16) & 255) * factor);
    const g = Math.round(((n >> 8) & 255) * factor);
    const b = Math.round((n & 255) * factor);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

module.exports = { renderConfigureHtml };
