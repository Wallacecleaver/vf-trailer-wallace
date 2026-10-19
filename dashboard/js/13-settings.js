  // ---- SETTINGS (comportement) ----
  const SETTING_FIELDS = [
    { id: 'set-allocineFallback', get: el => el.checked },
    { id: 'set-youtubeSearchFallback', get: el => el.checked },
    { id: 'set-ignoreTeasers', get: el => el.checked },
    { id: 'set-includeExtras', get: el => el.checked },
    { id: 'set-trailerLanguage', get: el => el.value },
    { id: 'set-maxTrailers', get: el => Math.min(3, Math.max(1, Number(el.value) || 2)) },
    { id: 'set-cacheEnabled', get: el => el.checked },
    { id: 'set-cacheTtlHours', get: el => Math.min(72, Math.max(1, Number(el.value) || 6)) },
    { id: 'set-allocineCacheTtlHours', get: el => Math.min(72, Math.max(1, Number(el.value) || 2)) },
    { id: 'set-youtubeSearchCacheTtlHours', get: el => Math.min(72, Math.max(1, Number(el.value) || 1)) },
    { id: 'set-cacheFailures', get: el => el.checked },
    { id: 'set-failureCacheTtlMinutes', get: el => Math.min(180, Math.max(5, Number(el.value) || 30)) },
    { id: 'set-extraVfKeywords', get: el => el.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) },
    { id: 'set-aiomTimeoutSeconds', get: el => Math.min(12, Math.max(1, Number(el.value) || 5)) },
  ];
  const SETTING_NAMES = {
    allocineFallback: 'set-allocineFallback', youtubeSearchFallback: 'set-youtubeSearchFallback',
    ignoreTeasers: 'set-ignoreTeasers', includeExtras: 'set-includeExtras',
    trailerLanguage: 'set-trailerLanguage', maxTrailers: 'set-maxTrailers',
    cacheEnabled: 'set-cacheEnabled', cacheTtlHours: 'set-cacheTtlHours',
    allocineCacheTtlHours: 'set-allocineCacheTtlHours', youtubeSearchCacheTtlHours: 'set-youtubeSearchCacheTtlHours',
    cacheFailures: 'set-cacheFailures', failureCacheTtlMinutes: 'set-failureCacheTtlMinutes',
    extraVfKeywords: 'set-extraVfKeywords', aiomTimeoutSeconds: 'set-aiomTimeoutSeconds',
  };

  let settingsSaveTimer = null;
  let settingsDirty = false;

  function setSaveState(state) {
    const el = document.getElementById('settings-save-state');
    if (!el) return;
    el.className = 'save-state ' + state;
    el.textContent = state === 'dirty' ? '⏳ Modifications à enregistrer'
      : state === 'saving' ? '💾 Enregistrement…'
      : state === 'saved' ? '✅ Enregistré'
      : '';
  }

  function collectBehaviorPayload() {
    const payload = {};
    SETTING_FIELDS.forEach(f => { const el = document.getElementById(f.id); if (el) payload[f.id.replace('set-', '')] = f.get(el); });
    return payload;
  }

  async function loadBehaviorSettings() {
    try {
      const res = await fetch('/api/settings/behavior', { headers: authHeaders() });
      const data = await res.json();
      Object.keys(SETTING_NAMES).forEach(k => {
        const el = document.getElementById(SETTING_NAMES[k]);
        if (!el) return;
        const v = data[k];
        if (el.type === 'checkbox') el.checked = !!v;
        else if (Array.isArray(v)) el.value = v.join(', ');
        else el.value = v ?? '';
      });
      setSaveState('');
      settingsDirty = false;
    } catch (e) { toast('❌ Erreur de chargement'); }
    loadCacheStats();
    loadDiagnostics(false);
  }

  async function saveBehaviorSettings(silent) {
    setSaveState('saving');
    try {
      const res = await fetch('/api/settings/behavior', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(collectBehaviorPayload()),
      });
      if (res.ok) { setSaveState('saved'); settingsDirty = false; setTimeout(() => { if (!settingsDirty) setSaveState(''); }, 2500); }
      else { setSaveState('dirty'); if (!silent) toast('❌ Erreur lors de l\'enregistrement'); }
    } catch (e) { setSaveState('dirty'); if (!silent) toast('❌ ' + e.message); }
  }

  function bindSettingsAutosave() {
    SETTING_FIELDS.forEach(f => {
      const el = document.getElementById(f.id);
      if (!el) return;
      el.addEventListener('input', () => {
        settingsDirty = true;
        setSaveState('dirty');
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => saveBehaviorSettings(true), 800);
      });
      el.addEventListener('change', () => {
        settingsDirty = true;
        setSaveState('dirty');
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => saveBehaviorSettings(true), 800);
      });
    });
  }

  async function loadCacheStats() {
    const desc = document.getElementById('cache-stats-desc');
    try {
      const res = await fetch('/api/cache/stats', { headers: authHeaders() });
      const data = await res.json();
      desc.textContent = data.count > 0
        ? `${data.count} entrée${data.count > 1 ? 's' : ''} en cache (${data.success || 0} succès · ${data.failures || 0} échec${data.failures === 1 ? '' : 's'})`
        : 'Aucune entrée en cache actuellement';
    } catch (e) {
      desc.textContent = 'Impossible de récupérer les statistiques du cache';
    }
  }

  async function clearTrailerCache(only) {
    const label = only === 'failures' ? 'les échecs du cache' : 'tout le cache des bandes-annonces';
    if (!confirm(only === 'failures'
      ? 'Vider uniquement les échecs en cache ? Les titres qui échouaient seront re-testés à la prochaine requête, les succès sont conservés.'
      : 'Vider tout le cache des bandes-annonces ? Les prochaines requêtes re-vérifieront auprès de TMDB.')) return;
    try {
      const res = await fetch('/api/cache' + (only === 'failures' ? '?only=failures' : ''), { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ ' + (only === 'failures' ? 'Échecs vidés' : 'Cache vidé')); loadCacheStats(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function loadDiagnostics(force) {
    const grid = document.getElementById('diag-grid');
    const desc = document.getElementById('diag-desc');
    if (!grid) return;
    const setVal = (key, label, ok, sub) => {
      const el = grid.querySelector('[data-diag="' + key + '"]');
      if (!el) return;
      el.className = 'diag-val ' + (ok === null ? 'diag-pending' : ok ? 'diag-ok' : 'diag-bad');
      el.innerHTML = escapeHtml(label) + (sub ? '<span class="diag-sub">' + escapeHtml(sub) + '</span>' : '');
    };
    try {
      if (force) { desc.textContent = 'Vérification en cours...'; setVal('redis', '…', null); setVal('tmdbkey', '…', null); setVal('svc-tmdb', '…', null); setVal('svc-youtube', '…', null); setVal('svc-allocine', '…', null); setVal('cache', '…', null); }
      const res = await fetch('/api/diagnostics', { headers: authHeaders() });
      const d = await res.json();
      setVal('redis', d.redis ? '✓ Connecté' : '✗ Indisponible', d.redis, d.redis ? 'Redis opérationnel' : 'Vérifie UPSTASH_REDIS_REST_URL / TOKEN');
      if (d.tmdbKey && d.tmdbKey.present) {
        setVal('tmdbkey', d.tmdbKey.valid === true ? '✓ Valide' : '✗ Invalide', d.tmdbKey.valid === true, 'Clé …' + (d.tmdbKey.last4 || ''));
      } else {
        setVal('tmdbkey', '⚠️ Absente', null, 'TMDB_API_KEY non configurée');
      }
      setVal('svc-tmdb', d.services && d.services.tmdb ? '✓ Joignable' : '✗ Down', !!(d.services && d.services.tmdb), 'themoviedb.org');
      setVal('svc-youtube', d.services && d.services.youtube ? '✓ Joignable' : '✗ Down', !!(d.services && d.services.youtube), 'youtube.com');
      setVal('svc-allocine', d.services && d.services.allocine ? '✓ Joignable' : '✗ Down', !!(d.services && d.services.allocine), 'allocine.fr');
      setVal('cache', d.cache && d.cache.count ? (d.cache.count + ' entrée' + (d.cache.count > 1 ? 's' : '')) : 'Vide', true, (d.cache && d.cache.success ? d.cache.success + ' succès · ' : '') + (d.cache && d.cache.failures ? d.cache.failures + ' échecs' : '0 échec'));
      desc.textContent = d.redis ? 'Tout est opérationnel' : '⚠️ Redis indisponible — le cache et les stats ne fonctionneront pas';
    } catch (e) {
      desc.textContent = 'Impossible de récupérer le diagnostic';
    }
  }

  async function resetBehaviorDefaults() {
    if (!confirm('Réinitialiser tous les réglages de comportement aux valeurs par défaut ?')) return;
    try {
      const res = await fetch('/api/settings/behavior/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Réinitialisé'); await loadBehaviorSettings(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

