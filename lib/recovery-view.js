// Page publique /recuperation : aide les utilisateurs à migrer leur addon après un
// changement de domaine. La config (clé TMDB, pseudo, options) est encodée dans l'URL du
// manifest elle-même (segment base64url) : il n'y a donc RIEN à chercher en base. Le
// navigateur extrait ce segment de l'ancienne URL collée et le recolle derrière le domaine
// courant.
// Design : celui de /configure (nav, hero, sections à filets, cartes, barre d'action fixe).
// Parcours : accueil clair (pourquoi / ce que fait la page / 5 étapes) -> bouton « Commencer »
// -> assistant en 5 étapes (copier, coller, vérifier, installer, nettoyer) avec indicateur
// de progression. L'étape « Vérifier » est un diagnostic animé qui s'exécute VRAIMENT :
// lecture du lien, décodage de la config, manifest.json via le serveur, test de la clé TMDB
// via /api/test-tmdb ; il passe au vert / orange / rouge selon le résultat.

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

    .hero { position: relative; z-index: 1; text-align: center; padding: 70px 40px 10px; }
    .status-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 26px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; background: var(--bg2);
      border: 1px solid var(--border); border-radius: 100px; font-size: 12px; font-weight: 500; color: var(--muted); letter-spacing: 0.5px;
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
    .hero-title { font-family: 'Bebas Neue', sans-serif; font-size: clamp(52px, 8vw, 96px); line-height: 0.9; letter-spacing: 4px; color: #fff; margin-bottom: 8px; }
    .hero-title span { color: var(--red); display: block; }
    .hero-sub { font-size: 16px; color: #a0a0a8; max-width: 520px; margin: 20px auto 0; line-height: 1.6; }
    .hero-sub b { color: #fff; font-weight: 700; }

    main { position: relative; z-index: 1; max-width: 780px; margin: 0 auto; padding: 0 24px 150px; }
    .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; margin-top: 40px; }
    .section-line { flex: 1; height: 1px; background: var(--border); }
    .section-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; font-weight: 600; }
    .config-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-top: 12px; }
    .card-title { font-size: 22px; font-weight: 700; color: #fff; line-height: 1.25; margin-bottom: 8px; }
    .lead { font-size: 15.5px; line-height: 1.7; color: #b4b4bc; }
    .lead b, .info-desc b, .how-text b, .hint b, .step-line b { color: #fff; font-weight: 700; }
    .code { font-family: 'Rajdhani', ui-monospace, monospace; font-weight: 700; font-size: 14px; color: #fff; background: rgba(255,255,255,0.08); padding: 1px 8px; border-radius: 6px; white-space: nowrap; }
    .code.old { color: #fc8181; background: rgba(252,129,129,0.10); text-decoration: line-through; text-decoration-color: rgba(252,129,129,0.6); }
    .code.new { color: var(--green); background: rgba(72,187,120,0.10); }
    .swap { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; margin: 18px 0 4px; }
    .swap .arrow { color: var(--muted); font-size: 18px; }
    .tag { display: inline-block; background: rgba(255,255,255,0.10); border-radius: 6px; padding: 0 7px; font-weight: 700; color: #fff; white-space: nowrap; font-size: 12.5px; }

    .info-list { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .info-row { display: flex; align-items: flex-start; gap: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; }
    .info-ico { font-size: 21px; line-height: 1.2; flex-shrink: 0; }
    .info-title { font-size: 14.5px; font-weight: 700; color: #fff; line-height: 1.3; margin-bottom: 3px; }
    .info-desc { font-size: 13.5px; color: #9a9aa2; line-height: 1.6; }

    .step-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .step-list li { display: flex; align-items: center; gap: 14px; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; font-size: 14.5px; color: #b4b4bc; }
    .n { flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--red); color: #fff; display: flex; align-items: center; justify-content: center; font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 700; }
    .step-line { flex: 1; }
    .step-time { font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; font-weight: 600; text-align: center; margin-top: 14px; }

    /* Indicateur de progression */
    .stepper { display: none; align-items: flex-start; justify-content: center; margin: 34px auto 6px; max-width: 560px; }
    .stepper.show { display: flex; }
    .st { display: flex; flex-direction: column; align-items: center; gap: 7px; flex: 0 0 auto; width: 64px; }
    .st-dot { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--muted2); background: var(--bg); color: var(--muted); display: flex; align-items: center; justify-content: center; font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 700; transition: all .3s; }
    .st-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted2); font-weight: 600; transition: color .3s; }
    .st-bar { flex: 1; height: 2px; background: var(--border); margin-top: 15px; min-width: 10px; transition: background .3s; }
    .st.active .st-dot { background: var(--red); border-color: var(--red); color: #fff; box-shadow: 0 0 16px rgba(229,62,62,0.55); }
    .st.active .st-label { color: #fff; }
    .st.done .st-dot { background: var(--green); border-color: var(--green); color: #fff; font-size: 0; }
    .st.done .st-dot::before { content: '\\2713'; font-size: 15px; }
    .st.done .st-label { color: var(--muted); }
    .st-bar.done { background: var(--green); }

    .screen { display: none; }
    .screen.active { display: block; animation: fade .3s ease; }
    @keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

    .how { list-style: none; display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }
    .how li { display: flex; align-items: flex-start; gap: 14px; }
    .how .n { margin-top: 1px; }
    .how-text { font-size: 15px; color: #9a9aa2; line-height: 1.65; }
    .hint { font-size: 12.5px; color: var(--muted); margin-top: 14px; line-height: 1.6; }

    .config-field label { display: block; font-size: 13px; font-weight: 700; color: var(--text); margin: 18px 0 8px; }
    .config-field textarea {
      width: 100%; min-height: 120px; resize: vertical; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
      color: var(--text); font-family: 'Rajdhani', ui-monospace, monospace; font-size: 14px; line-height: 1.5; word-break: break-all; transition: border-color .2s;
    }
    .config-field textarea:focus { outline: none; border-color: var(--red); }
    .config-status { font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 8px; margin-top: 14px; display: none; line-height: 1.5; }
    .config-status.ok { display: block; background: rgba(72,187,120,0.08); border: 1px solid rgba(72,187,120,0.25); color: #68d391; }
    .config-status.bad { display: block; background: rgba(252,129,129,0.08); border: 1px solid rgba(252,129,129,0.25); color: #fc8181; }

    /* Diagnostic futuriste */
    .scan { position: relative; overflow: hidden; margin-top: 18px; border-radius: 14px; padding: 18px 18px 16px;
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

    .result { margin-top: 18px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; font-family: 'Rajdhani', ui-monospace, monospace; font-size: 14px; line-height: 1.5; word-break: break-all; color: #cfcfd6; }
    .stack { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .party { text-align: center; padding: 8px 0 0; }
    .party .big { font-size: 60px; line-height: 1; margin-bottom: 12px; }

    .install-bar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; padding: 16px 32px;
      background: rgba(10,10,11,0.97); backdrop-filter: blur(20px);
      border-top: 1px solid rgba(229,62,62,0.25); box-shadow: 0 -4px 30px rgba(229,62,62,0.06);
      display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;
    }
    .btn { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 12px 24px; border-radius: 9px; font-size: 14px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; border: none; text-decoration: none; transition: all .2s; }
    .btn-big { width: 100%; padding: 16px 24px; font-size: 16px; }
    .btn-red { background: var(--red); color: #fff; animation: btnPulse 2.5s ease-in-out infinite; }
    .btn-red:hover:not(:disabled) { background: var(--red-dark); transform: translateY(-1px); box-shadow: 0 4px 15px rgba(229,62,62,0.4); }
    @keyframes btnPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(229,62,62,0.35); } 50% { box-shadow: 0 0 0 8px rgba(229,62,62,0); } }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover:not(:disabled) { background: var(--bg3); transform: translateY(-1px); }
    .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
    .btn-ghost:hover:not(:disabled) { color: var(--text); background: var(--bg3); }
    .btn:disabled { opacity: .35; cursor: not-allowed; animation: none; }
    .toast {
      position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%) translateY(10px);
      background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 10px 20px;
      border-radius: 10px; font-size: 13px; opacity: 0; transition: all 0.25s; pointer-events: none; z-index: 999; white-space: nowrap;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    @media (max-width: 640px) {
      nav { padding: 0 16px; }
      .hero { padding: 54px 20px 6px; }
      .hero-title { font-size: clamp(48px, 14vw, 80px); }
      main { padding: 0 12px 170px; }
      .config-card { padding: 18px; }
      .card-title { font-size: 20px; }
      .install-bar { padding: 12px 14px; gap: 8px; }
      .install-bar .btn { flex: 1; padding: 12px 10px; }
      .st { width: 46px; } .st-label { display: none; }
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

  <section class="hero" id="hero">
    <div class="status-row">
      <span class="status-badge"><span class="status-dot"></span>Config conservée</span>
      <span class="status-badge"><span class="status-dot"></span>1 minute</span>
      <span class="status-badge"><span class="status-dot"></span>Rien à retaper</span>
    </div>
    <h1 class="hero-title">RÉCUPÈRE<span>TON ADDON</span></h1>
    <p class="hero-sub">L'adresse de l'addon a changé. <b>Suis le guide</b> : tu auras ton <b>nouveau lien</b> en quelques clics, avec toute ta configuration.</p>
  </section>

  <main>
    <div class="stepper" id="stepper">
      <div class="st" data-st="1"><span class="st-dot">1</span><span class="st-label">Copier</span></div><span class="st-bar" data-bar="1"></span>
      <div class="st" data-st="2"><span class="st-dot">2</span><span class="st-label">Coller</span></div><span class="st-bar" data-bar="2"></span>
      <div class="st" data-st="3"><span class="st-dot">3</span><span class="st-label">Vérifier</span></div><span class="st-bar" data-bar="3"></span>
      <div class="st" data-st="4"><span class="st-dot">4</span><span class="st-label">Installer</span></div><span class="st-bar" data-bar="4"></span>
      <div class="st" data-st="5"><span class="st-dot">5</span><span class="st-label">Nettoyer</span></div>
    </div>

    <!-- 0. Accueil -->
    <section class="screen active" data-screen="0">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Ce qui se passe</span><div class="section-line"></div></div>
      <div class="config-card">
        <p class="lead">L'addon <b>${escapeHtml(brandName)}</b> a <b>changé d'adresse</b>. L'ancienne est <b>arrêtée</b> : si ton addon ne trouve plus rien dans Stremio, c'est pour ça.</p>
        <div class="swap">
          <span class="code old">vf-trailer-off.vercel.app</span>
          <span class="arrow">→</span>
          <span class="code new" id="newHost">nouvelle adresse</span>
        </div>
        <div class="info-list">
          <div class="info-row"><span class="info-ico">🤔</span><div>
            <div class="info-title">Pourquoi agir ?</div>
            <div class="info-desc">Stremio <b>ne met pas l'adresse à jour tout seul</b> : il faut lui donner le nouveau lien.</div></div></div>
          <div class="info-row"><span class="info-ico">🔗</span><div>
            <div class="info-title">Que fait cette page ?</div>
            <div class="info-desc">Ta configuration (<b>clé TMDB, pseudo, options</b>) est cachée <b>dans ton ancien lien</b>. La page la récupère et fabrique le nouveau : <b>rien à reconfigurer</b>.</div></div></div>
          <div class="info-row"><span class="info-ico">🔒</span><div>
            <div class="info-title">Et mes données ?</div>
            <div class="info-desc">Ton lien est lu <b>dans ton navigateur</b>. Seuls <b>ce serveur</b> et TMDB (test de ta clé) sont contactés. Rien n'est publié.</div></div></div>
        </div>
      </div>

      <div class="section-header"><div class="section-line"></div><span class="section-label">Comment ça marche</span><div class="section-line"></div></div>
      <div class="config-card">
        <ol class="step-list">
          <li><span class="n">1</span><span class="step-line"><b>Copier</b> ton ancien lien dans Stremio</span></li>
          <li><span class="n">2</span><span class="step-line"><b>Coller</b> le lien ici</span></li>
          <li><span class="n">3</span><span class="step-line"><b>Vérifier</b> : un diagnostic contrôle que tout fonctionne</span></li>
          <li><span class="n">4</span><span class="step-line"><b>Installer</b> le nouveau lien en un clic</span></li>
          <li><span class="n">5</span><span class="step-line"><b>Nettoyer</b> : supprimer l'ancien addon</span></li>
        </ol>
        <div class="step-time">Environ 1 minute · Rien à taper</div>
      </div>
    </section>

    <!-- 1. Copier -->
    <section class="screen" data-screen="1">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Étape 1 sur 5</span><div class="section-line"></div></div>
      <div class="config-card">
        <h2 class="card-title">Copie ton ancien lien 📋</h2>
        <p class="lead">Ouvre <b>Stremio</b>, puis fais <b>ces 3 gestes</b> :</p>
        <ol class="how">
          <li><span class="n">1</span><span class="how-text">Clique sur la pièce de puzzle 🧩 <b>« Addons »</b> dans le menu à gauche.</span></li>
          <li><span class="n">2</span><span class="how-text">Clique sur la ligne <span class="tag">W Bandes-Annonces VF</span>. <b>Une fenêtre s'ouvre.</b></span></li>
          <li><span class="n">3</span><span class="how-text">Fais un <b>triple-clic</b> sur le long lien pour <b>tout sélectionner</b>, puis <span class="tag">Ctrl</span> + <span class="tag">C</span> (Mac : <span class="tag">⌘</span> + <span class="tag">C</span>).</span></li>
        </ol>
        <p class="hint"><b>Sur téléphone :</b> appui long sur le lien, puis « Copier ». Si la fenêtre propose « Désinstaller », <b>ne clique pas dessus</b> tout de suite.</p>
      </div>
    </section>

    <!-- 2. Coller -->
    <section class="screen" data-screen="2">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Étape 2 sur 5</span><div class="section-line"></div></div>
      <div class="config-card">
        <h2 class="card-title">Colle ton lien ici 👇</h2>
        <p class="lead">Clique <b>dans la case</b>, puis <span class="tag">Ctrl</span> + <span class="tag">V</span> (Mac : <span class="tag">⌘</span> + <span class="tag">V</span>).</p>
        <div class="config-field">
          <label for="old">Ancienne URL de l'addon</label>
          <textarea id="old" spellcheck="false" autocomplete="off" placeholder="Colle ton lien ici (il ressemble à https://…/eyJ…/manifest.json)"></textarea>
        </div>
        <div class="config-status" id="status"></div>
        <p class="hint">🔒 Ce lien contient <b>ta clé TMDB</b> : il n'est utilisé que pour les vérifications de l'étape suivante.</p>
      </div>
    </section>

    <!-- 3. Vérifier -->
    <section class="screen" data-screen="3">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Étape 3 sur 5</span><div class="section-line"></div></div>
      <div class="config-card">
        <h2 class="card-title">Analyse de ton lien 🛰️</h2>
        <p class="lead">On vérifie que <b>tout fonctionne</b> avant d'installer. <b>Ne bouge pas</b>, ça prend quelques secondes.</p>
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
        </div>
      </div>
    </section>

    <!-- 4. Installer -->
    <section class="screen" data-screen="4">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Étape 4 sur 5</span><div class="section-line"></div></div>
      <div class="config-card">
        <h2 class="card-title">Ton nouveau lien est prêt ✨</h2>
        <p class="lead">Clique sur <b>le gros bouton rouge</b> : Stremio s'ouvre et te propose d'installer l'addon. Il te reste <b>un clic</b> sur <span class="tag">Installer</span>.</p>
        <div class="stack">
          <a class="btn btn-red btn-big" id="install" href="#">⬇ Installer dans Stremio</a>
          <button class="btn btn-outline btn-big" id="copy" type="button">📋 Copier le lien</button>
        </div>
        <div class="result" id="newUrl"></div>
        <p class="hint"><b>Si rien ne s'ouvre :</b> copie le lien, puis dans Stremio → <span class="tag">Addons</span> → <span class="tag">Ajouter un addon</span> → colle-le → <b>Installer</b>.</p>
      </div>
    </section>

    <!-- 5. Nettoyer -->
    <section class="screen" data-screen="5">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Étape 5 sur 5</span><div class="section-line"></div></div>
      <div class="config-card">
        <h2 class="card-title">Supprime l'ancien addon 🧹</h2>
        <p class="lead">Tu as maintenant <b>deux fois</b> le même addon dans Stremio. On enlève <b>le vieux</b> pour éviter les doublons :</p>
        <ol class="how">
          <li><span class="n">1</span><span class="how-text">Dans <b>Addons</b>, clique sur <b>un des deux</b> <span class="tag">W Bandes-Annonces VF</span>.</span></li>
          <li><span class="n">2</span><span class="how-text">Regarde le lien affiché. S'il contient <span class="code old" id="oldHost">vf-trailer-off.vercel.app</span>, c'est <b>le vieux</b>.</span></li>
          <li><span class="n">3</span><span class="how-text">Clique sur <span class="tag">Désinstaller</span>. Si c'est <b>le nouveau</b>, choisis « Annuler » et essaie l'autre.</span></li>
        </ol>
      </div>
    </section>

    <!-- 6. Fin -->
    <section class="screen" data-screen="6">
      <div class="section-header"><div class="section-line"></div><span class="section-label">Terminé</span><div class="section-line"></div></div>
      <div class="config-card">
        <div class="party">
          <div class="big">🎉</div>
          <h2 class="card-title">Bravo, c'est terminé !</h2>
          <p class="lead">Ton addon fonctionne avec <b>la nouvelle adresse</b> et <b>ta configuration d'avant</b>. Tu peux fermer cette page et profiter de tes bandes-annonces.</p>
        </div>
      </div>
    </section>
  </main>

  <div class="install-bar">
    <button class="btn btn-ghost" id="bBack" type="button">← Retour</button>
    <button class="btn btn-outline" id="bSec" type="button">🔄 Relancer</button>
    <button class="btn btn-red" id="bPri" type="button">Commencer →</button>
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
    var screens = document.querySelectorAll('.screen');
    var oldEl = $('old'), statusEl = $('status'), heroEl = $('hero'), stepperEl = $('stepper');
    var scanEl = $('scan'), scanTitleEl = $('scanTitle'), pctEl = $('pct'), barEl = $('barFill'), verdictEl = $('verdict');
    var newUrlEl = $('newUrl'), installEl = $('install'), copyEl = $('copy'), toastEl = $('toast');
    var bBack = $('bBack'), bSec = $('bSec'), bPri = $('bPri');
    var step = 0, currentCfg = null, currentObj = null, newUrl = '', runId = 0, toastTimer = null;
    var flags = { ready2: false, idle3: false, ok3: false };

    $('newHost').textContent = location.host || 'nouvelle adresse';

    // Configuration de la barre d'action pour chaque étape.
    var BAR = {
      0: { back: null, sec: null, pri: { t: 'Commencer →', to: 1 } },
      1: { back: 0, sec: null, pri: { t: "C'est copié →", to: 2 } },
      2: { back: 1, sec: null, pri: { t: "Lancer l'analyse 🔍", to: 3, need: 'ready2' } },
      3: { back: 2, sec: { t: '🔄 Relancer', need: 'idle3' }, pri: { t: 'Continuer →', to: 4, need: 'ok3' } },
      4: { back: 3, sec: null, pri: { t: "C'est installé →", to: 5 } },
      5: { back: 4, sec: null, pri: { t: "J'ai terminé ✓", to: 6 } },
      6: { back: null, sec: null, pri: { t: 'Recommencer', to: 0, outline: true } }
    };

    function toast(msg) {
      toastEl.textContent = msg; toastEl.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }

    function refreshBar() {
      var c = BAR[step];
      bBack.style.display = c.back === null ? 'none' : '';
      bSec.style.display = c.sec ? '' : 'none';
      if (c.sec) { bSec.textContent = c.sec.t; bSec.disabled = !flags[c.sec.need]; }
      bPri.textContent = c.pri.t;
      bPri.className = 'btn ' + (c.pri.outline ? 'btn-outline' : 'btn-red');
      bPri.disabled = c.pri.need ? !flags[c.pri.need] : false;
    }

    function refreshStepper() {
      var visible = step >= 1;
      stepperEl.classList.toggle('show', visible);
      var items = stepperEl.querySelectorAll('.st');
      for (var i = 0; i < items.length; i++) {
        var n = Number(items[i].getAttribute('data-st'));
        items[i].classList.toggle('done', n < step);
        items[i].classList.toggle('active', n === step);
      }
      var bars = stepperEl.querySelectorAll('.st-bar');
      for (var j = 0; j < bars.length; j++) {
        bars[j].classList.toggle('done', Number(bars[j].getAttribute('data-bar')) < step);
      }
    }

    function show(n) {
      n = Number(n);
      if (n !== 3) runId++; // quitter le diagnostic l'annule
      step = n;
      for (var i = 0; i < screens.length; i++) {
        screens[i].classList.toggle('active', screens[i].getAttribute('data-screen') === String(n));
      }
      heroEl.style.display = n === 0 ? '' : 'none';
      refreshStepper();
      refreshBar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (n === 3) runChecks();
    }

    function check() {
      var value = oldEl.value;
      flags.ready2 = false; flags.ok3 = false;
      statusEl.className = 'config-status';
      if (value.trim()) {
        var cfg = extractConfig(value);
        if (!cfg) {
          statusEl.className = 'config-status bad';
          statusEl.textContent = "🤔 Je ne reconnais pas ce lien. Reprends l'étape 1 et copie bien tout le lien, du « https » jusqu'à « manifest.json ».";
        } else {
          currentCfg = cfg;
          currentObj = decodeObj(cfg);
          newUrl = location.origin + '/' + cfg + '/manifest.json';
          newUrlEl.textContent = newUrl;
          installEl.href = newUrl.replace(/^https?:\\/\\//, 'stremio://');
          var oldHost = hostOf(value);
          var sameHost = oldHost === location.host.toLowerCase();
          if (oldHost && !sameHost) $('oldHost').textContent = oldHost;
          statusEl.className = 'config-status ok';
          statusEl.textContent = sameHost
            ? "✅ Lien reconnu. Il utilise déjà la nouvelle adresse : tu peux quand même continuer."
            : "✅ Lien reconnu ! Ta configuration est retrouvée. Clique sur « Lancer l'analyse ».";
          flags.ready2 = true;
        }
      }
      refreshBar();
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
      flags.idle3 = false; flags.ok3 = false;
      refreshBar();
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

      async function stepRun(k, running, pct, fn) {
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

      if (!(await stepRun('read', 'Lecture de l\\'adresse…', 25, async function () {
        return { state: 'ok', detail: 'Lien reconnu, format valide.' };
      }))) return;

      if (!(await stepRun('decode', 'Décodage en cours…', 50, async function () {
        var bits = [];
        bits.push(typeof obj.tmdbKey === 'string' && obj.tmdbKey ? 'clé TMDB trouvée' : 'aucune clé TMDB');
        if (typeof obj.pseudo === 'string' && obj.pseudo.trim()) bits.push('pseudo : ' + obj.pseudo.trim().slice(0, 40));
        if (obj.maxLinks) bits.push(obj.maxLinks + ' lien(s) max');
        if (obj.externalOnly === true) bits.push('liens externes seulement');
        return obj.tmdbKey
          ? { state: 'ok', detail: 'Configuration retrouvée : ' + bits.join(' · ') + '.' }
          : { state: 'warn', detail: 'Configuration lue, mais sans clé TMDB : tu devras la refaire sur /configure.' };
      }))) return;

      if (!(await stepRun('server', 'Le serveur est interrogé…', 75, async function () {
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

      if (!(await stepRun('tmdb', 'Interrogation de TMDB…', 100, async function () {
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
        verdictEl.textContent = '❌ Un point bloque. Relance l\\'analyse, ou reviens à l\\'étape 2 pour recoller ton lien.';
      }
      flags.idle3 = true;
      flags.ok3 = worst !== 'bad';
      refreshBar();
    }

    bBack.addEventListener('click', function () { var c = BAR[step]; if (c.back !== null) show(c.back); });
    bPri.addEventListener('click', function () { if (!bPri.disabled) show(BAR[step].pri.to); });
    bSec.addEventListener('click', function () { if (!bSec.disabled && step === 3) runChecks(); });
    oldEl.addEventListener('input', check);
    oldEl.addEventListener('paste', function () { setTimeout(check, 0); });

    copyEl.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(newUrl).then(function () { toast('Lien copié ✓'); }, function () {});
      else { var r = document.createRange(); r.selectNodeContents(newUrlEl); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Lien sélectionné : fais Ctrl+C'); }
    });

    refreshBar();
  </script>
</body>
</html>`;
}

module.exports = { renderRecoveryHtml };
