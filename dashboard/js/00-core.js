  let token = localStorage.getItem('vftrailers_token') || '';
  let isDark = true;

  async function doLogin() {
    const pwd = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    const card = document.querySelector('.login-card');
    err.style.display = 'none';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        token = data.token;
        localStorage.setItem('vftrailers_token', token);
        showDashboard();
      } else {
        err.textContent = data.error || 'Mot de passe incorrect';
        err.style.display = 'block';
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      }
    } catch (e) {
      err.textContent = 'Erreur de connexion';
      err.style.display = 'block';
    }
  }

  function logout() {
    localStorage.removeItem('vftrailers_token');
    token = '';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  }

  async function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    const initialPage = DASHBOARD_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    showPage(initialPage);
    await refreshFailedBadge();
    await refreshRequestsBadge();
    await refreshLogsBadge();
  }

  function authHeaders(extra) {
    return Object.assign({ 'x-admin-token': token }, extra || {});
  }

  let ovInterval = null;
  const DASHBOARD_PAGES = ['overview', 'users', 'mapping', 'requests', 'teststream', 'configure', 'settings', 'logs'];

  function showPage(name) {
    if (location.hash.slice(1) !== name) history.pushState(null, '', '#' + name);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.querySelector('.nav-item[data-page="' + name + '"]').classList.add('active');
    if (name !== 'overview' && ovInterval) { clearInterval(ovInterval); ovInterval = null; const ao = document.getElementById('ov-auto'); if (ao) ao.checked = false; }
    if (name === 'overview') loadOverview();
    if (name === 'users') loadInstallStats();
    if (name === 'mapping') loadMapping();
    if (name === 'requests') loadRequests();
    if (name === 'configure') loadConfigureSettings();
    if (name === 'settings') loadBehaviorSettings();
    if (name === 'logs') initLogsPage();
    else if (logsInterval) { clearInterval(logsInterval); logsInterval = null; } // pas de polling hors de la page logs
  }

  // Bouton précédent/suivant du navigateur : resynchronise la page affichée sur le hash.
  window.addEventListener('popstate', () => {
    const page = DASHBOARD_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    showPage(page);
  });

