  // ---- USERS (installations actives) ----
  async function loadInstallStats() {
    try {
      const res = await fetch('/api/install-stats', { headers: authHeaders() });
      if (!res.ok) { logout(); return; }
      const data = await res.json();

      document.getElementById('install-updated').textContent = 'MAJ ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (!data.configured) {
        ['install-stat-total', 'install-stat-today', 'install-stat-users', 'install-stat-req'].forEach(id => document.getElementById(id).textContent = '⚠️');
        document.getElementById('users-body').innerHTML =
          '<tr class="empty-row"><td colspan="5">Base de données non configurée — vérifie DATABASE_URL</td></tr>';
        document.getElementById('install-chart-svg').innerHTML = '';
        document.getElementById('user-split-body').innerHTML = '';
        return;
      }

      const users = data.users || [];
      const totalRequests = users.reduce((s, u) => s + (u.requestCount || 0), 0);
      const pseudos = users.filter(u => u.pseudo).length;

      animateNumber(document.getElementById('install-stat-total'), data.total);
      animateNumber(document.getElementById('install-stat-today'), data.activeToday);
      animateNumber(document.getElementById('install-stat-users'), users.length);
      animateNumber(document.getElementById('install-stat-req'), totalRequests);

      document.getElementById('install-trend-total').innerHTML = '<span class="trend-up">+' + data.activeToday + ' aujourd\'hui</span>';
      document.getElementById('install-trend-users').innerHTML = '<span class="trend-flat">' + pseudos + ' pseudo(s) renseigné(s)</span>';
      document.getElementById('install-trend-req').innerHTML = '<span class="trend-flat">moy. ' + (users.length ? Math.round(totalRequests / users.length) : 0) + ' / install</span>';

      const days = data.days || [];
      const yesterday = days.length >= 2 ? days[days.length - 2].count : 0;
      const diff = data.activeToday - yesterday;
      const tEl = document.getElementById('install-trend-today');
      if (diff > 0) tEl.innerHTML = '<span class="trend-up">▲ +' + diff + ' vs hier</span>';
      else if (diff < 0) tEl.innerHTML = '<span class="trend-down">▼ ' + diff + ' vs hier</span>';
      else tEl.innerHTML = '<span class="trend-flat">• stable vs hier</span>';

      document.getElementById('install-chart-svg').innerHTML = renderTrendChart(days);
      renderUserSplit(pseudos, users.length - pseudos);

      usersData = users;
      renderUsersTable();
    } catch (e) { toast('❌ Erreur de chargement des utilisateurs'); }
  }

  function renderUsersTable() {
    const filter = (document.getElementById('users-filter').value || '').toLowerCase().trim();
    const body = document.getElementById('users-body');
    const filtered = !filter ? usersData : usersData.filter(u => (u.pseudo || 'anonyme').toLowerCase().includes(filter));
    const maxReq = Math.max(1, ...usersData.map(u => u.requestCount || 0));

    body.innerHTML = !filtered.length
      ? '<tr class="empty-row"><td colspan="5">' + (usersData.length ? 'Aucun résultat pour ce filtre' : "Aucune installation pour l'instant") + '</td></tr>'
      : filtered.map(u => {
          const pseudo = u.pseudo || 'Anonyme';
          const isAnon = !u.pseudo;
          const req = u.requestCount || 0;
          const share = Math.max(Math.round((req / maxReq) * 100), 4);
          return '<tr>' +
            '<td><div class="user-cell">' +
            '<div class="user-avatar' + (isAnon ? ' anon' : '') + '">' + escapeHtml((pseudo.charAt(0) || '?').toUpperCase()) + '</div>' +
            '<div><div class="user-name">' + escapeHtml(pseudo) + (isAnon ? ' <span class="user-anon-badge">anonyme</span>' : '') + '</div>' +
            '<div class="user-sub muted">' + timeAgo(u.lastSeen) + '</div></div></div></td>' +
            '<td class="muted">' + new Date(u.firstSeen).toLocaleDateString('fr-FR') + '<div class="user-sub muted">' + timeAgo(u.firstSeen) + '</div></td>' +
            '<td class="muted">' + new Date(u.lastSeen).toLocaleString('fr-FR') + '</td>' +
            '<td class="count">' + req + '<div class="top-share" style="margin-top:5px"><div class="top-share-bar" style="width:' + share + '%"></div></div></td>' +
            '<td class="row-actions"><button class="small-btn danger" onclick="deleteInstallUser(\'' + escapeAttr(u.id) + '\',\'' + escapeAttr(pseudo) + '\')" title="Supprimer">🗑️</button></td>' +
            '</tr>';
        }).join('');
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "à l\'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    const h = Math.floor(min / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    const d = Math.floor(h / 24);
    if (d < 30) return 'il y a ' + d + ' j';
    return 'il y a ' + Math.floor(d / 30) + ' mois';
  }

  async function deleteInstallUser(id, pseudo) {
    if (!confirm(`Supprimer ${pseudo} de la liste ? Ses stats seront effacées, mais son addon continuera de fonctionner normalement (ce n'est qu'une ligne de suivi, pas un accès).`)) return;
    try {
      const res = await fetch(`/api/install-stats/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast('✅ Utilisateur supprimé'); await loadInstallStats(); }
      else toast('❌ Erreur lors de la suppression');
    } catch (e) { toast('❌ ' + e.message); }
  }

  async function resetInstallStats() {
    if (!confirm('Vider toutes les données d\'installation ? Cette action est irréversible.')) return;
    try {
      const res = await fetch('/api/install-stats/reset', { method: 'POST', headers: authHeaders() });
      if (res.ok) { toast('✅ Données réinitialisées'); await loadInstallStats(); }
      else toast('❌ Erreur lors du reset');
    } catch (e) { toast('❌ ' + e.message); }
  }

