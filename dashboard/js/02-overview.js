  // ---- OVERVIEW ----
  async function loadOverview() {
    try {
      const res = await fetch('/api/dashboard-stats', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      const data = await res.json();

      document.getElementById('ov-updated').textContent = 'MAJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (!data.configured) {
        ['stat-total', 'stat-movies', 'stat-series', 'stat-today'].forEach(id => document.getElementById(id).textContent = '⚠️');
        document.getElementById('top-titles-body').innerHTML =
          '<tr class="empty-row"><td colspan="5">Redis non configuré — ajoute UPSTASH_REDIS_REST_URL / TOKEN sur Vercel</td></tr>';
        document.getElementById('chart-svg').innerHTML = '';
        document.getElementById('split-body').innerHTML = '';
        return;
      }

      const grandTotal = data.movieCount + data.seriesCount; // même base que le donut (évite un écart de 1 si une écriture a échoué)
      animateNumber(document.getElementById('stat-total'), grandTotal);
      animateNumber(document.getElementById('stat-movies'), data.movieCount);
      animateNumber(document.getElementById('stat-series'), data.seriesCount);
      animateNumber(document.getElementById('stat-today'), data.todayCount);

      const pctMovie = grandTotal ? Math.round((data.movieCount / grandTotal) * 100) : 0;
      document.getElementById('trend-movies').innerHTML = '<span class="trend-flat">' + pctMovie + '% des demandes</span>';
      document.getElementById('trend-series').innerHTML = '<span class="trend-flat">' + (100 - pctMovie) + '% des demandes</span>';
      document.getElementById('trend-total').innerHTML = '<span class="trend-up">+' + data.todayCount + ' aujourd\'hui</span>';

      const days = data.days || [];
      const yesterday = days.length >= 2 ? days[days.length - 2].count : 0;
      const diff = data.todayCount - yesterday;
      const tEl = document.getElementById('trend-today');
      if (diff > 0) tEl.innerHTML = '<span class="trend-up">▲ +' + diff + ' vs hier (' + yesterday + ')</span>';
      else if (diff < 0) tEl.innerHTML = '<span class="trend-down">▼ ' + diff + ' vs hier (' + yesterday + ')</span>';
      else tEl.innerHTML = '<span class="trend-flat">• stable vs hier</span>';

      document.getElementById('chart-svg').innerHTML = renderTrendChart(days);
      renderSplit(data.movieCount, data.seriesCount);

      const body = document.getElementById('top-titles-body');
      const topMax = Math.max(1, ...data.topTitles.map(t => t.count));
      body.innerHTML = !data.topTitles.length
        ? '<tr class="empty-row"><td colspan="5">Aucune donnée pour l\'instant</td></tr>'
        : data.topTitles.map((t, i) => renderTopTitle(t, i, topMax)).join('');
    } catch (e) { toast('❌ Erreur de chargement des stats'); }
  }

  function toggleOverviewAuto() {
    if (ovInterval) { clearInterval(ovInterval); ovInterval = null; }
    if (document.getElementById('ov-auto').checked) ovInterval = setInterval(loadOverview, 30000);
  }

  function renderTopTitle(t, i, topMax) {
    const hasImdb = t.imdbId && /^tt\d+$/.test(t.imdbId);
    const medal = ['🥇', '🥈', '🥉'][i] || String(i + 1).padStart(2, '0');
    const share = Math.max(Math.round((t.count / topMax) * 100), 4);
    const actions = hasImdb
      ? '<button class="small-btn" onclick="testFromOverview(\'' + escapeAttr(t.imdbId) + '\',\'' + escapeAttr(t.title || '') + '\')" title="Tester ce titre">🔬</button>' +
        '<button class="small-btn" onclick="overrideFromOverview(\'' + escapeAttr(t.imdbId) + '\',\'' + escapeAttr(t.title || '') + '\')" title="Créer un override">🎯</button>'
      : '';
    return '<tr>' +
      '<td class="rank">' + medal + '</td>' +
      '<td>' + escapeHtml(t.title || 'Inconnu') + '<div class="top-share"><div class="top-share-bar" style="width:' + share + '%"></div></div></td>' +
      '<td class="muted mono">' + escapeHtml(t.imdbId || '—') + '</td>' +
      '<td class="count">' + t.count + '</td>' +
      '<td class="row-actions">' + actions + '</td>' +
      '</tr>';
  }

  // Graphique en aires (SVG) des 14 derniers jours.
  function renderTrendChart(days) {
    if (!days || !days.length) return '<div class="empty-row">Aucune donnée</div>';
    const W = 600, H = 170, PX = 12, PY = 24, PB = 32;
    const maxDay = Math.max(1, ...days.map(d => d.count));
    const n = days.length;
    const stepX = n > 1 ? (W - PX * 2) / (n - 1) : 0;
    const yOf = v => H - PB - (v / maxDay) * (H - PY - PB);
    const pts = days.map((d, i) => ({ x: PX + i * stepX, y: yOf(d.count), c: d.count }));
    const baseY = H - PB;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const area = line + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + baseY + ' L' + pts[0].x.toFixed(1) + ' ' + baseY + ' Z';
    const last = pts[pts.length - 1];
    const grid = [0.25, 0.5, 0.75, 1].map(f => {
      const gy = baseY - f * (H - PY - PB);
      return '<line x1="' + PX + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PX) + '" y2="' + gy.toFixed(1) + '" class="ov-chart-grid"/>';
    }).join('');
    const yLabels = [0.5, 1].map(f => '<text x="' + (PX + 2) + '" y="' + (baseY - f * (H - PY - PB) - 4).toFixed(1) + '" class="ov-chart-xlabel" style="opacity:.75">' + Math.round(maxDay * f) + '</text>').join('');
    const labelEvery = Math.max(1, Math.round(n / 6));
    const labels = pts.map((p, i) => {
      if (i !== n - 1 && i % labelEvery !== 0) return '';
      return '<text x="' + p.x.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="ov-chart-xlabel"' + (i === n - 1 ? ' style="fill:var(--accent);font-weight:800"' : '') + '>' +
        new Date(days[i].date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + '</text>';
    }).join('');
    const dots = pts.map((p, i) => '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" style="fill:var(--surface);stroke:var(--accent);stroke-width:2"><title>' + p.c + ' requêtes le ' + new Date(days[i].date).toLocaleDateString('fr-FR') + '</title></circle>').join('');
    return '<svg class="ov-chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="ov-fill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" style="stop-color:var(--accent);stop-opacity:0.32"/>' +
      '<stop offset="100%" style="stop-color:var(--accent);stop-opacity:0"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#ov-fill)"/>' +
      '<path d="' + line + '" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="9" fill="var(--accent)" opacity="0.18"/>' +
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="4" fill="var(--accent)"/>' +
      yLabels + dots + labels +
      '</svg>';
  }

  // Donut de répartition Film / Série.
  function renderSplit(movieCount, seriesCount) {
    renderDonut('split-body', [
      { label: 'Films', value: movieCount, color: '#60a5fa' },
      { label: 'Séries', value: seriesCount, color: '#a78bfa' },
    ], 'demandes');
  }

  // Donut de répartition Pseudo renseigné / Anonyme.
  function renderUserSplit(pseudos, anons) {
    renderDonut('user-split-body', [
      { label: 'Pseudos renseignés', value: pseudos, color: '#48bb78' },
      { label: 'Anonymes', value: anons, color: '#94a3b8' },
    ], 'utilisateurs');
  }

  // Donut générique : segments = [{ label, value, color }].
  function renderDonut(bodyId, segments, totalText) {
    const body = document.getElementById(bodyId);
    const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);
    if (!total) { body.innerHTML = '<div class="empty-row">Aucune donnée pour l\'instant</div>'; return; }
    const R = 40, C = 2 * Math.PI * R;
    let acc = 0;
    let arcs = '<circle cx="50" cy="50" r="' + R + '" fill="none" style="stroke:var(--surface2)" stroke-width="13"/>';
    segments.forEach(seg => {
      const len = ((seg.value || 0) / total) * C;
      arcs += '<circle cx="50" cy="50" r="' + R + '" fill="none" style="stroke:' + seg.color + '" stroke-width="13" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 50 50)"/>';
      acc += len;
    });
    const legend = segments.map(seg => {
      const pct = Math.round(((seg.value || 0) / total) * 100);
      return '<div class="ov-legend-item"><span class="ov-legend-dot" style="background:' + seg.color + '"></span><span>' + seg.label + '</span><b>' + pct + '%</b></div>';
    }).join('');
    body.innerHTML =
      '<div class="ov-split">' +
      '<svg viewBox="0 0 100 100" class="ov-donut">' + arcs +
      '<text x="50" y="46" text-anchor="middle" class="ov-donut-total">' + total.toLocaleString('fr-FR') + '</text>' +
      '<text x="50" y="59" text-anchor="middle" class="ov-donut-sub">' + (totalText || '') + '</text>' +
      '</svg>' +
      '<div class="ov-split-legend">' + legend + '</div>' +
      '</div>';
  }

  // Compteur animé pour les valeurs des cartes.
  function animateNumber(el, target) {
    const dur = 600;
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString('fr-FR');
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Depuis le top titres : tester la résolution de ce titre sur la page Test des flux.
  async function testFromOverview(imdbId, title) {
    if (!/^tt\d+$/.test(imdbId || '')) { toast('⚠️ Pas d\'IMDB ID utilisable pour ce titre'); return; }
    document.getElementById('ts-imdb').value = imdbId;
    document.getElementById('ts-season').value = '';
    document.getElementById('test-tmdb-search').value = title || '';
    const typeEl = document.getElementById('ts-type');
    typeEl.value = 'movie';
    onTsTypeChange();
    showPage('teststream');
    try {
      const res = await fetch('/api/tmdb-lookup?imdbId=' + encodeURIComponent(imdbId), { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.mediaType === 'tv') { typeEl.value = 'series'; onTsTypeChange(); }
      }
    } catch (e) { /* silencieux */ }
    scheduleOverrideCheck();
    runStreamTest();
  }

  // Depuis le top titres : pré-remplir le formulaire Mapping pour créer un override.
  function overrideFromOverview(imdbId, title) {
    if (!/^tt\d+$/.test(imdbId || '')) { toast('⚠️ Pas d\'IMDB ID utilisable pour ce titre'); return; }
    cancelEditOverride();
    document.getElementById('ov-imdb').value = imdbId;
    document.getElementById('ov-season').value = '';
    document.getElementById('ov-title').value = title || '';
    document.getElementById('ov-mediatype').value = '';
    updateFormPreview();
    document.getElementById('mapping-form-title').textContent = '🎯 Créer un override';
    document.getElementById('edit-banner-text').textContent = 'Nouvel override pour ' + imdbId + ' — renseigne le lien puis enregistre';
    document.getElementById('edit-banner').classList.add('show');
    checkDuplicateOverride();
    showPage('mapping');
    toast('ℹ️ Lien à renseigner — enregistre pour créer l\'override');
  }

  async function resetStats() {
    if (!confirm('Vider toutes les stats ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/dashboard-stats/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Stats réinitialisées'); await loadOverview(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

