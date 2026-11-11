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
    nfCrawlerLoad();
    nfCoverageLoad();
    nfLoadTable();
    nfStartPolling();
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

  // ---- Exploration en arrière-plan ----
  let nfInterval = null;
  const nfFmt = n => Number(n || 0).toLocaleString('fr-FR');

  function nfStartPolling() {
    if (nfInterval) return;
    nfInterval = setInterval(function () {
      if (!document.getElementById('page-netflix').classList.contains('active')) { nfStopPolling(); return; }
      nfCrawlerLoad(true);
      nfCoverageLoad();
    }, 8000);
  }
  function nfStopPolling() { if (nfInterval) { clearInterval(nfInterval); nfInterval = null; } }

  async function nfCrawlerLoad(refreshTable) {
    const { ok, data } = await nfCall('/api/netflix-catalog/crawler');
    if (!ok) return;
    nfRenderCrawler(data);
    if (refreshTable && data.enabled && nfTable.page === 1 && !nfTable.q) nfLoadTable(true);
  }

  function nfRenderCrawler(d) {
    const c = d.counts;
    const pill = document.getElementById('nfc-pill');
    let kind = 'off', label = 'Arrêtée';
    if (!d.available) { kind = 'off'; label = 'Désactivée (NETFLIX_CRAWL=0)'; }
    else if (d.enabled && d.paused) { kind = 'pause'; label = 'En pause jusqu\'à ' + new Date(d.pausedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
    else if (d.enabled) { kind = 'on'; label = 'En cours'; }
    pill.className = 'nfc-pill ' + kind;
    pill.textContent = label;
    const sw = document.getElementById('nfc-enabled');
    sw.checked = d.enabled; sw.disabled = !d.available;
    document.getElementById('nf-crawler').classList.toggle('running', d.enabled && !d.paused);

    const processed = d.total - c.pending;
    document.getElementById('nfc-bar-fill').style.width = Math.min(100, d.progress * 100).toFixed(1) + '%';
    document.getElementById('nfc-progress-text').textContent = nfFmt(processed) + ' / ' + nfFmt(d.total) + ' pages explorées · ' + Math.round(d.progress * 100) + ' %';
    document.getElementById('nfc-eta').textContent = c.pending > 0 && d.enabled ? '≈ ' + (d.etaHours >= 1 ? d.etaHours.toLocaleString('fr-FR') + ' h' : Math.max(1, Math.round(d.etaHours * 60)) + ' min') + ' restantes (sans compter les nouveaux ID)' : '';
    document.getElementById('nfc-pending').textContent = nfFmt(c.pending);
    document.getElementById('nfc-done').textContent = nfFmt(c.done);
    document.getElementById('nfc-disc').textContent = '+' + nfFmt(d.session.discovered);
    document.getElementById('nfc-matched').textContent = '+' + nfFmt(d.session.matched);
    document.getElementById('nfc-issues').textContent = nfFmt(c.missing + c.noinfo + c.error);
    nfRenderSpeed(d.delayMs);
    const last = [];
    if (d.last.nid) last.push('Dernier : ' + (d.last.title ? d.last.title + ' ' : '') + '#' + d.last.nid);
    if (d.last.error) last.push('⚠️ ' + d.last.error);
    document.getElementById('nfc-last').textContent = last.join(' · ');
  }

  async function nfCrawlerToggle(on) {
    const { ok, data } = await nfCall('/api/netflix-catalog/crawler', { enabled: !!on });
    if (!ok) { toast(data.error || 'Erreur'); document.getElementById('nfc-enabled').checked = !on; return; }
    nfRenderCrawler(data);
    toast(on ? 'Exploration démarrée' : 'Exploration arrêtée');
  }

  // Cadences proposées : [libellé, délai en ms]. Le débit affiché tient compte de l'aléatoire (+12,5 % en moyenne).
  const NF_SPEEDS = [['Rapide', 1500], ['Normal', 4000], ['Discret', 10000], ['Très discret', 30000]];

  function nfRenderSpeed(delayMs) {
    const seg = document.getElementById('nfc-seg');
    const list = NF_SPEEDS.some(function (s) { return s[1] === delayMs; }) ? NF_SPEEDS : NF_SPEEDS.concat([['Perso', delayMs]]);
    seg.innerHTML = list.map(function (s) {
      const perHour = Math.round(3600000 / (s[1] * 1.125) / 10) * 10;
      return '<button type="button" class="nfc-seg-btn' + (s[1] === delayMs ? ' active' : '') + '" onclick="nfCrawlerDelay(' + s[1] + ')">' +
        '<b>' + escapeHtml(s[0]) + '</b><span>' + (s[1] / 1000).toLocaleString('fr-FR') + ' s · ≈ ' + perHour.toLocaleString('fr-FR') + ' /h</span></button>';
    }).join('');
  }

  async function nfCrawlerDelay(ms) {
    const { ok, data } = await nfCall('/api/netflix-catalog/crawler', { delayMs: Number(ms) });
    if (!ok) { toast(data.error || 'Erreur'); return; }
    nfRenderCrawler(data);
    toast('Cadence mise à jour');
  }

  // ---- Table des ID ----
  let nfTable = { q: '', filter: 'all', page: 1, size: 25, total: 0 };
  let nfSearchTimer = null;

  function nfShowTab(name) {
    document.querySelectorAll('#page-netflix .nf-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.nftab === name); });
    document.getElementById('nf-tab-table').style.display = name === 'table' ? '' : 'none';
    document.getElementById('nf-tab-tools').style.display = name === 'tools' ? '' : 'none';
  }

  function nfTableSearchDebounced() {
    clearTimeout(nfSearchTimer);
    nfSearchTimer = setTimeout(function () {
      nfTable.q = document.getElementById('nf-t-q').value.trim();
      nfTable.page = 1;
      nfLoadTable();
    }, 300);
  }

  function nfSetFilter(f) {
    nfTable.filter = f; nfTable.page = 1;
    document.querySelectorAll('#nf-chips .nf-chip').forEach(function (b) { b.classList.toggle('active', b.dataset.f === f); });
    nfLoadTable();
  }

  function nfGoPage(p) { nfTable.page = p; nfLoadTable(); }

  const NF_STATUS = {
    pending: ['À explorer', 'grey'], done: ['Exploré', 'green'], missing: ['Absent FR', 'amber'],
    noinfo: ['Illisible', 'amber'], error: ['Erreur', 'red'],
  };
  const NF_SOURCE = { manual: 'Manuel', tmdb: 'TMDB', wikidata: 'Wikidata', crawl: 'Exploration' };

  function nfBadge(text, kind) { return '<span class="nf-badge ' + kind + '">' + escapeHtml(text) + '</span>'; }

  const NF_LINK = {
    ok: ['Vérifié', 'green', 'Titre et année concordent avec TMDB'],
    weak: ['Probable', 'amber', 'Le titre ou l\'année concorde avec TMDB (titre traduit autrement, par exemple)'],
    mismatch: ['Douteux', 'red', 'Ni le titre ni l\'année ne concordent : lien écarté de la distribution'],
    unknown: ['Inconnu', 'grey', 'TMDB ne connaît pas ce titre'],
  };

  function nfRenderRow(r) {
    const st = NF_STATUS[r.crawl_status || 'pending'] || NF_STATUS.pending;
    const tmdb = r.tmdb_id
      ? '<a class="nf-link mono" target="_blank" rel="noopener" href="https://www.themoviedb.org/' + (r.type === 'tv' ? 'tv' : 'movie') + '/' + encodeURIComponent(r.tmdb_id) + '">' + escapeHtml(r.tmdb_id) + '</a>'
      : '<span class="nf-dash">—</span>';
    const imdb = r.imdb_id
      ? '<a class="nf-link mono" target="_blank" rel="noopener" href="https://www.imdb.com/title/' + encodeURIComponent(r.imdb_id) + '/">' + escapeHtml(r.imdb_id) + '</a>'
      : '<span class="nf-dash">—</span>';
    let link = '<span class="nf-dash">—</span>';
    if (r.imdb_id) {
      const l = NF_LINK[r.link_status] || (r.source === 'manual' ? ['Manuel', 'blue', 'Saisi à la main : fait foi'] : ['À vérifier', 'grey', 'Pas encore vérifié contre TMDB']);
      link = '<span title="' + escapeHtml(l[2]) + '">' + nfBadge(l[0], l[1]) + '</span>';
    }
    const trailer = r.has_trailer === 1 ? nfBadge('✓ Oui', 'green') : r.has_trailer === 0 ? nfBadge('Aucune', 'amber') : '<span class="nf-dash">—</span>';
    const served = r.served_count > 0
      ? '<span class="mono" title="' + r.served_count + ' fois proposée · ' + (r.played_count || 0) + ' lecture(s)">' + nfFmt(r.served_count) + '×</span>'
      : '<span class="nf-dash">—</span>';
    return '<tr>' +
      '<td><a class="nf-link mono" target="_blank" rel="noopener" href="https://www.netflix.com/title/' + encodeURIComponent(r.nid) + '">' + escapeHtml(r.nid) + '</a></td>' +
      '<td class="nf-title-cell">' + (r.title ? escapeHtml(r.title) : '<span class="nf-dash">non lu</span>') + '</td>' +
      '<td class="mono">' + (r.year || '<span class="nf-dash">—</span>') + '</td>' +
      '<td>' + (nfTypeLabel(r.type) ? nfBadge(nfTypeLabel(r.type), r.type === 'tv' ? 'purple' : 'blue') : '<span class="nf-dash">—</span>') + '</td>' +
      '<td>' + tmdb + '</td><td>' + imdb + '</td><td>' + link + '</td><td>' + trailer + '</td><td>' + served + '</td>' +
      '<td><span title="Source : ' + escapeHtml(NF_SOURCE[r.source] || r.source) + '">' + nfBadge(st[0], st[1]) + '</span></td></tr>';
  }

  async function nfLoadTable(silent) {
    const body = document.getElementById('nf-t-body');
    const qs = 'q=' + encodeURIComponent(nfTable.q) + '&filter=' + nfTable.filter + '&page=' + nfTable.page + '&size=' + nfTable.size;
    const { ok, data } = await nfCall('/api/netflix-catalog/titles?' + qs);
    if (!ok) { if (!silent) body.innerHTML = '<tr class="empty-row"><td colspan="10">' + escapeHtml(data.error || 'Erreur') + '</td></tr>'; return; }
    nfTable.total = data.total; nfTable.page = data.page;
    body.innerHTML = data.rows.length ? data.rows.map(nfRenderRow).join('')
      : '<tr class="empty-row"><td colspan="10">Aucun titre' + (nfTable.q || nfTable.filter !== 'all' ? ' pour ce filtre' : ' pour l\'instant') + '</td></tr>';
    nfRenderPager(data);
  }

  function nfRenderPager(d) {
    const pages = Math.max(1, Math.ceil(d.total / d.size));
    const el = document.getElementById('nf-pager');
    const from = d.total ? (d.page - 1) * d.size + 1 : 0;
    const to = Math.min(d.total, d.page * d.size);
    el.innerHTML = '<span class="nf-pager-info">' + nfFmt(from) + '–' + nfFmt(to) + ' sur ' + nfFmt(d.total) + '</span>' +
      '<span class="nf-pager-btns">' +
      '<button class="btn-outline-sm" ' + (d.page <= 1 ? 'disabled' : 'onclick="nfGoPage(1)"') + '>«</button>' +
      '<button class="btn-outline-sm" ' + (d.page <= 1 ? 'disabled' : 'onclick="nfGoPage(' + (d.page - 1) + ')"') + '>‹ Préc.</button>' +
      '<span class="nf-pager-page">' + d.page + ' / ' + nfFmt(pages) + '</span>' +
      '<button class="btn-outline-sm" ' + (d.page >= pages ? 'disabled' : 'onclick="nfGoPage(' + (d.page + 1) + ')"') + '>Suiv. ›</button>' +
      '<button class="btn-outline-sm" ' + (d.page >= pages ? 'disabled' : 'onclick="nfGoPage(' + pages + ')"') + '>»</button></span>';
  }

  // ---- Couverture : de l'ID Netflix jusqu'à la distribution ----
  async function nfCoverageLoad() {
    const { ok, data: c } = await nfCall('/api/netflix-catalog/coverage');
    if (!ok) return;
    const total = c.total || 1;
    const steps = [
      ['Titres en base', c.total, 'grey', null],
      ['Pages Netflix lues', c.read, 'blue', null],
      ['Liés à un IMDB ID', c.with_imdb, 'blue', null],
      ['Liens vérifiés (titre/année concordent)', c.verified, 'green', c.mismatch ? c.mismatch + ' douteux écartés' : null],
      ['Avec une bande-annonce sur la page', c.with_trailer, 'purple', c.without_trailer ? c.without_trailer + ' sans' : null],
      ['Prêts à distribuer (IMDB + bande-annonce)', c.ready, 'red', c.imdb_unread ? c.imdb_unread + ' pas encore lus' : null],
      ['Déjà proposés à Stremio', c.served_titles, 'green', c.served_total ? nfFmt(c.served_total) + ' fois · ' + nfFmt(c.played_total) + ' lecture(s)' : null],
    ];
    document.getElementById('nfv-steps').innerHTML = steps.map(function (s) {
      const pct = Math.min(100, (s[1] / total) * 100);
      return '<div class="nfv-step"><div class="nfv-row"><span class="nfv-k">' + escapeHtml(s[0]) + '</span>' +
        '<span class="nfv-v">' + nfFmt(s[1]) + ' <small>' + (pct < 1 && s[1] ? '<1' : Math.round(pct)) + ' %</small></span></div>' +
        '<div class="nfv-bar"><div class="nfv-fill ' + s[2] + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
        (s[3] ? '<div class="nfv-extra">' + escapeHtml(s[3]) + '</div>' : '') + '</div>';
    }).join('');
    document.getElementById('nfv-ready-n').textContent = nfFmt(c.ready);
    const note = [];
    if (c.read) note.push(Math.round((c.with_trailer / c.read) * 100) + ' % des pages lues ont une bande-annonce');
    if (c.unverified) note.push(nfFmt(c.unverified) + ' lien(s) IMDB pas encore vérifié(s) : l\'exploration les vérifie au fil de l\'eau');
    document.getElementById('nfv-note').textContent = note.join(' · ');
  }
