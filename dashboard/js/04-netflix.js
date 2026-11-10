  // ---- CATALOGUE NETFLIX ----
  let nfCandidates = { nid: null, list: [] }; // candidats TMDB affichés quand le titre est ambigu

  // Appel d'API du dashboard : renvoie { ok, data } ; une session expirée (401) renvoie au login.
  async function nfCall(path, body) {
    const opts = body === undefined ? { headers: authHeaders() }
      : { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) };
    const res = await fetch(path, opts);
    if (res.status === 401) { logout(); return { ok: false, data: { error: 'Session expirée' } }; }
    let data = {};
    try { data = await res.json(); } catch (e) { /* réponse vide */ }
    return { ok: res.ok, data };
  }

  function nfBox(kind, html) { return '<div class="nf-box ' + kind + '">' + html + '</div>'; }
  function nfRow(label, value) {
    return '<div class="nf-row"><span class="nf-k">' + escapeHtml(label) + '</span><span class="nf-v mono">' + (value === null || value === undefined || value === '' ? '—' : escapeHtml(value)) + '</span></div>';
  }
  function nfTypeLabel(t) { return t === 'tv' ? 'Série' : t === 'movie' ? 'Film' : null; }

  async function loadNetflixPage() {
    const { ok, data } = await nfCall('/api/netflix-catalog');
    if (!ok) { toast(data.error || 'Erreur de chargement'); return; }
    document.getElementById('nf-titles').textContent = data.titles;
    document.getElementById('nf-imdb').textContent = data.titlesWithImdb;
    document.getElementById('nf-seen').textContent = data.tmdbSeenOnNetflixFr;
    document.getElementById('nf-checked').textContent = data.nidLookupAttempted;
    const notes = [];
    if (!data.syncEnabled) notes.push('⚠️ La synchro automatique est désactivée (NETFLIX_SYNC=0).');
    if (!data.tmdbKeyConfigured) notes.push('⚠️ TMDB_API_KEY n\'est pas définie : seul Wikidata alimente le catalogue, et la recherche TMDB de cet onglet est indisponible.');
    document.getElementById('nf-note').innerHTML = notes.map(escapeHtml).join('<br>');
  }

  async function nfSyncNow() {
    const { ok, data } = await nfCall('/api/netflix-catalog/sync', {});
    toast(ok ? 'Synchro lancée en arrière-plan — actualise dans une minute' : (data.error || 'Erreur'));
  }

  // ---- URL Netflix -> TMDB -> IMDB ----
  async function nfTestUrl() {
    const url = document.getElementById('nf-url').value.trim();
    const out = document.getElementById('nf-url-result');
    if (!url) { toast('Colle une URL ou un ID Netflix'); return; }
    const btn = document.getElementById('nf-url-btn');
    btn.disabled = true; out.innerHTML = nfBox('', 'Lecture de la page Netflix…');
    try {
      const { ok, data } = await nfCall('/api/netflix-catalog/from-url', { url, dryRun: document.getElementById('nf-dry').checked });
      out.innerHTML = ok ? nfRenderLinkResult(data) : nfBox('err', '❌ ' + escapeHtml(data.error || 'Erreur'));
      if (ok && data.status === 'linked') loadNetflixPage();
    } catch (e) {
      out.innerHTML = nfBox('err', '❌ Erreur réseau : ' + escapeHtml(e.message));
    } finally { btn.disabled = false; }
  }

  function nfRenderLinkResult(d) {
    const info = d.info ? nfRow('Page Netflix', d.info.title + (d.info.year ? ' (' + d.info.year + ')' : '') + (nfTypeLabel(d.info.mediaType) ? ' · ' + nfTypeLabel(d.info.mediaType) : '')) : '';
    if (d.status === 'exists') return nfBox('ok', '✅ Déjà dans le catalogue' + nfRowCatalog(d.row));
    if (d.status === 'linked') return nfBox('ok', '✅ Enregistré dans le catalogue' + info + nfRowCatalog(d.row));
    if (d.status === 'preview') {
      return nfBox('ok', '🔬 Résultat du test (rien n\'est enregistré)' + info +
        nfRow('Titre TMDB', d.match.title + (d.match.year ? ' (' + d.match.year + ')' : '')) + nfRow('TMDB', nfTypeLabel(d.match.type) + ' #' + d.match.tmdbId) +
        nfRow('IMDB', d.imdbId || 'inconnu chez TMDB') + '<div class="nf-hint">Décoche « Tester sans enregistrer » puis relance pour l\'enregistrer.</div>');
    }
    if (d.status === 'ambiguous') {
      nfCandidates = { nid: d.nid, list: d.candidates || [] };
      const items = nfCandidates.list.map(function (c, i) {
        return '<div class="nf-cand"><span>' + escapeHtml(c.title || '?') + (c.year ? ' (' + c.year + ')' : '') + ' · ' + escapeHtml(nfTypeLabel(c.type) || '') + ' #' + c.tmdbId +
          '</span><button class="btn-outline-sm" onclick="nfLink(' + i + ')">C\'est celui-là</button></div>';
      }).join('');
      return nfBox('warn', '⚠️ Aucune correspondance sûre sur TMDB — choisis le bon titre' + info + items);
    }
    return nfBox('warn', '⚠️ Rien trouvé sur TMDB pour ce titre' + info);
  }

  function nfRowCatalog(r) {
    if (!r) return '';
    return nfRow('ID Netflix', r.nid) + nfRow('IMDB', r.imdb_id) + nfRow('TMDB', r.tmdb_id ? (nfTypeLabel(r.type) || '') + ' #' + r.tmdb_id : null) + nfRow('Source', r.source);
  }

  async function nfLink(i) {
    const c = nfCandidates.list[i];
    if (!c) return;
    const out = document.getElementById('nf-url-result');
    const { ok, data } = await nfCall('/api/netflix-catalog/link', { nid: nfCandidates.nid, type: c.type, tmdbId: c.tmdbId, title: c.title, year: c.year });
    out.innerHTML = ok ? nfRenderLinkResult(data) : nfBox('err', '❌ ' + escapeHtml(data.error || 'Erreur'));
    if (ok) loadNetflixPage();
  }

  // ---- Recherche dans le catalogue / bandes-annonces ----
  async function nfSearch() {
    const q = document.getElementById('nf-q').value.trim();
    const out = document.getElementById('nf-q-result');
    if (!q) { toast('Colle un IMDB ID, un ID Netflix ou une URL'); return; }
    const { ok, data } = await nfCall('/api/netflix-catalog/lookup?q=' + encodeURIComponent(q));
    if (!ok) { out.innerHTML = nfBox('err', '❌ ' + escapeHtml(data.error || 'Erreur')); return; }
    let html = '';
    if (data.rows.length) html += nfBox('ok', '✅ ' + data.rows.length + ' correspondance(s) dans le catalogue' + data.rows.map(nfRowCatalog).join('<hr class="nf-sep">'));
    else html += nfBox('warn', '⚠️ Pas dans le catalogue (' + escapeHtml(data.query) + ')');
    if (data.seenOnNetflixFr && data.seenOnNetflixFr.length) {
      html += nfBox('', '📺 TMDB le signale disponible sur Netflix France' + data.seenOnNetflixFr.map(function (s) {
        return nfRow('Titre', s.title + (s.year ? ' (' + s.year + ')' : '')) + nfRow('ID Netflix cherché sur Wikidata', s.nid_checked_at ? 'oui, le ' + s.nid_checked_at.slice(0, 10) : 'pas encore');
      }).join(''));
    }
    out.innerHTML = html;
  }

  async function nfTrailers() {
    const q = document.getElementById('nf-q').value.trim();
    const out = document.getElementById('nf-q-result');
    if (!q) { toast('Colle un ID Netflix ou une URL'); return; }
    out.innerHTML = nfBox('', 'Lecture de la page Netflix…');
    const { ok, data } = await nfCall('/api/netflix-catalog/trailers', { q });
    if (!ok) { out.innerHTML = nfBox('err', '❌ ' + escapeHtml(data.error || 'Erreur')); return; }
    if (!data.trailers.length) { out.innerHTML = nfBox('warn', '⚠️ Aucune bande-annonce lisible sur la page Netflix ' + escapeHtml(data.nid) + ' (page bloquée, sans bande-annonce, ou format changé)'); return; }
    out.innerHTML = nfBox('ok', '✅ ' + data.trailers.length + ' bande(s)-annonce(s) trouvée(s)' +
      data.trailers.map(function (t) { return nfRow(t.title || 'Bande-annonce', t.runtimeSec ? Math.round(t.runtimeSec) + ' s' : null); }).join('') +
      nfRow('Lien relais de l\'addon', data.relayUrl));
  }
