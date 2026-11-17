  // ---- MAINTENANCE DE LA PAGE CONFIGURE ----
  const MNT_FIELDS = ['enabled', 'title', 'message', 'linkUrl', 'linkLabel', 'blockInstall'];
  const MNT_FLAGS = ['enabled', 'blockInstall'];
  let mntLoaded = false, mntLoading = false, mntSaving = false;
  let mntSaved = null, mntError = '', mntLoadError = false;

  function collectMaintenancePayload() {
    const payload = {};
    MNT_FIELDS.forEach(key => {
      const el = document.getElementById('mnt-' + key);
      payload[key] = MNT_FLAGS.includes(key) ? el.checked : el.value.trim();
    });
    return payload;
  }

  function maintenanceHasChanges() {
    return mntLoaded && JSON.stringify(collectMaintenancePayload()) !== mntSaved;
  }

  function validMaintenanceLink(value) {
    if (!value) return true;
    try {
      const url = new URL(value);
      return /^https:\/\//i.test(value) && url.protocol === 'https:' && !url.username && !url.password && !/[\s"'<>]/.test(value);
    } catch { return false; }
  }

  function updateMaintenanceEditor() {
    const payload = collectMaintenancePayload(), dirty = maintenanceHasChanges();
    document.getElementById('mnt-preview').setAttribute('data-mode', payload.blockInstall ? 'locked' : 'banner');
    document.getElementById('mnt-preview-mode').textContent = payload.blockInstall ? 'Page de maintenance' : 'Bandeau d’information';
    ['brand', 'emblem', 'eyebrow', 'lock', 'refresh', 'availability', 'thanks'].forEach(part => {
      document.getElementById('mnt-preview-' + part).hidden = !payload.blockInstall;
    });
    document.getElementById('mnt-preview-banner-icon').hidden = payload.blockInstall;
    document.getElementById('mnt-preview-title').textContent = payload.title || 'Maintenance en cours';
    const message = document.getElementById('mnt-preview-message');
    message.textContent = payload.message;
    message.hidden = !payload.message;
    const link = document.getElementById('mnt-preview-link');
    const validLink = validMaintenanceLink(payload.linkUrl);
    link.hidden = !payload.linkUrl || !validLink;
    link.href = validLink && payload.linkUrl ? payload.linkUrl : '';
    link.textContent = (payload.linkLabel || 'En savoir plus') + ' ↗';
    document.getElementById('mnt-linkUrl').setCustomValidity(validLink ? '' : 'Utilise une adresse HTTPS valide, sans identifiants.');
    document.getElementById('mnt-preview-state').textContent = !payload.enabled ? 'Bandeau masqué sur la page publique.'
      : payload.blockInstall ? 'Bandeau visible et configuration suspendue.' : 'Bandeau visible ; configuration accessible.';
    const status = document.getElementById('mnt-save-state');
    status.className = 'save-state ' + (mntLoading || mntSaving || !mntLoaded ? 'saving' : mntError || dirty ? 'dirty' : 'saved');
    status.textContent = mntLoading ? 'Chargement…' : mntSaving ? 'Enregistrement…' : mntError
      || (!mntLoaded ? 'Chargement…' : dirty ? 'Modifications non enregistrées' : 'Maintenance enregistrée');
    document.getElementById('mnt-fields').disabled = !mntLoaded || mntLoading;
    document.getElementById('mnt-save').disabled = !mntLoaded || mntLoading || mntSaving || !dirty;
    document.getElementById('mnt-save').textContent = mntSaving ? 'Enregistrement…' : 'Enregistrer la maintenance';
    document.getElementById('mnt-retry').hidden = !mntLoadError || dirty;
  }

  async function loadMaintenanceSettings() {
    if (mntLoading || mntSaving) return;
    if (maintenanceHasChanges()) { updateMaintenanceEditor(); return; }
    mntLoading = true;
    mntError = '';
    mntLoadError = false;
    updateMaintenanceEditor();
    try {
      const response = await authFetch('/api/settings/maintenance', { headers: authHeaders() });
      if (!response.ok) throw new Error('load');
      const data = await response.json();
      if (!MNT_FIELDS.every(key => typeof data[key] === (MNT_FLAGS.includes(key) ? 'boolean' : 'string'))) throw new Error('load');
      MNT_FIELDS.forEach(key => {
        const el = document.getElementById('mnt-' + key);
        if (MNT_FLAGS.includes(key)) el.checked = data[key];
        else el.value = data[key];
      });
      mntSaved = JSON.stringify(collectMaintenancePayload());
      mntLoaded = true;
    } catch {
      mntLoadError = true;
      mntError = 'Chargement impossible. Les champs ont été conservés.';
      toast('❌ Impossible de charger la maintenance.');
    } finally {
      mntLoading = false;
      updateMaintenanceEditor();
    }
  }

  async function saveMaintenanceSettings() {
    if (!mntLoaded || mntLoading || mntSaving) return;
    const payload = collectMaintenancePayload();
    if (!validMaintenanceLink(payload.linkUrl)) {
      document.getElementById('mnt-linkUrl').reportValidity();
      return;
    }
    if (!maintenanceHasChanges()) return;
    mntSaving = true;
    mntError = '';
    updateMaintenanceEditor();
    try {
      const response = await authFetch('/api/settings/maintenance', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('save');
      const data = await response.json();
      if (data.success !== true) throw new Error('save');
      // Garder toute modification faite après le départ de la requête.
      mntSaved = JSON.stringify(payload);
      toast('✅ Maintenance enregistrée');
    } catch {
      mntError = 'Enregistrement impossible. Tes modifications sont conservées.';
      toast('❌ Enregistrement impossible. Réessaie.');
    } finally {
      mntSaving = false;
      updateMaintenanceEditor();
    }
  }

  function bindMaintenanceSettings() {
    MNT_FIELDS.forEach(key => {
      const el = document.getElementById('mnt-' + key);
      el.addEventListener(MNT_FLAGS.includes(key) ? 'change' : 'input', () => {
        mntError = '';
        updateMaintenanceEditor();
      });
    });
    window.addEventListener('beforeunload', event => {
      if (!maintenanceHasChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    updateMaintenanceEditor();
  }

