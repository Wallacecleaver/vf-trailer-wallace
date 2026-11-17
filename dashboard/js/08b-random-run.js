  // ---- TEST ALÉATOIRE EN MASSE (page « Test des flux ») ----
  // Tire des films / séries au hasard (/api/random-titles), passe chacun dans la vraie chaîne
  // (/api/test-resolve, sans cache ni stats ni logs) et agrège les résultats.
  const RT_SOURCE_LABELS = Object.assign({ thetvdb: 'TheTVDB', anilist: 'AniList' }, SOURCE_LABELS);
  const RT_CONCURRENCY = 4;
  let rt = { running: false, stop: false, target: 0, results: [], startedAt: 0 };

  function rtSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Lit les étapes « TMDB vidéos » de la trace : "…: 1/3 retenue(s)" -> { seen: 3, kept: 1 }.
  function rtTmdbVideos(trace) {
    let seen = 0, kept = 0;
    for (const t of (trace || [])) {
      if (t.step !== 'tmdb-videos') continue;
      const m = /(\d+)\/(\d+) retenue/.exec(t.detail || '');
      if (!m) continue;
      kept = Math.max(kept, Number(m[1]));
      seen = Math.max(seen, Number(m[2]));
    }
    return { seen, kept };
  }

  async function rtTestOne(title, ignoreOverride) {
    const t0 = Date.now();
    const base = { title: title.title, year: title.year, imdbId: title.imdbId, type: title.type };
    try {
      const res = await authFetch('/api/test-resolve', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type: title.type, imdbId: title.imdbId, season: null, ignoreOverride, aiom: false }),
      });
      if (!res.ok) return Object.assign(base, { status: 'error', why: 'HTTP ' + res.status, ms: Date.now() - t0 });
      const data = await res.json();
      const tv = rtTmdbVideos(data.trace);
      const out = Object.assign(base, { ms: Date.now() - t0, source: data.source || null, tmdbSeen: tv.seen, tmdbKept: tv.kept });
      if (data.error) return Object.assign(out, { status: 'error', why: data.error });
      if (data.streams && data.streams.length) return Object.assign(out, { status: 'ok', streams: data.streams.length });
      const failSteps = (data.trace || []).filter(s => !s.ok).map(s => TRACE_STEP_LABELS[s.step] || s.step);
      return Object.assign(out, { status: 'none', why: failSteps.join(' → ') || 'aucune source' });
    } catch (e) {
      return Object.assign(base, { status: 'error', why: e.message, ms: Date.now() - t0 });
    }
  }

  async function startRandomTest() {
    if (rt.running) return;
    const target = Number(document.getElementById('rt-count').value) || 100;
    const mode = document.getElementById('rt-type').value;
    const pool = document.getElementById('rt-pool').value;
    const ignoreOverride = document.getElementById('rt-ignore-override').checked;

    rt = { running: true, stop: false, target, results: [], startedAt: Date.now() };
    document.getElementById('rt-start').disabled = true;
    document.getElementById('rt-start').textContent = '…';
    document.getElementById('rt-stop').disabled = false;
    document.getElementById('rt-progress').hidden = false;
    renderRandomTest();

    const pending = [];
    const seen = new Set();
    let collected = 0, producerDone = false, producerError = null, calls = 0;

    // Producteur : rappelle l'endpoint (une page TMDB au hasard par appel) jusqu'à avoir assez de titres.
    const producer = (async () => {
      const maxCalls = Math.ceil(target / 8) + 15;
      while (!rt.stop && collected < target && calls < maxCalls) {
        const type = mode === 'both' ? (calls % 2 === 0 ? 'movie' : 'tv') : mode;
        calls++;
        try {
          const res = await authFetch('/api/random-titles?type=' + type + '&pool=' + pool, { headers: authHeaders() });
          if (!res.ok) { producerError = 'Tirage TMDB indisponible (HTTP ' + res.status + ')'; if (res.status === 503 || res.status === 400) break; continue; }
          const data = await res.json();
          for (const t of (data.titles || [])) {
            if (collected >= target) break;
            if (seen.has(t.imdbId)) continue;
            seen.add(t.imdbId);
            pending.push(t);
            collected++;
          }
        } catch (e) { producerError = e.message; }
      }
      producerDone = true;
    })();

    const worker = async () => {
      while (!rt.stop) {
        const item = pending.shift();
        if (!item) {
          if (producerDone) break;
          await rtSleep(150);
          continue;
        }
        rt.results.push(await rtTestOne(item, ignoreOverride));
        renderRandomTest();
      }
    };
    await Promise.all([producer, ...Array.from({ length: RT_CONCURRENCY }, worker)]);

    rt.running = false;
    rt.finishedAt = Date.now();
    rt.producerError = rt.results.length < target && !rt.stop ? producerError : null;
    document.getElementById('rt-start').disabled = false;
    document.getElementById('rt-start').textContent = '🎲 Relancer un test';
    document.getElementById('rt-stop').disabled = true;
    renderRandomTest();
  }

  function stopRandomTest() { if (rt.running) rt.stop = true; }

  function rtPct(n, total) { return total ? Math.round(n * 1000 / total) / 10 : 0; }

  function rtItemHtml(r, idx, extra) {
    const kind = r.type === 'series' ? '📺' : '🎬';
    return '<div class="rt-item"><span>' + kind + '</span>' +
      '<span class="t">' + escapeHtml(r.title) + (r.year ? ' (' + escapeHtml(r.year) + ')' : '') + '</span>' +
      '<span class="m">' + escapeHtml(r.imdbId) + '</span>' +
      '<span class="why">' + escapeHtml(extra || '') + '</span>' +
      '<button class="small-btn" onclick="rtOpen(' + idx + ')">🔬 Voir</button></div>';
  }

  function renderRandomTest() {
    const done = rt.results.length;
    const fill = document.getElementById('rt-bar-fill');
    const label = document.getElementById('rt-progress-label');
    fill.style.width = Math.min(100, rtPct(done, rt.target)) + '%';
    const elapsed = Math.round(((rt.finishedAt || Date.now()) - rt.startedAt) / 1000);
    label.textContent = (rt.running ? (rt.stop ? 'Arrêt en cours… ' : 'Test en cours… ') : (rt.stop ? 'Arrêté : ' : 'Terminé : ')) +
      done + ' / ' + rt.target + ' titres · ' + elapsed + ' s';

    const out = document.getElementById('rt-results');
    if (!done) { out.innerHTML = ''; return; }

    const ok = rt.results.filter(r => r.status === 'ok');
    const none = rt.results.filter(r => r.status === 'none');
    const err = rt.results.filter(r => r.status === 'error');
    const viaTmdb = ok.filter(r => r.source === 'tmdb').length;
    const rejected = rt.results.filter(r => r.tmdbSeen > 0 && r.tmdbKept === 0);
    const avgMs = Math.round(rt.results.reduce((s, r) => s + (r.ms || 0), 0) / done);
    const movies = rt.results.filter(r => r.type === 'movie'), series = rt.results.filter(r => r.type === 'series');
    const okOf = list => list.filter(r => r.status === 'ok').length;

    const bySource = {};
    ok.forEach(r => { const k = RT_SOURCE_LABELS[r.source] || r.source || '—'; bySource[k] = (bySource[k] || 0) + 1; });
    const sourceRows = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      '<div class="rt-src-row"><span>' + escapeHtml(k) + '</span><div class="rt-src-track"><div class="rt-src-fill" style="width:' + rtPct(n, ok.length) + '%"></div></div><span>' + n + ' · ' + rtPct(n, ok.length) + '%</span></div>'
    ).join('');

    const stat = (cls, k, v, s) => '<div class="rt-stat ' + cls + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
    let html = '<div class="rt-stats">' +
      stat('', 'Testés', done, 'sur ' + rt.target + ' demandés') +
      stat('good', 'Bande-annonce trouvée', rtPct(ok.length, done) + ' %', ok.length + ' titres') +
      stat(none.length ? 'warn' : '', 'Aucune trouvée', none.length, rtPct(none.length, done) + ' %') +
      stat(err.length ? 'bad' : '', 'Erreurs', err.length, rtPct(err.length, done) + ' %') +
      stat('', 'Directement via TMDB', viaTmdb, ok.length ? rtPct(viaTmdb, ok.length) + ' % des trouvées' : '—') +
      stat(rejected.length ? 'warn' : '', 'Vidéo TMDB rejetée', rejected.length, 'TMDB avait une vidéo, le filtre l’a écartée') +
      stat('', 'Temps moyen', avgMs + ' ms', 'par titre') +
      '</div>';

    html += '<div class="rt-section-title">Réussite par type</div>' +
      '<div class="rt-src-row"><span>🎬 Films</span><div class="rt-src-track"><div class="rt-src-fill" style="width:' + rtPct(okOf(movies), movies.length) + '%;background:#48bb78"></div></div><span>' + okOf(movies) + '/' + movies.length + '</span></div>' +
      '<div class="rt-src-row"><span>📺 Séries</span><div class="rt-src-track"><div class="rt-src-fill" style="width:' + rtPct(okOf(series), series.length) + '%;background:#48bb78"></div></div><span>' + okOf(series) + '/' + series.length + '</span></div>';

    if (sourceRows) html += '<div class="rt-section-title">D’où viennent les bandes-annonces trouvées</div>' + sourceRows;

    const idx = r => rt.results.indexOf(r);
    if (none.length || err.length) {
      html += '<div class="rt-section-title">Sans bande-annonce / en erreur (' + (none.length + err.length) + ')</div><div class="rt-list">' +
        [...none, ...err].map(r => rtItemHtml(r, idx(r), r.why)).join('') + '</div>';
    }
    if (rejected.length) {
      html += '<div class="rt-section-title">Vidéo TMDB présente mais rejetée par le filtre (' + rejected.length + ')</div><div class="rt-list">' +
        rejected.map(r => rtItemHtml(r, idx(r), r.tmdbKept + '/' + r.tmdbSeen + ' retenue' + (r.status === 'ok' ? ' · trouvée via ' + (RT_SOURCE_LABELS[r.source] || r.source) : ' · rien trouvé'))).join('') + '</div>';
    }
    if (rt.producerError) html += '<div class="info-box" style="margin-top:12px">⚠️ Le tirage s’est arrêté avant la fin : ' + escapeHtml(rt.producerError) + '</div>';
    if (!rt.running) html += '<div class="form-actions"><button class="btn-outline-sm" onclick="exportRandomTest()">⬇️ Exporter en JSON</button></div>';
    out.innerHTML = html;
  }

  // Ouvre un titre du test aléatoire dans le testeur individuel (avec sa trace complète).
  function rtOpen(i) {
    const r = rt.results[i];
    if (!r) return;
    document.getElementById('test-tmdb-search').value = r.title + (r.year ? ' (' + r.year + ')' : '');
    document.getElementById('ts-imdb').value = r.imdbId;
    setTsType(r.type);
    document.getElementById('ts-ignore-override').checked = document.getElementById('rt-ignore-override').checked;
    document.getElementById('page-teststream').scrollIntoView({ behavior: 'smooth', block: 'start' });
    runStreamTest();
  }

  function exportRandomTest() {
    const blob = new Blob([JSON.stringify({ date: new Date().toISOString(), target: rt.target, results: rt.results }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'test-aleatoire-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
