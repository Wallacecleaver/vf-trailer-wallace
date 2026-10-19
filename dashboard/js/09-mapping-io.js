  // ---- MAPPING — export / import JSON ----
  function exportOverrides() {
    if (!overridesData.length) { toast('ℹ️ Aucun override à exporter'); return; }
    const blob = new Blob([JSON.stringify(overridesData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `overrides-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('✅ Export téléchargé');
  }

  async function importOverrides(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const items = JSON.parse(text);
      if (!Array.isArray(items)) throw new Error('Le fichier doit contenir un tableau d\'overrides');
      if (!items.length) { toast('ℹ️ Fichier vide'); return; }

      // Détection des doublons avec les overrides existants (même IMDB ID + saison).
      const existing = new Map(overridesData.map(o => [o.imdbId + ':' + String(o.season || ''), o]));
      const dupRows = items
        .map(item => {
          const key = (item.imdbId || '') + ':' + String(item.season || '');
          const match = existing.get(key);
          return match ? { imdbId: item.imdbId, season: item.season || null, oldTitle: match.title || '', newTitle: item.title || '' } : null;
        })
        .filter(Boolean);
      let msg = `Importer ${items.length} override(s) ?`;
      if (dupRows.length) {
        msg += `\n\n⚠️ ${dupRows.length} entrée(s) existante(s) seront ÉCRASÉES :\n` +
          dupRows.slice(0, 8).map(d => `• ${d.imdbId}${d.season ? ' (saison ' + d.season + ')' : ''} — ${d.oldTitle || d.newTitle || 'sans titre'}`).join('\n') +
          (dupRows.length > 8 ? `\n… et ${dupRows.length - 8} autre(s)` : '');
      }
      if (!confirm(msg)) return;

      let ok = 0, fail = 0;
      for (const item of items) {
        const isHidden = item.hidden === true;
        const hasLink = (item.ytId && item.ytId.trim()) || (item.url && item.url.trim()) || (Array.isArray(item.links) && item.links.some(l => l && (l.ytId || l.url)));
        if (!item.imdbId || (!hasLink && !isHidden)) { fail++; continue; }
        try {
          const res = await fetch('/api/overrides', {
            method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ imdbId: item.imdbId, season: item.season || null, ytId: item.ytId || null, url: item.ytId ? null : (item.url || null), links: Array.isArray(item.links) && item.links.length ? item.links : undefined, title: item.title || null, hidden: isHidden, mediaType: item.mediaType || null, notes: item.notes || null }),
          });
          if (res.ok) ok++; else fail++;
        } catch (e) { fail++; }
      }
      toast(`✅ ${ok} importé(s)${fail ? `, ❌ ${fail} échoué(s)` : ''}`);
      await loadMapping();
    } catch (e) { toast('❌ Fichier invalide : ' + e.message); }
  }

