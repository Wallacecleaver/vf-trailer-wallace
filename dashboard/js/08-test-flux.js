  // ---- TEST DES FLUX ----
  const SOURCE_LABELS = {
    tmdb: 'TMDB',
    allocine: 'Allociné',
    youtube_search: 'YouTube (recherche)',
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
  };
  let tsLast = null; // dernier résultat de test : { imdbId, season, type, streams }

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
        const res = await fetch('/api/overrides', { headers: authHeaders() });
        if (!res.ok) { if (res.status === 401) { logout(); return; } return; }
        tsOverridesCache = await res.json();
        tsOverridesCacheAt = Date.now();
      }
      const match = (tsOverridesCache || []).some(o => o.imdbId === imdbId && String(o.season || '') === String(season || ''));
      badge.classList.toggle('show', match);
    } catch (e) { /* pas bloquant */ }
  }

  function resetTsForm() {
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

    const out = document.getElementById('ts-result');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '...';
    out.innerHTML = '<div class="ts-loading"><div class="ts-eq"><span></span><span></span><span></span><span></span><span></span></div><div class="lbl">résolution en cours…</div></div>';

    try {
      const res = await fetch('/api/test-resolve', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type, imdbId, season: season || null, ignoreOverride, aiom }),
      });
      if (!res.ok) { logout(); return; }
      const data = await res.json();
      renderStreamTestResult(data, imdbId, season || null, type);
    } catch (e) {
      out.innerHTML = '<div class="info-box" style="color:var(--accent)">❌ Erreur réseau : ' + escapeHtml(e.message) + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
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

  function renderStreamTestResult(data, imdbId, season, type) {
    const out = document.getElementById('ts-result');
    tsLast = { imdbId, season, type, streams: data.streams || [] };
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
      const res = await fetch('/api/tmdb-search?q=' + encodeURIComponent(q), { headers: authHeaders() });
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
    const r = (window._testTmdbLastResults || [])[i];
    if (!r) return;
    const box = document.getElementById('test-tmdb-results');
    box.innerHTML = '<div class="tmdb-loading">Récupération de l\'IMDB ID...</div>';
    try {
      const res = await fetch('/api/tmdb-resolve?id=' + r.tmdbId + '&type=' + r.mediaType, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.imdbId) { toast('❌ IMDB ID introuvable pour ce titre'); box.classList.remove('show'); return; }
      document.getElementById('ts-imdb').value = data.imdbId;
      document.getElementById('ts-type').value = r.mediaType === 'tv' ? 'series' : 'movie';
      onTsTypeChange();
      document.getElementById('test-tmdb-search').value = r.title + (r.year ? ' (' + r.year + ')' : '');
      box.classList.remove('show');
      toast('✅ ' + (r.mediaType === 'tv' ? 'Série trouvée' : 'Film trouvé') + ' — IMDB ID rempli, test lancé');
      scheduleOverrideCheck();
      runStreamTest();
    } catch (e) { toast('❌ ' + e.message); box.classList.remove('show'); }
  }

