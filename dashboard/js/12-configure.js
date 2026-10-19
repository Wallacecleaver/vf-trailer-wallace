  // ---- CONFIGURE ----
  const CFG_FIELDS = ['brandName','navLinkText','navLinkUrl','heroTitleWhite','heroTitleRed','heroSubtitle',
    'accentColor','sectionConfigLabel','sectionProfileLabel','sectionLinksLabel','tmdbKeyHint','pseudoHint',
    'externalToggleTitle','externalToggleDesc','maxLinksLabel','maxLinksHint','extrasSelectLabel','extrasSelectHint',
    'installAppLabel','installWebLabel','installCopyLabel'];

  let cfgPreviewTimer = null;

  function setAccentInputs(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
    const color = document.getElementById('cfg-accentColor');
    const text = document.getElementById('cfg-accentColorText');
    if (color && color.value !== hex) color.value = hex;
    if (text && text.value !== hex) text.value = hex;
  }

  function refreshConfigurePreview() {
    clearTimeout(cfgPreviewTimer);
    cfgPreviewTimer = setTimeout(async () => {
      const frame = document.getElementById('cfg-preview');
      if (!frame) return;
      try {
        const res = await fetch('/api/configure-preview', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(collectConfigurePayload()) });
        const data = await res.json();
        frame.srcdoc = data.html || '';
      } catch (e) { /* silencieux : pas bloquant */ }
    }, 300);
  }

  function collectConfigurePayload() {
    const payload = {};
    CFG_FIELDS.forEach(f => { const el = document.getElementById('cfg-' + f); if (el) payload[f] = el.value; });
    return payload;
  }

  async function loadConfigureSettings() {
    try {
      const res = await fetch('/api/settings/configure', { headers: authHeaders() });
      const data = await res.json();
      CFG_FIELDS.forEach(f => { const el = document.getElementById('cfg-' + f); if (el) el.value = data[f] || ''; });
      setAccentInputs(data.accentColor);
      refreshConfigurePreview();
    } catch (e) { toast('❌ Erreur de chargement'); }
  }

  async function saveConfigureSettings() {
    const payload = collectConfigurePayload();
    try {
      const res = await fetch('/api/settings/configure', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      });
      if (res.ok) { toast('✅ Page configure mise à jour'); refreshConfigurePreview(); }
      else toast('❌ Erreur lors de l\'enregistrement');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function resetConfigureDefaults() {
    if (!confirm('Réinitialiser tous les textes de la page configure ?')) return;
    try {
      const res = await fetch('/api/settings/configure/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Réinitialisé'); await loadConfigureSettings(); }
      else toast('❌ Erreur');
    } catch (e) { toast('❌ ' + e.message); }
  }

  function bindConfigureLivePreview() {
    CFG_FIELDS.forEach(f => {
      const el = document.getElementById('cfg-' + f);
      if (el) el.addEventListener('input', () => {
        if (f === 'accentColor') setAccentInputs(el.value);
        refreshConfigurePreview();
      });
    });
    const color = document.getElementById('cfg-accentColor');
    const text = document.getElementById('cfg-accentColorText');
    if (color) color.addEventListener('input', () => {
      const c = document.getElementById('cfg-accentColor');
      const t = document.getElementById('cfg-accentColorText');
      if (t) t.value = c.value;
      refreshConfigurePreview();
    });
    if (text) text.addEventListener('input', () => {
      const v = text.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { if (color) color.value = v; refreshConfigurePreview(); }
    });
  }

