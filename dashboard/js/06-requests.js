  // ---- DEMANDES (propositions communautaires) ----
  let requestsAll = [];
  let requestsActiveTab = 'pending';

  function copyContributeLink() {
    const link = location.origin + '/proposer';
    navigator.clipboard.writeText(link)
      .then(() => toast('✅ Lien copié : ' + link))
      .catch(() => toast('❌ Impossible de copier, voici le lien : ' + link));
  }

  async function refreshRequestsBadge() {
    try {
      const res = await fetch('/api/contributions', { headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } return; }
      const all = await res.json();
      const pending = all.filter(c => c.status === 'pending');
      const badge = document.getElementById('requests-badge');
      if (pending.length) { badge.style.display = 'inline-block'; badge.textContent = pending.length; }
      else badge.style.display = 'none';
    } catch (e) { /* silencieux */ }
  }

  async function loadRequests() {
    try {
      const res = await fetch('/api/contributions', { headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } toast('❌ Erreur de chargement des demandes'); return; }
      requestsAll = await res.json();
      document.getElementById('tab-count-req-pending').textContent = requestsAll.filter(c => c.status === 'pending').length;
      document.getElementById('tab-count-req-accepted').textContent = requestsAll.filter(c => c.status === 'accepted').length;
      document.getElementById('tab-count-req-rejected').textContent = requestsAll.filter(c => c.status === 'rejected').length;
      renderActiveRequestsTab();
      refreshRequestsBadge();
    } catch (e) { toast('❌ Erreur de chargement des demandes'); }
  }

  function switchRequestsTab(tab) {
    requestsActiveTab = tab;
    document.querySelectorAll('#page-requests .maptab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('#page-requests .mapping-tab-panel').forEach(p => p.style.display = p.id === 'requests-tab-' + tab ? '' : 'none');
    renderActiveRequestsTab();
  }

  function requestThumb(item) {
    const Q = "'";
    if (item.ytId) return '<img class="preview-thumb" src="https://img.youtube.com/vi/' + item.ytId + '/mqdefault.jpg" onclick="openPreview(' + Q + item.ytId + Q + ', null, ' + Q + escapeAttr(item.title || 'Aperçu') + Q + ')" alt="">';
    if (item.url) return '<span class="preview-link" onclick="openPreview(null, ' + Q + escapeAttr(item.url) + Q + ', ' + Q + escapeAttr(item.title || 'Aperçu') + Q + ')">▶️ Tester</span>';
    return '<span class="muted">—</span>';
  }

  function requestDate(item) {
    try { return new Date(item.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (e) { return '—'; }
  }

  function renderActiveRequestsTab() {
    const list = requestsAll.filter(c => c.status === requestsActiveTab);
    if (requestsActiveTab === 'pending') renderRequestsPending(list);
    else renderRequestsReadonly(requestsActiveTab, list);
  }

  function renderRequestsPending(list) {
    const Q2 = "'";
    const body = document.getElementById('requests-pending-body');
    body.innerHTML = !list.length
      ? '<tr class="empty-row"><td colspan="6">Aucune demande en attente</td></tr>'
      : list.map(c => (
          '<tr>' +
          '<td>' + requestThumb(c) + '</td>' +
          '<td>' + escapeHtml(c.title || c.imdbId) + (c.season ? ' <span class="muted">S' + escapeHtml(c.season) + '</span>' : '') + '<div class="muted mono" style="font-size:11px">' + escapeHtml(c.imdbId) + '</div></td>' +
          '<td>' + escapeHtml(c.pseudo) + '</td>' +
          '<td class="muted" style="max-width:220px">' + (c.notes ? escapeHtml(c.notes) : '—') + '</td>' +
          '<td class="muted">' + requestDate(c) + '</td>' +
          '<td class="row-actions">' +
          '<button class="small-btn" onclick="acceptRequest(' + Q2 + c.id + Q2 + ')">✅ Accepter</button>' +
          '<button class="small-btn" onclick="rejectRequest(' + Q2 + c.id + Q2 + ')">🚫 Refuser</button>' +
          '</td>' +
          '</tr>'
        )).join('');
  }

  function renderRequestsReadonly(tab, list) {
    const body = document.getElementById('requests-' + tab + '-body');
    body.innerHTML = !list.length
      ? '<tr class="empty-row"><td colspan="4">' + (tab === 'accepted' ? 'Aucune demande acceptée' : 'Aucune demande refusée') + '</td></tr>'
      : list.map(c => (
          '<tr>' +
          '<td>' + requestThumb(c) + '</td>' +
          '<td>' + escapeHtml(c.title || c.imdbId) + (c.season ? ' <span class="muted">S' + escapeHtml(c.season) + '</span>' : '') + '</td>' +
          '<td>' + escapeHtml(c.pseudo) + '</td>' +
          '<td class="muted">' + requestDate(c) + '</td>' +
          '</tr>'
        )).join('');
  }

  async function acceptRequest(id) {
    try {
      const res = await fetch('/api/contributions/' + encodeURIComponent(id) + '/accept', { method: 'POST', headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } toast("❌ Erreur lors de l'acceptation"); return; }
      const data = await res.json();
      if (data.success) toast('✅ Proposition acceptée — override mis à jour');
      else toast("❌ Échec de la création de l'override");
      loadRequests();
    } catch (e) { toast('❌ Erreur réseau'); }
  }

  async function rejectRequest(id) {
    try {
      const res = await fetch('/api/contributions/' + encodeURIComponent(id) + '/reject', { method: 'POST', headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { logout(); return; } toast('❌ Erreur lors du refus'); return; }
      toast('🚫 Proposition refusée');
      loadRequests();
    } catch (e) { toast('❌ Erreur réseau'); }
  }

  function prefillOverride(imdbId, season, title) {
    cancelEditOverride();
    document.getElementById('ov-imdb').value = imdbId;
    document.getElementById('ov-season').value = season || '';
    checkDuplicateOverride();
    if (title) document.getElementById('ov-title').value = title; // déjà connu (journal des échecs) -> pas besoin de relookup TMDB
    else lookupTitleFromImdb(imdbId);
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Pré-remplit le formulaire à partir d'une résolution réussie, pour permettre d'écraser
  // un résultat automatique jugé mauvais (langue, qualité, mauvaise vidéo...) par un override.
  // Le lien actuellement trouvé est prérempli (via resolvedData) pour que l'admin voie ce
  // qu'il corrige, et puisse soit l'ajuster, soit le remplacer entièrement.
  function editOverrideFromResolved(imdbId, season, title, type) {
    cancelEditOverride();
    const r = resolvedData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    const stream = r && r.streams && r.streams[0] ? r.streams[0] : null;
    document.getElementById('ov-imdb').value = imdbId;
    document.getElementById('ov-season').value = season || '';
    document.getElementById('ov-title').value = title || '';
    document.getElementById('ov-mediatype').value = type || '';
    document.getElementById('ov-ytid').value = stream && stream.ytId ? stream.ytId : '';
    document.getElementById('ov-url').value = stream && stream.url ? stream.url : '';
    updateFormPreview();
    onOverrideLinkInput();
    document.getElementById('mapping-form-title').textContent = '✏️ Corriger le résultat trouvé';
    setFormMode('Correction');
    document.getElementById('edit-banner-text').textContent = `Correction du résultat automatique pour ${imdbId}${season ? ' (saison ' + season + ')' : ''} — modifie le lien puis enregistre`;
    document.getElementById('edit-banner').classList.add('show');
    checkDuplicateOverride();
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(stream ? 'ℹ️ Lien actuel préaffiché — modifie-le puis enregistre' : 'ℹ️ Renseigne le nouveau lien pour écraser le résultat automatique');
  }

  // Affiche le badge du mode actuel du formulaire (Nouveau / Édition / Correction)
  function setFormMode(mode) {
    const badge = document.getElementById('form-mode-badge');
    badge.textContent = mode;
    badge.dataset.mode = mode;
  }

  // Passe le formulaire en mode édition d'un override déjà actif : tous les champs
  // sont pré-remplis (y compris le lien), et le bouton devient "Mettre à jour".
  function editOverride(imdbId, season) {
    const o = overridesData.find(x => x.imdbId === imdbId && String(x.season || '') === String(season || ''));
    if (!o) return;
    editingKey = { imdbId: o.imdbId, season: o.season || '' };
    document.getElementById('ov-imdb').value = o.imdbId || '';
    document.getElementById('ov-season').value = o.season || '';
    document.getElementById('ov-ytid').value = o.ytId || '';
    document.getElementById('ov-url').value = o.url || '';
    document.getElementById('ov-title').value = o.title || '';
    document.getElementById('ov-mediatype').value = o.mediaType || '';
    document.getElementById('ov-notes').value = o.notes || '';
    // Liens de repli : on exclut le lien principal (déjà dans ov-ytid/ov-url)
    const links = Array.isArray(o.links) ? o.links.slice() : [];
    overrideLinks = links.filter(l => {
      const isPrimary = (l.ytId && l.ytId === o.ytId) || (l.url && l.url === o.url);
      return !isPrimary;
    });
    renderFallbacks();
    document.getElementById('ov-hidden').checked = !!o.hidden;
    toggleHiddenMode();
    document.getElementById('mapping-form-title').textContent = '✏️ Modifier l\'override';
    setFormMode('Édition');
    document.getElementById('ov-submit-btn').textContent = 'Mettre à jour';
    document.getElementById('edit-banner-text').textContent = `Modification de l'override pour ${o.imdbId}${o.season ? ' (saison ' + o.season + ')' : ''}`;
    document.getElementById('edit-banner').classList.add('show');
    updateFormPreview();
    onOverrideLinkInput();
    checkDuplicateOverride();
    showPage('mapping');
    document.getElementById('ov-imdb').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelEditOverride() {
    editingKey = null;
    overrideLinks = [];
    renderFallbacks();
    ['ov-imdb','ov-season','ov-ytid','ov-url','ov-title','ov-mediatype','ov-notes','tmdb-search','yt-search'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('link-status-0').textContent = '';
    document.getElementById('link-status-0').className = 'link-status';
    document.getElementById('link-status-url').textContent = '';
    document.getElementById('link-status-url').className = 'link-status';
    document.getElementById('link-test-result').textContent = '';
    document.getElementById('link-test-result').style.color = '';
    const hiddenEl = document.getElementById('ov-hidden');
    hiddenEl.checked = false;
    toggleHiddenMode();
    document.getElementById('mapping-form-title').textContent = '🎯 Ajouter / modifier un override';
    setFormMode('Nouveau');
    document.getElementById('ov-submit-btn').textContent = 'Enregistrer l\'override';
    document.getElementById('edit-banner').classList.remove('show');
    document.getElementById('form-preview-wrap').classList.remove('show');
    document.getElementById('tmdb-results').classList.remove('show');
    document.getElementById('yt-results').classList.remove('show');
    document.getElementById('dup-warning').style.display = 'none';
  }

  async function submitOverride() {
    const imdbId = extractImdbId(document.getElementById('ov-imdb').value.trim());
    const season = document.getElementById('ov-season').value.trim();
    const ytId = extractYoutubeId(document.getElementById('ov-ytid').value.trim());
    const url = document.getElementById('ov-url').value.trim();
    const title = document.getElementById('ov-title').value.trim();
    const mediaType = document.getElementById('ov-mediatype').value.trim();
    const hidden = document.getElementById('ov-hidden').checked;
    const notes = document.getElementById('ov-notes').value.trim();
    const fallbacks = overrideLinks
      .map(l => ({ ytId: extractYoutubeId((l.ytId || '').trim()), url: (l.url || '').trim() }))
      .filter(l => (l.ytId && /^[a-zA-Z0-9_-]{11}$/.test(l.ytId)) || l.url);

    if (!imdbId.startsWith('tt')) { toast('❌ IMDB ID invalide (doit commencer par "tt")'); return; }
    if (!ytId && !url && !fallbacks.length && !hidden) { toast('❌ Renseigne un YouTube ID, une URL directe, un lien de repli, ou coche "Masquer ce titre"'); return; }
    if (ytId && url) {
      toast('⚠️ YouTube ID ET URL directe remplis : seule la piste YouTube ID est enregistrée (l\'URL est ignorée — mets-la en lien de repli si besoin)');
    }

    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ imdbId, season: season ? Number(season) : null, ytId: ytId || null, url: ytId ? null : (url || null), links: fallbacks.length ? fallbacks : undefined, title: title || null, hidden, mediaType: mediaType || null, notes: notes || null }),
      });
      if (res.ok) {
        // En édition, si la saison a changé, l'entrée d'origine devient orpheline -> on la supprime.
        if (editingKey && (editingKey.imdbId !== imdbId || String(editingKey.season || '') !== String(season || ''))) {
          await fetch('/api/overrides?imdbId=' + encodeURIComponent(editingKey.imdbId) + '&season=' + encodeURIComponent(editingKey.season || ''), {
            method: 'DELETE', headers: authHeaders(),
          });
        }
        toast(editingKey ? '✅ Override mis à jour' : '✅ Override enregistré');
        cancelEditOverride();
        await loadMapping();
      } else toast('❌ Erreur lors de l\'enregistrement');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function deleteOverride(imdbId, season) {
    if (!confirm('Supprimer cet override ?')) return;
    try {
      const res = await fetch('/api/overrides?imdbId=' + encodeURIComponent(imdbId) + '&season=' + encodeURIComponent(season), {
        method: 'DELETE', headers: authHeaders(),
      });
      if (res.ok) {
        toast('✅ Override supprimé');
        if (editingKey && editingKey.imdbId === imdbId && String(editingKey.season || '') === String(season || '')) cancelEditOverride();
        await loadMapping();
      } else toast('❌ Erreur lors de la suppression');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function clearFailedLog() {
    if (!confirm('Vider le journal des échecs ?')) return;
    try {
      const res = await fetch('/api/failed-log', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Journal vidé'); await loadMapping(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function clearResolvedLog() {
    if (!confirm('Vider le journal des résolutions récentes ?')) return;
    try {
      const res = await fetch('/api/resolved-log', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Journal vidé'); await loadMapping(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

