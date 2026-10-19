  // ---- RÉCUPÉRATION (gens qui ont refait leur config via /recuperation) ----
  async function loadRecoveryStats() {
    try {
      const res = await fetch('/api/recovery-stats', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      const data = await res.json();
      document.getElementById('recovery-updated').textContent = 'MAJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (!data.configured) {
        ['rec-stat-total', 'rec-stat-confirmed', 'rec-stat-pending', 'rec-stat-today'].forEach(id => document.getElementById(id).textContent = '⚠️');
        document.getElementById('recovery-body').innerHTML = '<tr class="empty-row"><td colspan="4">Base de données non configurée (DATABASE_URL)</td></tr>';
        document.getElementById('recovery-chart-svg').innerHTML = '';
        return;
      }

      animateNumber(document.getElementById('rec-stat-total'), data.total);
      animateNumber(document.getElementById('rec-stat-confirmed'), data.confirmed);
      animateNumber(document.getElementById('rec-stat-pending'), data.pending);
      animateNumber(document.getElementById('rec-stat-today'), data.today);

      const pct = data.total ? Math.round((data.confirmed / data.total) * 100) : 0;
      document.getElementById('rec-trend-total').innerHTML = '<span class="trend-flat">personnes uniques</span>';
      document.getElementById('rec-trend-confirmed').innerHTML = '<span class="trend-up">' + pct + ' % des clics</span>';
      document.getElementById('rec-trend-today').innerHTML = '<span class="trend-flat">nouveaux clics</span>';

      document.getElementById('recovery-chart-svg').innerHTML = renderTrendChart(data.days || []);

      const users = data.users || [];
      document.getElementById('recovery-body').innerHTML = !users.length
        ? '<tr class="empty-row"><td colspan="4">Personne pour le moment</td></tr>'
        : users.map(u => {
            const pseudo = u.pseudo || 'Anonyme';
            const isAnon = !u.pseudo;
            const status = u.confirmed
              ? '<span class="trend-up">✅ Confirmé</span><div class="user-sub muted">actif ' + timeAgo(u.lastSeen) + '</div>'
              : '<span class="trend-flat">⏳ En attente</span>';
            return '<tr>' +
              '<td><div class="user-cell">' +
              '<div class="user-avatar' + (isAnon ? ' anon' : '') + '">' + escapeHtml((pseudo.charAt(0) || '?').toUpperCase()) + '</div>' +
              '<div><div class="user-name">' + escapeHtml(pseudo) + (isAnon ? ' <span class="user-anon-badge">anonyme</span>' : '') + '</div></div></div></td>' +
              '<td class="muted">' + new Date(u.firstClick).toLocaleString('fr-FR') + '<div class="user-sub muted">' + timeAgo(u.firstClick) + '</div></td>' +
              '<td>' + status + '</td>' +
              '<td class="count">' + u.clickCount + '</td>' +
              '</tr>';
          }).join('');
    } catch (e) { toast('❌ Erreur de chargement de la récupération'); }
  }

  async function resetRecoveryStats() {
    if (!confirm('Vider les données de récupération ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/recovery-stats/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Données réinitialisées'); await loadRecoveryStats(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

