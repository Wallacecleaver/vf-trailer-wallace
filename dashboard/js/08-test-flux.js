  // ---- TEST DES FLUX ----
  const SOURCE_LABELS = {
    tmdb: 'TMDB',
    allocine: 'Allociné',
    youtube_search: 'YouTube (recherche)',
    netflix_catalogue: 'Stockage BD',
    override: 'Override manuel',
  };
  const TRACE_STEP_LABELS = {
    override: 'Override',
    'tmdb-find': 'TMDB find',
    'tmdb-meta': 'Titre & titres alt.',
    'tmdb-videos': 'TMDB vidéos',
    'tmdb-pick': 'Sélection',
    'tmdb-complement': 'Complément (pas de bande-annonce TMDB)',
    allocine: 'Allociné',
    'youtube-search': 'YouTube (recherche)',
    'netflix-catalogue': 'Stockage BD',
  };
  let tsLast = null; // dernier résultat de test : { imdbId, season, type, streams }

  let tsPreviewData = null;
  let tsSelectedMedia = null;
  let tsTestSeq = 0;

  function updateTsPreviewMedia(context, officialTitle) {
    const box = document.getElementById('ts-preview-media');
    const poster = document.getElementById('ts-preview-poster');
    const fallback = document.getElementById('ts-preview-poster-fallback');
    box.hidden = !context;
    if (!context) {
      document.getElementById('ts-preview-type').textContent = 'Film / Série';
      poster.hidden = true;
      poster.removeAttribute('src');
      return;
    }
    const type = context.type === 'series' ? 'Série' : 'Film';
    const media = context.media || {};
    document.getElementById('ts-preview-type').textContent = type;
    document.getElementById('ts-preview-media-title').textContent = officialTitle || media.title || context.imdbId;
    document.getElementById('ts-preview-media-meta').textContent = [
      type, media.year, context.type === 'series' && context.season ? 'Saison ' + context.season : null, context.imdbId,
    ].filter(Boolean).join(' · ');
    const posterUrl = typeof media.poster === 'string' && /^https:\/\/image\.tmdb\.org\/t\/p\/[a-zA-Z0-9_/.-]+$/.test(media.poster) ? media.poster : '';
    poster.hidden = !posterUrl;
    fallback.hidden = !!posterUrl;
    fallback.textContent = context.type === 'series' ? '📺' : '🎬';
    if (posterUrl) poster.src = posterUrl;
    else poster.removeAttribute('src');
  }

  function showTsPreviewMessage(message, loading = false) {
    const list = document.getElementById('ts-preview-list');
    list.setAttribute('aria-busy', String(loading));
    list.innerHTML = '<div class="ts-preview-state' + (loading ? ' is-loading' : '') + '">' + escapeHtml(message) + '</div>';
    document.getElementById('ts-preview-display').disabled = true;
    document.getElementById('ts-preview-note').textContent = '';
  }

  function renderTsStremioPreview() {
    if (!tsPreviewData) {
      updateTsPreviewMedia(null);
      showTsPreviewMessage('Lance un test pour voir les liens tels qu’ils apparaissent dans Stremio.');
      return;
    }
    const data = tsPreviewData.data;
    updateTsPreviewMedia(tsPreviewData.context, data.officialTitle);
    if (data.error) { showTsPreviewMessage(data.error); return; }
    if (!data.streams || !data.streams.length) {
      showTsPreviewMessage(data.hidden ? 'Ce titre est masqué par un override.' : 'Aucun lien trouvé pour ce test.');
      if (data.aiom) document.getElementById('ts-preview-note').textContent = 'AIOMetadata conserverait la bande-annonce de son fournisseur.';
      return;
    }
    const select = document.getElementById('ts-preview-display');
    select.disabled = !!data.aiom || !data.preview;
    if (select.disabled) select.value = 'default';
    const mode = ['default', 'compact', 'detailed'].includes(select.value) ? select.value : 'default';
    const streams = data.preview && data.preview[mode] || data.streams;
    const list = document.getElementById('ts-preview-list');
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = streams.map((stream, i) =>
      '<button type="button" class="ts-preview-row" onclick="playStream(' + i + ')" aria-label="Lire le lien ' + (i + 1) + '">' +
      '<span class="ts-preview-name">' + escapeHtml(stream.name || '🎬 VF') + '</span>' +
      '<span class="ts-preview-title">' + escapeHtml(stream.title || '') + '</span>' +
      '</button>'
    ).join('');
    document.getElementById('ts-preview-note').textContent = (data.aiom ? 'Vue AIOMetadata · ' : '') +
      streams.length + ' lien' + (streams.length > 1 ? 's' : '') + ' · Clique sur un lien pour le lire dans le testeur.';
  }


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
    if (!/^tt\d{6,9}$/.test(imdbId)) { badge.classList.remove('show'); return; }
    try {
      if (!tsOverridesCache || Date.now() - tsOverridesCacheAt > 60000) {
        const res = await authFetch('/api/overrides', { headers: authHeaders() });
        if (!res.ok) { if (res.status === 401) return; return; }
        tsOverridesCache = await res.json();
        tsOverridesCacheAt = Date.now();
      }
      const match = (tsOverridesCache || []).some(o => o.imdbId === imdbId && String(o.season || '') === String(season || ''));
      badge.classList.toggle('show', match);
    } catch (e) { /* pas bloquant */ }
  }

  function resetTsForm() {
    ++tsTestSeq;
    ++testTmdbSearchSeq;
    clearTimeout(testTmdbSearchTimer);
    tsLast = null;
    tsSelectedMedia = null;
    tsPreviewData = null;
    document.getElementById('ts-btn').disabled = false;
    document.getElementById('ts-btn').textContent = '🔬 Tester';
    document.getElementById('test-tmdb-results').classList.remove('show');
    renderTsStremioPreview();
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

    if (!/^tt\d{6,9}$/.test(imdbId)) { toast('❌ IMDB ID invalide (doit ressembler à tt15239678)'); return; }

    const request = ++tsTestSeq;
    const media = tsSelectedMedia && tsSelectedMedia.imdbId === imdbId && tsSelectedMedia.type === type ? tsSelectedMedia : null;
    const context = { imdbId, type, season: season || null, media };
    const out = document.getElementById('ts-result');
    tsLast = null;
    tsPreviewData = null;
    updateTsPreviewMedia(context);
    showTsPreviewMessage('Recherche des bandes-annonces…', true);
    btn.disabled = true;
    btn.textContent = '...';
    out.innerHTML = '<div class="ts-loading"><div class="ts-eq"><span></span><span></span><span></span><span></span><span></span></div><div class="lbl">résolution en cours…</div></div>';

    try {
      const res = await authFetch('/api/test-resolve', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type, imdbId, season: season || null, ignoreOverride, aiom }),
      });
      if (request !== tsTestSeq) return;
      if (!res.ok) {
        if (res.status !== 401) out.innerHTML = '<div class="info-box">❌ Le serveur est temporairement indisponible. Réessaie.</div>';
        showTsPreviewMessage('Le test est indisponible pour le moment. Réessaie.');
        return;
      }
      const data = await res.json();
      if (request !== tsTestSeq) return;
      renderStreamTestResult(data, imdbId, season || null, type, context);
    } catch (e) {
      if (request !== tsTestSeq) return;
      out.innerHTML = '<div class="info-box" style="color:var(--accent)">❌ Erreur réseau : ' + escapeHtml(e.message) + '</div>';
      showTsPreviewMessage('Impossible de charger les liens. Réessaie.');
    } finally {
      if (request === tsTestSeq) {
        btn.disabled = false;
        btn.textContent = '🔬 Tester';
      }
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

  function renderStreamTestResult(data, imdbId, season, type, context) {
    const out = document.getElementById('ts-result');
    tsLast = { imdbId, season, type, streams: data.streams || [] };
    tsPreviewData = { data, context: context || { imdbId, season, type } };
    renderTsStremioPreview();
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
    return String(t).replace(/\(ouvrir dans YouTube\)/g, '').replace(/\n/g, ' ').trim();
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
    } else if (url && /^https?:\/\//.test(url)) {
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
    toast('ℹ️ Lien préaffiché — enregistre pour créer l\'override');
  }

  // ---- TEST DES FLUX — recherche TMDB (même principe que le formulaire Mapping) ----
  let testTmdbSearchTimer = null;
  let testTmdbSearchSeq = 0;

  function normalizeTsImdbField() {
    const el = document.getElementById('ts-imdb');
    el.value = extractImdbId(el.value);
  }

  function onTestTmdbSearchInput() {
    ++testTmdbSearchSeq;
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
      const res = await authFetch('/api/tmdb-search?q=' + encodeURIComponent(q), { headers: authHeaders() });
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
    const selection = ++testTmdbSearchSeq;
    const r = (window._testTmdbLastResults || [])[i];
    if (!r) return;
    const box = document.getElementById('test-tmdb-results');
    box.innerHTML = '<div class="tmdb-loading">Récupération de l\'IMDB ID...</div>';
    try {
      const res = await authFetch('/api/tmdb-resolve?id=' + r.tmdbId + '&type=' + r.mediaType, { headers: authHeaders() });
      const data = await res.json();
      if (selection !== testTmdbSearchSeq) return;
      if (!res.ok || !data.imdbId) { toast('❌ IMDB ID introuvable pour ce titre'); box.classList.remove('show'); return; }
      document.getElementById('ts-imdb').value = data.imdbId;
      document.getElementById('ts-type').value = r.mediaType === 'tv' ? 'series' : 'movie';
      tsSelectedMedia = { imdbId: data.imdbId, type: r.mediaType === 'tv' ? 'series' : 'movie', title: r.title, year: r.year, poster: r.poster };
      onTsTypeChange();
      document.getElementById('test-tmdb-search').value = r.title + (r.year ? ' (' + r.year + ')' : '');
      box.classList.remove('show');
      toast('✅ ' + (r.mediaType === 'tv' ? 'Série trouvée' : 'Film trouvé') + ' — IMDB ID rempli, test lancé');
      scheduleOverrideCheck();
      runStreamTest();
    } catch (e) { toast('❌ ' + e.message); box.classList.remove('show'); }
  }

