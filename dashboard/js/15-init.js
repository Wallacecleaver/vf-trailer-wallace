  // Init
  const savedTheme = localStorage.getItem('vftrailers_theme') || 'dark';
  isDark = savedTheme === 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';

  bindConfigureLivePreview();
  bindSettingsAutosave();

  if (token) { showDashboard(); }
