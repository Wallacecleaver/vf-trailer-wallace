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
      if (!res.ok) { box.innerHTML = `<div class="tmdb-empty">${escapeHtml(data.error || 'Erreur de recherche')}</div>`; return; }
      if (!data.length) { box.innerHTML = '<div class="tmdb-empty">Aucun résultat</div>'; return; }
      box.innerHTML = data.map((r, i) => `
        <div class="tmdb-result-item" onclick="pickTmdbResult(${i})">
          ${r.poster ? `<img class="tmdb-result-poster" src="${r.poster}" alt="">` : '<div class="tmdb-result-poster empty">🎬</div>'}
          <div class="tmdb-result-info">
            <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
            <div class="tmdb-result-meta">${r.mediaType === 'tv' ? 'Série' : 'Film'}${r.year ? ' · ' + r.year : ''}</div>
          </div>
        </div>
      `).join('');
      window._tmdbLastResults = data;
    } catch (e) {
      if (seq === tmdbSearchSeq) box.innerHTML = '<div class="tmdb-empty">Erreur de recherche</div>';
    }
  }

  async function pickTmdbResult(i) {
    const r = (window._tmdbLastResults || [])[i];
    if (!r) return;
    const box = document.getElementById('tmdb-results');
    box.innerHTML = '<div class="tmdb-loading">Récupération de l\'IMDB ID...</div>';
    try {
      const res = await fetch(`/api/tmdb-resolve?id=${r.tmdbId}&type=${r.mediaType}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.imdbId) { toast('❌ IMDB ID introuvable pour ce titre'); box.classList.remove('show'); return; }
      document.getElementById('ov-imdb').value = data.imdbId;
      document.getElementById('ov-mediatype').value = r.mediaType;
      if (!document.getElementById('ov-title').value.trim()) document.getElementById('ov-title').value = r.title;
      document.getElementById('tmdb-search').value = `${r.title}${r.year ? ' (' + r.year + ')' : ''}`;
      box.classList.remove('show');
      checkDuplicateOverride();
      toast(`✅ ${r.mediaType === 'tv' ? 'Série' : 'Film'} trouvé${r.mediaType === 'tv' ? 'e' : ''} — IMDB ID rempli`);
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
      box.innerHTML = data.map((r, i) => `
        <div class="tmdb-result-item" onclick="pickYtResult(${i})">
          ${r.thumb ? `<img class="tmdb-result-poster" src="${r.thumb}" alt="" style="height:32px;width:44px">` : '<div class="tmdb-result-poster empty">🎬</div>'}
          <div class="tmdb-result-info">
            <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
            <div class="tmdb-result-meta">${escapeHtml(r.channel || '')}${r.duration ? ' · ' + escapeHtml(r.duration) : ''}</div>
          </div>
        </div>
      `).join('');
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
    box.innerHTML = overrideLinks.map((l, i) => `
      <div class="fallback-item" data-i="${i}">
        <input class="fallback-yt" value="${escapeAttr(l.ytId || '')}" placeholder="YouTube ID" oninput="updateFallbackLink(${i}, 'ytId', this.value)">
        <input class="fallback-url" value="${escapeAttr(l.url || '')}" placeholder="OU URL directe" oninput="updateFallbackLink(${i}, 'url', this.value)">
        <span class="fallback-status" id="fallback-status-${i}"></span>
        <button class="fallback-remove" onclick="removeFallbackLink(${i})">✕</button>
      </div>
    `).join('');
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
        el.textContent = data.ok ? (data.media === 'hls' ? '✅ Flux HLS (.m3u8) jouable' : data.media === 'mp4' ? '✅ Vidéo MP4 jouable' : '✅ Lien jouable') : '❌ ' + (data.error || 'Lien injoignable');
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
    out.title = details.join('\n');
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
    const m = s.match(/tt\d{6,9}/);
    return m ? m[0] : s;
  }

  function extractYoutubeId(input) {
    const s = (input || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s; // déjà un ID nu
    const m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
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
    if (!/^tt\d{6,9}$/.test(imdbId)) return;
    const titleEl = document.getElementById('ov-title');
    const mediaTypeEl = document.getElementById('ov-mediatype');
    if (titleEl.value.trim()) return; // un titre déjà tapé à la main ne doit jamais être écrasé

    const seq = ++imdbLookupSeq;
    try {
      const res = await fetch(`/api/tmdb-lookup?imdbId=${imdbId}`, { headers: authHeaders() });
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
      const res = await fetch(`/api/youtube-title?id=${ytId}`, { headers: authHeaders() });
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
      warn.textContent = `⚠️ Un override existe déjà pour ${imdbId}${season ? ' (saison ' + season + ')' : ''} — l'enregistrer va le remplacer.`;
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
      thumb.src = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
      name.textContent = title || 'Bande-annonce';
      meta.textContent = `YouTube · ${ytId}`;
    } else if (url && !document.getElementById('ov-hidden').checked) {
      wrap.classList.add('show');
      thumb.src = '';
      name.textContent = title || 'Bande-annonce';
      meta.textContent = `Flux direct · ${url}`;
    } else {
      wrap.classList.remove('show');
    }
    if (imdb && imdb.trim()) {
      name.textContent = title || name.textContent;
      meta.textContent = `${meta.textContent ? meta.textContent + ' · ' : ''}${imdb}${season ? ' (saison ' + season + ')' : ''}`;
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
    } else if (url && /^https?:\/\//.test(url)) {
      body.innerHTML = `<video src="${escapeAttr(url)}" controls autoplay></video>`;
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

