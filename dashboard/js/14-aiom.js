  // ---- LIEN AIOMETADATA PARTAGÉ ----
  function setAiomManifestLink() {
    const url = window.location.origin + '/aiom/manifest.json';
    document.getElementById('aiom-manifest-url').value = url;
    document.getElementById('aiom-open').href = url;
  }

  let aiomStatsRequest = 0;
  let aiomStatsLoaded = false;
  let aiomSourceUrl = null;
  let aiomSourceRevision = 0;
  let aiomSourceSaving = false;

  function renderAiomSource(url) {
    const field = document.getElementById('aiom-source-url');
    if (aiomSourceUrl === null || field.value === aiomSourceUrl) field.value = url;
    aiomSourceUrl = url;
    field.disabled = false;
    document.getElementById('aiom-source-save').disabled = false;
    document.getElementById('aiom-response-format').textContent = url ? '1 bande-annonce YouTube ou MP4' : '1 bande-annonce VF en MP4';
    document.getElementById('aiom-response-source').textContent = url ? 'Manifest source externe' : 'YouTube 1080p, Allociné ou Stockage DB';
    const key = document.getElementById('aiom-key-status');
    key.hidden = !!url;
    document.getElementById('aiom-key-warning').hidden = !!url || key.dataset.state !== 'missing';
  }

  async function saveAiomSource() {
    if (aiomSourceUrl === null || aiomSourceSaving) return;
    const field = document.getElementById('aiom-source-url');
    const button = document.getElementById('aiom-source-save');
    const status = document.getElementById('aiom-source-status');
    aiomSourceSaving = true;
    ++aiomSourceRevision;
    field.disabled = button.disabled = true;
    status.dataset.state = '';
    status.textContent = 'Vérification du manifest…';
    try {
      const response = await authFetch('/api/settings/aiom-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceManifestUrl: field.value.trim() }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.sourceManifestUrl !== 'string') {
        status.dataset.state = 'error';
        status.textContent = data.error || 'Enregistrement impossible.';
        return;
      }
      field.value = data.sourceManifestUrl;
      renderAiomSource(data.sourceManifestUrl);
      status.textContent = data.sourceManifestUrl ? 'Source externe active.' : 'Sources natives rétablies.';
    } catch {
      status.dataset.state = 'error';
      status.textContent = 'Enregistrement impossible. Réessaie.';
    } finally {
      aiomSourceSaving = false;
      ++aiomSourceRevision;
      field.disabled = button.disabled = false;
    }
  }

  function loadAiomSettings() {
    setAiomManifestLink();
    return loadAiomStats();
  }

  async function loadAiomStats() {
    const request = ++aiomStatsRequest;
    const sourceRevision = aiomSourceRevision;
    const refresh = document.getElementById('aiom-refresh');
    const stats = document.getElementById('aiom-stats');
    refresh.disabled = true;
    stats.setAttribute('aria-busy', 'true');
    try {
      const response = await authFetch('/api/aiom-stats');
      if (!response.ok) throw new Error('Statistiques indisponibles');
      const data = await response.json();
      // Une réponse ancienne ne doit jamais remplacer une actualisation plus récente.
      if (request !== aiomStatsRequest) return;
      if (!aiomSourceSaving && sourceRevision === aiomSourceRevision && typeof data.sourceManifestUrl === 'string') {
        renderAiomSource(data.sourceManifestUrl);
      }
      if (!data.configured) throw new Error('Statistiques indisponibles');
      renderAiomStats(data);
      aiomStatsLoaded = true;
      document.getElementById('aiom-stats-error').hidden = true;
      document.getElementById('aiom-updated').textContent = 'Mis à jour à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      if (request !== aiomStatsRequest) return;
      const error = document.getElementById('aiom-stats-error');
      error.textContent = aiomStatsLoaded
        ? 'Actualisation impossible. Les dernières données restent affichées. Le lien reste accessible.'
        : 'Statistiques indisponibles pour le moment. Le lien reste accessible. Réessaie avec Actualiser.';
      error.hidden = false;
      document.getElementById('aiom-updated').textContent = 'Actualisation impossible';
      if (!aiomStatsLoaded) {
        document.getElementById('aiom-key-status').textContent = 'Statut de la clé indisponible';
        ['aiom-activity', 'aiom-outcomes', 'aiom-recent'].forEach(id => {
          document.getElementById(id).innerHTML = '<div class="aiom-empty">Données indisponibles pour le moment.</div>';
        });
      }
    } finally {
      if (request === aiomStatsRequest) {
        refresh.disabled = false;
        stats.setAttribute('aria-busy', 'false');
      }
    }
  }

  function aiomCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  }

  function renderAiomStats(data) {
    const total = aiomCount(data.total), found = aiomCount(data.found);
    const outcomes = data.byOutcome || {};
    const text = (id, value) => { document.getElementById(id).textContent = value; };
    text('aiom-total', total.toLocaleString('fr-FR'));
    text('aiom-today', 'Aujourd’hui : ' + aiomCount(data.today).toLocaleString('fr-FR'));
    text('aiom-hit-rate', total ? Math.min(100, Math.round(found / total * 100)) + ' %' : '—');
    text('aiom-found', found.toLocaleString('fr-FR') + (found === 1 ? ' renvoyée' : ' renvoyées'));
    text('aiom-avg-ms', total ? aiomCount(data.avgMs).toLocaleString('fr-FR') + ' ms' : '—');
    text('aiom-cache-rate', 'Servies par le cache : ' + (total ? Math.min(100, aiomCount(data.cacheRate)) + ' %' : '—'));
    text('aiom-timeouts', aiomCount(outcomes.timeout).toLocaleString('fr-FR'));
    text('aiom-timeout', aiomCount(data.timeoutSeconds) + ' secondes');
    text('aiom-chart-total', total.toLocaleString('fr-FR') + ' demandes');
    const status = document.getElementById('aiom-key-status');
    status.dataset.state = data.tmdbConfigured ? 'ready' : 'missing';
    status.textContent = data.tmdbConfigured ? 'Clé TMDB configurée' : 'Clé TMDB absente';
    document.getElementById('aiom-key-warning').hidden = !!aiomSourceUrl || !!data.tmdbConfigured;
    document.getElementById('aiom-activity').innerHTML = renderAiomActivity(data.days || []);
    document.getElementById('aiom-outcomes').innerHTML = [
      ['ytId', 'YouTube', 'red'], ['url', 'Vidéo directe', 'blue'], ['aucun', 'Aucun trailer VF', 'muted'],
      ['timeout', 'Délai dépassé', 'amber'], ['masque', 'Titre masqué', 'purple'],
    ].map(([key, label, color]) => {
      const count = aiomCount(outcomes[key]);
      const share = total ? Math.min(100, Math.round(count / total * 100)) : 0;
      return '<div class="aiom-outcome"><div><span><i class="aiom-dot aiom-' + color + '"></i>' + label + '</span><strong>' + count.toLocaleString('fr-FR') + '</strong></div>' +
        '<div class="aiom-track"><span class="aiom-' + color + '" style="width:' + share + '%"></span></div></div>';
    }).join('');
    const recent = (data.recent || []).slice(0, 6);
    document.getElementById('aiom-recent').innerHTML = recent.length ? recent.map(entry => {
      const date = new Date(entry.time);
      const time = Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const state = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
      return '<div class="aiom-event"><span class="aiom-event-dot ' + state + '" aria-hidden="true"></span><p>' + escapeHtml(entry.message || 'Événement AIOM') + '</p><time>' + escapeHtml(time) + '</time></div>';
    }).join('') : '<div class="aiom-empty">Aucun événement AIOM pour l’instant. Les prochaines demandes apparaîtront ici.</div>';
  }

  function renderAiomActivity(days) {
    const max = Math.max(1, ...days.map(day => aiomCount(day.count)));
    if (!days.some(day => aiomCount(day.count))) return '<div class="aiom-empty">Aucune demande sur les 14 derniers jours.<small>Le graphique se remplira lors des premières requêtes AIOM.</small></div>';
    return '<ol class="aiom-chart" aria-label="Demandes AIOM par jour">' + days.map((day, index) => {
      const count = aiomCount(day.count);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date.slice(8) + '/' + day.date.slice(5, 7) : '—';
      const label = date + ' · ' + count.toLocaleString('fr-FR') + ' demande(s)';
      const showDate = (index % 3 === 0 && index < days.length - 2) || index === days.length - 1;
      return '<li title="' + escapeHtml(label) + '" tabindex="0" aria-label="' + escapeHtml(label) + '"><div class="aiom-bar-area"><span class="aiom-bar' + (index === days.length - 1 ? ' is-today' : '') + '" style="height:' + Math.max(2, Math.round(count / max * 100)) + '%"></span><span class="aiom-bar-tooltip">' + count.toLocaleString('fr-FR') + '</span></div><span class="aiom-bar-date">' + (showDate ? date : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function openAiomLogs() {
    document.getElementById('logs-ctx').value = 'AIOM';
    document.getElementById('logs-level').value = '';
    document.getElementById('logs-search').value = '';
    showPage('logs');
  }

  async function copyAiomManifest() {
    setAiomManifestLink();
    const field = document.getElementById('aiom-manifest-url');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(field.value);
      else {
        field.focus();
        field.select();
        if (!document.execCommand('copy')) throw new Error('copy');
      }
      toast('✅ Lien AIOMetadata copié');
    } catch {
      field.focus();
      field.select();
      toast('Le lien est sélectionné. Utilise Ctrl+C pour le copier.');
    }
  }
