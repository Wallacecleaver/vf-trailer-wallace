  // ---- LIEN AIOMETADATA PARTAGÉ ----
  function loadAiomSettings() {
    const url = window.location.origin + '/aiom/manifest.json';
    document.getElementById('aiom-manifest-url').value = url;
    document.getElementById('aiom-open').href = url;
  }

  async function copyAiomManifest() {
    loadAiomSettings();
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
