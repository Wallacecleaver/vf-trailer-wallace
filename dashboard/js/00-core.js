  function readDashboardToken() {
    try { return localStorage.getItem('vftrailers_token') || ''; }
    catch (e) { return undefined; }
  }

  let token = readDashboardToken() || '';
  let isDark = true;

  function saveDashboardToken(value) {
    token = value;
    try {
      if (value) localStorage.setItem('vftrailers_token', value);
      else localStorage.removeItem('vftrailers_token');
    } catch (e) { /* la session reste utilisable dans cet onglet */ }
  }

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
        saveDashboardToken(data.token);
        document.getElementById('login-password').value = '';
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

  function showLogin(message) {
    if (ovInterval) { clearInterval(ovInterval); ovInterval = null; }
    if (typeof logsInterval !== 'undefined' && logsInterval) { clearInterval(logsInterval); logsInterval = null; }
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    const error = document.getElementById('login-error');
    error.textContent = message || '';
    error.style.display = message ? 'block' : 'none';
  }

  function logout(message) {
    saveDashboardToken('');
    showLogin(message);
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
    const saved = readDashboardToken();
    if (typeof saved === 'string') token = saved;
    return Object.assign({ 'x-admin-token': token }, extra || {});
  }

  // Une panne réseau ou un 5xx ne supprime jamais la session. Tous les appels
  // authentifiés récupèrent aussi un éventuel renouvellement envoyé par le serveur.
  async function authFetch(url, options = {}) {
    if (new URL(url, window.location.href).origin !== window.location.origin) {
      throw new Error('Les appels du dashboard doivent rester sur le même site.');
    }
    const saved = readDashboardToken();
    if (typeof saved === 'string') token = saved;
    const sentToken = token;
    const headers = new Headers(options.headers || {});
    headers.set('x-admin-token', sentToken);
    const response = await fetch(url, Object.assign({}, options, { headers }));
    const latest = readDashboardToken();
    // Une réponse ancienne ne doit ni effacer une nouvelle connexion, ni la remplacer.
    if (sentToken && token === sentToken && (latest === undefined || latest === sentToken)) {
      if (response.status === 401) logout('Ta session a expiré ou a été révoquée. Reconnecte-toi.');
      else {
        const renewed = response.headers.get('x-admin-token');
        if (renewed) saveDashboardToken(renewed);
      }
    }
    return response;
  }

  window.addEventListener('storage', event => {
    if (event.key !== 'vftrailers_token' && event.key !== null) return;
    const saved = readDashboardToken();
    if (typeof saved !== 'string' || saved === token) return;
    const wasLoggedIn = !!token;
    token = saved;
    if (!token) showLogin();
    else if (!wasLoggedIn) showDashboard();
  });

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
    if (name === 'configure') loadMaintenanceSettings();
    if (name === 'settings') loadBehaviorSettings();
    if (name === 'logs') initLogsPage();
    else if (logsInterval) { clearInterval(logsInterval); logsInterval = null; } // pas de polling hors de la page logs
  }

  // Bouton précédent/suivant du navigateur : resynchronise la page affichée sur le hash.
  window.addEventListener('popstate', () => {
    const page = DASHBOARD_PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    showPage(page);
  });

