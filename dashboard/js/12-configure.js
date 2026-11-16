  // ---- CONFIGURE ----
  const CFG_FIELDS = ['brandName','navLinkText','navLinkUrl','heroTitleWhite','heroTitleRed','heroSubtitle',
    'accentColor','sectionConfigLabel','sectionProfileLabel','sectionLinksLabel','tmdbKeyHint','pseudoHint',
    'externalToggleTitle','externalToggleDesc','maxLinksLabel','maxLinksHint','extrasSelectLabel','extrasSelectHint',
    'installAppLabel','installWebLabel','installCopyLabel'];

  let cfgPreviewTimer = null;
  let cfgPreviewRequest = 0;
  let cfgPreviewMode = 'desktop';
  let cfgLoaded = false;
  let cfgLoading = false;
  let cfgSaving = false;
  let cfgResetting = false;
  let cfgSavedPayload = null;
  let cfgLoadError = '';
  let cfgSaveError = '';

  function setAccentInputs(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
    const color = document.getElementById('cfg-accentColor');
    const text = document.getElementById('cfg-accentColorText');
    if (color) color.value = hex;
    if (text) text.value = hex;
    validateConfigureAccent();
  }

  function validateConfigureAccent() {
    const text = document.getElementById('cfg-accentColorText');
    const valid = /^#[0-9a-fA-F]{6}$/.test(text.value.trim());
    text.setCustomValidity(valid ? '' : 'Utilise une couleur au format #RRGGBB, par exemple #e53e3e.');
    text.setAttribute('aria-invalid', String(!valid));
    return valid;
  }

  function collectConfigurePayload() {
    const payload = {};
    CFG_FIELDS.forEach(f => { const el = document.getElementById('cfg-' + f); if (el) payload[f] = el.value; });
    return payload;
  }

  function configureHasChanges() {
    return cfgLoaded && (JSON.stringify(collectConfigurePayload()) !== cfgSavedPayload
      || !/^#[0-9a-fA-F]{6}$/.test(document.getElementById('cfg-accentColorText').value.trim()));
  }

  function updateConfigureSaveState() {
    const dirty = configureHasChanges();
    const status = document.getElementById('cfg-save-state');
    let state = 'saved', message = 'Toutes les modifications sont enregistrées';
    if (cfgLoading) { state = 'saving'; message = 'Chargement des réglages…'; }
    else if (cfgResetting) { state = 'saving'; message = 'Réinitialisation…'; }
    else if (cfgSaving) { state = 'saving'; message = 'Enregistrement…'; }
    else if (cfgLoadError || cfgSaveError) { state = 'dirty'; message = cfgLoadError || cfgSaveError; }
    else if (!cfgLoaded) { state = 'saving'; message = 'Chargement des réglages…'; }
    else if (dirty) { state = 'dirty'; message = 'Modifications non enregistrées'; }
    status.className = 'save-state ' + state;
    status.textContent = message;
    document.getElementById('cfg-fields').disabled = !cfgLoaded || cfgLoading || cfgResetting;
    document.getElementById('cfg-save').disabled = !cfgLoaded || cfgLoading || cfgSaving || cfgResetting || !dirty;
    document.getElementById('cfg-save').textContent = cfgSaving ? 'Enregistrement…' : 'Enregistrer les modifications';
    document.getElementById('cfg-reset').disabled = !cfgLoaded || cfgLoading || cfgSaving || cfgResetting;
    document.getElementById('cfg-load-retry').hidden = !cfgLoadError;
  }

  function setConfigurePreviewStatus(message, error = false) {
    const status = document.getElementById('cfg-preview-status');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function resizeConfigurePreview() {
    const stage = document.getElementById('cfg-preview-stage');
    const frame = document.getElementById('cfg-preview');
    if (!stage || !frame || !stage.clientWidth) return;
    const width = cfgPreviewMode === 'mobile' ? 390 : 1200;
    const scale = Math.min(1, stage.clientWidth / width);
    frame.style.width = width + 'px';
    frame.style.height = (stage.clientHeight / scale) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.style.marginLeft = Math.max(0, (stage.clientWidth - width * scale) / 2) + 'px';
    document.getElementById('cfg-preview-width').textContent = width + ' px';
  }

  function setConfigurePreviewDevice(mode) {
    if (mode !== 'desktop' && mode !== 'mobile') return;
    cfgPreviewMode = mode;
    ['desktop', 'mobile'].forEach(device => {
      document.getElementById('cfg-device-' + device).setAttribute('aria-pressed', String(device === mode));
    });
    resizeConfigurePreview();
  }

  function refreshConfigurePreview(immediate = false) {
    clearTimeout(cfgPreviewTimer);
    // Invalider dès la frappe : une ancienne réponse ne doit pas remplacer le prochain aperçu.
    const request = ++cfgPreviewRequest;
    if (!cfgLoaded) return;
    setConfigurePreviewStatus('Mise à jour de l’aperçu…');
    cfgPreviewTimer = setTimeout(async () => {
      try {
        const res = await authFetch('/api/configure-preview', {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(collectConfigurePayload()),
        });
        if (!res.ok) throw new Error('preview');
        const data = await res.json();
        if (typeof data.html !== 'string' || !data.html) throw new Error('preview');
        if (request !== cfgPreviewRequest) return;
        const frame = document.getElementById('cfg-preview');
        frame.srcdoc = data.html;
        resizeConfigurePreview();
        setConfigurePreviewStatus('Aperçu à jour · les modifications restent privées jusqu’à l’enregistrement.');
      } catch (e) {
        if (request === cfgPreviewRequest) {
          setConfigurePreviewStatus('Aperçu indisponible. Clique sur Actualiser pour réessayer.', true);
        }
      }
    }, immediate ? 0 : 300);
  }

  async function loadConfigureSettings() {
    if (cfgLoading || cfgSaving || cfgResetting) return;
    // La navigation entre onglets ne doit pas effacer un brouillon en cours.
    if (configureHasChanges()) { updateConfigureSaveState(); return; }
    cfgLoading = true;
    cfgLoadError = '';
    updateConfigureSaveState();
    try {
      const res = await authFetch('/api/settings/configure', { headers: authHeaders() });
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      if (!CFG_FIELDS.every(f => typeof data[f] === 'string')) throw new Error('load');
      CFG_FIELDS.forEach(f => { document.getElementById('cfg-' + f).value = data[f]; });
      setAccentInputs(data.accentColor);
      cfgSavedPayload = JSON.stringify(collectConfigurePayload());
      cfgLoaded = true;
      cfgSaveError = '';
      refreshConfigurePreview();
    } catch (e) {
      cfgLoadError = 'Chargement impossible. Les champs ont été conservés.';
      toast('❌ Impossible de charger les réglages de la page.');
    } finally {
      cfgLoading = false;
      updateConfigureSaveState();
    }
  }

  async function saveConfigureSettings() {
    if (!cfgLoaded || cfgLoading || cfgSaving || cfgResetting) return;
    if (!validateConfigureAccent()) {
      document.getElementById('cfg-accentColorText').reportValidity();
      return;
    }
    setAccentInputs(document.getElementById('cfg-accentColorText').value.trim());
    if (!configureHasChanges()) return;
    const payload = collectConfigurePayload();
    cfgSaving = true;
    cfgSaveError = '';
    updateConfigureSaveState();
    try {
      const res = await authFetch('/api/settings/configure', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      });
      if (!res.ok || (await res.json()).success !== true) throw new Error('save');
      // Seul le contenu envoyé est enregistré : une nouvelle frappe reste un brouillon.
      cfgSavedPayload = JSON.stringify(payload);
      toast('✅ Page configure mise à jour');
    } catch (e) {
      cfgSaveError = 'Enregistrement impossible. Tes modifications sont conservées.';
      toast('❌ Enregistrement impossible. Réessaie avec le bouton Enregistrer.');
    } finally {
      cfgSaving = false;
      updateConfigureSaveState();
    }
  }

  async function resetConfigureDefaults() {
    if (!cfgLoaded || cfgLoading || cfgSaving || cfgResetting) return;
    if (!confirm('Réinitialiser les textes et l’apparence de la page Configure ? Les personnalisations enregistrées et le brouillon seront remplacés par les valeurs par défaut.')) return;
    cfgResetting = true;
    cfgSaveError = '';
    updateConfigureSaveState();
    try {
      const res = await authFetch('/api/settings/configure/reset', { method: 'POST', headers: authHeaders() });
      if (!res.ok || (await res.json()).success !== true) throw new Error('reset');
      cfgLoaded = false;
      cfgSavedPayload = null;
      cfgResetting = false;
      await loadConfigureSettings();
      toast('✅ Page configure réinitialisée');
    } catch (e) {
      cfgSaveError = 'Réinitialisation impossible. Tes modifications sont conservées.';
      toast('❌ Réinitialisation impossible.');
    } finally {
      cfgResetting = false;
      updateConfigureSaveState();
    }
  }

  function bindConfigureLivePreview() {
    CFG_FIELDS.forEach(f => {
      const el = document.getElementById('cfg-' + f);
      if (el) el.addEventListener('input', () => {
        if (f === 'accentColor') setAccentInputs(el.value);
        cfgSaveError = '';
        updateConfigureSaveState();
        refreshConfigurePreview();
      });
    });
    const text = document.getElementById('cfg-accentColorText');
    text.addEventListener('input', () => {
      if (validateConfigureAccent()) document.getElementById('cfg-accentColor').value = text.value.trim();
      cfgSaveError = '';
      updateConfigureSaveState();
      refreshConfigurePreview();
    });
    const stage = document.getElementById('cfg-preview-stage');
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeConfigurePreview).observe(stage);
    window.addEventListener('resize', resizeConfigurePreview);
    window.addEventListener('beforeunload', event => {
      if (!configureHasChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    updateConfigureSaveState();
  }

