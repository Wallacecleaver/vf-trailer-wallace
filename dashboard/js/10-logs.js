  // ---- LOGS (live-tail, façon terminal) ----
  let allLogs = [];
  let logsInterval = null;
  let logsPaused = false;

  const LOG_LEVEL_PRIORITY = { info: 0, warn: 1, error: 2 };
  const CTX_META = {
    AUTH:     { icon: '🔐', color: '#60a5fa' },
    INSTALL:  { icon: '📦', color: '#48bb78' },
    STREAM:   { icon: '🎬', color: '#eab308' },
    OVERRIDE: { icon: '🎯', color: '#a78bfa' },
    SETTINGS: { icon: '⚙️', color: '#48bb78' },
    META:     { icon: 'ℹ️', color: '#38bdf8' },
    SYSTEM:   { icon: '🚀', color: '#94a3b8' },
    AIOM:     { icon: '🧩', color: '#f472b6' },
  };

  function initLogsPage() {
    loadLogs();
    loadServicesStatus(false);
    restartLogPolling();
  }

