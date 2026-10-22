  // ---- Statut des services (TMDB/YouTube/Allociné), vérifié côté serveur toutes les 6h ----
  const SVC_LABELS = { tmdb: 'TMDB', youtube: 'YouTube', allocine: 'Allociné' };
  function timeAgoFr(iso) {
    const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    const h = Math.round(diffMin / 60);
    return `il y a ${h}h`;
  }
  function timeUntilFr(iso) {
    const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (diffMin <= 0) return 'bientôt';
    if (diffMin < 60) return `dans ${diffMin} min`;
    return `dans ${Math.round(diffMin / 60)}h`;
  }
  async function loadServicesStatus(forceRefreshFeedback) {
    const grid = document.getElementById('svc-status-grid');
    const desc = document.getElementById('svc-status-desc');
    if (forceRefreshFeedback) desc.textContent = 'Vérification en cours...';
    try {
      const res = await fetch('/api/services-status', { headers: authHeaders() });
      if (!res.ok) throw new Error('Requête échouée');
      const data = await res.json();
      grid.innerHTML = ['tmdb', 'youtube', 'allocine'].map(svc => {
        const up = data[svc] === 'up';
        return `<div class="svc-pill ${up ? 'svc-up' : 'svc-down'}"><span class="svc-dot"></span>${SVC_LABELS[svc]} — ${up ? 'OK' : 'HS'}</div>`;
      }).join('');
      desc.textContent = `Vérifié ${timeAgoFr(data.checkedAt)} — prochaine vérification ${timeUntilFr(data.nextCheckAt)}`;
    } catch (e) {
      desc.textContent = 'Impossible de vérifier le statut des services pour le moment.';
    }
  }

  function restartLogPolling() {
    if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
    if (logsPaused) return;
    const ms = Number(document.getElementById('logs-interval').value);
    if (ms > 0) logsInterval = setInterval(loadLogs, ms);
  }

  function toggleLogPause() {
    logsPaused = !logsPaused;
    const btn = document.getElementById('logs-pausebtn');
    const dot = document.getElementById('logs-dot');
    const text = document.getElementById('logs-statustext');
    if (logsPaused) {
      if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
      btn.textContent = '▶️ Reprendre'; btn.classList.add('paused');
      dot.classList.add('paused'); text.textContent = 'Paused';
    } else {
      btn.textContent = '⏸️ Pause'; btn.classList.remove('paused');
      dot.classList.remove('paused'); text.textContent = 'Live';
      restartLogPolling();
    }
  }

  async function loadLogs() {
    if (logsPaused) return;
    try {
      const res = await fetch('/api/logs', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      allLogs = await res.json(); // le plus récent en premier (base Postgres)
      renderLogs();
      refreshLogsBadgeFrom(allLogs);
    } catch (e) { /* silencieux, on retentera au prochain tick */ }
  }

  function renderLogs() {
    const ctxFilter = document.getElementById('logs-ctx').value;
    const levelFilter = document.getElementById('logs-level').value;
    const search = document.getElementById('logs-search').value.trim().toLowerCase();

    // du plus ancien au plus récent, comme un vrai terminal qui défile vers le bas
    let filtered = [...allLogs].reverse();
    if (ctxFilter) filtered = filtered.filter(l => l.context === ctxFilter);
    if (levelFilter) filtered = filtered.filter(l => (LOG_LEVEL_PRIORITY[l.level] ?? 0) >= LOG_LEVEL_PRIORITY[levelFilter]);
    if (search) {
      const haystackOf = l => String(l.message || l.event || '').toLowerCase() + (l.meta ? ' ' + JSON.stringify(l.meta).toLowerCase() : '');
      filtered = filtered.filter(l => haystackOf(l).includes(search));
    }

    const term = document.getElementById('logs-term');
    if (!filtered.length) {
      term.innerHTML = '<div class="logs-empty"><div class="icon">📋</div><p>Aucun log ne correspond</p></div>';
      return;
    }

    const META_LABELS = { ip: 'IP', imdbId: 'IMDB', season: 'Saison', pseudo: 'Pseudo', source: 'Source', path: 'Route', type: 'Type', service: 'Service', ytId: 'YouTube', requested: 'Demandé', actual: 'Servi', error: 'Erreur', links: 'Liens', hidden: 'Masqué', title: 'Titre', result: 'Résultat', ms: 'Durée', cache: 'Cache' };
    function formatMetaValue(v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }
    function formatMeta(meta) {
      if (!meta) return '';
      const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (!entries.length) return '';
      // Le pseudo passe toujours en premier et en évidence : c'est l'info la
      // plus utile pour retrouver qui a rencontré quoi.
      entries.sort(([ka], [kb]) => (ka === 'pseudo' ? -1 : kb === 'pseudo' ? 1 : 0));
      const chips = entries.map(([k, v]) => {
        const isPseudo = k === 'pseudo';
        return `<span class="meta-chip${isPseudo ? ' chip-pseudo' : ''}"><b>${isPseudo ? '👤' : (META_LABELS[k] || k)}</b>${escapeHtml(formatMetaValue(v))}</span>`;
      });
      return `<div class="log-meta">${chips.join('')}</div>`;
    }

    const wasAtBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 40;
    term.innerHTML = filtered.map(l => {
      const ctx = CTX_META[l.context] || CTX_META.SYSTEM;
      const lv = LOG_LEVEL_PRIORITY[l.level] !== undefined ? l.level : 'info';
      const d = new Date(l.time || l.timestamp || 0);
      const time = isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('fr-FR');
      return `<div class="log-row row-lv-${lv}">
        <span class="log-time">${time}</span>
        <span class="log-level lv-${lv}">${lv.toUpperCase()}</span>
        <span class="log-ctx" style="background:${ctx.color}20;color:${ctx.color}">${ctx.icon} ${l.context || 'SYSTEM'}</span>
        <span class="log-msg">${escapeHtml(l.message || l.event || '—')}</span>
        ${formatMeta(l.meta)}
      </div>`;
    }).join('');
    if (wasAtBottom) term.scrollTop = term.scrollHeight;
  }

  function refreshLogsBadgeFrom(logs) {
    const errorCount = logs.filter(l => l.level === 'error').length;
    const badge = document.getElementById('logs-badge');
    if (errorCount) { badge.style.display = 'inline-block'; badge.textContent = errorCount; }
    else badge.style.display = 'none';
  }

  async function refreshLogsBadge() {
    try {
      const res = await fetch('/api/logs', { headers: authHeaders() });
      refreshLogsBadgeFrom(await res.json());
    } catch (e) { /* silencieux */ }
  }

  function exportLogs() {
    if (!allLogs.length) { toast('⚠️ Aucun log à exporter'); return; }
    const lines = [...allLogs].reverse().map(l => {
      const time = new Date(l.time).toLocaleString('fr-FR');
      const meta = l.meta ? ' ' + JSON.stringify(l.meta) : '';
      return `[${time}] ${(l.level || 'info').toUpperCase()} (${l.context || 'SYSTEM'}) ${l.message || l.event || ''}${meta}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `vftrailers-logs-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('✅ Export téléchargé');
  }

  async function clearLogs() {
    if (!confirm('Vider tous les logs ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/logs', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Logs vidés'); await loadLogs(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

