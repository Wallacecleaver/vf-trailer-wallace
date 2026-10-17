// Page publique /recuperation : aide les utilisateurs à migrer leur addon après un
// changement de domaine. La config (clé TMDB, pseudo, options) est encodée dans l'URL du
// manifest elle-même (segment base64url) : il n'y a donc RIEN à chercher en base. Le
// navigateur extrait ce segment de l'ancienne URL collée et le recolle derrière le domaine
// courant.
// Mise en page : même structure que /configure (nav, hero, sections à filets, cartes,
// barre d'action fixe en bas). Avant le champ de saisie : un encart qui explique pourquoi
// et ce que fait la page, puis un mode d'emploi. Une fois le lien collé, un diagnostic
// animé s'exécute VRAIMENT (lecture, décodage, manifest.json via le serveur, test de la
// clé TMDB via /api/test-tmdb) et passe au vert / orange / rouge selon le résultat.

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function darkenHex(hex, fraction) {
    const n = parseInt(hex.slice(1), 16);
    const factor = 1 - fraction;
    const r = Math.round(((n >> 16) & 255) * factor);
    const g = Math.round(((n >> 8) & 255) * factor);
    const b = Math.round((n & 255) * factor);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function renderRecoveryHtml(s) {
    const settings = s || {};
    const brandName = settings.brandName || 'Bandes-Annonces VF/VO';
    const accent = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor || '') ? settings.accentColor : '#e53e3e';
    const accentDark = darkenHex(accent, 0.12);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <link rel="icon" type="image/png" href="/logo_transparent_check.png">
  <title>${escapeHtml(brandName)} — Récupérer mon addon</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --red: ${accent}; --red-dark: ${accentDark}; --bg: #0a0a0b; --bg2: #111113; --bg3: #18181b;
      --border: rgba(255,255,255,0.06); --text: #f0f0f0; --muted: #8a8a92; --muted2: #444;
      --green: #48bb78; --amber: #ecc94b; --bad: #fc8181; --cyan: #63b3ed;
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
    .nav-name { font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 2px; color: #fff; text-transform: uppercase; text-decoration: none; }
    .nav-links { display: flex; align-items: center; gap: 8px; }
    .nav-link {
      display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px;
      border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 13px;
      font-family: 'DM Sans', sans-serif; text-decoration: none; cursor: pointer; transition: all 0.2s;
    }
    .nav-link:hover { color: var(--text); border-color: var(--muted2); background: var(--bg3); }

    .hero { position: relative; z-index: 1; text-align: center; padding: 80px 40px 30px; }
    .status-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 28px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; background: var(--bg2);
      border: 1px solid var(--border); border-radius: 100px; font-size: 12px; font-weight: 500; color: var(--muted); letter-spacing: 0.5px;
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
    .hero-title { font-family: 'Bebas Neue', sans-serif; font-size: clamp(52px, 8vw, 96px); line-height: 0.9; letter-spacing: 4px; color: #fff; margin-bottom: 8px; }
    .hero-title span { color: var(--red); display: block; }
    .hero-sub { font-size: 16px; color: #a0a0a8; max-width: 520px; margin: 20px auto 0; line-height: 1.6; font-weight: 400; }
    .hero-sub b { color: #fff; font-weight: 700; }

    main { position: relative; z-index: 1; max-width: 780px; margin: 0 auto; padding: 0 24px 150px; }
    .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; margin-top: 40px; }
    .section-line { flex: 1; height: 1px; background: var(--border); }
    .section-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; font-weight: 600; }
    .config-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-top: 12px; }
    .lead { font-size: 15.5px; line-height: 1.7; color: #b4b4bc; font-weight: 400; }
    .lead b, .info-desc b, .how-text b, .hint b { color: #fff; font-weight: 700; }
    .code { font-family: 'Rajdhani', ui-monospace, monospace; font-weight: 700; font-size: 14px; color: #fff; background: rgba(255,255,255,0.08); padding: 1px 8px; border-radius: 6px; white-space: nowrap; }
    .code.old { color: #fc8181; background: rgba(252,129,129,0.10); text-decoration: line-through; text-decoration-color: rgba(252,129,129,0.6); }
    .code.new { color: var(--green); background: rgba(72,187,120,0.10); }
    .swap { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; margin: 18px 0 4px; }
    .swap .arrow { color: var(--muted); font-size: 18px; }

    .info-list { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .info-row { display: flex; align-items: flex-start; gap: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
    .info-ico { font-size: 22px; line-height: 1.2; flex-shrink: 0; }
    .info-title { font-size: 14.5px; font-weight: 700; color: #fff; line-height: 1.3; margin-bottom: 4px; }
    .info-desc { font-size: 13.5px; color: #9a9aa2; line-height: 1.6; font-weight: 400; }

    .how { list-style: none; display: flex; flex-direction: column; gap: 14px; }
    .how li { display: flex; align-items: flex-start; gap: 16px; }
    .how .n { flex: 0 0 30px; height: 30px; border-radius: 50%; background: var(--red); color: #fff; display: flex; align-items: center; justify-content: center; font-family: 'Rajdhani', sans-serif; font-size: 16px; font-weight: 700; margin-top: 1px; }
    .how-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 3px; }
    .how-text { font-size: 13.5px; color: #9a9aa2; line-height: 1.65; }
    .tag { display: inline-block; background: rgba(255,255,255,0.10); border-radius: 6px; padding: 0 7px; font-weight: 700; color: #fff; white-space: nowrap; font-size: 12.5px; }

    .config-field label { display: block; font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .config-field textarea {
      width: 100%; min-height: 110px; resize: vertical; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
      color: var(--text); font-family: 'Rajdhani', ui-monospace, monospace; font-size: 14px; line-height: 1.5; word-break: break-all; transition: border-color .2s;
    }
    .config-field textarea:focus { outline: none; border-color: var(--red); }
    .hint { font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 8px; line-height: 1.55; }
    .config-status { font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 8px; margin-top: 14px; display: none; line-height: 1.5; }
    .config-status.ok { display: block; background: rgba(72,187,120,0.08); border: 1px solid rgba(72,187,120,0.25); color: #68d391; }
    .config-status.bad { display: block; background: rgba(252,129,129,0.08); border: 1px solid rgba(252,129,129,0.25); color: #fc8181; }

    .reveal { display: none; }
    .reveal.show { display: block; animation: fade .35s ease; }
    @keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

    /* Diagnostic futuriste */
    .scan { position: relative; overflow: hidden; margin-top: 12px; border-radius: 14px; padding: 18px 18px 16px;
      background: linear-gradient(180deg, #0d0d12, #08080b); border: 1px solid rgba(99,179,237,0.28);
      box-shadow: 0 0 0 1px rgba(99,179,237,0.05), 0 0 30px rgba(99,179,237,0.10); transition: border-color .4s, box-shadow .4s; }
    .scan::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .5;
      background: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px); }
    .scan.running::after { content: ''; position: absolute; left: 0; right: 0; height: 70px; top: -70px; pointer-events: none;
      background: linear-gradient(180deg, transparent, rgba(99,179,237,0.16), transparent); animation: sweep 1.8s linear infinite; }
    @keyframes sweep { to { transform: translateY(420px); } }
    .scan.done.ok   { border-color: rgba(72,187,120,0.6);  box-shadow: 0 0 40px rgba(72,187,120,0.22); }
    .scan.done.warn { border-color: rgba(236,201,75,0.6);  box-shadow: 0 0 40px rgba(236,201,75,0.18); }
    .scan.done.bad  { border-color: rgba(252,129,129,0.6); box-shadow: 0 0 40px rgba(252,129,129,0.20); }
    .scan-head { position: relative; display: flex; justify-content: space-between; align-items: baseline; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; letter-spacing: 2px; color: var(--cyan); font-weight: 700; }
    .scan-pct { font-size: 20px; color: #fff; letter-spacing: 0; }
    .bar { position: relative; height: 6px; border-radius: 99px; background: rgba(255,255,255,0.07); margin: 12px 0 16px; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg, var(--cyan), var(--green)); box-shadow: 0 0 12px rgba(99,179,237,0.8); transition: width .6s cubic-bezier(.2,.8,.2,1); }
    .checks { position: relative; list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .chk { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; border: 1px solid transparent; background: rgba(255,255,255,0.025); transition: background .3s, border-color .3s; }
    .chk .ico { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--muted2); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; }
    .chk b { display: block; font-size: 15px; font-weight: 700; color: #fff; }
    .chk small { display: block; font-size: 12.5px; color: #a0a0a8; font-weight: 500; line-height: 1.4; margin-top: 2px; }
    .chk .res { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: var(--muted2); }
    .chk.pending { opacity: .45; }
    .chk.run { background: rgba(99,179,237,0.08); border-color: rgba(99,179,237,0.3); }
    .chk.run .ico { border-color: rgba(99,179,237,0.25); border-top-color: var(--cyan); animation: spin .8s linear infinite; }
    .chk.run .res { color: var(--cyan); }
    .chk.ok { background: rgba(72,187,120,0.07); border-color: rgba(72,187,120,0.25); }
    .chk.ok .ico { background: var(--green); border-color: var(--green); box-shadow: 0 0 14px rgba(72,187,120,0.6); }
    .chk.ok .ico::before { content: '\\2713'; }
    .chk.ok .res { color: var(--green); }
    .chk.warn { background: rgba(236,201,75,0.07); border-color: rgba(236,201,75,0.28); }
    .chk.warn .ico { background: var(--amber); border-color: var(--amber); color: #111; box-shadow: 0 0 14px rgba(236,201,75,0.5); }
    .chk.warn .ico::before { content: '!'; }
    .chk.warn .res { color: var(--amber); }
    .chk.bad { background: rgba(252,129,129,0.07); border-color: rgba(252,129,129,0.3); }
    .chk.bad .ico { background: var(--bad); border-color: var(--bad); color: #111; box-shadow: 0 0 14px rgba(252,129,129,0.55); }
    .chk.bad .ico::before { content: '\\2715'; }
    .chk.bad .res { color: var(--bad); }
    .chk.skip .ico::before { content: '\\2013'; color: var(--muted); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .verdict { position: relative; margin-top: 16px; font-size: 16px; font-weight: 700; line-height: 1.5; text-align: center; min-height: 24px; }
    .verdict.ok { color: var(--green); } .verdict.warn { color: var(--amber); } .verdict.bad { color: var(--bad); }
    .scan-actions { position: relative; display: flex; justify-content: center; margin-top: 12px; }

    .result { margin-top: 4px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; font-family: 'Rajdhani', ui-monospace, monospace; font-size: 14px; line-height: 1.5; word-break: break-all; color: #cfcfd6; }

    .install-bar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; padding: 18px 32px;
      background: rgba(10,10,11,0.97); backdrop-filter: blur(20px);
      border-top: 1px solid rgba(229,62,62,0.25); box-shadow: 0 -4px 30px rgba(229,62,62,0.06);
      display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;
      transform: translateY(110%); transition: transform .4s cubic-bezier(.2,.8,.2,1);
    }
    .install-bar.show { transform: none; }
    .btn { display: flex; align-items: center; gap: 7px; padding: 11px 22px; border-radius: 9px; font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; border: none; text-decoration: none; transition: all .2s; }
    .btn-red { background: var(--red); color: #fff; animation: btnPulse 2.5s ease-in-out infinite; }
    .btn-red:hover { background: var(--red-dark); transform: translateY(-1px); box-shadow: 0 4px 15px rgba(229,62,62,0.4); }
    @keyframes btnPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(229,62,62,0.35); } 50% { box-shadow: 0 0 0 8px rgba(229,62,62,0); } }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover:not(:disabled) { background: var(--bg3); transform: translateY(-1px); }
    .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
    .btn-ghost:hover:not(:disabled) { color: var(--text); background: var(--bg3); }
    .btn:disabled { opacity: .4; cursor: not-allowed; }
    .toast {
      position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%) translateY(10px);
      background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 10px 20px;
      border-radius: 10px; font-size: 13px; opacity: 0; transition: all 0.25s; pointer-events: none; z-index: 999; white-space: nowrap;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    @media (max-width: 640px) {
      nav { padding: 0 16px; }
      .hero { padding: 60px 20px 20px; }
      .hero-title { font-size: clamp(48px, 14vw, 80px); }
      main { padding: 0 12px 170px; }
      .config-card { padding: 18px; }
      .install-bar { padding: 14px 16px; }
      .btn { flex: 1; justify-content: center; }
      .chk { grid-template-columns: 28px 1fr; }
      .chk .res { grid-column: 2; }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <nav>
    <a class="nav-name" href="/configure">${escapeHtml(brandName)}</a>
    <div class="nav-links"><a class="nav-link" href="/configure">Configurer</a></div>
  </nav>

  <section class="hero">
    <div class="status-row">
      <span class="status-badge"><span class="status-dot"></span>Config conservée</span>
      <span class="status-badge"><span class="status-dot"></span>1 minute</span>
      <span class="status-badge"><span class="status-dot"></span>Rien à retaper</span>
    </div>
    <h1 class="hero-title">RÉCUPÈRE<span>TON ADDON</span></h1>
    <p class="hero-sub">L'adresse de l'addon a changé. <b>Colle ton ancien lien</b> : on te fabrique le <b>nouveau</b>, avec toute ta configuration.</p>
  </section>

  <main>
    <!-- 1. Pourquoi -->
    <div class="section-header"><div class="section-line"></div><span class="section-label">Pourquoi cette page ?</span><div class="section-line"></div></div>
    <div class="config-card">
      <p class="lead">L'addon <b>${escapeHtml(brandName)}</b> a <b>changé d'adresse</b>. L'ancienne est <b>arrêtée</b> : si ton addon ne trouve plus rien ou affiche une erreur dans Stremio, c'est pour ça.</p>
      <div class="swap">
        <span class="code old">vf-trailer-off.vercel.app</span>
        <span class="arrow">→</span>
        <span class="code new" id="newHost">nouvelle adresse</span>
      </div>
      <div class="info-list">
        <div class="info-row">
          <span class="info-ico">🤔</span>
          <div><div class="info-title">Pourquoi dois-je faire quelque chose ?</div>
          <div class="info-desc">Stremio garde en mémoire l'adresse de ton addon et <b>ne peut pas la mettre à jour tout seul</b>. Il faut donc lui donner le nouveau lien.</div></div>
        </div>
        <div class="info-row">
          <span class="info-ico">🔗</span>
          <div><div class="info-title">Que fait cette page ?</div>
          <div class="info-desc">Ta configuration (<b>clé TMDB, pseudo, options</b>) est cachée <b>dans ton lien</b>. La page la récupère et la remet derrière la nouvelle adresse : tu obtiens un lien <b>identique, mais à jour</b>. Tu n'as rien à reconfigurer.</div></div>
        </div>
        <div class="info-row">
          <span class="info-ico">🔒</span>
          <div><div class="info-title">Et mes données ?</div>
          <div class="info-desc">Ton lien est lu <b>dans ton navigateur</b>. Le diagnostic contacte seulement <b>ce serveur</b> et TMDB (pour tester ta clé). Rien n'est publié ni partagé.</div></div>
        </div>
      </div>
    </div>

    <!-- 2. Comment faire -->
    <div class="section-header"><div class="section-line"></div><span class="section-label">Comment faire</span><div class="section-line"></div></div>
    <div class="config-card">
      <ol class="how">
        <li><span class="n">1</span><div>
          <div class="how-title">Copie ton ancien lien</div>
          <div class="how-text">Dans <b>Stremio</b> : 🧩 <span class="tag">Addons</span> → clique sur <span class="tag">W Bandes-Annonces VF</span> → fais un <b>triple-clic</b> sur le long lien pour tout sélectionner → <span class="tag">Ctrl</span> + <span class="tag">C</span> (Mac : <span class="tag">⌘</span> + <span class="tag">C</span>). Sur téléphone : <b>appui long</b> sur le lien, puis « Copier ».</div>
        </div></li>
        <li><span class="n">2</span><div>
          <div class="how-title">Colle-le dans la case ci-dessous</div>
          <div class="how-text"><span class="tag">Ctrl</span> + <span class="tag">V</span>. Un <b>diagnostic</b> se lance tout seul pour vérifier que tout fonctionne.</div>
        </div></li>
        <li><span class="n">3</span><div>
          <div class="how-title">Installe le nouveau lien</div>
          <div class="how-text">Quand tout est au vert, clique sur <b>« Installer dans Stremio »</b> (bouton rouge en bas de l'écran), puis sur <span class="tag">Installer</span>.</div>
        </div></li>
        <li><span class="n">4</span><div>
          <div class="how-title">Supprime l'ancien addon</div>
          <div class="how-text">Dans <span class="tag">Addons</span>, ouvre celui dont le lien contient <span class="code old" id="oldHost">vf-trailer-off.vercel.app</span> et clique sur <span class="tag">Désinstaller</span>. Ça évite les doublons.</div>
        </div></li>
      </ol>
    </div>

    <!-- 3. Saisie -->
    <div class="section-header"><div class="section-line"></div><span class="section-label">Ton ancien lien</span><div class="section-line"></div></div>
    <div class="config-card">
      <div class="config-field">
        <label for="old">Ancienne URL de l'addon</label>
        <textarea id="old" spellcheck="false" autocomplete="off" placeholder="Colle ton lien ici (il ressemble à https://…/eyJ…/manifest.json)"></textarea>
        <div class="hint">Colle-le, <b>c'est tout</b> : la suite se fait automatiquement. 🔒 Ce lien contient ta clé TMDB, il n'est utilisé que pour les vérifications.</div>
      </div>
      <div class="config-status" id="status"></div>
    </div>

    <!-- 4. Diagnostic (affiché une fois le lien collé) -->
    <div class="reveal" id="scanSection">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Diagnostic</span><div class="section-line"></div></div>
      <div class="scan running" id="scan">
        <div class="scan-head"><span id="scanTitle">▸ DIAGNOSTIC EN COURS</span><span class="scan-pct" id="pct">0%</span></div>
        <div class="bar"><i id="barFill"></i></div>
        <ul class="checks">
          <li class="chk pending" data-k="read"><span class="ico"></span><span><b>Lecture du lien</b><small>En attente…</small></span><span class="res"></span></li>
          <li class="chk pending" data-k="decode"><span class="ico"></span><span><b>Décodage de la configuration</b><small>En attente…</small></span><span class="res"></span></li>
          <li class="chk pending" data-k="server"><span class="ico"></span><span><b>Connexion au serveur</b><small>En attente…</small></span><span class="res"></span></li>
          <li class="chk pending" data-k="tmdb"><span class="ico"></span><span><b>Test de la clé TMDB</b><small>En attente…</small></span><span class="res"></span></li>
        </ul>
        <div class="verdict" id="verdict"></div>
        <div class="scan-actions"><button class="btn btn-ghost" id="retry" type="button" disabled>🔄 Relancer l'analyse</button></div>
      </div>
    </div>

    <!-- 5. Nouveau lien (affiché quand le diagnostic n'est pas rouge) -->
    <div class="reveal" id="resultSection">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Ton nouveau lien</span><div class="section-line"></div></div>
      <div class="config-card">
        <div class="result" id="newUrl"></div>
        <div class="hint">Clique sur <b>« Installer dans Stremio »</b> en bas de l'écran. Si rien ne s'ouvre : copie le lien, puis dans Stremio → <span class="tag">Addons</span> → <span class="tag">Ajouter un addon</span> → colle-le → <b>Installer</b>. N'oublie pas d'<b>enlever l'ancien addon</b> (étape 4).</div>
      </div>
    </div>
  </main>

  <div class="install-bar" id="bar">
    <a class="btn btn-red" id="install" href="#">⬇ Installer dans Stremio</a>
    <button class="btn btn-outline" id="copy" type="button">📋 Copier le lien</button>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    // Extrait le segment de config (base64url d'un JSON) d'une URL de manifest, ou d'un
    // segment collé tel quel. Retourne null si rien d'exploitable.
    function extractConfig(input) {
      var raw = String(input || '').trim();
      if (!raw) return null;
      raw = raw.split('#')[0].split('?')[0];
      raw = raw.replace(/^[a-z][a-z0-9+.-]*:\\/\\//i, '');
      var parts = raw.split('/').filter(Boolean);
      var candidate = null;
      var mi = parts.indexOf('manifest.json');
      if (mi > 0) candidate = parts[mi - 1];
      else if (parts.length === 1) candidate = parts[0];
      else if (parts.length > 1) candidate = parts[1];
      if (!candidate) return null;
      try { candidate = decodeURIComponent(candidate); } catch (e) { return null; }
      candidate = candidate.replace(/=+$/, '');
      if (candidate.length < 8 || candidate.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(candidate)) return null;
      return decodeObj(candidate) ? candidate : null;
    }

    // Décode le segment base64url -> objet de config, ou null.
    function decodeObj(candidate) {
      try {
        var b64 = candidate.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        var bin = atob(b64);
        var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
        var obj = JSON.parse(new TextDecoder().decode(bytes));
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
      } catch (e) { return null; }
    }

    // Domaine de l'URL collée (pour savoir si c'est déjà la bonne adresse).
    function hostOf(input) {
      var raw = String(input || '').trim().replace(/^[a-z][a-z0-9+.-]*:\\/\\//i, '');
      return raw.split('/')[0].toLowerCase();
    }

    var $ = function (id) { return document.getElementById(id); };
    var oldEl = $('old'), statusEl = $('status'), scanSection = $('scanSection'), resultSection = $('resultSection');
    var scanEl = $('scan'), scanTitleEl = $('scanTitle'), pctEl = $('pct'), barEl = $('barFill'), verdictEl = $('verdict');
    var retryEl = $('retry'), newUrlEl = $('newUrl'), installEl = $('install'), copyEl = $('copy'), barBox = $('bar'), toastEl = $('toast');
    var currentCfg = null, currentObj = null, newUrl = '', lastRunCfg = null, runId = 0, toastTimer = null;

    $('newHost').textContent = location.host || 'nouvelle adresse';

    function toast(msg) {
      toastEl.textContent = msg; toastEl.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }
    function scrollTo(el) { if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    function hideResults() {
      runId++; lastRunCfg = null;
      scanSection.classList.remove('show'); resultSection.classList.remove('show'); barBox.classList.remove('show');
    }

    function check() {
      var value = oldEl.value;
      statusEl.className = 'config-status';
      if (!value.trim()) { hideResults(); return; }
      var cfg = extractConfig(value);
      if (!cfg) {
        hideResults();
        statusEl.className = 'config-status bad';
        statusEl.textContent = "🤔 Je ne reconnais pas ce lien. Copie bien tout le lien, du « https » jusqu'à « manifest.json », puis colle-le à nouveau.";
        return;
      }
      var oldHost = hostOf(value);
      var sameHost = oldHost === location.host.toLowerCase();
      if (oldHost && !sameHost) $('oldHost').textContent = oldHost;
      statusEl.className = 'config-status ok';
      statusEl.textContent = sameHost
        ? '✅ Lien reconnu. Il utilise déjà la nouvelle adresse : tu peux quand même lancer la vérification.'
        : '✅ Lien reconnu ! Ta configuration est retrouvée. Le diagnostic démarre…';
      if (cfg === lastRunCfg) return; // même lien : pas de relance inutile
      currentCfg = cfg;
      currentObj = decodeObj(cfg);
      newUrl = location.origin + '/' + cfg + '/manifest.json';
      newUrlEl.textContent = newUrl;
      installEl.href = newUrl.replace(/^https?:\\/\\//, 'stremio://');
      resultSection.classList.remove('show'); barBox.classList.remove('show');
      scanSection.classList.add('show');
      scrollTo(scanSection);
      lastRunCfg = cfg;
      runChecks();
    }

    // ---- Diagnostic ----
    var STATE_LABEL = { pending: '', run: 'EN COURS', ok: 'OK', warn: 'ATTENTION', bad: 'ÉCHEC', skip: 'IGNORÉ' };

    function setRow(k, state, detail) {
      var li = document.querySelector('.chk[data-k="' + k + '"]');
      li.className = 'chk ' + state;
      if (detail != null) li.querySelector('small').textContent = detail;
      li.querySelector('.res').textContent = STATE_LABEL[state] || '';
    }
    function setPct(p) { pctEl.textContent = p + '%'; barEl.style.width = p + '%'; }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function resetScan() {
      scanEl.className = 'scan running';
      scanTitleEl.textContent = '▸ DIAGNOSTIC EN COURS';
      verdictEl.className = 'verdict'; verdictEl.textContent = '';
      setPct(0);
      ['read', 'decode', 'server', 'tmdb'].forEach(function (k) { setRow(k, 'pending', 'En attente…'); });
      retryEl.disabled = true;
      resultSection.classList.remove('show'); barBox.classList.remove('show');
    }

    async function fetchJson(url, timeoutMs) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var to = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs);
      try {
        var r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        var data = null;
        try { data = await r.json(); } catch (e) { data = null; }
        return { ok: r.ok, status: r.status, data: data };
      } finally { clearTimeout(to); }
    }

    async function runChecks() {
      var id = ++runId;
      if (!currentCfg) return;
      resetScan();
      var cfg = currentCfg, obj = currentObj || {};
      var worst = 'ok';
      function bump(s) { if (s === 'bad') worst = 'bad'; else if (s === 'warn' && worst !== 'bad') worst = 'warn'; }
      function cancelled() { return id !== runId; }

      async function step(k, running, pct, fn) {
        if (cancelled()) return null;
        setRow(k, 'run', running);
        var t0 = Date.now();
        var out;
        try { out = await fn(); } catch (e) { out = { state: 'bad', detail: 'Erreur inattendue pendant ce test.' }; }
        var left = 750 - (Date.now() - t0);
        if (left > 0) await wait(left);
        if (cancelled()) return null;
        setRow(k, out.state, out.detail);
        bump(out.state);
        setPct(pct);
        return out;
      }

      if (!(await step('read', 'Lecture de l\\'adresse…', 25, async function () {
        return { state: 'ok', detail: 'Lien reconnu, format valide.' };
      }))) return;

      if (!(await step('decode', 'Décodage en cours…', 50, async function () {
        var bits = [];
        bits.push(typeof obj.tmdbKey === 'string' && obj.tmdbKey ? 'clé TMDB trouvée' : 'aucune clé TMDB');
        if (typeof obj.pseudo === 'string' && obj.pseudo.trim()) bits.push('pseudo : ' + obj.pseudo.trim().slice(0, 40));
        if (obj.maxLinks) bits.push(obj.maxLinks + ' lien(s) max');
        if (obj.externalOnly === true) bits.push('liens externes seulement');
        return obj.tmdbKey
          ? { state: 'ok', detail: 'Configuration retrouvée : ' + bits.join(' · ') + '.' }
          : { state: 'warn', detail: 'Configuration lue, mais sans clé TMDB : tu devras la refaire sur /configure.' };
      }))) return;

      if (!(await step('server', 'Le serveur est interrogé…', 75, async function () {
        var t0 = Date.now();
        try {
          var res = await fetchJson('/' + cfg + '/manifest.json', 10000);
          if (!res.ok) return { state: 'bad', detail: 'Le serveur a répondu avec une erreur (' + res.status + ').' };
          var m = res.data;
          if (!m || !m.id || !m.name) return { state: 'bad', detail: 'Réponse inattendue du serveur.' };
          var ms = Date.now() - t0;
          var accepted = !(m.behaviorHints && m.behaviorHints.configurationRequired);
          return accepted
            ? { state: 'ok', detail: m.name + ' v' + m.version + ' répond (' + ms + ' ms).' }
            : { state: 'warn', detail: 'Le serveur répond mais ne reconnaît pas la configuration de ce lien.' };
        } catch (e) {
          return { state: 'bad', detail: e && e.name === 'AbortError' ? 'Le serveur met trop de temps à répondre.' : 'Impossible de joindre le serveur.' };
        }
      }))) return;

      if (!(await step('tmdb', 'Interrogation de TMDB…', 100, async function () {
        if (!obj.tmdbKey) return { state: 'skip', detail: 'Pas de clé dans ce lien : test ignoré.' };
        try {
          var res = await fetchJson('/api/test-tmdb?key=' + encodeURIComponent(obj.tmdbKey), 10000);
          if (res.data && res.data.valid) return { state: 'ok', detail: 'TMDB accepte ta clé.' };
          var why = res.data && res.data.error ? ' (' + res.data.error + ')' : '';
          return { state: 'warn', detail: 'TMDB ne valide pas cette clé' + why + '. Tu pourras la changer sur /configure.' };
        } catch (e) {
          return { state: 'warn', detail: 'Test impossible pour le moment, réessaie plus tard.' };
        }
      }))) return;

      scanEl.className = 'scan done ' + worst;
      verdictEl.className = 'verdict ' + worst;
      if (worst === 'ok') {
        scanTitleEl.textContent = '▸ DIAGNOSTIC TERMINÉ';
        verdictEl.textContent = '✅ Tout est au vert ! Ton nouveau lien est prêt.';
      } else if (worst === 'warn') {
        scanTitleEl.textContent = '▸ TERMINÉ AVEC REMARQUES';
        verdictEl.textContent = '⚠️ Ça devrait marcher, mais regarde les points en orange.';
      } else {
        scanTitleEl.textContent = '▸ PROBLÈME DÉTECTÉ';
        verdictEl.textContent = '❌ Un point bloque. Relance l\\'analyse, ou colle à nouveau ton lien.';
      }
      retryEl.disabled = false;
      if (worst !== 'bad') {
        resultSection.classList.add('show');
        barBox.classList.add('show');
        setTimeout(function () { scrollTo(resultSection); }, 250);
      }
    }

    retryEl.addEventListener('click', function () { if (!retryEl.disabled) runChecks(); });
    oldEl.addEventListener('input', check);
    oldEl.addEventListener('paste', function () { setTimeout(check, 0); });

    copyEl.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(newUrl).then(function () { toast('Lien copié ✓'); }, function () {});
      else { var r = document.createRange(); r.selectNodeContents(newUrlEl); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Lien sélectionné : fais Ctrl+C'); }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderRecoveryHtml };
