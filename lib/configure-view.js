// Génère la page publique /configure : textes éditables depuis le dashboard,
// + un vrai formulaire de configuration par utilisateur (clé TMDB perso,
// qualité vidéo) encodé dans l'URL du manifest, à la manière des gros addons
// Stremio (Torrentio etc.) : /<config>/manifest.json

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderConfigureHtml(s) {
    // Couleur de marque éditée depuis le dashboard : on override --red/--red-dark dans :root.
    const accent = /^#[0-9a-fA-F]{6}$/.test(s.accentColor || '') ? s.accentColor : '#e53e3e';
    const accentDark = darkenHex(accent, 0.12);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/logo_transparent_check.png">
  <title>${escapeHtml(s.brandName)} — Installation</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
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
    .hero { position: relative; z-index: 1; text-align: center; padding: 48px 40px 28px; }
    .status-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 28px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px;
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: 100px; font-size: 12px; font-weight: 500; color: var(--muted);
      letter-spacing: 0.5px; cursor: default;
    }
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
    .step-num { width: 32px; height: 32px; border-radius: 9px; background: rgba(229,62,62,0.12); border: 1px solid rgba(229,62,62,0.35); color: var(--red); display: grid; place-items: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
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
    .ready-card { display: flex; align-items: center; gap: 14px; background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
    .ready-ring { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(229,62,62,0.25); border-top-color: var(--red); animation: spin 1.1s linear infinite; flex-shrink: 0; }
    .ready-card.ok { border-color: rgba(72,187,120,0.35); background: rgba(72,187,120,0.06); }
    .ready-card.ok .ready-ring { animation: none; border-color: #48bb78; }
    .ready-title { font-size: 14px; font-weight: 600; color: #fff; }
    .ready-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .preview-top { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); margin-bottom: 14px; }
    .preview-film { padding: 12px 14px; border-radius: 10px; background: var(--bg3); margin-bottom: 10px; font-size: 12px; color: var(--muted); }
    .preview-film-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 2px; }
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
      ${s.navLinkUrl ? `<a href="${escapeHtml(s.navLinkUrl)}" class="nav-link" target="_blank">${escapeHtml(s.navLinkText || 'Lien')}</a>` : ''}
    </div>
  </nav>

  <div class="hero">
    <div class="status-row" id="status-row">
      <div class="status-badge" data-service="tmdb"><span class="status-dot"></span>TMDB</div>
      <div class="status-badge" data-service="youtube"><span class="status-dot"></span>YouTube</div>
      <div class="status-badge" data-service="allocine"><span class="status-dot"></span>Allociné</div>
    </div>
    <h1 class="hero-title">${escapeHtml(s.heroTitleWhite)}<span>${escapeHtml(s.heroTitleRed)}</span></h1>
    <p class="hero-sub">${escapeHtml(s.heroSubtitle)}</p>
  </div>

  <main>
    <div class="layout">
      <div class="col-main">
        <section class="config-card">
          <div class="step-head"><span class="step-num">1</span><div><div class="step-title">${escapeHtml(s.sectionConfigLabel || 'Ta configuration')}</div><div class="step-sub">Ta clé gratuite TMDB, pour trouver les bandes-annonces</div></div></div>
          <div class="config-field">
            <label>Ta clé API TMDB (gratuite)</label>
            <div class="tmdb-key-row">
              <input type="text" id="cfg-tmdbkey" placeholder="Colle ta clé TMDB ici">
              <button type="button" class="btn-test" id="test-tmdb-btn" onclick="testTmdbKey()">Tester</button>
            </div>
            <div class="test-result" id="test-tmdb-result"></div>
            <div class="hint">${escapeHtml(s.tmdbKeyHint || 'Obtiens la tienne gratuitement sur themoviedb.org/settings/api (compte gratuit, 2 min).')} <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org ↗</a></div>
          </div>
          <div class="config-status" id="cfg-status">✅ Clé testée, tout est bon</div>
        </section>

        <section class="config-card">
          <div class="step-head"><span class="step-num">2</span><div><div class="step-title">${escapeHtml(s.sectionProfileLabel || 'Ton profil')}</div><div class="step-sub">Pour savoir à qui il manque une bande-annonce</div></div></div>
          <div class="config-field">
            <label>Ton pseudo Discord</label>
            <input type="text" id="cfg-pseudo" maxlength="40" placeholder="Ton pseudo">
            <div class="hint">${escapeHtml(s.pseudoHint || "Si jamais une bande-annonce manque pour un film que tu ouvres, ton pseudo apparaîtra dans le journal admin — plus facile de savoir qui a eu le souci.")}</div>
          </div>
        </section>

        <section class="config-card">
          <div class="step-head"><span class="step-num">3</span><div><div class="step-title">${escapeHtml(s.sectionLinksLabel || 'Affichage des liens')}</div><div class="step-sub">Facultatif — l'aperçu se met à jour en direct</div></div></div>
          <div class="config-field">
            <label for="cfg-display">Format des liens dans Stremio</label>
            <select id="cfg-display">
              <option value="">Par défaut</option>
              <option value="compact">Compact</option>
              <option value="detailed">Détaillé</option>
            </select>
            <div class="hint">Change la présentation des liens dans Stremio : regarde l'aperçu à droite. « Détaillé » ajoute la source, la qualité, le type de lecture et le lien.</div>
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
          <div class="config-field">
            <label class="toggle-card" for="cfg-aiom">
              <input type="checkbox" id="cfg-aiom">
              <span class="toggle-text">
                <span class="toggle-title">Compatible AIOMetadata</span>
                <span class="toggle-desc">À cocher si tu colles ce lien dans AIOMetadata (Meta Providers › Trailers › « A trailer addon »). L’addon renvoie alors un seul trailer lisible par AIOMetadata, sans lien externe ni lien « Proposer ».</span>
              </span>
            </label>
          </div>
        </section>
      </div>

      <aside class="aside">
        <div class="ready-card" id="ready-card">
          <span class="ready-ring"></span>
          <div><div class="ready-title" id="ready-title">Encore une étape</div><div class="ready-sub" id="ready-sub"></div></div>
        </div>
        <div class="config-card preview-card">
          <div class="preview-top"><span>Aperçu dans Stremio</span><span>Film</span></div>
          <div class="preview-film"><div class="preview-film-title">Dune : Deuxième partie</div><div>Exemple · 2024</div></div>
          <div class="preview-list" id="preview-list"></div>
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
    function b64urlEncode(str) {
      return btoa(unescape(encodeURIComponent(str))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }

    function buildConfig() {
      const pseudo = document.getElementById('cfg-pseudo').value.trim();
      const tmdbKey = document.getElementById('cfg-tmdbkey').value.trim();
      const externalOnly = document.getElementById('cfg-external-only').checked;
      const maxLinks = document.getElementById('cfg-max-links').value;
      const extras = document.getElementById('cfg-extras').value;
      const aiom = document.getElementById('cfg-aiom').checked;
      const display = document.getElementById('cfg-display').value;
      const cfg = {};
      if (pseudo) cfg.pseudo = pseudo.slice(0, 40);
      if (tmdbKey) cfg.tmdbKey = tmdbKey;
      if (externalOnly) cfg.externalOnly = true;
      if (maxLinks) cfg.maxLinks = parseInt(maxLinks, 10);
      if (extras === 'on') cfg.includeExtras = true;
      else if (extras === 'off') cfg.includeExtras = false;
      if (aiom) cfg.aiom = true;
      if (display) cfg.display = display;
      return Object.keys(cfg).length ? b64urlEncode(JSON.stringify(cfg)) : '';
    }

    function getManifestUrl() {
      const config = buildConfig();
      const base = window.location.origin;
      return config ? \`\${base}/\${config}/manifest.json\` : \`\${base}/manifest.json\`;
    }

    let tmdbKeyValidated = false;

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
      extras: 'vftrailer_extras', aiom: 'vftrailer_aiom', display: 'vftrailer_display',
    };

    function loadSavedValues() {
      try {
        const pseudo = localStorage.getItem(STORAGE_KEYS.pseudo);
        const tmdbKey = localStorage.getItem(STORAGE_KEYS.tmdbKey);
        const externalOnly = localStorage.getItem(STORAGE_KEYS.externalOnly);
        const maxLinks = localStorage.getItem(STORAGE_KEYS.maxLinks);
        const extras = localStorage.getItem(STORAGE_KEYS.extras);
        const aiom = localStorage.getItem(STORAGE_KEYS.aiom);
        const display = localStorage.getItem(STORAGE_KEYS.display);
        if (pseudo) document.getElementById('cfg-pseudo').value = pseudo;
        if (tmdbKey) document.getElementById('cfg-tmdbkey').value = tmdbKey;
        if (externalOnly) document.getElementById('cfg-external-only').checked = externalOnly === '1';
        if (maxLinks) document.getElementById('cfg-max-links').value = maxLinks;
        if (extras) document.getElementById('cfg-extras').value = extras;
        if (aiom) document.getElementById('cfg-aiom').checked = aiom === '1';
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
        localStorage.setItem(STORAGE_KEYS.aiom, document.getElementById('cfg-aiom').checked ? '1' : '0');
        localStorage.setItem(STORAGE_KEYS.display, document.getElementById('cfg-display').value);
      } catch (e) { /* idem, silencieux */ }
    }

    document.getElementById('cfg-pseudo').addEventListener('input', saveValuesLocally);
    document.getElementById('cfg-tmdbkey').addEventListener('input', saveValuesLocally);
    document.getElementById('cfg-external-only').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-max-links').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-extras').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-aiom').addEventListener('change', saveValuesLocally);
    document.getElementById('cfg-display').addEventListener('change', saveValuesLocally);

    loadSavedValues();

    var previewSeq = 0;
    function renderPreview() {
      var seq = ++previewSeq;
      var qs = new URLSearchParams({
        display: document.getElementById('cfg-display').value,
        externalOnly: document.getElementById('cfg-external-only').checked ? '1' : '0',
        maxLinks: document.getElementById('cfg-max-links').value,
        aiom: document.getElementById('cfg-aiom').checked ? '1' : '0'
      });
      fetch('/api/preview-streams?' + qs.toString())
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (seq !== previewSeq) return;
          var list = document.getElementById('preview-list');
          list.textContent = '';
          (d.streams || []).forEach(function (s) {
            var row = document.createElement('div'); row.className = 'preview-row';
            var name = document.createElement('div'); name.className = 'preview-name'; name.textContent = s.name;
            var title = document.createElement('div'); title.className = 'preview-title'; title.textContent = s.title;
            row.appendChild(name); row.appendChild(title); list.appendChild(row);
          });
        })
        .catch(function () { /* aperçu facultatif : on n'embête pas la personne si ça échoue */ });
    }
    ['cfg-display', 'cfg-max-links', 'cfg-external-only', 'cfg-aiom'].forEach(function (id) {
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
        document.getElementById('cfg-external-only').checked = cfg.externalOnly === true;
        document.getElementById('cfg-max-links').value = cfg.maxLinks ? String(cfg.maxLinks) : '';
        document.getElementById('cfg-extras').value = cfg.includeExtras === true ? 'on' : cfg.includeExtras === false ? 'off' : '';
        document.getElementById('cfg-aiom').checked = cfg.aiom === true;
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

    function refreshAside() {
      var missing = [];
      if (!document.getElementById('cfg-pseudo').value.trim()) missing.push('ton pseudo');
      if (!document.getElementById('cfg-tmdbkey').value.trim()) missing.push('ta clé TMDB');
      else if (!tmdbKeyValidated) missing.push('tester ta clé TMDB');
      document.getElementById('ready-card').classList.toggle('ok', !missing.length);
      document.getElementById('ready-title').textContent = missing.length ? 'Encore une étape' : 'Tout est prêt';
      document.getElementById('ready-sub').textContent = missing.length ? 'Il manque : ' + missing.join(', ') : 'Tu peux installer l’addon dans Stremio.';
      document.getElementById('manifest-url').value = getManifestUrl();
    }
    document.addEventListener('input', refreshAside);
    document.addEventListener('change', refreshAside);
    renderPreview();

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

    function validateReady() {
      const pseudoInput = document.getElementById('cfg-pseudo');
      const keyInput = document.getElementById('cfg-tmdbkey');
      const pseudo = pseudoInput.value.trim();
      const key = keyInput.value.trim();
      const missing = [];

      pseudoInput.style.borderColor = '';
      keyInput.style.borderColor = '';

      if (!pseudo) { pseudoInput.style.borderColor = 'var(--red)'; missing.push('pseudo'); }
      if (!key) { keyInput.style.borderColor = 'var(--red)'; missing.push('clé TMDB'); }
      else if (!tmdbKeyValidated) { keyInput.style.borderColor = 'var(--red)'; missing.push('clé TMDB testée'); }

      if (missing.length) {
        toast('Complète ta config avant d\\'installer 👇');
        return false;
      }
      return true;
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
        ['tmdb', 'youtube', 'allocine'].forEach(svc => {
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