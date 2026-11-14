  // ---- MAPPING ----
  let overridesData = [];
  let failedData = [];
  let resolvedData = [];
  let usersData = [];
  let editingKey = null; // { imdbId, season } de l'override en cours d'édition, null si création
  let tmdbSearchTimer = null;
  let tmdbSearchSeq = 0;
  let ytSearchTimer = null;
  let ytSearchSeq = 0;
  let overrideLinks = []; // liens de repli [{ ytId }|{ url }] au-delà du lien 1 (champ ov-ytid/ov-url)
  let linkTestTimer = null;
  let linkTestSeq = 0;

  async function loadMapping() {
    mappingPage = 0;
    try {
      const [ovRes, failRes, resRes] = await Promise.all([
        fetch('/api/overrides', { headers: authHeaders() }),
        fetch('/api/failed-log', { headers: authHeaders() }),
        fetch('/api/resolved-log', { headers: authHeaders() }),
      ]);
      overridesData = await ovRes.json();
      failedData = await failRes.json();
      resolvedData = await resRes.json();

      document.getElementById('tab-count-overrides').textContent = overridesData.length;
      document.getElementById('tab-count-failed').textContent = failedData.length;
      document.getElementById('tab-count-resolved').textContent = resolvedData.length;

      document.getElementById('map-stat-overrides').textContent = overridesData.length;
      document.getElementById('map-stat-resolved').textContent = resolvedData.length;
      document.getElementById('map-stat-failed').textContent = failedData.length;
      document.getElementById('map-stat-hidden').textContent = overridesData.filter(o => o.hidden).length;

      renderActiveMappingTab();

      const badge = document.getElementById('failed-badge');
      if (failedData.length) { badge.style.display = 'inline-block'; badge.textContent = failedData.length; }
      else badge.style.display = 'none';
    } catch (e) { toast('❌ Erreur de chargement du mapping'); }
  }

  // ---- MAPPING — onglets unifiés (Overrides actifs / Résolutions récentes / Échecs récents) ----
  let mappingActiveTab = 'overrides';
  let mappingSort = 'imdb';
  let mappingPage = 0;
  const MAPPING_PAGE_SIZE = 10;
  const MAPPING_TAB_DESC = {
    overrides: 'Overrides que tu as configurés manuellement',
    resolved: "Bandes-annonces trouvées automatiquement dans la dernière heure — utile pour override un mauvais résultat même sans échec",
    failed: "Titres pour lesquels aucun trailer n'a été trouvé — bons candidats pour un override",
  };
  function switchMappingTab(tab) {
    mappingActiveTab = tab;
    document.querySelectorAll('.maptab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.mapping-tab-panel').forEach(p => p.style.display = p.id === 'mapping-tab-' + tab ? '' : 'none');
    document.getElementById('mapping-tab-desc').textContent = MAPPING_TAB_DESC[tab];
    document.getElementById('mapping-clear-btn').style.display = tab === 'overrides' ? 'none' : 'inline-flex';
    document.getElementById('mapping-sort').style.display = tab === 'overrides' ? '' : 'none';
    renderActiveMappingTab();
  }
  // Change le tri des overrides (contrôle segmenté) et re-rend la liste active.
  function setMappingSort(sort) {
    mappingSort = sort;
    document.querySelectorAll('.mapping-sort-opt').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
    renderActiveMappingTab();
  }
  function renderActiveMappingTab() {
    if (mappingActiveTab === 'overrides') renderOverridesTable();
    else if (mappingActiveTab === 'resolved') renderResolvedTable();
    else renderFailedTable();
  }
  function clearActiveMappingLog() {
    if (mappingActiveTab === 'resolved') clearResolvedLog();
    else if (mappingActiveTab === 'failed') clearFailedLog();
  }

  // Liste prioritaire des liens d'un override : lien principal (ytId/url) puis replis (links).
  function overrideLinkList(o) {
    const links = [];
    const seen = new Set();
    const push = (ytId, url) => {
      const yt = ytId ? extractYoutubeId(ytId) : null;
      const u = url && url.trim() ? url.trim() : null;
      if (!yt && !u) return;
      const key = (yt || '') + '|' + (u || '');
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ ytId: yt, url: u });
    };
    if (Array.isArray(o.links) && o.links.length) {
      for (const l of o.links) push(l.ytId, l.url);
    } else {
      push(o.ytId, o.url);
    }
    return links;
  }

  // Ouvre l'aperçu de TOUS les liens d'un override (principal + replis), avec
  // navigation entre eux dans la modale.
  function openOverridePreview(o) {
    const links = overrideLinkList(o);
    if (!links.length) return;
    const title = o.title || 'Aperçu';
    document.getElementById('preview-modal-title').textContent = title;
    const body = document.getElementById('preview-modal-body');
    body.classList.add('preview-multi');
    const render = (idx) => {
      const l = links[idx];
      const useYt = l.ytId && /^[a-zA-Z0-9_-]{11}$/.test(l.ytId);
      const player = useYt
        ? `<div id="ov-preview-player"></div>`
        : (l.url && /^https?:\/\//.test(l.url)
          ? `<video src="${escapeAttr(l.url)}" controls autoplay></video>`
          : '<div class="info-box" style="padding:24px;text-align:center;color:var(--muted)">Lien invalide — vérifie le mapping</div>');
      body.innerHTML = (links.length > 1
        ? `<div class="preview-link-nav">${links.map((x, i) =>
            `<button class="small-btn ${i === idx ? 'active' : ''}" onclick="openOverridePreviewAt(${i})">${i === 0 ? 'Lien 1' : 'Repli ' + i}${x.ytId ? '' : ' (URL)'}</button>`
          ).join('')}</div>`
        : '') +
        `<div class="preview-player">${player}</div>`;
      if (useYt) mountYoutubePlayer('ov-preview-player', l.ytId);
    };
    window._overridePreviewLinks = links;
    window.openOverridePreviewAt = render;
    render(0);
    document.getElementById('preview-modal').classList.add('show');
  }

  function openOverridePreviewByKey(imdbId, season) {
    const o = overridesData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    if (o) openOverridePreview(o);
  }

  function overrideThumb(o) {
    if (o.hidden) return '<span class="muted">🚫</span>';
    const links = overrideLinkList(o);
    if (!links.length) return '<span class="muted">—</span>';
    const key = escapeAttr(o.imdbId) + "','" + escapeAttr(o.season || '');
    if (links[0].ytId) return `<img class="preview-thumb" src="https://img.youtube.com/vi/${links[0].ytId}/mqdefault.jpg" onclick="openOverridePreviewByKey('${key}')" alt="">`;
    return `<span class="preview-link" onclick="openOverridePreviewByKey('${key}')">▶️ Tester</span>`;
  }

  function renderOverridesTable() {
    const filter = (document.getElementById('mapping-filter').value || '').toLowerCase().trim();
    const ovBody = document.getElementById('overrides-body');
    let filtered = !filter ? overridesData.slice() : overridesData.filter(o =>
      (o.imdbId || '').toLowerCase().includes(filter) || (o.title || '').toLowerCase().includes(filter));
    const sort = mappingSort;
    if (sort === 'title') filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'));
    else if (sort === 'hidden') filtered.sort((a, b) => (!!b.hidden) - (!!a.hidden));
    else if (sort === 'uses') filtered.sort((a, b) => (b.uses || 0) - (a.uses || 0));
    else filtered.sort((a, b) => (a.imdbId || '').localeCompare(b.imdbId || ''));

    // Pagination : clamp si la page courante dépasse le nouveau nombre de pages.
    const pageCount = Math.max(1, Math.ceil(filtered.length / MAPPING_PAGE_SIZE));
    if (mappingPage >= pageCount) mappingPage = pageCount - 1;
    const pageItems = filtered.slice(mappingPage * MAPPING_PAGE_SIZE, (mappingPage + 1) * MAPPING_PAGE_SIZE);

    const selected = selectedOverrideKeys();
    const allVisibleSelected = pageItems.length > 0 && pageItems.every(o => selected.has(o.imdbId + ':' + (o.season || '')));
    const checkAll = document.getElementById('overrides-checkall');
    if (checkAll) checkAll.checked = allVisibleSelected;

    ovBody.innerHTML = !pageItems.length
      ? `<tr class="empty-row"><td colspan="8">${filtered.length ? 'Aucun résultat pour ce filtre' : 'Aucun override configuré'}</td></tr>`
      : pageItems.map(o => {
          const key = o.imdbId + ':' + (o.season || '');
          return `
          <tr class="${o.hidden ? 'override-hidden-row' : ''}">
            <td><input type="checkbox" class="override-check" data-key="${escapeAttr(key)}" onchange="renderBulkBar()" ${selected.has(key) ? 'checked' : ''}></td>
            <td>${overrideThumb(o)}</td>
            <td class="mono">${escapeHtml(o.imdbId)}</td>
            <td class="muted">${o.season || '—'}</td>
            <td>${escapeHtml(o.title || '—')}${o.notes ? `<div class="override-note" title="${escapeAttr(o.notes)}">📝 ${escapeHtml(o.notes)}</div>` : ''}</td>
            <td><span class="badge-type" style="${o.hidden ? 'background:rgba(229,62,62,0.12);color:var(--accent)' : ''}">${o.hidden ? '🚫 Masqué' : (o.ytId ? 'YouTube' : 'URL directe')}${Array.isArray(o.links) && o.links.length > 1 ? ' +' + (o.links.length - 1) : ''}</span>${Array.isArray(o.links) && o.links.length > 1 && typeof o.activeLinkIndex === 'number' && o.activeLinkIndex > 0 ? `<div class="link-fallback-warn" title="Le lien principal semble mort : Stremio sert actuellement le repli n°${o.activeLinkIndex + 1} à sa place — vérifie/remplace le lien principal">⚠️ repli ${o.activeLinkIndex + 1} actif</div>` : ''}</td>
            <td style="text-align:right"><span class="uses-badge" title="Nombre de fois que cet override a servi">${o.uses || 0}</span></td>
            <td class="row-actions">
              <button class="small-btn" onclick="toggleOverrideHidden('${escapeAttr(o.imdbId)}','${o.season||''}')">${o.hidden ? '✅ Afficher' : '🚫 Masquer'}</button>
              <button class="small-btn" onclick="editOverride('${escapeAttr(o.imdbId)}','${o.season||''}')">Modifier</button>
              <button class="small-btn danger" onclick="deleteOverride('${escapeAttr(o.imdbId)}','${o.season||''}')">Supprimer</button>
            </td>
          </tr>
        `;
        }).join('');
    renderBulkBar();
    renderMappingPagination(filtered.length);
  }

  function renderMappingPagination(total) {
    const el = document.getElementById('mapping-pagination');
    if (!el) return;
    if (total <= MAPPING_PAGE_SIZE) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const pageCount = Math.ceil(total / MAPPING_PAGE_SIZE);
    const start = mappingPage * MAPPING_PAGE_SIZE + 1;
    const end = Math.min(total, (mappingPage + 1) * MAPPING_PAGE_SIZE);
    el.style.display = 'flex';
    el.innerHTML = `
      <button class="small-btn" onclick="mappingGoPage(0)" ${mappingPage === 0 ? 'disabled' : ''}>⏮</button>
      <button class="small-btn" onclick="mappingGoPage(${mappingPage - 1})" ${mappingPage === 0 ? 'disabled' : ''}>◀ Précédent</button>
      <span class="mapping-page-info">${start}–${end} sur ${total} · page ${mappingPage + 1}/${pageCount}</span>
      <button class="small-btn" onclick="mappingGoPage(${mappingPage + 1})" ${mappingPage >= pageCount - 1 ? 'disabled' : ''}>Suivant ▶</button>
      <button class="small-btn" onclick="mappingGoPage(${pageCount - 1})" ${mappingPage >= pageCount - 1 ? 'disabled' : ''}>⏭</button>
    `;
  }

  function mappingGoPage(page) {
    mappingPage = page;
    renderOverridesTable();
  }

  // ---- MAPPING — sélection multiple + actions groupées ----
  function selectedOverrideKeys() {
    const set = new Set();
    document.querySelectorAll('.override-check:checked').forEach(cb => set.add(cb.dataset.key));
    return set;
  }

  function toggleCheckAll() {
    const checked = document.getElementById('overrides-checkall').checked;
    document.querySelectorAll('.override-check').forEach(cb => cb.checked = checked);
    renderBulkBar();
  }

  function renderBulkBar() {
    const keys = selectedOverrideKeys();
    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-count');
    if (keys.size) { bar.style.display = 'flex'; count.textContent = keys.size + ' sélectionné(s)'; }
    else { bar.style.display = 'none'; count.textContent = '0 sélectionné(s)'; }
  }

  function clearSelection() {
    document.querySelectorAll('.override-check').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('overrides-checkall');
    if (checkAll) checkAll.checked = false;
    renderBulkBar();
  }

  async function bulkToggleHidden() {
    const keys = [...selectedOverrideKeys()];
    if (!keys.length) return;
    const targets = overridesData.filter(o => keys.includes(o.imdbId + ':' + (o.season || '')));
    if (!confirm(`${targets.length} override(s) — basculer masqué/affiché ?`)) return;
    let ok = 0;
    for (const o of targets) {
      try {
        const res = await fetch('/api/overrides', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ imdbId: o.imdbId, season: o.season || null, ytId: o.ytId || null, url: o.url || null, title: o.title || null, mediaType: o.mediaType || null, links: Array.isArray(o.links) ? o.links : undefined, notes: o.notes || null, hidden: !o.hidden }),
        });
        if (res.ok) ok++;
      } catch (e) { /* silencieux */ }
    }
    toast(`✅ ${ok}/${targets.length} basculé(s)`);
    clearSelection();
    await loadMapping();
  }

  async function bulkDelete() {
    const keys = [...selectedOverrideKeys()];
    if (!keys.length) return;
    const targets = overridesData.filter(o => keys.includes(o.imdbId + ':' + (o.season || '')));
    if (!confirm(`Supprimer définitivement ${targets.length} override(s) ?`)) return;
    let ok = 0;
    for (const o of targets) {
      try {
        const res = await fetch('/api/overrides?imdbId=' + encodeURIComponent(o.imdbId) + '&season=' + encodeURIComponent(o.season || ''), { method: 'DELETE', headers: authHeaders() });
        if (res.ok) ok++;
      } catch (e) { /* silencieux */ }
    }
    toast(`✅ ${ok}/${targets.length} supprimé(s)`);
    clearSelection();
    await loadMapping();
  }

  // Bascule l'état "masqué" d'un override (sert à cacher un titre sans supprimer son lien).
  async function toggleOverrideHidden(imdbId, season) {
    const o = overridesData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    if (!o) return;
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          imdbId: o.imdbId,
          season: o.season || null,
          ytId: o.ytId || null,
          url: o.url || null,
          title: o.title || null,
          mediaType: o.mediaType || null,
          links: Array.isArray(o.links) ? o.links : undefined,
          notes: o.notes || null,
          hidden: !o.hidden,
        }),
      });
      if (res.ok) {
        await loadMapping();
        toast(o.hidden ? '✅ Override réactivé' : '🚫 Override masqué — le titre ne sera plus servi');
      } else {
        const err = await res.json().catch(() => null);
        toast('❌ ' + (err && err.error ? err.error : 'Erreur lors de la mise à jour'));
      }
    } catch (e) {
      toast('❌ Erreur réseau');
    }
  }

  function renderFailedTable() {
    const filter = (document.getElementById('mapping-filter').value || '').toLowerCase().trim();
    const failBody = document.getElementById('failed-body');
    const filtered = !filter ? failedData : failedData.filter(f => (f.imdbId || '').toLowerCase().includes(filter) || (f.title || '').toLowerCase().includes(filter));
    // Le titre le plus demandé en échec en premier -- c'est celui qui vaut le plus la
    // peine d'être mappé en priorité (déjà trié par dernière apparition côté serveur,
    // on affine ici par nombre d'échecs pour remonter les cas les plus fréquents).
    const sorted = filtered.slice().sort((a, b) => (b.count || 1) - (a.count || 1));
    failBody.innerHTML = !sorted.length
      ? `<tr class="empty-row"><td colspan="7">${failedData.length ? 'Aucun résultat pour ce filtre' : 'Aucun échec récent 🎉'}</td></tr>`
      : sorted.map(f => `
          <tr>
            <td>${escapeHtml(f.title || '—')}</td>
            <td class="mono">${escapeHtml(f.imdbId)}</td>
            <td><span class="badge-type">${f.type === 'series' ? 'Série' : 'Film'}</span></td>
            <td class="muted">${f.season || '—'}</td>
            <td style="text-align:right"><span class="uses-badge" title="Nombre de requêtes en échec pour ce titre">${f.count || 1}</span></td>
            <td class="muted">${timeAgo(f.lastSeen || f.time)}</td>
            <td class="row-actions">
              <button class="small-btn" onclick="prefillOverride('${escapeAttr(f.imdbId)}','${f.season||''}','${escapeAttr(f.title||'')}')">🎯 Mapper</button>
            </td>
          </tr>
        `).join('');
  }

  function resolvedThumb(r) {
    const s = (r.streams || [])[0];
    if (!s) return '<span class="muted">—</span>';
    if (s.ytId) return `<img class="preview-thumb" src="https://img.youtube.com/vi/${s.ytId}/mqdefault.jpg" onclick="openPreview('${s.ytId}', null, '${escapeAttr(r.title||'Aperçu')}')" alt="">`;
    if (s.url) return `<span class="preview-link" onclick="openPreview(null, '${escapeAttr(s.url)}', '${escapeAttr(r.title||'Aperçu')}')">▶️ Tester</span>`;
    return '<span class="muted">—</span>';
  }

  function sourceLabel(src) {
    return src === 'allocine' ? 'Allociné' : src === 'youtube_search' ? 'Recherche YouTube' : src === 'tmdb' ? 'TMDB' : '—';
  }

  function renderResolvedTable() {
    const filter = (document.getElementById('mapping-filter').value || '').toLowerCase().trim();
    const resBody = document.getElementById('resolved-body');
    const filtered = !filter ? resolvedData : resolvedData.filter(r =>
      (r.imdbId || '').toLowerCase().includes(filter) || (r.title || '').toLowerCase().includes(filter));

    resBody.innerHTML = !filtered.length
      ? `<tr class="empty-row"><td colspan="6">${resolvedData.length ? 'Aucun résultat pour ce filtre' : 'Aucune résolution récente'}</td></tr>`
      : filtered.map(r => `
          <tr>
            <td>${resolvedThumb(r)}</td>
            <td>${escapeHtml(r.title || '—')}</td>
            <td class="mono">${escapeHtml(r.imdbId)}</td>
            <td class="muted">${r.season || '—'}</td>
            <td><span class="badge-type">${sourceLabel(r.source)}</span></td>
            <td class="row-actions">
              <button class="small-btn" onclick="testFromOverview('${escapeAttr(r.imdbId)}','${escapeAttr(r.title||'')}')">🔬 Tester</button>
              <button class="small-btn" onclick="editOverrideFromResolved('${escapeAttr(r.imdbId)}','${r.season||''}','${escapeAttr(r.title||'')}','${r.type||''}')">✏️ Modifier</button>
            </td>
          </tr>
        `).join('');
  }

  async function refreshFailedBadge() {
    try {
      const res = await fetch('/api/failed-log', { headers: authHeaders() });
      const failed = await res.json();
      const badge = document.getElementById('failed-badge');
      if (failed.length) { badge.style.display = 'inline-block'; badge.textContent = failed.length; }
    } catch (e) { /* silencieux */ }
  }

