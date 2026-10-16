// Page publique /recuperation : aide les utilisateurs à migrer leur addon après un
// changement de domaine. La config (clé TMDB, pseudo, options) est encodée dans l'URL du
// manifest elle-même (segment base64url) : il n'y a donc RIEN à chercher en base. Le
// navigateur extrait ce segment de l'ancienne URL collée et le recolle derrière le domaine
// courant. Tout se passe côté client -- l'ancienne URL (qui contient la clé TMDB) n'est
// jamais envoyée au serveur.
// Reprend volontairement la charte de /configure et /proposer.

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
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --red: ${accent}; --red-dark: ${accentDark}; --bg: #0a0a0b; --bg2: #111113; --bg3: #18181b;
      --border: rgba(255,255,255,0.06); --text: #f0f0f0; --muted: #888; --muted2: #444; --green: #48bb78;
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
    .nav-link {
      display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px;
      border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 13px;
      text-decoration: none; transition: all 0.2s;
    }
    .nav-link:hover { color: var(--text); border-color: var(--muted2); background: var(--bg3); }

    .hero { position: relative; z-index: 1; text-align: center; padding: 64px 24px 12px; }
    .hero-title { font-family: 'Bebas Neue', sans-serif; font-size: clamp(42px, 7vw, 68px); line-height: 0.95; letter-spacing: 3px; color: #fff; }
    .hero-title span { color: var(--red); }
    .hero-sub { margin: 18px auto 0; max-width: 520px; color: var(--muted); font-size: 15px; line-height: 1.6; }

    main { position: relative; z-index: 1; max-width: 640px; margin: 32px auto 80px; padding: 0 20px; }
    .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 18px; }
    .card h2 { font-family: 'Rajdhani', sans-serif; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
    textarea, .result {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      color: var(--text); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; padding: 12px 14px;
      line-height: 1.5; word-break: break-all;
    }
    textarea { resize: vertical; min-height: 92px; outline: none; }
    textarea:focus { border-color: var(--red); }
    .hint { color: var(--muted); font-size: 12px; margin-top: 8px; line-height: 1.5; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 20px;
      border-radius: 10px; border: 1px solid var(--border); background: var(--bg3); color: var(--text);
      font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: all 0.2s;
    }
    .btn:hover { border-color: var(--muted2); }
    .btn-primary { background: var(--red); border-color: var(--red); color: #fff; }
    .btn-primary:hover { background: var(--red-dark); border-color: var(--red-dark); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    #convert { margin-top: 14px; width: 100%; }
    .error { display: none; margin-top: 12px; color: #fc8181; font-size: 13px; line-height: 1.5; }
    #out { display: none; }
    .ok { color: var(--green); font-size: 13px; font-weight: 600; margin-bottom: 12px; }
    ol { padding-left: 20px; color: var(--muted); font-size: 14px; line-height: 1.8; }
    ol b { color: var(--text); }
    @media (max-width: 560px) { nav { padding: 0 16px; } }
  </style>
</head>
<body>
  <nav>
    <a class="nav-name" href="/configure">${escapeHtml(brandName)}</a>
    <a class="nav-link" href="/configure">Configurer</a>
  </nav>

  <section class="hero">
    <h1 class="hero-title">RÉCUPÉRER<br><span>MON ADDON</span></h1>
    <p class="hero-sub">L'adresse de l'addon a changé. Colle ton ancien lien ci-dessous : on te génère le nouveau avec ta configuration, sans rien ressaisir.</p>
  </section>

  <main>
    <div class="card">
      <h2>Étape 1 — Ton ancien lien</h2>
      <label for="old">Ancienne URL de l'addon</label>
      <textarea id="old" spellcheck="false" autocomplete="off" placeholder="https://ancien-domaine.app/eyJ…/manifest.json"></textarea>
      <p class="hint">Dans Stremio : Addons → clique sur « W Bandes-Annonces VF » → copie l'URL affichée. Tout est traité dans ton navigateur : ce lien (qui contient ta clé TMDB) n'est pas envoyé au serveur.</p>
      <button class="btn btn-primary" id="convert" type="button">Générer mon nouveau lien</button>
      <p class="error" id="err"></p>
    </div>

    <div class="card" id="out">
      <h2>Étape 2 — Ton nouveau lien</h2>
      <p class="ok">✓ Configuration retrouvée</p>
      <div class="result" id="newUrl"></div>
      <div class="actions">
        <a class="btn btn-primary" id="install" href="#">Installer dans Stremio</a>
        <button class="btn" id="copy" type="button">Copier le lien</button>
      </div>
      <p class="hint" style="margin-top:16px">Pense à <b>désinstaller l'ancienne version</b> de l'addon dans Stremio pour éviter les doublons.</p>
    </div>

    <div class="card">
      <h2>En résumé</h2>
      <ol>
        <li>Copie l'<b>ancienne URL</b> de l'addon dans Stremio.</li>
        <li>Colle-la ici et génère le <b>nouveau lien</b>.</li>
        <li><b>Désinstalle</b> l'ancien addon, puis installe le nouveau.</li>
      </ol>
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

    var oldEl = document.getElementById('old');
    var errEl = document.getElementById('err');
    var outEl = document.getElementById('out');
    var newUrlEl = document.getElementById('newUrl');
    var installEl = document.getElementById('install');
    var copyEl = document.getElementById('copy');

    function convert() {
      var cfg = extractConfig(oldEl.value);
      if (!cfg) {
        outEl.style.display = 'none';
        errEl.textContent = "Lien non reconnu. Colle l'URL complète de l'addon, celle qui ressemble à https://…/eyJ…/manifest.json.";
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      var url = location.origin + '/' + cfg + '/manifest.json';
      newUrlEl.textContent = url;
      installEl.href = url.replace(/^https?:\\/\\//, 'stremio://');
      outEl.style.display = 'block';
      outEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.getElementById('convert').addEventListener('click', convert);
    oldEl.addEventListener('paste', function () { setTimeout(convert, 0); });
    copyEl.addEventListener('click', function () {
      var text = newUrlEl.textContent;
      var done = function () { copyEl.textContent = 'Copié ✓'; setTimeout(function () { copyEl.textContent = 'Copier le lien'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
      else { var r = document.createRange(); r.selectNodeContents(newUrlEl); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderRecoveryHtml };
