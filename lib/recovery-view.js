// Page publique /recuperation : aide les utilisateurs à migrer leur addon après un
// changement de domaine. La config (clé TMDB, pseudo, options) est encodée dans l'URL du
// manifest elle-même (segment base64url) : il n'y a donc RIEN à chercher en base. Le
// navigateur extrait ce segment de l'ancienne URL collée et le recolle derrière le domaine
// courant.
// Présentation : écran d'accueil (3 cartes + encart "Comment ça marche ?") puis assistant
// en 5 étapes très guidées, une seule action par écran. L'étape 3 est un vrai diagnostic
// animé : il lit le lien, décode la config, interroge réellement le serveur (manifest.json)
// et teste la clé TMDB via /api/test-tmdb, puis passe au vert / orange / rouge selon le
// résultat. Reprend la charte de /configure.

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
      --border: rgba(255,255,255,0.07); --text: #f4f4f5; --muted: #b0b0b8; --muted2: #55555c;
      --green: #48bb78; --amber: #ecc94b; --bad: #fc8181; --cyan: #63b3ed;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; overflow-x: hidden; }
    body::before {
      content: ''; position: fixed; top: -200px; left: 50%; transform: translateX(-50%);
      width: 800px; height: 600px; background: radial-gradient(ellipse, rgba(229,62,62,0.08) 0%, transparent 70%);
      pointer-events: none; z-index: 0;
    }
    nav {
      position: absolute; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between;
      padding: 0 32px; height: 64px;
    }
    .nav-name { font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 2px; color: #fff; text-transform: uppercase; text-decoration: none; }
    .nav-link {
      padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border); color: var(--muted);
      font-size: 13px; font-weight: 600; text-decoration: none; transition: all 0.2s;
    }
    .nav-link:hover { color: var(--text); border-color: var(--muted2); background: var(--bg3); }

    main { position: relative; z-index: 1; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 84px 16px 48px; }
    .panel { position: relative; overflow: hidden; width: 100%; max-width: 720px; background: linear-gradient(180deg, #131316, #0e0e11); border: 1px solid var(--border); border-radius: 28px; padding: 40px 40px 32px; box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02); }
    .eyebrow { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--cyan); margin-bottom: 14px; }
    .eyebrow::before { content: ''; width: 26px; height: 2px; background: linear-gradient(90deg, transparent, var(--cyan)); }
    h1 { font-size: clamp(25px, 4.8vw, 34px); font-weight: 700; line-height: 1.2; margin-bottom: 12px; letter-spacing: -0.3px; }
    .lead { color: var(--muted); font-size: 16px; line-height: 1.65; font-weight: 500; }
    .lead b, .tip b, .callout b, .feature b { color: #fff; font-weight: 700; }

    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0 18px; }
    .feature { background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 16px; padding: 18px 16px; }
    .feature h3 { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .feature p { color: var(--muted); font-size: 13.5px; line-height: 1.5; font-weight: 500; }
    .callout { border-left: 3px solid var(--red); background: linear-gradient(90deg, rgba(229,62,62,0.16), rgba(229,62,62,0.02) 70%, transparent); border-radius: 4px 14px 14px 4px; padding: 16px 20px; color: var(--muted); font-size: 14.5px; line-height: 1.6; font-weight: 500; }
    .divider { height: 1px; background: var(--border); margin: 24px 0 20px; }

    .footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .footer.end { justify-content: flex-end; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 26px;
      border-radius: 12px; border: 1px solid var(--border); background: var(--bg3); color: var(--text);
      font-family: inherit; font-size: 15px; font-weight: 700; cursor: pointer; text-decoration: none; transition: all 0.2s;
    }
    .btn:hover:not(:disabled) { border-color: var(--muted2); }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, var(--red), var(--red-dark)); border-color: transparent; color: #fff; padding: 15px 30px; border-radius: 14px; box-shadow: 0 10px 30px rgba(229,62,62,0.40), inset 0 1px 0 rgba(255,255,255,0.18); }
    .btn-primary:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
    .btn-ghost { background: transparent; color: var(--muted); padding: 13px 16px; }
    .btn-big { width: 100%; padding: 17px 24px; font-size: 17px; }

    /* Assistant */
    .progress { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 4px; }
    .dot { flex: 1; height: 4px; background: rgba(255,255,255,0.06); transition: background 0.3s; }
    .dot.on { background: linear-gradient(90deg, var(--red), var(--red-dark)); box-shadow: 0 0 12px rgba(229,62,62,0.6); }

    .todo { list-style: none; margin: 22px 0 6px; display: flex; flex-direction: column; gap: 12px; }
    .todo li { display: flex; align-items: flex-start; gap: 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; font-size: 16px; line-height: 1.5; font-weight: 500; color: var(--muted); }
    .todo .n { flex: 0 0 32px; height: 32px; border-radius: 50%; background: var(--red); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
    .todo b { color: #fff; font-weight: 700; }
    .tag { display: inline-block; background: rgba(255,255,255,0.10); border-radius: 6px; padding: 1px 8px; font-weight: 700; color: #fff; white-space: nowrap; }
    .tip { color: var(--muted); font-size: 14px; line-height: 1.55; margin-top: 14px; font-weight: 500; }

    textarea {
      width: 100%; min-height: 120px; resize: vertical; margin-top: 20px; background: var(--bg); border: 2px dashed var(--muted2); border-radius: 14px;
      color: var(--text); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; padding: 14px; line-height: 1.5; outline: none; word-break: break-all;
    }
    textarea:focus { border-color: var(--red); border-style: solid; }
    .status { display: none; margin-top: 14px; padding: 12px 16px; border-radius: 12px; font-size: 15px; font-weight: 700; line-height: 1.5; }
    .status.ok { display: block; background: rgba(72,187,120,0.12); color: var(--green); border: 1px solid rgba(72,187,120,0.3); }
    .status.bad { display: block; background: rgba(252,129,129,0.10); color: var(--bad); border: 1px solid rgba(252,129,129,0.3); }

    /* Diagnostic futuriste */
    .scan { position: relative; overflow: hidden; margin-top: 22px; border-radius: 16px; padding: 18px 18px 16px;
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
    .chk small { display: block; font-size: 12.5px; color: var(--muted); font-weight: 500; line-height: 1.4; margin-top: 2px; }
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

    .result { margin-top: 18px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; word-break: break-all; color: var(--muted); }
    .stack { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }

    .party { text-align: center; padding: 10px 0 4px; }
    .party .big { font-size: 64px; line-height: 1; margin-bottom: 14px; }

    .screen { display: none; }
    .screen.active { display: block; animation: fade 0.25s ease; }
    @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    @media (max-width: 600px) {
      nav { padding: 0 16px; }
      main { padding: 72px 12px 32px; align-items: flex-start; }
      .panel { padding: 30px 20px 22px; border-radius: 22px; }
      .features { grid-template-columns: 1fr; }
      .btn { padding: 13px 18px; }
      .chk { grid-template-columns: 28px 1fr; }
      .chk .res { grid-column: 2; }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <nav>
    <a class="nav-name" href="/configure">${escapeHtml(brandName)}</a>
    <a class="nav-link" href="/configure">Configurer</a>
  </nav>

  <main>
    <div class="panel">

      <!-- Accueil -->
      <section class="screen active" data-screen="0">
        <div class="eyebrow">Bienvenue</div>
        <h1>Ton addon a changé d'adresse 👋</h1>
        <p class="lead">L'adresse de l'addon <b>${escapeHtml(brandName)}</b> n'est plus la même. Cette page prend ton <b>ancien lien</b> et fabrique ton <b>nouveau lien</b> : tu gardes <b>toute ta configuration</b>, sans rien retaper.</p>

        <div class="features">
          <div class="feature"><h3>🔗 Tu colles</h3><p><b>Ton ancien lien</b>, copié depuis Stremio.</p></div>
          <div class="feature"><h3>🛰️ On vérifie</h3><p>Un <b>diagnostic</b> contrôle que tout est bien au vert.</p></div>
          <div class="feature"><h3>✨ Tu installes</h3><p><b>Un seul clic</b> et ton addon est à jour.</p></div>
        </div>

        <div class="callout"><b>Comment ça marche ?</b> <b>5 petites étapes</b>, environ <b>1 minute</b>. Tu n'as rien à taper : juste <b>copier, coller et cliquer</b>.</div>

        <div class="divider"></div>
        <div class="footer end"><button class="btn btn-primary" data-go="1" type="button">Commencer →</button></div>
      </section>

      <!-- Étape 1 : copier -->
      <section class="screen" data-screen="1">
        <div class="eyebrow">Étape 1 sur 5</div>
        <div class="progress"><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <h1>Copie ton ancien lien 📋</h1>
        <p class="lead">On commence dans <b>Stremio</b>. Ouvre l'application, puis fais <b>ces 3 petits gestes</b> :</p>
        <ol class="todo">
          <li><span class="n">1</span><span>Clique sur la pièce de puzzle 🧩 <b>« Addons »</b> dans le menu à gauche.</span></li>
          <li><span class="n">2</span><span>Clique sur la ligne <span class="tag">W Bandes-Annonces VF</span>. <b>Une fenêtre s'ouvre.</b></span></li>
          <li><span class="n">3</span><span>Fais un <b>triple-clic</b> sur le long lien pour <b>tout sélectionner</b>, puis appuie sur <span class="tag">Ctrl</span> + <span class="tag">C</span> (sur Mac : <span class="tag">⌘</span> + <span class="tag">C</span>).</span></li>
        </ol>
        <p class="tip"><b>Sur téléphone :</b> reste appuyé sur le lien, puis choisis <b>« Copier »</b>. Pas de panique si la fenêtre propose « Désinstaller » : <b>ne clique pas dessus</b> tout de suite.</p>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="0" type="button">← Retour</button>
          <button class="btn btn-primary" data-go="2" type="button">C'est copié →</button>
        </div>
      </section>

      <!-- Étape 2 : coller -->
      <section class="screen" data-screen="2">
        <div class="eyebrow">Étape 2 sur 5</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <h1>Colle-le ici 👇</h1>
        <p class="lead">Clique <b>dans la case</b> ci-dessous, puis appuie sur <span class="tag">Ctrl</span> + <span class="tag">V</span> (sur Mac : <span class="tag">⌘</span> + <span class="tag">V</span>). <b>C'est tout.</b></p>
        <textarea id="old" spellcheck="false" autocomplete="off" placeholder="Colle ton lien ici (il ressemble à https://…/eyJ…/manifest.json)"></textarea>
        <div class="status" id="status"></div>
        <p class="tip">🔒 Ce lien contient <b>ta clé TMDB</b>. Il n'est utilisé que pour <b>les vérifications de l'étape suivante</b> : rien n'est partagé ni affiché publiquement.</p>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="1" type="button">← Retour</button>
          <button class="btn btn-primary" id="toScan" data-go="3" type="button" disabled>Lancer l'analyse 🔍</button>
        </div>
      </section>

      <!-- Étape 3 : diagnostic -->
      <section class="screen" data-screen="3">
        <div class="eyebrow">Étape 3 sur 5</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot"></span><span class="dot"></span></div>
        <h1>Analyse de ton lien 🛰️</h1>
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

        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="2" type="button">← Retour</button>
          <span style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn" id="retry" type="button" disabled>Relancer 🔄</button>
            <button class="btn btn-primary" id="toInstall" data-go="4" type="button" disabled>Continuer →</button>
          </span>
        </div>
      </section>

      <!-- Étape 4 : installer -->
      <section class="screen" data-screen="4">
        <div class="eyebrow">Étape 4 sur 5</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot"></span></div>
        <h1>Ton nouveau lien est prêt ✨</h1>
        <p class="lead">Clique sur <b>le gros bouton</b> : Stremio s'ouvre et te propose d'installer l'addon. Il te reste <b>un seul clic</b> sur <span class="tag">Installer</span>.</p>
        <div class="stack">
          <a class="btn btn-primary btn-big" id="install" href="#">Installer dans Stremio</a>
          <button class="btn btn-big" id="copy" type="button">Ou copier le lien</button>
        </div>
        <div class="result" id="newUrl"></div>
        <p class="tip"><b>Si rien ne s'ouvre :</b> copie le lien, puis dans Stremio : Addons → <span class="tag">Ajouter un addon</span> → colle le lien → <b>Installer</b>.</p>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="3" type="button">← Retour</button>
          <button class="btn btn-primary" data-go="5" type="button">C'est installé →</button>
        </div>
      </section>

      <!-- Étape 5 : supprimer l'ancien -->
      <section class="screen" data-screen="5">
        <div class="eyebrow">Étape 5 sur 5</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span></div>
        <h1>Supprime l'ancien 🧹</h1>
        <p class="lead">Il y a maintenant <b>deux fois</b> le même addon dans Stremio. On enlève <b>le vieux</b> pour éviter les doublons :</p>
        <ol class="todo">
          <li><span class="n">1</span><span>Dans <b>Addons</b>, clique sur <b>un des deux</b> <span class="tag">W Bandes-Annonces VF</span>.</span></li>
          <li><span class="n">2</span><span>Regarde le lien affiché. S'il contient <span class="tag" id="oldHost">l'ancienne adresse</span>, c'est <b>le vieux</b>.</span></li>
          <li><span class="n">3</span><span>Clique sur <span class="tag">Désinstaller</span>. Si c'est <b>le nouveau</b>, clique sur « Annuler » et essaie l'autre.</span></li>
        </ol>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="4" type="button">← Retour</button>
          <button class="btn btn-primary" data-go="6" type="button">J'ai terminé ✓</button>
        </div>
      </section>

      <!-- Fin -->
      <section class="screen" data-screen="6">
        <div class="party">
          <div class="big">🎉</div>
          <h1>Bravo, c'est terminé !</h1>
          <p class="lead">Ton addon fonctionne avec <b>la nouvelle adresse</b> et <b>ta configuration d'avant</b>. Tu peux fermer cette page et profiter de tes bandes-annonces.</p>
        </div>
        <div class="divider"></div>
        <div class="footer end"><button class="btn" data-go="0" type="button">Recommencer</button></div>
      </section>

    </div>
  </main>

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

    var screens = document.querySelectorAll('.screen');
    var oldEl = document.getElementById('old');
    var statusEl = document.getElementById('status');
    var toScanEl = document.getElementById('toScan');
    var toInstallEl = document.getElementById('toInstall');
    var retryEl = document.getElementById('retry');
    var newUrlEl = document.getElementById('newUrl');
    var installEl = document.getElementById('install');
    var copyEl = document.getElementById('copy');
    var oldHostEl = document.getElementById('oldHost');
    var scanEl = document.getElementById('scan');
    var scanTitleEl = document.getElementById('scanTitle');
    var pctEl = document.getElementById('pct');
    var barEl = document.getElementById('barFill');
    var verdictEl = document.getElementById('verdict');
    var newUrl = '';
    var currentCfg = null;
    var currentObj = null;
    var runId = 0;

    function show(n) {
      if (String(n) !== '3') runId++; // quitter le diagnostic l'annule
      for (var i = 0; i < screens.length; i++) {
        screens[i].classList.toggle('active', screens[i].getAttribute('data-screen') === String(n));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (String(n) === '3') runChecks();
    }

    function check() {
      var value = oldEl.value;
      toScanEl.disabled = true;
      statusEl.className = 'status';
      if (!value.trim()) return;
      var cfg = extractConfig(value);
      if (!cfg) {
        statusEl.className = 'status bad';
        statusEl.textContent = "🤔 Je ne reconnais pas ce lien. Reprends l'étape 1 et copie bien tout le lien, du « https » jusqu'à « manifest.json ».";
        return;
      }
      currentCfg = cfg;
      currentObj = decodeObj(cfg);
      newUrl = location.origin + '/' + cfg + '/manifest.json';
      newUrlEl.textContent = newUrl;
      installEl.href = newUrl.replace(/^https?:\\/\\//, 'stremio://');
      var oldHost = hostOf(value);
      oldHostEl.textContent = oldHost && oldHost !== location.host.toLowerCase() ? oldHost : "l'ancienne adresse";
      statusEl.className = 'status ok';
      statusEl.textContent = oldHost === location.host.toLowerCase()
        ? '✅ Lien reconnu. Il utilise déjà la nouvelle adresse : tu peux quand même continuer.'
        : '✅ Lien reconnu ! Ta configuration est retrouvée. Clique sur « Lancer l\\'analyse ».';
      toScanEl.disabled = false;
    }

    // ---- Diagnostic ----
    var STATE_LABEL = { pending: '', run: 'EN COURS', ok: 'OK', warn: 'ATTENTION', bad: 'ÉCHEC', skip: 'IGNORÉ' };
    var CHECK_TITLES = { read: 'Lecture du lien', decode: 'Décodage de la configuration', server: 'Connexion au serveur', tmdb: 'Test de la clé TMDB' };

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
      verdictEl.className = 'verdict';
      verdictEl.textContent = '';
      setPct(0);
      ['read', 'decode', 'server', 'tmdb'].forEach(function (k) { setRow(k, 'pending', 'En attente…'); });
      toInstallEl.disabled = true;
      retryEl.disabled = true;
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
        verdictEl.textContent = '❌ Un point bloque. Relance l\\'analyse, ou reviens à l\\'étape 2.';
      }
      toInstallEl.disabled = worst === 'bad';
      retryEl.disabled = false;
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-go]') : null;
      if (!btn || btn.disabled) return;
      show(btn.getAttribute('data-go'));
    });
    retryEl.addEventListener('click', function () { if (!retryEl.disabled) runChecks(); });
    oldEl.addEventListener('input', check);
    oldEl.addEventListener('paste', function () { setTimeout(check, 0); });

    copyEl.addEventListener('click', function () {
      var done = function () { copyEl.textContent = 'Copié ✓'; setTimeout(function () { copyEl.textContent = 'Ou copier le lien'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(newUrl).then(done, function () {});
      else { var r = document.createRange(); r.selectNodeContents(newUrlEl); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderRecoveryHtml };
