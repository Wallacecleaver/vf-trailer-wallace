  // ---- LECTEUR YOUTUBE (aperçus dashboard) ----
  // Contrairement à la lecture dans Stremio (ytId natif transmis au lecteur intégré de
  // l'appli, hors de portée de l'addon), les aperçus ci-dessous tournent DANS ce navigateur.
  // On peut donc piloter le vrai lecteur YouTube via son API officielle (script JS chargé
  // depuis youtube.com, pas de scraping serveur, donc aucun risque de blocage anti-bot) et
  // lui demander la meilleure qualité disponible. YouTube ne garantit pas 1080p à 100% (ça
  // dépend de ce que la vidéo propose et des heuristiques internes du lecteur), donc on le
  // redemande à chaque étape clé (prêt + tout changement d'état) plutôt qu'une seule fois.
  let ytApiReadyPromise = null;
  function loadYoutubeIframeApi() {
    if (ytApiReadyPromise) return ytApiReadyPromise;
    ytApiReadyPromise = new Promise(resolve => {
      if (window.YT && window.YT.Player) { resolve(); return; }
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prevCb) prevCb(); resolve(); };
      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    });
    return ytApiReadyPromise;
  }

  let ytPreviewPlayerSeq = 0;
  // Monte un lecteur YouTube dans le conteneur donné (id d'un élément vide déjà présent
  // dans le DOM) et force la 1080p dès que possible. containerId est consommé par l'API
  // YouTube elle-même (elle remplace l'élément par son propre iframe).
  async function mountYoutubePlayer(containerId, ytId) {
    const mySeq = ++ytPreviewPlayerSeq; // évite qu'un montage obsolète (fermé/changé entre-temps) ne s'exécute encore
    try {
      await loadYoutubeIframeApi();
    } catch {
      return; // API indisponible (réseau coupé...) -> tant pis, pas de lecteur, pas de crash
    }
    if (mySeq !== ytPreviewPlayerSeq || !document.getElementById(containerId)) return;
    const forceHd = player => { try { player.setPlaybackQuality('hd1080'); } catch {} };
    new YT.Player(containerId, {
      videoId: ytId,
      playerVars: { autoplay: 1, vq: 'hd1080' },
      events: {
        onReady: e => forceHd(e.target),
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) forceHd(e.target);
        },
      },
    });
  }

