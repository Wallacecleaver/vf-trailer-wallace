// Page publique /proposer : n'importe quel visiteur peut proposer le bon lien de
// bande-annonce pour un film/une série. La proposition part en "pending" et n'est
// appliquée que si l'admin l'accepte depuis l'onglet Demandes du dashboard.
// Reprend volontairement la charte de /configure (mêmes polices, glow, cartes).

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

function renderContributeHtml(s) {
    const settings = s || {};
    const brandName = settings.brandName || 'Bandes-Annonces VF/VO';
    const accent = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor || '') ? settings.accentColor : '#e53e3e';
    const accentDark = darkenHex(accent, 0.12);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="https://vf-trailer-off.vercel.app/logo_transparent_check.png">
  <title>${escapeHtml(brandName)} — Proposer un lien</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --red: ${accent}; --red-dark: ${accentDark}; --bg: #0a0a0b; --bg2: #111113; --bg3: #18181b;
      --border: rgba(255,255,255,0.06); --text: #f0f0f0; --muted: #666; --muted2: #444; --green: #48bb78;
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

    .hero { position: relative; z-index: 1; text-align: center; padding: 64px 40px 12px; }
    .hero-title { font-family: 'Bebas Neue', sans-serif; font-size: clamp(42px, 7vw, 68px); line-height: 0.95; letter-spacing: 3px; color: #fff; }
    .hero-title span { color: var(--red); }
    .hero-sub { font-size: 15px; color: var(--muted); max-width: 470px; margin: 18px auto 0; line-height: 1.6; font-weight: 300; }

    main { position: relative; z-index: 1; max-width: 620px; margin: 0 auto; padding: 0 24px 90px; }
    .section-header { display: flex; align-items: center; gap: 12px; margin: 38px 0 4px; }
    .section-line { flex: 1; height: 1px; background: var(--border); }
    .section-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; }

    .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-top: 12px; transition: opacity .25s, border-color .2s; }
    .card.locked { opacity: .45; pointer-events: none; }
    .locked-hint { display: none; font-size: 11.5px; color: var(--muted); margin-top: 10px; }
    .card.locked .locked-hint { display: block; }

    .field { margin-bottom: 18px; }
    .field:last-child { margin-bottom: 0; }
    .field label { display: block; font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 7px; }
    .field .hint { font-weight: 300; color: var(--muted); font-size: 11px; }
    input, textarea {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 11px 14px;
      color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; transition: border-color .2s;
    }
    input:focus, textarea:focus { outline: none; border-color: var(--red); }
    textarea { resize: vertical; min-height: 76px; line-height: 1.5; }

    .search-wrap { position: relative; }
    .results {
      display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); background: var(--bg3);
      border: 1px solid var(--border); border-radius: 10px; max-height: 300px; overflow-y: auto; z-index: 20;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    }
    .results.show { display: block; }
    .result-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; transition: background .15s; }
    .result-item:hover { background: rgba(255,255,255,0.04); }
    .result-item img, .result-item .ph { width: 34px; height: 50px; border-radius: 5px; object-fit: cover; background: var(--bg); flex-shrink: 0; }
    .result-item .t { font-size: 13.5px; font-weight: 600; }
    .result-item .y { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .results-empty { padding: 14px; font-size: 12.5px; color: var(--muted); text-align: center; }

    .picked { display: none; align-items: center; gap: 14px; padding: 12px 14px; background: var(--bg); border: 1px solid rgba(72,187,120,0.3); border-radius: 10px; }
    .picked.show { display: flex; }
    .picked img { width: 40px; height: 58px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
    .picked .info { flex: 1; min-width: 0; }
    .picked .t { font-size: 14px; font-weight: 700; }
    .picked .y { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
    .picked .imdb { font-family: 'Rajdhani', monospace; font-size: 11px; color: var(--muted2); margin-top: 3px; }
    .picked button {
      background: none; border: 1px solid var(--border); color: var(--muted); border-radius: 7px;
      padding: 6px 12px; font-size: 11.5px; font-family: 'DM Sans', sans-serif; cursor: pointer; flex-shrink: 0; transition: all .2s;
    }
    .picked button:hover { color: var(--text); border-color: var(--muted2); }

    .season-field { display: none; margin-top: 18px; }
    .season-field.show { display: block; }

    .link-check { display: none; align-items: center; gap: 7px; font-size: 12px; margin-top: 9px; }
    .link-check.show { display: flex; }
    .link-check.ok { color: #68d391; }
    .link-check.fail { color: #fc8181; }

    .btn {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px;
      border-radius: 9px; font-size: 14px; font-weight: 600; font-family: 'DM Sans', sans-serif;
      cursor: pointer; border: none; transition: all 0.2s; margin-top: 4px;
    }
    .btn-red { background: var(--red); color: #fff; }
    .btn-red:hover:not(:disabled) { background: var(--red-dark); transform: translateY(-1px); box-shadow: 0 4px 15px rgba(229,62,62,0.35); }
    .btn:disabled { opacity: .55; cursor: default; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { background: var(--bg3); }

    .msg { display: none; font-size: 12.5px; border-radius: 9px; padding: 11px 14px; margin-top: 14px; line-height: 1.5; }
    .msg.show { display: block; }
    .msg.error { background: rgba(229,62,62,0.08); border: 1px solid rgba(229,62,62,0.28); color: #fc8181; }

    .done { display: none; text-align: center; padding: 60px 24px; }
    .done.show { display: block; }
    .done .ico {
      width: 62px; height: 62px; margin: 0 auto 20px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; font-size: 26px;
      background: rgba(72,187,120,0.1); border: 1px solid rgba(72,187,120,0.3);
    }
    .done h2 { font-family: 'Bebas Neue', sans-serif; font-size: 30px; letter-spacing: 2px; margin-bottom: 10px; }
    .done p { font-size: 13.5px; color: var(--muted); line-height: 1.6; max-width: 380px; margin: 0 auto 24px; font-weight: 300; }
    .done .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .done .actions .btn { width: auto; padding: 11px 22px; }

    @media (max-width: 640px) {
      nav { padding: 0 16px; }
      .hero { padding: 44px 20px 8px; }
      main { padding: 0 14px 70px; }
      .card { padding: 20px; }
    }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--muted2); border-radius: 4px; }
  </style>
</head>
<body>
  <nav>
    <a href="/configure" class="nav-name">${escapeHtml(brandName)}</a>
    <a href="/configure" class="nav-link">← Retour à l'installation</a>
  </nav>

  <div class="hero">
    <h1 class="hero-title">Proposer un <span>lien</span></h1>
    <p class="hero-sub">Un titre n'a pas de bande-annonce, ou le lien actuel est cassé / pas en VF ? Propose le bon, on vérifie et on l'ajoute.</p>
  </div>

  <main>
    <div id="form-screen">
      <div class="section-header"><div class="section-line"></div><div class="section-label">Le titre concerné</div><div class="section-line"></div></div>
      <div class="card">
        <div class="field">
          <label>Cherche le film ou la série</label>
          <div class="search-wrap">
            <input type="text" id="q-search" placeholder="Ex: Dune, The Bear..." autocomplete="off">
            <div class="results" id="q-results"></div>
          </div>
          <div class="picked" id="q-picked" style="margin-top:4px">
            <img id="q-picked-img" src="" alt="" style="display:none">
            <div class="info">
              <div class="t" id="q-picked-title"></div>
              <div class="y" id="q-picked-year"></div>
              <div class="imdb" id="q-picked-imdb"></div>
            </div>
            <button type="button" onclick="resetPick()">Changer</button>
          </div>
          <div class="season-field" id="season-field">
            <label>Saison concernée <span class="hint">(laisse vide si ça concerne toute la série)</span></label>
            <input type="number" id="q-season" min="1" placeholder="Ex: 2">
          </div>
        </div>
      </div>

      <div class="section-header"><div class="section-line"></div><div class="section-label">Ta proposition</div><div class="section-line"></div></div>
      <div class="card locked" id="step2">
        <div class="field">
          <label>Le bon lien <span class="hint">(YouTube, Vimeo, Dailymotion, ou lien vidéo direct)</span></label>
          <input type="text" id="q-link" placeholder="https://www.youtube.com/watch?v=... ou tout autre lien vidéo" oninput="onLinkInput()">
          <div class="link-check" id="link-check"></div>
        </div>
        <div class="field">
          <label>Ton pseudo <span class="hint">(obligatoire)</span></label>
          <input type="text" id="q-pseudo" placeholder="Ton pseudo Discord" maxlength="40">
        </div>
        <div class="field">
          <label>Note <span class="hint">(optionnel)</span></label>
          <textarea id="q-notes" placeholder="Ex: l'ancien lien est privé, celui-ci est la bande-annonce officielle VF" maxlength="300"></textarea>
        </div>
        <button class="btn btn-red" id="submit-btn" onclick="submitContribution()">Envoyer la proposition</button>
        <div class="msg" id="form-error"></div>
        <div class="locked-hint">Choisis d'abord un titre ci-dessus pour débloquer cette étape.</div>
      </div>
    </div>

    <div class="done" id="done-screen">
      <div class="ico">✓</div>
      <h2>Proposition envoyée</h2>
      <p>Merci ! Elle part en vérification manuelle. Si elle est validée, le lien sera mis à jour pour tout le monde.</p>
      <div class="actions">
        <button class="btn btn-red" onclick="location.reload()">Proposer un autre lien</button>
        <a href="/configure" class="btn btn-outline">Retour à l'installation</a>
      </div>
    </div>
  </main>

<script>
  let picked = null;
  let searchTimer = null, searchSeq = 0, linkCheckTimer = null;

  document.getElementById('q-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = document.getElementById('q-search').value.trim();
    if (!q) { document.getElementById('q-results').classList.remove('show'); return; }
    searchTimer = setTimeout(() => runSearch(q), 350);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) document.getElementById('q-results').classList.remove('show');
  });

  async function runSearch(q) {
    const mySeq = ++searchSeq;
    const box = document.getElementById('q-results');
    try {
      const res = await fetch('/api/public/tmdb-search?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (mySeq !== searchSeq) return;
      if (!Array.isArray(data) || !data.length) {
        box.innerHTML = '<div class="results-empty">Aucun résultat</div>';
        box.classList.add('show');
        return;
      }
      window.__results = data;
      box.innerHTML = data.map((r, i) =>
        '<div class="result-item" onclick="pickResult(' + i + ')">' +
        (r.poster ? '<img src="' + r.poster + '" alt="">' : '<div class="ph"></div>') +
        '<div><div class="t">' + escapeHtml(r.title) + '</div><div class="y">' +
        (r.mediaType === 'tv' ? 'Série' : 'Film') + (r.year ? ' · ' + r.year : '') + '</div></div></div>'
      ).join('');
      box.classList.add('show');
    } catch (e) { /* silencieux */ }
  }

  async function pickResult(i) {
    const r = window.__results[i];
    document.getElementById('q-results').classList.remove('show');
    hideError();
    try {
      const res = await fetch('/api/public/tmdb-resolve?id=' + r.tmdbId + '&type=' + (r.mediaType === 'tv' ? 'tv' : 'movie'));
      const data = await res.json();
      if (!res.ok) { showError(data.error || "Impossible de récupérer l'identifiant de ce titre."); return; }
      picked = { imdbId: data.imdbId, title: r.title, year: r.year, mediaType: r.mediaType === 'tv' ? 'series' : 'movie' };
      document.getElementById('q-picked-title').textContent = r.title;
      document.getElementById('q-picked-year').textContent = (r.mediaType === 'tv' ? 'Série' : 'Film') + (r.year ? ' · ' + r.year : '');
      document.getElementById('q-picked-imdb').textContent = data.imdbId;
      const img = document.getElementById('q-picked-img');
      if (r.poster) { img.src = r.poster; img.style.display = 'block'; } else { img.style.display = 'none'; }
      document.getElementById('q-picked').classList.add('show');
      document.getElementById('q-search').style.display = 'none';
      document.getElementById('season-field').classList.toggle('show', picked.mediaType === 'series');
      document.getElementById('step2').classList.remove('locked');
      document.getElementById('q-link').focus();
    } catch (e) { showError('Erreur réseau, réessaie.'); }
  }

  function resetPick() {
    picked = null;
    document.getElementById('q-picked').classList.remove('show');
    const search = document.getElementById('q-search');
    search.style.display = 'block';
    search.value = '';
    search.focus();
    document.getElementById('q-season').value = '';
    document.getElementById('season-field').classList.remove('show');
    document.getElementById('step2').classList.add('locked');
  }

  function extractYoutubeId(input) {
    const s = (input || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/|v\\/|shorts\\/)|youtu\\.be\\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function onLinkInput() {
    clearTimeout(linkCheckTimer);
    const el = document.getElementById('link-check');
    el.className = 'link-check';
    const val = document.getElementById('q-link').value.trim();
    if (!val) return;
    linkCheckTimer = setTimeout(() => checkLink(val), 500);
  }

  const LINK_KIND_LABEL = { youtube: 'YouTube', vimeo: 'Vimeo', dailymotion: 'Dailymotion', direct: 'Lien direct' };

  async function checkLink(val) {
    const el = document.getElementById('link-check');
    const ytId = extractYoutubeId(val);
    const isUrl = /^https?:\\/\\//i.test(val);
    if (!ytId && !isUrl) {
      el.textContent = "Colle un lien YouTube, Vimeo, Dailymotion ou une URL vidéo directe";
      el.className = 'link-check show fail';
      return;
    }
    el.textContent = 'Vérification...';
    el.className = 'link-check show';
    try {
      const qs = ytId ? 'ytId=' + encodeURIComponent(ytId) : 'url=' + encodeURIComponent(val);
      const res = await fetch('/api/public/test-link?' + qs);
      const data = await res.json();
      const kindLabel = LINK_KIND_LABEL[data.kind] || '';
      if (data.ok) {
        el.textContent = '✓ ' + (kindLabel ? kindLabel + ' détecté' : 'Lien valide') + (data.title ? ' — ' + data.title : '');
        el.className = 'link-check show ok';
      } else {
        el.textContent = '✕ ' + (data.error || 'Lien invalide ou inaccessible');
        el.className = 'link-check show fail';
      }
    } catch (e) {
      el.textContent = 'Impossible de vérifier le lien pour le moment';
      el.className = 'link-check show';
    }
  }

  function showError(msg) {
    const box = document.getElementById('form-error');
    box.textContent = msg;
    box.className = 'msg show error';
  }
  function hideError() { document.getElementById('form-error').className = 'msg'; }

  async function submitContribution() {
    if (!picked) { showError('Choisis un titre avant de proposer un lien.'); return; }
    const link = document.getElementById('q-link').value.trim();
    const pseudo = document.getElementById('q-pseudo').value.trim();
    const notes = document.getElementById('q-notes').value.trim();
    const season = document.getElementById('q-season').value.trim();

    if (!link) { showError('Colle le lien de la bande-annonce.'); return; }
    if (!pseudo) { showError('Ton pseudo est obligatoire.'); return; }

    const ytId = extractYoutubeId(link);
    const url = ytId ? null : (/^https?:\\/\\//i.test(link) ? link : null);
    if (!ytId && !url) { showError("Le lien doit être une URL YouTube ou une URL directe valide."); return; }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Envoi...';
    hideError();

    try {
      const res = await fetch('/api/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imdbId: picked.imdbId,
          season: picked.mediaType === 'series' ? (season || null) : null,
          title: picked.title,
          mediaType: picked.mediaType,
          ytId, url, pseudo, notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Erreur lors de l'envoi, réessaie.");
        btn.disabled = false;
        btn.textContent = 'Envoyer la proposition';
        return;
      }
      document.getElementById('form-screen').style.display = 'none';
      document.getElementById('done-screen').classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showError('Erreur réseau, réessaie.');
      btn.disabled = false;
      btn.textContent = 'Envoyer la proposition';
    }
  }

  function escapeHtml(s) {
    return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Arrivée depuis le flux "➕ Proposer" de l'addon (voir buildProposeLinkStream côté
  // index.js) : l'IMDB ID est déjà connu, inutile de refaire chercher le titre -- on saute
  // direct à l'étape 2 avec le titre/type/saison déjà remplis.
  function applyPrefillFromUrl() {
    const params = new URLSearchParams(location.search);
    const imdbId = params.get('imdbId');
    if (!imdbId || !/^tt\d{6,9}$/.test(imdbId)) return;

    const title = params.get('title') || imdbId;
    const mediaType = params.get('type') === 'series' ? 'series' : 'movie';
    const season = params.get('season') || '';

    picked = { imdbId, title, year: null, mediaType };
    document.getElementById('q-picked-title').textContent = title;
    document.getElementById('q-picked-year').textContent = mediaType === 'series' ? 'Série' : 'Film';
    document.getElementById('q-picked-imdb').textContent = imdbId;
    document.getElementById('q-picked-img').style.display = 'none';
    document.getElementById('q-picked').classList.add('show');
    const search = document.getElementById('q-search');
    search.style.display = 'none';
    search.value = title;
    if (season) document.getElementById('q-season').value = season;
    document.getElementById('season-field').classList.toggle('show', mediaType === 'series');
    document.getElementById('step2').classList.remove('locked');
    document.getElementById('q-link').focus();
  }
  applyPrefillFromUrl();
</script>
</body>
</html>`;
}

module.exports = { renderContributeHtml };