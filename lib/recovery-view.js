// Page publique /recuperation : aide les utilisateurs à migrer leur addon après un
// changement de domaine. La config (clé TMDB, pseudo, options) est encodée dans l'URL du
// manifest elle-même (segment base64url) : il n'y a donc RIEN à chercher en base. Le
// navigateur extrait ce segment de l'ancienne URL collée et le recolle derrière le domaine
// courant. Tout se passe côté client -- l'ancienne URL (qui contient la clé TMDB) n'est
// jamais envoyée au serveur.
// Présentation : écran d'accueil (3 cartes + encart "Comment ça marche ?") puis assistant
// en 4 étapes très guidées, une seule action par écran. Reprend la charte de /configure.

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
      --border: rgba(255,255,255,0.07); --text: #f0f0f0; --muted: #9a9aa2; --muted2: #55555c; --green: #48bb78;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; min-height: 100vh; overflow-x: hidden; }
    body::before {
      content: ''; position: fixed; top: -200px; left: 50%; transform: translateX(-50%);
      width: 800px; height: 600px; background: radial-gradient(ellipse, rgba(229,62,62,0.08) 0%, transparent 70%);
      pointer-events: none; z-index: 0;
    }
    nav {
      position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between;
      padding: 0 40px; height: 60px; background: rgba(10,10,11,0.85); backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }
    .nav-name { font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 2px; color: #fff; text-transform: uppercase; text-decoration: none; }
    .nav-link {
      padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border); color: var(--muted);
      font-size: 13px; text-decoration: none; transition: all 0.2s;
    }
    .nav-link:hover { color: var(--text); border-color: var(--muted2); background: var(--bg3); }

    main { position: relative; z-index: 1; display: flex; justify-content: center; padding: 36px 16px 80px; }
    .panel { width: 100%; max-width: 680px; background: var(--bg2); border: 1px solid var(--border); border-radius: 22px; padding: 34px 34px 28px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); }
    .eyebrow { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #63b3ed; margin-bottom: 14px; }
    .eyebrow::before { content: ''; width: 26px; height: 2px; background: linear-gradient(90deg, transparent, #63b3ed); }
    h1 { font-size: clamp(24px, 4.6vw, 32px); font-weight: 700; line-height: 1.2; margin-bottom: 12px; }
    .lead { color: var(--muted); font-size: 15.5px; line-height: 1.65; }
    .lead b { color: var(--text); font-weight: 600; }

    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0 18px; }
    .feature { background: var(--bg3); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
    .feature h3 { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
    .feature p { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .callout { border-left: 3px solid var(--red); background: linear-gradient(90deg, rgba(229,62,62,0.10), transparent); border-radius: 4px 12px 12px 4px; padding: 14px 18px; color: var(--muted); font-size: 14px; line-height: 1.6; }
    .callout b { color: var(--text); }
    .divider { height: 1px; background: var(--border); margin: 24px 0 20px; }

    .footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .footer.end { justify-content: flex-end; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 26px;
      border-radius: 12px; border: 1px solid var(--border); background: var(--bg3); color: var(--text);
      font-family: inherit; font-size: 15px; font-weight: 700; cursor: pointer; text-decoration: none; transition: all 0.2s;
    }
    .btn:hover:not(:disabled) { border-color: var(--muted2); }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn-primary { background: var(--red); border-color: var(--red); color: #fff; box-shadow: 0 8px 24px rgba(229,62,62,0.28); }
    .btn-primary:hover:not(:disabled) { background: var(--red-dark); border-color: var(--red-dark); }
    .btn-ghost { background: transparent; color: var(--muted); font-weight: 600; padding: 13px 16px; }
    .btn-big { width: 100%; padding: 17px 24px; font-size: 17px; }

    /* Assistant */
    .progress { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
    .dot { flex: 1; height: 5px; border-radius: 99px; background: var(--bg3); transition: background 0.3s; }
    .dot.on { background: var(--red); }
    .progress-label { font-size: 12px; color: var(--muted); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }

    .todo { list-style: none; margin: 22px 0 6px; display: flex; flex-direction: column; gap: 12px; }
    .todo li { display: flex; align-items: flex-start; gap: 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; font-size: 15.5px; line-height: 1.5; }
    .todo .n { flex: 0 0 32px; height: 32px; border-radius: 50%; background: var(--red); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
    .todo b { color: #fff; }
    .tag { display: inline-block; background: rgba(255,255,255,0.08); border-radius: 6px; padding: 1px 8px; font-weight: 600; color: #fff; white-space: nowrap; }
    .tip { color: var(--muted); font-size: 13px; line-height: 1.55; margin-top: 14px; }

    textarea {
      width: 100%; min-height: 120px; resize: vertical; margin-top: 20px; background: var(--bg); border: 2px dashed var(--muted2); border-radius: 14px;
      color: var(--text); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; padding: 14px; line-height: 1.5; outline: none; word-break: break-all;
    }
    textarea:focus { border-color: var(--red); border-style: solid; }
    .status { display: none; margin-top: 14px; padding: 12px 16px; border-radius: 12px; font-size: 14.5px; font-weight: 600; line-height: 1.5; }
    .status.ok { display: block; background: rgba(72,187,120,0.12); color: var(--green); border: 1px solid rgba(72,187,120,0.3); }
    .status.bad { display: block; background: rgba(252,129,129,0.10); color: #fc8181; border: 1px solid rgba(252,129,129,0.3); }

    .result { margin-top: 18px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; word-break: break-all; color: var(--muted); }
    .stack { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }

    .party { text-align: center; padding: 10px 0 4px; }
    .party .big { font-size: 64px; line-height: 1; margin-bottom: 14px; }

    .screen { display: none; }
    .screen.active { display: block; animation: fade 0.25s ease; }
    @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    @media (max-width: 600px) {
      nav { padding: 0 16px; }
      .panel { padding: 24px 18px 20px; border-radius: 18px; }
      .features { grid-template-columns: 1fr; }
      .btn { padding: 13px 18px; }
    }
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
        <p class="lead">L'adresse de l'addon <b>${escapeHtml(brandName)}</b> n'est plus la même. Cette page récupère ton <b>ancien lien</b> et en fabrique un <b>nouveau</b> : tu gardes ta configuration, sans rien retaper.</p>

        <div class="features">
          <div class="feature"><h3>🔗 Tu colles</h3><p>Ton ancien lien, copié depuis Stremio.</p></div>
          <div class="feature"><h3>✨ On convertit</h3><p>Le nouveau lien est prêt en un clic, avec ta config.</p></div>
          <div class="feature"><h3>🔒 Privé</h3><p>Tout se passe dans ton navigateur. Rien n'est envoyé.</p></div>
        </div>

        <div class="callout"><b>Comment ça marche ?</b> 4 petites étapes, environ 1 minute. Tu n'as rien à taper : juste copier, coller et cliquer.</div>

        <div class="divider"></div>
        <div class="footer end"><button class="btn btn-primary" data-go="1" type="button">Commencer →</button></div>
      </section>

      <!-- Étape 1 : copier -->
      <section class="screen" data-screen="1">
        <div class="progress-label">Étape 1 sur 4</div>
        <div class="progress"><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <h1>Copie ton ancien lien 📋</h1>
        <p class="lead">On commence dans <b>Stremio</b>. Ouvre l'application, puis suis les 3 petits gestes :</p>
        <ol class="todo">
          <li><span class="n">1</span><span>Clique sur la pièce de puzzle 🧩 <b>« Addons »</b> dans le menu à gauche.</span></li>
          <li><span class="n">2</span><span>Clique sur la ligne <span class="tag">W Bandes-Annonces VF</span>. Une fenêtre s'ouvre.</span></li>
          <li><span class="n">3</span><span>Fais un <b>triple-clic</b> sur le long lien pour tout sélectionner, puis appuie sur <span class="tag">Ctrl</span> + <span class="tag">C</span> (sur Mac : <span class="tag">⌘</span> + <span class="tag">C</span>).</span></li>
        </ol>
        <p class="tip">Sur téléphone : reste appuyé sur le lien, puis choisis « Copier ». Pas de panique si la fenêtre propose « Désinstaller » : ne clique pas dessus tout de suite.</p>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="0" type="button">← Retour</button>
          <button class="btn btn-primary" data-go="2" type="button">C'est copié →</button>
        </div>
      </section>

      <!-- Étape 2 : coller -->
      <section class="screen" data-screen="2">
        <div class="progress-label">Étape 2 sur 4</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot"></span><span class="dot"></span></div>
        <h1>Colle-le ici 👇</h1>
        <p class="lead">Clique dans la case ci-dessous, puis appuie sur <span class="tag">Ctrl</span> + <span class="tag">V</span> (sur Mac : <span class="tag">⌘</span> + <span class="tag">V</span>). C'est tout.</p>
        <textarea id="old" spellcheck="false" autocomplete="off" placeholder="Colle ton lien ici (il ressemble à https://…/eyJ…/manifest.json)"></textarea>
        <div class="status" id="status"></div>
        <p class="tip">🔒 Ce lien contient ta clé TMDB. Il reste dans ton navigateur : il n'est jamais envoyé au serveur.</p>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="1" type="button">← Retour</button>
          <button class="btn btn-primary" id="toInstall" data-go="3" type="button" disabled>Suivant →</button>
        </div>
      </section>

      <!-- Étape 3 : installer -->
      <section class="screen" data-screen="3">
        <div class="progress-label">Étape 3 sur 4</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot"></span></div>
        <h1>Ton nouveau lien est prêt ✨</h1>
        <p class="lead">Clique sur le gros bouton : Stremio s'ouvre et te propose d'installer l'addon. Il te reste à cliquer sur <span class="tag">Installer</span>.</p>
        <div class="stack">
          <a class="btn btn-primary btn-big" id="install" href="#">Installer dans Stremio</a>
          <button class="btn btn-big" id="copy" type="button">Ou copier le lien</button>
        </div>
        <div class="result" id="newUrl"></div>
        <p class="tip">Si rien ne s'ouvre, copie le lien, puis dans Stremio : Addons → <span class="tag">Ajouter un addon</span> → colle le lien → Installer.</p>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="2" type="button">← Retour</button>
          <button class="btn btn-primary" data-go="4" type="button">C'est installé →</button>
        </div>
      </section>

      <!-- Étape 4 : supprimer l'ancien -->
      <section class="screen" data-screen="4">
        <div class="progress-label">Étape 4 sur 4</div>
        <div class="progress"><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span><span class="dot on"></span></div>
        <h1>Supprime l'ancien 🧹</h1>
        <p class="lead">Il y a maintenant <b>deux fois</b> le même addon dans Stremio. On enlève le vieux pour éviter les doublons :</p>
        <ol class="todo">
          <li><span class="n">1</span><span>Dans <b>Addons</b>, clique sur un des deux <span class="tag">W Bandes-Annonces VF</span>.</span></li>
          <li><span class="n">2</span><span>Regarde le lien affiché. S'il contient <span class="tag" id="oldHost">l'ancienne adresse</span>, c'est le <b>vieux</b>.</span></li>
          <li><span class="n">3</span><span>Clique sur <span class="tag">Désinstaller</span>. Si c'est le nouveau, clique sur « Annuler » et essaie l'autre.</span></li>
        </ol>
        <div class="divider"></div>
        <div class="footer">
          <button class="btn btn-ghost" data-go="3" type="button">← Retour</button>
          <button class="btn btn-primary" data-go="5" type="button">J'ai terminé ✓</button>
        </div>
      </section>

      <!-- Fin -->
      <section class="screen" data-screen="5">
        <div class="party">
          <div class="big">🎉</div>
          <h1>Bravo, c'est terminé !</h1>
          <p class="lead">Ton addon fonctionne avec la <b>nouvelle adresse</b> et ta configuration d'avant. Tu peux fermer cette page et profiter de tes bandes-annonces.</p>
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
      try {
        var b64 = candidate.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        var bin = atob(b64);
        var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
        var obj = JSON.parse(new TextDecoder().decode(bytes));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      } catch (e) { return null; }
      return candidate;
    }

    // Domaine de l'URL collée (pour savoir si c'est déjà la bonne adresse).
    function hostOf(input) {
      var raw = String(input || '').trim().replace(/^[a-z][a-z0-9+.-]*:\\/\\//i, '');
      return raw.split('/')[0].toLowerCase();
    }

    var screens = document.querySelectorAll('.screen');
    var oldEl = document.getElementById('old');
    var statusEl = document.getElementById('status');
    var nextEl = document.getElementById('toInstall');
    var newUrlEl = document.getElementById('newUrl');
    var installEl = document.getElementById('install');
    var copyEl = document.getElementById('copy');
    var oldHostEl = document.getElementById('oldHost');
    var newUrl = '';

    function show(n) {
      for (var i = 0; i < screens.length; i++) {
        screens[i].classList.toggle('active', screens[i].getAttribute('data-screen') === String(n));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function check() {
      var value = oldEl.value;
      nextEl.disabled = true;
      statusEl.className = 'status';
      if (!value.trim()) return;
      var cfg = extractConfig(value);
      if (!cfg) {
        statusEl.className = 'status bad';
        statusEl.textContent = "🤔 Je ne reconnais pas ce lien. Reprends l'étape 1 et copie bien tout le lien, du « https » jusqu'à « manifest.json ».";
        return;
      }
      newUrl = location.origin + '/' + cfg + '/manifest.json';
      newUrlEl.textContent = newUrl;
      installEl.href = newUrl.replace(/^https?:\\/\\//, 'stremio://');
      var oldHost = hostOf(value);
      oldHostEl.textContent = oldHost && oldHost !== location.host.toLowerCase() ? oldHost : "l'ancienne adresse";
      statusEl.className = 'status ok';
      statusEl.textContent = oldHost === location.host.toLowerCase()
        ? '✅ Lien reconnu. Il utilise déjà la nouvelle adresse : tu peux quand même continuer.'
        : '✅ Lien reconnu ! Ta configuration est retrouvée. Clique sur « Suivant ».';
      nextEl.disabled = false;
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-go]') : null;
      if (!btn || btn.disabled) return;
      show(btn.getAttribute('data-go'));
    });
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
