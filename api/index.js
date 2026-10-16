// ============================================================
// ADDON STREMIO — Bandes-Annonces VF
// Tourne ENTIÈREMENT sur Vercel (serverless), aucun serveur externe.
//
// Configuration par utilisateur (clé TMDB perso + qualité) encodée en
// base64url dans l'URL, comme les gros addons Stremio : /<config>/manifest.json
// Si aucune config n'est présente, on retombe sur TMDB_API_KEY (env) si défini.
// ============================================================

const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getAllocineTrailerStreams } = require('../lib/allocine');
const { searchYoutubeTrailer, searchYoutubeRaw } = require('../lib/youtube-search');
const { searchDailymotionTrailer, searchDailymotionRaw } = require('../lib/dailymotion-search');
const { recordRequest, getStats, resetStats } = require('../lib/stats');
const { recordInstallActivity, getInstallStats, resetInstalls, removeInstall } = require('../lib/install-stats');
const { logEvent, getLogs, clearLogs } = require('../lib/logs');
const redis = require('../lib/redis');
const { renderDashboardShell } = require('../lib/dashboard-view');
const { renderConfigureHtml } = require('../lib/configure-view');
const {
    getOverrides, getOverride, setOverride, deleteOverride,
    logFailure, getFailedLog, clearFailedLog,
    logResolution, getResolvedLog, clearResolvedLog,
    incrementOverrideUse,
} = require('../lib/overrides');
const {
    getContributions, addContribution, updateContributionStatus, deleteContribution,
} = require('../lib/contributions');
const { renderContributeHtml } = require('../lib/contribute-view');
const { renderRecoveryHtml } = require('../lib/recovery-view');
const {
    getConfigureSettings, setConfigureSettings, resetConfigureSettings,
    getBehaviorSettings, setBehaviorSettings, resetBehaviorSettings,
} = require('../lib/settings');
const { getCached, setCached, getCacheStats, clearAllCache, clearCacheFailures } = require('../lib/cache');
const { buildRef, matchVideoTitle } = require('../lib/title-match');

const FALLBACK_TMDB_KEY = process.env.TMDB_API_KEY; // clé perso, réservée au testeur admin du dashboard (/api/test-resolve) — jamais utilisée pour les visiteurs de l'addon
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

// ---- Fetch réseau avec timeout ----
// Tous les appels externes (TMDB, YouTube, Allociné, oEmbed...) passent par ici :
// sur Vercel la fonction est plafonnée à maxDuration=15s (vercel.json), un service
// qui ne répond pas ne doit pas faire expirer toute la requête. AbortSignal.timeout
// est disponible en Node 18+ (Vercel tourne en Node 20).
const NETWORK_TIMEOUT_MS = 8000;
async function fetchT(url, opts = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: opts.signal || controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ---- Auth dashboard : token signé (HMAC, façon JWT maison) + bcrypt + anti brute-force ----
// Clé de signature dérivée de DASHBOARD_PASSWORD (pas de secret aléatoire) : sur Vercel,
// plusieurs instances serverless tournent en parallèle, un secret généré en mémoire serait
// différent sur chacune -> des tokens valides seraient rejetés au hasard selon l'instance
// qui répond. Dériver du mot de passe donne la même clé partout sans variable en plus.
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

function getTokenSecret() {
    return crypto.createHash('sha256').update(DASHBOARD_PASSWORD || '').digest();
}

let passwordHashPromise = null;
function getPasswordHash() {
    if (!passwordHashPromise) passwordHashPromise = bcrypt.hash(DASHBOARD_PASSWORD, 10);
    return passwordHashPromise;
}

function generateToken() {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ role: 'admin', iat: Date.now(), exp: Date.now() + SESSION_DURATION_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', getTokenSecret()).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    try {
        const [header, body, sig] = token.split('.');
        if (!header || !body || !sig) return false;
        const expectedSig = crypto.createHmac('sha256', getTokenSecret()).update(`${header}.${body}`).digest('base64url');
        const sigBuf = Buffer.from(sig);
        const expectedBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
        return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now();
    } catch {
        return false;
    }
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// Compteur de tentatives dans Redis (via lib/cache, déjà utilisé ailleurs dans ce fichier)
// plutôt qu'une Map en mémoire : une Map ne serait ni persistante ni partagée entre les
// instances serverless de Vercel, un attaquant pourrait la contourner en retombant sur
// d'autres instances à chaque tentative.
async function isLockedOut(ip) {
    const attempts = await getCached(`loginattempts:${ip}`);
    return !!(attempts && attempts.count >= MAX_LOGIN_ATTEMPTS);
}

async function recordLoginAttempt(ip, success) {
    const key = `loginattempts:${ip}`;
    if (success) { await setCached(key, null, 1); return; }
    const attempts = (await getCached(key)) || { count: 0 };
    await setCached(key, { count: attempts.count + 1 }, LOCKOUT_SECONDS);
}

// Liste noire large : tout ce qui trahit une AUTRE langue que le français (VO anglaise,
// sous-titrée, ou une des grandes langues de doublage YouTube). On préfère une liste trop
// large (faux négatif -> repli Allociné/YouTube) qu'une liste trop courte (faux positif ->
// un trailer anglais qui passe pour VF, bien pire pour l'utilisateur).
const BASE_NON_VF_KEYWORDS = [
    // Anglais / VO / sous-titres (génériques)
    'vost', 'vostfr', 'vosta', ' vo ', '(vo)', '[vo]', ' vo)', ' vo]', 'v.o.',
    'sub', 'subtitled', 'subbed', 'subtitles', 'original version', 'original trailer',
    'english', 'anglais', 'eng dub', '(eng)', '[eng]', ' eng ',
    // Autres langues de doublage courantes sur YouTube
    'deutsch', 'german', 'allemand',
    'italiano', 'italian', 'italien',
    'español', 'espanol', 'spanish', 'espagnol', 'latino', 'castellano',
    'legendado', 'legendas', 'dublado', 'português', 'portugues', 'portuguese',
    'nederlands', 'dutch', 'néerlandais',
    'русский', 'russian', 'russe',
    '日本語', 'japanese', 'japonais',
    '한국어', 'korean', 'coréen',
    '中文', 'chinese', 'chinois', 'mandarin',
    'türkçe', 'turkish', 'turc',
    'polski', 'polish', 'polonais',
    'arabic', 'arabe', 'العربية',
    'hindi', 'हिन्दी',
];
// Types de vidéos TMDB considérés comme "bandes-annonces" au sens strict.
// Les types "extras" (récaps, extraits, making-of...) sont proposés en plus
// seulement quand includeExtras est activé (réglage admin + override par
// utilisateur sur /configure), jamais par défaut.
const ACCEPTED_VIDEO_TYPES = ['Trailer', 'Teaser'];
const EXTRA_VIDEO_TYPES = ['Clip', 'Featurette', 'Behind the Scenes', 'Bloopers', 'Recap', 'Opening Credits'];

// Libellés français affichés dans Stremio pour chaque type de vidéo TMDB.
// On garde le nom "bande-annonce" générique pour les replis Allociné/YouTube
// (formatStreamTitle('trailer')), et on traduit proprement chaque type "extra".
const VIDEO_TYPE_LABELS = {
    'Trailer': 'Bande-annonce',
    'Teaser': 'Teaser',
    'Clip': 'Extrait',
    'Featurette': 'Making-of',
    'Behind the Scenes': 'Coulisses',
    'Bloopers': 'Bêtisier',
    'Recap': 'Récap',
    'Opening Credits': 'Générique',
};

// Résout la liste de types acceptés selon le réglage includeExtras.
function getAcceptedVideoTypes(behavior) {
    return behavior && behavior.includeExtras ? [...ACCEPTED_VIDEO_TYPES, ...EXTRA_VIDEO_TYPES] : ACCEPTED_VIDEO_TYPES;
}

// ---- Présentation des flux dans Stremio ----
// `name` (colonne de gauche) : Stremio y affiche par défaut le nom de l'addon si on ne
// le précise pas -> d'où le "W Bandes-Annonces VF" répété sur chaque ligne. On le
// remplace par un tag court et lisible : clap + VF, avec la qualité RÉELLEMENT connue
// en 2e ligne -- uniquement quand elle est vraiment connue (qualité forcée ET
// effectivement résolue). Le mot "Auto" n'apportait aucune information concrète
// (Stremio choisit lui-même), donc on ne l'affiche plus : sans qualité connue, le
// tag reste sur une seule ligne, plus propre.
// Le vrai logo (image) reste géré par Stremio à partir de manifest.logo, on ne peut
// pas en injecter un par flux ici -- c'est ce tag qui joue ce rôle "repère visuel".
// `title` (colonne de droite) : au lieu du nom brut de la vidéo YouTube (souvent
// redondant ou mal formaté, ex. "Supergirl | Teaser"), on affiche systématiquement
// le titre officiel du film/série (déjà vérifié par title-match.js), de façon uniforme
// quelle que soit la source (TMDB, Allociné, YouTube). Sur 2 lignes (genre / titre),
// sans icône ni tiret : ça reprenait de la place pour rien (déjà dans le tag de
// gauche) et poussait le titre du film hors de la zone visible, tronqué par Stremio.
function formatStreamName() {
    return '🎬 VF';
}

// Accole "(Saison X)" au titre quand une saison précise est demandée -- évite le souci
// remonté par la communauté (MobLand S2) : sans ça, rien ne distingue la bande-annonce
// de la saison 2 de celle de la série en général, qu'on ouvre l'épisode 1 ou l'épisode 8.
function withSeasonLabel(title, season) {
    return season ? `${title} (Saison ${season})` : title;
}

function formatStreamTitle(kind, officialTitle, season) {
    const kindLabel = VIDEO_TYPE_LABELS[kind] || 'Bande-annonce';
    if (!officialTitle) return `${kindLabel} VF`;
    return `${kindLabel}\n${withSeasonLabel(officialTitle, season)}`;
}

// ---- Flux "ouvrir en externe" ----
// En plus du flux jouable dans le lecteur intégré de Stremio, on ajoute pour chaque
// trailer YouTube une entrée jumelle avec `externalUrl` : Stremio la traite comme un
// lien externe (ouvre l'appli/le navigateur YouTube) plutôt que de tenter de le lire
// dans son propre lecteur. Uniquement pertinent pour les flux YouTube (ytId) -- une
// URL Allociné n'a pas d'équivalent "appli externe" à ouvrir.
function formatExternalStreamName() {
    return '🎬 VF\n▶️ YouTube';
}

function buildExternalYoutubeStream(ytId, title) {
    return {
        name: formatExternalStreamName(),
        title: `${title || 'Bande-annonce VF'}\n(ouvrir dans YouTube)`,
        externalUrl: `https://www.youtube.com/watch?v=${ytId}`,
        __external: true, // marqueur interne (retiré avant envoi) -- voir applyUserStreamPrefs
    };
}

// Dailymotion n'est pas nativement résolu par le lecteur intégré de Stremio (contrairement
// à YouTube via `ytId`) : contrairement à un override en URL directe (qui pointe vers un
// vrai fichier vidéo), une page dailymotion.com/video/xxx est une page HTML, pas un flux
// brut -- tenter de la jouer inline échouerait. On la propose donc uniquement en "ouvrir en
// externe", comme le jumeau YouTube ci-dessus, jamais comme flux jouable direct.
function formatDailymotionStreamName() {
    return '🎬 VF\n▶️ Dailymotion';
}

function buildDailymotionStream(videoId, title) {
    return {
        name: formatDailymotionStreamName(),
        title: `${title || 'Bande-annonce VF'}\n(ouvrir dans Dailymotion)`,
        externalUrl: `https://www.dailymotion.com/video/${videoId}`,
        __external: true,
    };
}

// ---- Préférences d'affichage par utilisateur (page /configure) ----
// externalOnly : ne garde que les flux "ouvrir en externe" (marqués __external:true) --
// les flux qui n'ont pas d'équivalent externe (Allociné, override en URL directe, pas de
// __external du tout) ne sont jamais filtrés, il n'y a rien d'autre à proposer pour eux.
// maxLinks : tronque le nombre total de flux renvoyés, une fois le filtre ci-dessus appliqué.
// Appliqué en tout dernier, après cache/résolution -- jamais mis en cache lui-même (le cache
// reste commun à tous les utilisateurs, indépendant de leurs préférences d'affichage).
function applyUserStreamPrefs(streams, config) {
    if (!streams || !streams.length) return streams;
    let result = streams;
    if (config.externalOnly) {
        result = result.filter(s => s.__external !== false);
    }
    result = result.map(s => {
        if (!('__external' in s)) return s;
        const clean = { ...s };
        delete clean.__external;
        return clean;
    });
    if (config.maxLinks) {
        result = result.slice(0, config.maxLinks);
    }
    return result;
}

// ---- Mode AIOMetadata ("A trailer addon" dans Meta Providers > Trailers) ----
// AIOMetadata interroge l'addon comme Stremio le ferait pour un stream, mais ne sait lire que
// deux choses : un `ytId` YouTube ou une URL vidéo directe. Les flux "ouvrir en externe"
// (externalUrl : jumeau YouTube, Dailymotion, lien /proposer) lui sont inutiles, voire nuisibles
// (un lien /proposer pourrait être pris pour un trailer). On ne garde donc qu'UN seul flux
// exploitable, ytId en priorité ; liste vide sinon -> AIOMetadata garde le trailer de son fournisseur.
function toAiomStreams(streams) {
    const usable = (streams || []).filter(s => s && (s.ytId || s.url));
    usable.sort((a, b) => (b.ytId ? 1 : 0) - (a.ytId ? 1 : 0));
    return usable.slice(0, 1).map(s => {
        const { __external, ...rest } = s; // marqueur interne, jamais envoyé
        return rest;
    });
}

// AIOMetadata attend la réponse pendant qu'il construit la fiche : au-delà de ce délai on répond
// vide (il retombe sur son propre trailer). La résolution continue en arrière-plan et remplit le
// cache pour la requête suivante. Réglable dans le dashboard (Réglages > AIOMetadata), 1 à 12 s
// (la fonction Vercel expire à 15 s) ; 5 s par défaut.
function aiomTimeoutMs(behavior) {
    const secs = Number(behavior && behavior.aiomTimeoutSeconds);
    return (Number.isFinite(secs) && secs > 0 ? Math.min(12, Math.max(1, secs)) : 5) * 1000;
}
function withDeadline(promise, ms) {
    let timer;
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve({ streams: [], timedOut: true }), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Journal dashboard (page Logs, contexte AIOM) : une ligne par requête AIOMetadata, SANS toucher
// aux stats globales (AIOMetadata peut interroger l'addon pour beaucoup de titres d'un coup : ça
// gonflerait "Requêtes totales" et noierait les vraies demandes des utilisateurs Stremio).
// Dédoublonnage en mémoire (5 min, par instance serverless) : un même titre redemandé en boucle
// ne remplit pas le journal, mais un changement de résultat (ex. timeout puis succès) est loggé.
const AIOM_LOG_DEDUPE_MS = 5 * 60 * 1000;
const _aiomSeen = new Map();
async function logAiomRequest({ type, imdbId, season, config, result, ms, timeoutMs }) {
    const first = result.streams && result.streams[0];
    const outcome = result.timedOut ? 'timeout'
        : result.hidden ? 'masqué'
        : first ? (first.ytId ? 'ytId' : 'url')
        : 'aucun';

    const key = `${type}:${imdbId}:${season || ''}:${outcome}`;
    const now = Date.now();
    const last = _aiomSeen.get(key);
    if (last && now - last < AIOM_LOG_DEDUPE_MS) return;
    _aiomSeen.set(key, now);
    if (_aiomSeen.size > 500) {
        for (const [k, t] of _aiomSeen) if (now - t > AIOM_LOG_DEDUPE_MS) _aiomSeen.delete(k);
    }

    const typeLabel = type === 'series' ? 'série' : 'film';
    const titleLabel = result.officialTitle ? `"${result.officialTitle}"` : imdbId;
    const verdict = {
        ytId: 'trailer YouTube renvoyé',
        url: 'trailer en lien direct renvoyé',
        aucun: 'aucun trailer VF — AIOMetadata garde celui de son fournisseur',
        timeout: `trop lent (> ${Math.round(timeoutMs / 1000)} s) — AIOMetadata garde celui de son fournisseur`,
        masqué: 'titre masqué par un override',
    }[outcome];

    await logEvent({
        level: outcome === 'timeout' ? 'warn' : 'info',
        context: 'AIOM',
        event: 'aiom_request',
        message: `AIOMetadata → ${titleLabel} (${typeLabel}) : ${verdict}`,
        meta: {
            imdbId, type,
            season: season || null,
            title: result.officialTitle || null,
            pseudo: config.pseudo || null,
            result: outcome,
            source: result.source || null,
            cache: result.timedOut ? null : (result.fromCache ? 'oui' : 'non'),
            ms: `${ms} ms`,
            ytId: first && first.ytId ? first.ytId : null,
        },
    });
}

// Logo servi comme fichier statique (public/logo_transparent_check.png) plutôt qu'en
// base64 dans le manifest : Stremio limite la taille du descriptor, et l'ancien base64
// (~40 Ko) le faisait dépasser -> erreur "Max descriptor size reached".
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://vfwallace.duckdns.org';
const LOGO_URL = `${APP_BASE_URL}/logo_transparent_check.png`;
// Surchageable via env var si un domaine perso est ajouté un jour -- voir note sur LOGO_URL,
// même logique : une valeur fixe raisonnable par défaut plutôt qu'une détection dynamique
// fragile (pas d'accès à `req` à l'endroit où ce lien est construit, voir buildProposeLinkStream).

const manifest = {
    id: 'org.vftrailers',
    version: '3.5.0',
    name: 'W Bandes-Annonces VF',
    description: 'Addon Stremio bande d\'annonce VF',
    logo: LOGO_URL,
    // 'stream' reste pour l'app Stremio officielle (onglet Streams). On ajoute 'meta' à
    // côté : certains clients tiers (Fusion notamment) n'affichent leurs bandes-annonces
    // qu'à partir du champ `trailers` de l'objet meta, pas du resource `stream` -- les deux
    // mécanismes coexistent dans le protocole Stremio, indépendants l'un de l'autre.
    resources: ['stream', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: true },
};

// ---- Décodage de la config utilisateur (base64url -> JSON) ----
// Segment de config plafonné à 2 Ko : au-delà, on refuse silencieusement (une config
// ne contient que tmdbKey/pseudo/maxLinks/externalOnly, jamais besoin de plus) --
// ça protège d'un URL abusivement long (anti-abus, allègement des logs).
function decodeConfig(str) {
    if (!str || typeof str !== 'string' || str.length > 2048) return {};
    try {
        let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const json = Buffer.from(b64, 'base64').toString('utf-8');
        const parsed = JSON.parse(json);
        const maxLinksNum = Number(parsed.maxLinks);
        return {
            tmdbKey: typeof parsed.tmdbKey === 'string' ? parsed.tmdbKey : null,
            pseudo: typeof parsed.pseudo === 'string' ? parsed.pseudo.trim().slice(0, 40) || null : null,
            // externalOnly : n'affiche que les flux "ouvrir dans YouTube" (pas de lecture intégrée).
            // maxLinks : limite le nombre total de flux renvoyés (1 à 10) -- certains utilisateurs
            // préfèrent un seul lien plutôt que 2-3 (trailer + teaser, jouable + externe...).
            // includeExtras : tri-state -- true force les extras, false les coupe, null (absent)
            // suit le réglage admin (behavior.includeExtras). Laisse l'admin décider par défaut,
            // tout en donnant au visiteur la main s'il le veut.
            externalOnly: parsed.externalOnly === true,
            includeExtras: typeof parsed.includeExtras === 'boolean' ? parsed.includeExtras : null,
            maxLinks: Number.isInteger(maxLinksNum) && maxLinksNum > 0 && maxLinksNum <= 10 ? maxLinksNum : null,
            // aiom : mode "A trailer addon" d'AIOMetadata (un seul flux ytId/url, délai court, pas de
            // flux externes ni de lien /proposer) -- voir toAiomStreams et la route /stream.
            aiom: parsed.aiom === true,
        };
    } catch {
        return {};
    }
}

// ---- Référence TMDB enrichie pour le matching v2 (lib/matching.js + title-match.js) ----
// La vérification titre officiel <-> nom de trailer vit dans lib/title-match.js
// (matchVideoTitle, partagé avec allocine.js et youtube-search.js). La référence
// contient maintenant le titre FR + le titre original + tous les titres alternatifs
// TMDB : ça règle le cas fréquent où le trailer YouTube utilise le titre
// international ("28 Days Later" pour "28 Jours plus tard").

function pickBestTrailers(videos, maxTrailers) {
    // Ordre de préférence : Trailer > Teaser > extras (Clip, Récap, Making-of...).
    // Les "vraies" bandes-annonces passent toujours avant les extras quand un titre
    // a les deux -- un utilisateur qui active les extras veut un bonus, pas un remplaçant.
    const typeRank = t => {
        if (t.type === 'Trailer') return 0;
        if (t.type === 'Teaser') return 1;
        return 2;
    };
    const sorted = [...videos].sort((a, b) => {
        const rankDiff = typeRank(a) - typeRank(b);
        if (rankDiff !== 0) return rankDiff;
        if (a.official !== b.official) return a.official ? -1 : 1;
        return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });
    const seenNames = new Set();
    const picked = [];
    for (const v of sorted) {
        const key = v.name.trim().toLowerCase();
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        picked.push(v);
        if (picked.length >= maxTrailers) break;
    }
    return picked;
}

// Titre FR + titre original + année — le titre original sert à enrichir la référence
// de matching (un trailer peut utiliser le titre international plutôt que le titre FR).
// Résilient : une panne réseau ponctuelle sur CE sous-appel ne doit pas tuer toute la
// résolution (elles sont lancées en Promise.all avec getAlternativeTitles ci-dessous).
async function getTitleAndYear(mediaType, tmdbId, tmdbKey) {
    try {
        const res = await fetchT(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbKey}&language=fr-FR`);
        const data = await res.json();
        const title = mediaType === 'movie' ? data.title : data.name;
        const originalTitle = mediaType === 'movie' ? data.original_title : data.original_name;
        const dateStr = mediaType === 'movie' ? data.release_date : data.first_air_date;
        return { title, originalTitle, year: dateStr ? dateStr.slice(0, 4) : null };
    } catch (err) {
        console.error('Erreur récupération titre TMDB:', err.message);
        return { title: null, originalTitle: null, year: null };
    }
}

// Titres alternatifs TMDB (marché FR) — enrichit encore la référence de matching
// pour les cas où ni le titre FR ni le titre original n'apparaissent dans le trailer.
async function getAlternativeTitles(mediaType, tmdbId, tmdbKey) {
    try {
        const res = await fetchT(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/alternative_titles?api_key=${tmdbKey}`);
        const data = await res.json();
        return (data.titles || [])
            .filter(t => t.iso_3166_1 === 'FR')
            .map(t => t.title);
    } catch (err) {
        console.error('Erreur récupération titres alternatifs TMDB:', err.message);
        return [];
    }
}

// Résolution complète (sans override, sans cache) — TMDB puis Allociné en repli
// `trace` (optionnel) : tableau dans lequel on pousse les étapes { step, ok, detail, ms } pour
// le testeur admin (/api/test-resolve). Non fourni -> aucune instrumentation (0 surcoût).
async function resolveViaApis(type, imdbId, season, behavior, tmdbKey, trace) {
    const rec = (step, ok, detail, ms) => { if (trace) trace.push({ step, ok: !!ok, detail: detail || '', ms: ms == null ? null : ms }); };
    const nonVfKeywords = [...BASE_NON_VF_KEYWORDS, ...(behavior.extraVfKeywords || [])];
    // Avant : on excluait juste les mots-clés VOST/sub/original (liste noire) -> un trailer
    // nommé sobrement "Official Trailer" passait à travers alors qu'il n'est pas forcément VF.
    // Maintenant : il faut en plus un signal explicite "VF"/"français"/"french" dans le nom
    // (liste blanche), sinon on tombe sur Allociné puis YouTube comme repli.
    const hasVfSignal = name =>
        /\bvf\b/i.test(name) ||
        /\bvfq\b/i.test(name) ||                // doublage québécois
        /fran[çc]ais/i.test(name) ||
        /\bfrench\b/i.test(name) ||
        /qu[ée]b[ée]cois/i.test(name) ||
        /qu[ée]bec/i.test(name) ||
        /doublage/i.test(name);
    // Strict : il faut un signal explicite VF/VFQ ET aucune trace d'une autre langue.
    // Un trailer sans AUCUNE indication de langue (ex: "Official Trailer" tout court)
    // est donc rejeté par défaut -> pas de VF, pas de faux "peut-être français".
    const isLikelyVF = name => !nonVfKeywords.some(kw => name.toLowerCase().includes(kw)) && hasVfSignal(name);

    const tFind = Date.now();
    const findRes = await fetchT(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`);
    const findData = await findRes.json();
    const result = type === 'movie' ? findData.movie_results?.[0] : findData.tv_results?.[0];
    if (!result) {
        rec('tmdb-find', false, `Aucun résultat TMDB pour ${imdbId}`, Date.now() - tFind);
        return { streams: [], officialTitle: null };
    }
    rec('tmdb-find', true, `TMDB: ${type === 'movie' ? 'film' : 'série'} #${result.id} (${result.title || result.name || result.original_title || result.original_name || ''})`, Date.now() - tFind);

    const tmdbId = result.id;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    // Titre FR + original + alternatifs en parallèle (deux allers-retours réseau
    // séparés) puis construction de la référence enrichie utilisée par le matching v2.
    const tMeta = Date.now();
    const [{ title: officialTitle, originalTitle, year: officialYear }, alternativeTitles] = await Promise.all([
        getTitleAndYear(mediaType, tmdbId, tmdbKey),
        getAlternativeTitles(mediaType, tmdbId, tmdbKey),
    ]);
    rec('tmdb-meta', !!officialTitle, `Titre officiel: ${officialTitle || 'inconnu'}${officialYear ? ` (${officialYear})` : ''}${alternativeTitles.length ? ` · ${alternativeTitles.length} titre(s) alternatif(s)` : ''}`, Date.now() - tMeta);
    const ref = buildRef({
        tmdbId,
        year: officialYear,
        allTitles: [officialTitle, originalTitle, ...alternativeTitles].filter(Boolean),
        allPosterPaths: [],
    });

    async function fetchVideos(url, stepLabel) {
        const t0 = Date.now();
        const res = await fetchT(url);
        const data = await res.json();
        const all = (data.results || []).filter(v => v.site === 'YouTube');
        const accepted = getAcceptedVideoTypes(behavior);
        let kept = all.filter(v =>
            v.site === 'YouTube' && accepted.includes(v.type) && isLikelyVF(v.name) &&
            // Garde-fou anti-suite conservé pour Trailer/Teaser (un "2" dans le titre
            // trahit une autre entrée), mais relâché pour les extras : "Récap de la
            // saison 4" porte un numéro de saison qui n'est pas un numéro de suite.
            matchVideoTitle(v.name, ref, { ignoreNumbers: EXTRA_VIDEO_TYPES.includes(v.type) })
        );
        if (behavior.ignoreTeasers) kept = kept.filter(v => v.type !== 'Teaser');
        rec('tmdb-videos', kept.length > 0, `${stepLabel}: ${kept.length}/${all.length} retenue(s)${behavior.ignoreTeasers ? ' (sans teaser)' : ''}${behavior.includeExtras ? ' (extras inclus)' : ''}`, Date.now() - t0);
        return kept;
    }

    let trailers = [];
    if (mediaType === 'tv' && season) {
        trailers = await fetchVideos(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/videos?api_key=${tmdbKey}&language=fr-FR`, `Vidéos saison ${season} (fr-FR)`);
        if (!trailers.length && behavior.trailerLanguage !== 'fr-only') trailers = await fetchVideos(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/videos?api_key=${tmdbKey}`, `Vidéos saison ${season} (langue par défaut)`);
    }
    if (!trailers.length) trailers = await fetchVideos(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${tmdbKey}&language=fr-FR`, 'Vidéos globales (fr-FR)');
    if (!trailers.length && behavior.trailerLanguage !== 'fr-only') trailers = await fetchVideos(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${tmdbKey}`, 'Vidéos globales (langue par défaut)');

    if (trailers.length > 0) {
        const best = pickBestTrailers(trailers, behavior.maxTrailers || 2);
        rec('tmdb-pick', true, `${best.length} trailer(s) sélectionné(s) sur ${trailers.length} (max ${behavior.maxTrailers || 2})`);
        const streams = best.map(t => ({
            title: formatStreamTitle(t.type, officialTitle, season),
            ytId: t.key,
        }));
        return { streams, officialTitle, source: 'tmdb' };
    }

    if (!officialTitle || !behavior.allocineFallback) {
        rec('allocine', false, !officialTitle ? 'Titre officiel inconnu — repli Allociné impossible' : 'Repli Allociné désactivé dans les réglages');
        return { streams: [], officialTitle, source: null };
    }
    const tAllo = Date.now();
    const allocineStreams = await getAllocineTrailerStreams(officialTitle, ref);
    rec('allocine', allocineStreams.length > 0, allocineStreams.length > 0 ? `${allocineStreams.length} bande-annonce(s) trouvée(s)` : 'Aucune bande-annonce trouvée sur Allociné', Date.now() - tAllo);
    if (allocineStreams.length > 0) {
        const streams = allocineStreams.map(s => ({ title: formatStreamTitle('trailer', officialTitle, season), url: s.url }));
        return { streams, officialTitle, source: 'allocine' };
    }

    // Dernier recours : recherche YouTube directe (scraping, pas d'API/clé/quota).
    // Le moins fiable des trois -> toujours en dernière position de la chaîne.
    if (!behavior.youtubeSearchFallback) {
        rec('youtube-search', false, 'Repli recherche YouTube désactivé dans les réglages');
        return { streams: [], officialTitle, source: null };
    }
    const query = `${officialTitle} bande annonce VF`;
    const tYt = Date.now();
    const found = await searchYoutubeTrailer(query, ref);
    rec('youtube-search', !!found, found ? `Trouvé: v=${found.videoId}` : `Rien de pertinent pour "${query}"`, Date.now() - tYt);
    if (found) {
        return {
            streams: [{ title: formatStreamTitle('trailer', officialTitle, season), ytId: found.videoId }],
            officialTitle,
            source: 'youtube_search',
        };
    }

    // Tout dernier recours : Dailymotion (API publique, voir lib/dailymotion-search.js).
    // Contrairement aux flux YouTube/Allociné/TMDB, un résultat Dailymotion n'est proposé
    // qu'en "ouvrir en externe" (pas de lecture inline) -- voir buildDailymotionStream.
    if (!behavior.dailymotionFallback) {
        rec('dailymotion-search', false, 'Repli Dailymotion désactivé dans les réglages');
        return { streams: [], officialTitle, source: null };
    }
    const tDm = Date.now();
    const foundDm = await searchDailymotionTrailer(query, ref);
    rec('dailymotion-search', !!foundDm, foundDm ? `Trouvé: v=${foundDm.videoId}` : `Rien de pertinent pour "${query}"`, Date.now() - tDm);
    if (!foundDm) return { streams: [], officialTitle, source: null };
    return {
        streams: [buildDailymotionStream(foundDm.videoId, formatStreamTitle('trailer', officialTitle, season))],
        officialTitle,
        source: 'dailymotion_search',
    };
}

// Dédup : on ne veut logger qu'une seule fois qu'une personne donnée (pseudo) a
// cherché un titre donné. SADD retourne 1 si le membre est nouveau, 0 s'il existait
// déjà -> ça nous dit directement si c'est la 1ère fois ou une redemande.
// Best-effort comme le reste : sans Redis, impossible de dédupliquer -> on logue à chaque fois.
async function isNewSearch(pseudoKey, imdbId, type) {
    if (!redis) return true;
    try {
        const added = await redis.sadd('seen:searches', `${pseudoKey}|${imdbId}|${type}`);
        return added === 1;
    } catch (err) {
        console.error('Erreur dédup recherche:', err.message);
        return true;
    }
}

// Construit la liste prioritaire de liens d'un override (rétrocompat avec ytId/url seuls).
function buildOverrideLinks(override) {
    const links = Array.isArray(override.links)
        ? override.links
            .filter(l => l && (typeof l.ytId === 'string' && l.ytId.trim() || typeof l.url === 'string' && l.url.trim()))
            .map(l => l.ytId ? { ytId: l.ytId.trim() } : { url: l.url.trim() })
        : [];
    if (!links.length) {
        if (typeof override.ytId === 'string' && override.ytId.trim()) links.push({ ytId: override.ytId.trim() });
        else if (typeof override.url === 'string' && override.url.trim()) links.push({ url: override.url.trim() });
    }
    return links;
}

// Vérifie (oEmbed) qu'une vidéo YouTube existe et est publique -- sert à sauter un lien mort
// et passer au repli suivant. Coûteux (1 requête), donc réservé au cas multi-liens.
async function isYoutubeLinkAvailable(ytId) {
    try {
        const r = await fetchT(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}&format=json`, {}, 5000);
        return r.ok;
    } catch {
        return false;
    }
}

// Vérifie (HEAD) qu'une URL directe répond -- sert à sauter un lien mort dans la chaîne
// de repli, comme isYoutubeLinkAvailable pour les ytId. Réservé au cas multi-liens.
async function isUrlReachable(url) {
    try {
        const r = await fetchT(url, { method: 'HEAD', redirect: 'follow' }, 5000);
        return r.ok || r.status < 400;
    } catch {
        return false;
    }
}

// TTL du cache "quel lien est actuellement vivant" pour les overrides à liens de repli
// multiples (voir resolveOverrideLinks). Volontairement court : un lien qui vient de
// mourir reste servi jusqu'à expiration -- même compromis que le reste du cache de
// l'addon (cache.js), pas un cas à part.
const OVERRIDE_LINK_CHECK_TTL_SECONDS = 10 * 60; // 10 min

// Résout les liens d'un override en respectant l'ordre de priorité : le PREMIER lien jouable
// est servi, les suivants servent de repli si une vidéo devient indisponible/supprimée.
// Cas courant (1 seul lien) : comportement identique à avant, zéro latence ajoutée.
//
// Cas à 2+ liens : déterminer "lequel est encore vivant" demande un appel réseau par lien
// (oEmbed YouTube / HEAD sur l'URL, jusqu'à 5s chacun) -- REFAIT AVANT à CHAQUE requête
// Stremio de CHAQUE visiteur regardant ce titre, sans aucun cache, contrairement au reste
// de l'addon. Sur un override à 2-3 replis, ça pouvait ajouter plusieurs secondes de
// latence à chaque ouverture. On met maintenant en cache l'INDEX du premier lien trouvé
// vivant (`overrideKey` = imdbId:season), invalidé automatiquement par overrides.js dès
// que l'override est modifié -- donc pas de risque de rester bloqué sur un mauvais choix
// après une correction manuelle.
// Ajoute "👤 Proposé par X" en 2e ligne du titre affiché dans Stremio, uniquement quand
// l'override vient d'une contribution communautaire acceptée (override.contributedBy).
// Un override créé/édité normalement par l'admin depuis le dashboard n'a pas ce champ
// -> le titre reste inchangé, aucune mention n'apparaît.
function withContributorNote(title, contributedBy) {
    return contributedBy ? `${title}\n👤 Proposé par ${contributedBy}` : title;
}

async function resolveOverrideLinks(links, overrideTitle, overrideKey, contributedBy, season) {
    const baseTitle = overrideTitle ? withSeasonLabel(overrideTitle, season) : formatStreamTitle('trailer', null, season);
    const title = withContributorNote(baseTitle, contributedBy);

    if (links.length === 1) {
        const l = links[0];
        if (l.ytId) return buildYoutubeStreams(l.ytId, title);
        return [{ name: formatStreamName(), title, url: l.url }];
    }

    const cacheKey = overrideKey ? `cache:override-link:${overrideKey}` : null;
    if (cacheKey) {
        const cached = await getCached(cacheKey);
        if (cached && typeof cached.index === 'number' && links[cached.index]) {
            const l = links[cached.index];
            return l.ytId ? buildYoutubeStreams(l.ytId, title) : [{ name: formatStreamName(), title, url: l.url }];
        }
    }

    for (let i = 0; i < links.length; i++) {
        const l = links[i];
        if (l.ytId) {
            if (!(await isYoutubeLinkAvailable(l.ytId))) continue; // lien mort -> repli suivant
            if (cacheKey) await setCached(cacheKey, { index: i }, OVERRIDE_LINK_CHECK_TTL_SECONDS);
            return buildYoutubeStreams(l.ytId, title);
        }
        if (!(await isUrlReachable(l.url))) continue; // lien mort -> repli suivant
        if (cacheKey) await setCached(cacheKey, { index: i }, OVERRIDE_LINK_CHECK_TTL_SECONDS);
        return [{ name: formatStreamName(), title, url: l.url }];
    }
    return []; // tous les liens sont morts -> on ne sert rien (plutôt que du cassé)
}

// Flux YouTube servi tel quel via `ytId` (lecteur intégré Stremio officiel), sans tentative
// d'extraction d'une URL directe -- ancien comportement retiré : le scraping ytdl-core était
// quasi-systématiquement bloqué par la protection anti-bot de YouTube sur les IP datacenter
// Vercel (voir historique), pour un gain quasi nul et beaucoup de latence/bruit dans les logs.
function buildYoutubeStreams(ytId, title) {
    const stream = { name: formatStreamName(), title, ytId, __external: false };
    return [stream, buildExternalYoutubeStream(ytId, title)];
}

// Cache mémoire (durée de vie du process serverless, ~30s) pour getBehaviorSettings() :
// ce réglage est lu à CHAQUE requête /stream mais ne change quasiment jamais -- inutile de
// taper Redis à chaque fois. Utilisé uniquement sur le chemin chaud (résolution réelle) ;
// les routes /api/settings/behavior (dashboard) continuent d'appeler getBehaviorSettings()
// directement pour toujours refléter l'état exact. Contrepartie : jusqu'à ~30s avant qu'un
// changement de réglage admin soit pris en compte par les visiteurs -- largement acceptable
// pour ce type de réglage, et ça réduit d'autant les commandes Redis consommées.
let _behaviorCache = null;
let _behaviorCacheAt = 0;
const BEHAVIOR_CACHE_TTL_MS = 30000;
async function getBehaviorSettingsFast() {
    if (_behaviorCache && Date.now() - _behaviorCacheAt < BEHAVIOR_CACHE_TTL_MS) return _behaviorCache;
    _behaviorCache = await getBehaviorSettings();
    _behaviorCacheAt = Date.now();
    return _behaviorCache;
}

// Point d'entrée réel : override manuel > cache > résolution complète > qualité forcée.
// Renommée en "Core" -- voir resolveStreams (wrapper) juste après, qui applique les
// préférences d'affichage de l'utilisateur (externalOnly / maxLinks) sur le résultat.
async function resolveStreamsCore(type, imdbId, season, config) {
    const pseudoKey = config.pseudo || 'anonyme';
    // Clone impératif : getBehaviorSettingsFast() renvoie le même objet en mémoire tant que
    // le cache est valide (30s) ; sans clone, muter behavior.includeExtras ci-dessous
    // modifierait l'objet partagé et ferait fuiter la préférence d'un visiteur vers le
    // suivant dans la même fenêtre de cache.
    const behavior = { ...(await getBehaviorSettingsFast()) };
    // Override utilisateur (config encodée dans l'URL) sur le réglage admin :
    // tri-state -- true force les extras, false les coupe, null suit l'admin.
    if (typeof config.includeExtras === 'boolean') behavior.includeExtras = config.includeExtras;

    const override = await getOverride(imdbId, season);
    if (override) {
        if (override.hidden) {
            // "Masquer ce titre" (dashboard) : l'admin a volontairement coupé le mapping
            // pour cet IMDB ID -> aucune bande-annonce. Pas d'override_used, pas de
            // logFailure (voir route /stream) : c'est un choix délibéré, pas un échec.
            return { streams: [], officialTitle: override.title || null, hidden: true };
        }
        const links = buildOverrideLinks(override);
        if (links.length) {
            const streams = await resolveOverrideLinks(links, override.title, `${imdbId}:${season || ''}`, override.contributedBy, season);
            if (await isNewSearch(pseudoKey, imdbId, type)) {
                await logEvent({ level: 'info', context: 'OVERRIDE', event: 'override_used', message: `Override utilisé pour ${imdbId}${override.title ? ' — ' + override.title : ''}`, meta: { imdbId, season: season || null, pseudo: config.pseudo || null } });
            }
            await incrementOverrideUse(imdbId, season);
            return { streams, officialTitle: override.title || null, source: 'override' };
        }
        // Override existant mais SANS lien et non masqué (ex: réactivé après un masquage
        // sans lien) -> ne pas servir un flux cassé, on retombe sur la résolution normale.
    }

    const tmdbKey = config.tmdbKey;
    if (!tmdbKey) return { streams: [], officialTitle: null }; // pas de clé perso configurée par le visiteur -> rien à faire (plus de fallback sur la clé serveur)

    // L'état includeExtras fait partie de la clé de cache : un résultat avec extras
    // n'est PAS compatible avec un utilisateur sans extras (et inversement), sinon on
    // servirait des flux "Récap"/"Extrait" à quelqu'un qui ne les veut pas.
    const cacheKey = `cache:trailers:${imdbId}:${type}:${season || 'all'}:${behavior.includeExtras ? 'x' : 'nx'}`;

    if (behavior.cacheEnabled) {
        const cached = await getCached(cacheKey);
        if (cached) {
            if (await isNewSearch(pseudoKey, imdbId, type)) {
                if (cached.streams.length > 0) {
                    // Plus de logEvent ici : une résolution réussie n'est pas un événement à
                    // journaliser (bruit), seuls les vrais problèmes de mapping (rien trouvé)
                    // le sont. Le suivi des résolutions reste dans "Résolutions récentes".
                    await logResolution({
                        imdbId, season, type,
                        title: cached.officialTitle,
                        source: cached.source,
                        streams: cached.streams,
                    });
                } else {
                    // Échec mis en cache (cacheFailures) : le mapping manquant reste un vrai
                    // problème à journaliser, même si la résolution elle-même vient du cache.
                    const typeLabel = type === 'series' ? 'série' : 'film';
                    const titleLabel = cached.officialTitle ? `"${cached.officialTitle}"` : imdbId;
                    const who = config.pseudo ? config.pseudo : 'Un visiteur';
                    await logEvent({
                        level: 'warn', context: 'STREAM', event: 'trailer_not_found',
                        message: `${who} a voulu voir ${titleLabel} (${typeLabel}) — mapping manquant`,
                        meta: { imdbId, type, pseudo: config.pseudo || null },
                    });
                }
            }
            return { ...cached, fromCache: true }; // fromCache : uniquement pour le journal AIOM, jamais re-stocké
        }
    }

    let result = await resolveViaApis(type, imdbId, season, behavior, tmdbKey);
    const isNew = await isNewSearch(pseudoKey, imdbId, type);

    if (result.streams.length > 0) {
        if (isNew) {
            // Idem : plus de logEvent pour un succès -- seul le journal "Résolutions
            // récentes" (mapping) le retient, les Logs ne gardent que les vrais problèmes.
            await logResolution({
                imdbId, season, type,
                title: result.officialTitle,
                source: result.source,
                streams: result.streams,
            });
        }
    } else if (isNew) {
        const typeLabel = type === 'series' ? 'série' : 'film';
        const titleLabel = result.officialTitle ? `"${result.officialTitle}"` : imdbId;
        const who = config.pseudo ? config.pseudo : 'Un visiteur';
        await logEvent({
            level: 'warn', context: 'STREAM', event: 'trailer_not_found',
            message: `${who} a voulu voir ${titleLabel} (${typeLabel}) — mapping manquant`,
            meta: { imdbId, type, pseudo: config.pseudo || null },
        });
    }

    // Pose ici le tag `name` affiché à gauche dans Stremio (voir formatStreamName) et le flux
    // jumeau "ouvrir en externe" pour chaque trailer YouTube -- centralisé ici plutôt que dans
    // resolveViaApis. Plus de résolution d'URL directe (voir buildYoutubeStreams) : ces flux
    // restent ytId-only, lisibles sur l'appli Stremio officielle via son lecteur intégré.
    if (result.streams.length > 0) {
        const expanded = result.streams.map(s => {
            if (!s.ytId) return [{ ...s, name: formatStreamName() }];
            return [{ ...s, name: formatStreamName(), __external: false }, buildExternalYoutubeStream(s.ytId, s.title)];
        });
        result = { ...result, streams: expanded.flat() };
    }

    if (behavior.cacheEnabled && result.streams.length > 0) {
        // TTL différencié par source : TMDB (catalogué, stable) > Allociné (HTML
        // scrapé, peut changer) > YouTube search (le moins fiable, re-vérifié souvent).
        let ttl;
        if (result.source === 'allocine') ttl = (behavior.allocineCacheTtlHours || 2) * 3600;
        else if (result.source === 'youtube_search') ttl = (behavior.youtubeSearchCacheTtlHours || 1) * 3600;
        else ttl = (behavior.cacheTtlHours || 6) * 3600;
        await setCached(cacheKey, result, ttl);
    } else if (behavior.cacheEnabled && behavior.cacheFailures) {
        // TTL volontairement court et indépendant de cacheTtlHours : un échec n'a pas la même
        // durée de vie qu'un succès (peut être corrigé par un override à tout moment).
        const failTtl = Math.max(60, (behavior.failureCacheTtlMinutes || 30) * 60);
        await setCached(cacheKey, result, failTtl);
    }

    return result;
}

// Wrapper public : applique les préférences d'affichage propres à l'utilisateur
// (externalOnly / maxLinks, définies sur /configure) après coup, sur CHAQUE chemin de
// retour de resolveStreamsCore (override, cache, résolution fraîche) sans avoir à
// dupliquer la logique à chaque return -- et sans jamais polluer le cache partagé,
// qui reste calculé une seule fois pour tout le monde en amont.
// Quand aucune source ne trouve de bande-annonce VF, plutôt qu'une liste vide (impasse
// silencieuse), on propose un flux "virtuel" qui renvoie vers /proposer avec le titre déjà
// pré-rempli -- transforme un échec en invitation à contribuer, pile au moment où la personne
// est le plus motivée à corriger elle-même. N'est jamais mis en cache séparément : fait partie
// du résultat normal de resolveStreamsCore (qui lui, cache un vrai [] -- voir plus haut), donc
// réévalué à la même fréquence que n'importe quel échec, pas plus souvent ni moins.
function buildProposeLinkStream(type, imdbId, season, officialTitle) {
    const params = new URLSearchParams({ imdbId, type: type === 'series' ? 'series' : 'movie' });
    if (season) params.set('season', String(season));
    if (officialTitle) params.set('title', officialTitle);
    return {
        name: '🎬 VF\n➕ Proposer',
        title: `${withSeasonLabel(officialTitle || 'Ce titre', season)}\nAucune bande-annonce VF trouvée — propose le bon lien`,
        externalUrl: `${APP_BASE_URL}/proposer?${params.toString()}`,
        __external: true,
    };
}

async function resolveStreams(type, imdbId, season, config) {
    const result = await resolveStreamsCore(type, imdbId, season, config);
    if (config.aiom) return { ...result, streams: toAiomStreams(result.streams) };
    let streams = applyUserStreamPrefs(result.streams, config);
    // Pas de flux "proposer" si : rien n'a vraiment été tenté (pas de clé TMDB configurée --
    // la personne n'a même pas fini sa config), ou si l'admin a explicitement masqué ce titre
    // (result.hidden) -- dans ce cas le silence est délibéré, pas un échec à combler.
    if (!streams.length && config.tmdbKey && !result.hidden) {
        streams = [buildProposeLinkStream(type, imdbId, season, result.officialTitle)];
    }
    return { ...result, streams };
}

// ---- Objet meta (pour le resource 'meta', consommé par Fusion & co) ----
// Format volontairement calqué à l'identique sur trailerio-lite (id, type, name, links --
// rien d'autre) : eux ne renvoient ni poster, ni background, ni le champ standard `trailers`,
// uniquement `links`. Testons si c'est la forme minimaliste qui compte pour Fusion, plutôt
// que d'ajouter des champs qui pourraient faire traiter cet addon comme un fournisseur de
// meta "complet" (concurrent d'AIOMetadata) au lieu d'un simple fournisseur de trailer.
async function buildMetaObject(type, imdbId, config) {
    const tmdbKey = config.tmdbKey;
    if (!tmdbKey) return null; // pas de clé perso -> pas de meta

    const findRes = await fetchT(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`);
    const findData = await findRes.json();
    const result = type === 'movie' ? findData.movie_results?.[0] : findData.tv_results?.[0];
    if (!result) return null;
    const title = type === 'movie' ? result.title : result.name;
    if (!title) return null;

    const { streams } = await resolveStreams(type, imdbId, null, config);
    const playable = streams.filter(s => !s.externalUrl && s.url); // seuls les flux avec URL directe résolue intéressent Fusion

    const links = playable.map(s => ({ trailers: s.url, provider: 'VF' }));

    // Champ natif Stremio (protocole officiel) : déclenche le bouton "Watch trailer" sur la
    // fiche du film/série, un lecteur dédié SÉPARÉ du lecteur principal -> contrairement aux
    // streams classiques, ça n'alimente jamais "Continuer à regarder"/bibliothèque (voir
    // discussion : ce bouton est distinct du bouton "Show", qui seul déclenche ce tracking).
    // Format attendu : { source: <ID YouTube>, type: 'Trailer' } -- source est bien l'ID seul,
    // pas une URL complète (contrairement au `links.trailers` ci-dessus, gardé pour Fusion).
    // On ne peut fournir ça QUE pour les trailers YouTube (source = ytId) : les flux Allociné
    // n'ont pas d'ID YouTube donc ne peuvent pas alimenter ce champ.
    const trailers = streams
        .filter(s => s.ytId)
        .map(s => ({ source: s.ytId, type: 'Trailer' }));

    return { id: imdbId, type, name: title, links, trailers };
}

// Résolution "à blanc" pour le testeur du dashboard : réutilise le même pipeline
// (override > TMDB/Allociné/YouTube selon les réglages actuels) mais ne touche JAMAIS
// au cache, aux stats ni aux logs -> un test admin ne doit pas polluer les vraies données.
async function testResolve(type, imdbId, season, ignoreOverride, aiom) {
    const trace = [];
    const rec = (step, ok, detail, ms) => trace.push({ step, ok: !!ok, detail: detail || '', ms: ms == null ? null : ms });

    const override = await getOverride(imdbId, season);
    if (override && !ignoreOverride) {
        if (override.hidden) {
            rec('override', true, 'Titre masqué par un override — aucune bande-annonce');
            return { source: 'override', officialTitle: override.title || null, streams: [], hidden: true, trace, aiom: !!aiom };
        }
        const overrideTitle = override.title || 'Bande-annonce VF';
        const streams = override.ytId
            ? [{ title: overrideTitle, ytId: override.ytId }, buildExternalYoutubeStream(override.ytId, overrideTitle)]
            : [{ title: overrideTitle, url: override.url }];
        rec('override', true, `Override appliqué${override.ytId ? ` — v=${override.ytId}` : override.url ? ' — URL directe' : ''}`);
        return { source: 'override', officialTitle: override.title || null, streams: aiom ? toAiomStreams(streams) : streams, trace, aiom: !!aiom };
    }
    if (override && ignoreOverride) {
        rec('override', false, 'Override ignoré (coché dans le formulaire) — test de la chaîne normale');
    }

    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return { error: "Aucune clé TMDB de secours configurée côté serveur (variable d'env TMDB_API_KEY) -> impossible de tester sans clé personnelle.", trace };

    const behavior = await getBehaviorSettings();
    const result = await resolveViaApis(type, imdbId, season, behavior, tmdbKey, trace);
    const expanded = result.streams.flatMap(s => s.ytId ? [s, buildExternalYoutubeStream(s.ytId, s.title)] : [s]);
    // Simulation AIOMetadata : montre exactement ce que l'addon renverrait en mode aiom.
    const streams = aiom ? toAiomStreams(expanded) : expanded;
    return { source: result.source, officialTitle: result.officialTitle, streams, trace, aiom: !!aiom };
}

function checkDashboardAuth(req) {
    if (!DASHBOARD_PASSWORD) return false; // pas de mdp configuré = accès refusé (fail closed)
    const token = req.header('x-admin-token');
    return !!token && verifyToken(token);
}

const app = express();
app.use(express.json({ limit: '64kb' })); // limite les corps de requête (anti-abus)
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
        "media-src https: blob: data:; " +
        "frame-ancestors 'none';"
    );
    next();
});

// Favicon embarqué en base64 (pas de dossier /public en serverless) -> évite les 404
// répétés que les navigateurs génèrent automatiquement en demandant /favicon.ico.
const FAVICON_BUFFER = Buffer.from('AAABAAEAEBAAAAAAIABCAwAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAwlJREFUeJwt0r1rnXUUwPHvOc/Lfe5b0mtMMqR0uIJm0aVEhDoIxloMYqtdXKSBdAxk6KC7Ujchq6tEK8WioFYJviSRtNRCW6cKaZNKjCSNuUnuW+5zf+c41C98/oOvAIyOjpZ7ve5HZrwr7k8HXLruEtwBiETIRDxCzEX+jqLo093d3Q9FBBkaGqrmIf9GXF4Rd5pmVFWpJwk1VRxomPGgn3MYjIoqLqAqC5OTp9+TWm1w3oxZ3PO2W3wqK8p4krDd77NnhuPUNGIkjvkzz1npdrwkGhBi1egDGRio7iky0HSTs6WypCIstlt0DFQEAYIbRRUmS2V6wNetppdEHWFHFTnWNNOXs6KkIlw9OCRCGVClJEJRhAGNiFCuHhyQAqeyorTMVNxHNeBUVRlPEhZbbYYLKWaBIBAsPCGOWWC4UGCx1WY8SahGSgCPu+68kKbsAjutJp9cvswzzz3L2bPnuHbtK9K0wNTUFF9eucI/m5vMXrrE42qFepxwr3ckGhxqUcS/5mDG+vpDJk+/Tv34GCcnXuTkxAT1sTFeO3OGRxsbmBkNM2qREhxi/s+CUUhSfltaotvtMj1zkVs3byAIF2ZmCCGwsvQrhTjBzNAni6CRwF4I1FRIs4xH6+v8tbHB7Nwcv6+usrq8zOzcHFubmzxcWyPNChwToWFGJKCZKA/ynJE4ohzHHLTa3Lx9G6tUuL60xPeLi1CtcuvOHRoHh5STmJEoYi3PyUSJI+DQjPt5j1ezjM+yjOvz8wz//Avn+4YeP85PF6b59t5d2lmBc1mR+3nOoTsVEWKDZkW1tNLpyDuVWN48VmO6e8TU6AhvnX8byhVYWKCQ53QGawSc5U7HSyLuQjtW1c/d/WIRza81m8nzacqPR0dU7twl3WsQtrfpP97hh17OVt7jj7xHNUn6UaRJv59/ISdOnKjtH+x/h/MS7nTcCe6kZgyFgMQxuyIcuROpkgFpoUCSJDe2trbeEIB6vT7YaDQ+NgvncX9KHDUR+gI4xO6oCO5uqOwBVxuN/feBxn+BdHdInbz8WwAAAABJRU5ErkJggg==', 'base64');
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(FAVICON_BUFFER);
});

// Manifest et stream acceptent un segment de config optionnel en tête d'URL.
app.get('/:config?/manifest.json', async (req, res) => {
    let hasValidConfig = false;

    if (req.params.config && req.params.config !== 'manifest.json') {
        // Le manifest ne peut plus être renvoyé tel quel : si l'URL contient une config
        // valide (clé TMDB), il faut lever configurationRequired, sinon Stremio continue
        // d'afficher le bouton "Configure" au lieu de "Install" même une fois configuré.
        const { tmdbKey, pseudo } = decodeConfig(req.params.config);
        hasValidConfig = !!tmdbKey;
        const isNewInstall = await recordInstallActivity(req.params.config, pseudo);
        if (isNewInstall) {
            await logEvent({
                level: 'info', context: 'INSTALL', event: 'manifest_created',
                message: `${pseudo || 'Un visiteur'} a créé son manifest`,
                meta: { pseudo: pseudo || null },
            });
        }
    }

    res.json({
        ...manifest,
        behaviorHints: {
            ...manifest.behaviorHints,
            configurationRequired: !hasValidConfig,
        },
    });
});

app.get(['/', '/configure', '/:config/configure'], async (req, res) => {
    const settings = await getConfigureSettings();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderConfigureHtml(settings));
});

// Aperçu en direct pour le dashboard : rend /configure à partir du payload en cours
// d'édition (non encore enregistré), pour que l'admin voie le résultat sans quitter la page.
app.post('/api/configure-preview', requireAuth, async (req, res) => {
    const body = req.body || {};
    const current = await getConfigureSettings();
    const merged = { ...current };
    ['brandName','navLinkText','navLinkUrl','heroTitleWhite','heroTitleRed','heroSubtitle',
     'accentColor','sectionConfigLabel','sectionProfileLabel','sectionLinksLabel','tmdbKeyHint','pseudoHint',
     'externalToggleTitle','externalToggleDesc','maxLinksLabel','maxLinksHint','extrasSelectLabel','extrasSelectHint',
     'installAppLabel','installWebLabel','installCopyLabel']
        .forEach(f => { if (typeof body[f] === 'string') merged[f] = body[f]; });
    res.setHeader('Content-Type', 'application/json');
    res.json({ html: renderConfigureHtml(merged) });
});

// Endpoint public (pas de requireAuth) : utilisé par le bouton "Tester" de la page
// /configure pour vérifier une clé TMDB perso avant de générer le lien d'installation.
// On passe par le serveur plutôt qu'un fetch direct depuis le navigateur car la CSP
// globale (voir plus haut) limite connect-src à 'self'.
app.get('/api/test-tmdb', async (req, res) => {
    const key = (req.query.key || '').toString().trim();
    if (!key) return res.status(400).json({ valid: false, error: 'Clé manquante' });
    try {
        const r = await fetchT(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`);
        if (r.ok) return res.json({ valid: true });
        const data = await r.json().catch(() => ({}));
        res.json({ valid: false, error: data.status_message || `Erreur TMDB (${r.status})` });
    } catch (err) {
        await logEvent({ level: 'error', context: 'SYSTEM', event: 'tmdb_unreachable', message: 'Impossible de joindre TMDB depuis le serveur', meta: { error: err.message } });
        res.status(502).json({ valid: false, error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

// ---- Recherche TMDB pour le formulaire "Mapping des liens" du dashboard ----
// Utilise la clé de secours serveur (réservée à l'admin), jamais celle d'un visiteur.
app.get('/api/tmdb-search', requireAuth, async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });

    try {
        const [movieRes, tvRes] = await Promise.all([
            fetchT(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&language=fr-FR&query=${encodeURIComponent(q)}`),
            fetchT(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&language=fr-FR&query=${encodeURIComponent(q)}`),
        ]);
        const [movieData, tvData] = await Promise.all([movieRes.json(), tvRes.json()]);

        const toResult = mediaType => r => ({
            tmdbId: r.id,
            mediaType,
            title: mediaType === 'movie' ? r.title : r.name,
            year: (mediaType === 'movie' ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
            poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
            popularity: r.popularity || 0,
        });

        const results = [
            ...(movieData.results || []).map(toResult('movie')),
            ...(tvData.results || []).map(toResult('tv')),
        ]
            .filter(r => r.title)
            .sort((a, b) => b.popularity - a.popularity)
            .slice(0, 12);

        res.json(results);
    } catch (err) {
        console.error('Erreur recherche TMDB:', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

// Sens inverse de /api/tmdb-resolve : à partir d'un IMDB ID déjà connu (tapé ou collé
// directement dans le formulaire), retrouve le titre TMDB pour pré-remplir le champ titre.
app.get('/api/tmdb-lookup', requireAuth, async (req, res) => {
    const imdbId = (req.query.imdbId || '').toString().trim();
    if (!/^tt\d{6,9}$/.test(imdbId)) return res.status(400).json({ error: 'IMDB ID invalide' });
    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });

    try {
        const r = await fetchT(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id&language=fr-FR`);
        const data = await r.json();
        const movie = data.movie_results?.[0];
        const tv = data.tv_results?.[0];

        const result = movie
            ? { mediaType: 'movie', title: movie.title, year: movie.release_date?.slice(0, 4) || null }
            : tv
                ? { mediaType: 'tv', title: tv.name, year: tv.first_air_date?.slice(0, 4) || null }
                : null;

        if (!result) return res.status(404).json({ error: 'Aucun titre TMDB trouvé pour cet IMDB ID' });
        res.json(result);
    } catch (err) {
        console.error('Erreur lookup TMDB par IMDB ID:', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

// Titre d'une vidéo YouTube à partir de son ID, via l'API oEmbed publique de YouTube
// (pas de clé API nécessaire) -- sert à pré-remplir "Titre affiché dans Stremio" dans le
// formulaire d'override, symétrique au lookup TMDB par IMDB ID.
app.get('/api/youtube-title', requireAuth, async (req, res) => {
    const id = (req.query.id || '').toString().trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'YouTube ID invalide' });

    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
        const r = await fetchT(oembedUrl);
        if (!r.ok) return res.status(404).json({ error: 'Vidéo introuvable, privée ou supprimée' });
        const data = await r.json();
        res.json({ title: data.title });
    } catch (err) {
        console.error('Erreur titre YouTube:', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

// Recherche YouTube pour le formulaire "Mapping des liens" : résultats BRUTS (sans filtre
// VF/pertinence -- l'admin choisit le lien qu'il veut mapper), classés par pertinence.
app.get('/api/youtube-search', requireAuth, async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    try {
        const results = await searchYoutubeRaw(q);
        res.json(results);
    } catch (err) {
        console.error('Erreur recherche YouTube:', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

// Vérifie qu'un lien (YouTube ID ou URL directe) est jouable AVANT de l'enregistrer en override.
// Pour YouTube : vérifie via oEmbed que la vidéo existe et est publique (titre renvoyé).
// Pour une URL directe : simple test de joignabilité HEAD (le serveur répond, pas forcément
// un vrai média -- suffisant pour attraper les fautes de frappe/liens morts au moment de saisir).
app.get('/api/test-link', requireAuth, async (req, res) => {
    const ytId = (req.query.ytId || '').toString().trim();
    const url = (req.query.url || '').toString().trim();

    if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}&format=json`;
            const r = await fetchT(oembedUrl);
            if (!r.ok) return res.json({ ok: false, error: 'Vidéo introuvable, privée ou supprimée' });
            const data = await r.json();
            return res.json({ ok: true, kind: 'youtube', title: data.title || null, ytId });
        } catch (err) {
            console.error('Erreur test lien YouTube:', err.message);
            return res.status(502).json({ ok: false, error: 'Erreur réseau côté serveur, réessaie.' });
        }
    }

    if (url && /^https?:\/\//i.test(url)) {
        try {
            const r = await fetchT(url, { method: 'HEAD', redirect: 'follow' });
            return res.json({ ok: r.ok || r.status < 400, kind: 'url', url });
        } catch (err) {
            return res.json({ ok: false, error: 'URL injoignable' });
        }
    }

    res.status(400).json({ ok: false, error: 'YouTube ID ou URL requis' });
});

// Récupère l'IMDB ID d'un titre TMDB déjà choisi dans les résultats de recherche.
app.get('/api/tmdb-resolve', requireAuth, async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'id et type requis' });
    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });

    try {
        const mediaType = type === 'tv' ? 'tv' : 'movie';
        const r = await fetchT(`https://api.themoviedb.org/3/${mediaType}/${encodeURIComponent(id)}/external_ids?api_key=${tmdbKey}`);
        const data = await r.json();
        if (!data.imdb_id) return res.status(404).json({ error: 'IMDB ID introuvable pour ce titre' });
        res.json({ imdbId: data.imdb_id });
    } catch (err) {
        console.error('Erreur résolution TMDB:', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

// ---- Health check des services externes (pour le badge live sur /configure) ----
// Volontairement public (pas de requireAuth) : c'est juste "le service est joignable ou pas",
// aucune donnée sensible. On teste le domaine public, pas l'API authentifiée, pour ne pas
// faire dépendre le statut de la validité d'une clé TMDB.
async function pingUrl(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
        return r.status < 500; // même une 403/404 prouve que le service répond
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

app.get('/api/health', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const [tmdb, youtube, allocine] = await Promise.all([
        pingUrl('https://www.themoviedb.org'),
        pingUrl('https://www.youtube.com'),
        pingUrl('https://www.allocine.fr'),
    ]);
    const current = { tmdb, youtube, allocine };

    // On ne log QUE les changements d'état (pas chaque check, sinon spam à chaque
    // visite de /configure). Best-effort : si Redis absent, on skip juste le log.
    if (redis) {
        try {
            const prevRaw = await redis.get('system:health:last');
            const prev = prevRaw ? (typeof prevRaw === 'string' ? JSON.parse(prevRaw) : prevRaw) : null;
            if (prev) {
                for (const svc of ['tmdb', 'youtube', 'allocine']) {
                    if (prev[svc] !== current[svc]) {
                        await logEvent({
                            level: current[svc] ? 'info' : 'warn',
                            context: 'SYSTEM',
                            event: current[svc] ? 'service_up' : 'service_down',
                            message: `${svc.toUpperCase()} est ${current[svc] ? 'de nouveau joignable' : 'devenu injoignable'}`,
                            meta: { service: svc },
                        });
                    }
                }
            }
            await redis.set('system:health:last', JSON.stringify(current));
        } catch (err) {
            console.error('Erreur suivi santé services:', err.message);
        }
    }

    res.json({
        tmdb: tmdb ? 'up' : 'down',
        youtube: youtube ? 'up' : 'down',
        allocine: allocine ? 'up' : 'down',
        checkedAt: new Date().toISOString(),
    });
});

// ---- Statut des services (dashboard, page Logs) ----
// Contrairement à /api/health (public, live, pour le badge de /configure), celui-ci est
// authentifié et volontairement mis en cache 6h dans Redis : pas besoin de re-pinguer TMDB/
// YouTube/Allociné à chaque ouverture de la page Logs, un statut par demi-journée suffit.
const SERVICES_STATUS_CACHE_KEY = 'system:services-status';
const SERVICES_STATUS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

app.get('/api/services-status', requireAuth, async (req, res) => {
    try {
        if (redis) {
            const cachedRaw = await redis.get(SERVICES_STATUS_CACHE_KEY);
            const cached = cachedRaw ? (typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw) : null;
            if (cached && Date.now() - new Date(cached.checkedAt).getTime() < SERVICES_STATUS_TTL_MS) {
                return res.json({ ...cached, nextCheckAt: new Date(new Date(cached.checkedAt).getTime() + SERVICES_STATUS_TTL_MS).toISOString() });
            }
        }

        const [tmdb, youtube, allocine] = await Promise.all([
            pingUrl('https://www.themoviedb.org'),
            pingUrl('https://www.youtube.com'),
            pingUrl('https://www.allocine.fr'),
        ]);
        const result = {
            tmdb: tmdb ? 'up' : 'down',
            youtube: youtube ? 'up' : 'down',
            allocine: allocine ? 'up' : 'down',
            checkedAt: new Date().toISOString(),
        };

        if (redis) {
            try { await redis.set(SERVICES_STATUS_CACHE_KEY, JSON.stringify(result)); }
            catch (err) { console.error('Erreur cache statut services:', err.message); }
        }

        res.json({ ...result, nextCheckAt: new Date(Date.now() + SERVICES_STATUS_TTL_MS).toISOString() });
    } catch (err) {
        console.error('Erreur statut services:', err.message);
        res.status(502).json({ error: 'Erreur lors de la vérification des services.' });
    }
});

app.get('/:config?/meta/:type/:idWithExt', async (req, res) => {
    try {
        const config = decodeConfig(req.params.config);
        const { type } = req.params;
        const imdbId = decodeURIComponent(req.params.idWithExt).replace(/\.json$/, '');

        const meta = await buildMetaObject(type, imdbId, config);
        res.json({ meta: meta || null });
    } catch (err) {
        console.error('Erreur /meta:', err);
        await logEvent({ level: 'error', context: 'META', event: 'meta_error', message: err.message, meta: { path: req.path } });
        res.json({ meta: null });
    }
});

app.get('/:config?/stream/:type/:idWithExt', async (req, res) => {
    try {
        const config = decodeConfig(req.params.config);
        const { type } = req.params;
        const id = decodeURIComponent(req.params.idWithExt).replace(/\.json$/, '');
        const [imdbId, season] = id.split(':');

        // Mode AIOMetadata : réponse courte et lisible, journalisée dans le dashboard (Logs > AIOM),
        // sans stats globales ni journal "échecs" (voir logAiomRequest).
        if (config.aiom) {
            const t0 = Date.now();
            const timeoutMs = aiomTimeoutMs(await getBehaviorSettingsFast()); // réglage du dashboard (cache mémoire 30 s)
            const work = resolveStreams(type, imdbId, season, config);
            work.catch(() => {}); // évite un unhandledRejection si le délai a déjà répondu
            const result = await withDeadline(work, timeoutMs);
            await logAiomRequest({ type, imdbId, season, config, result, ms: Date.now() - t0, timeoutMs });
            // Cache navigateur/CDN court : un résultat trouvé 10 min, un vide 1 min, un timeout jamais
            // (la résolution continue en arrière-plan, la requête suivante sera servie par le cache).
            res.setHeader('Cache-Control', result.timedOut ? 'no-store' : result.streams.length ? 'public, max-age=600' : 'public, max-age=60');
            return res.json({ streams: result.streams });
        }

        const { streams, officialTitle, hidden } = await resolveStreams(type, imdbId, season, config);

        // IMPORTANT : sur Vercel, la fonction peut être "gelée" juste après l'envoi de la réponse.
        // Un appel Redis "fire-and-forget" (sans await) risque alors d'être coupé avant d'avoir
        // atteint Upstash -> on attend ces écritures (en parallèle) avant de répondre.
        await Promise.all([
            recordRequest({ type, imdbId, title: officialTitle }),
            streams.length === 0 && !hidden ? logFailure({ imdbId, type, season, title: officialTitle }) : Promise.resolve(),
        ]);

        res.json({ streams });
    } catch (err) {
        console.error('Erreur /stream:', err);
        await logEvent({ level: 'error', context: 'STREAM', event: 'stream_error', message: err.message, meta: { path: req.path } });
        res.json({ streams: [] });
    }
});

// ---- Dashboard ----
app.get('/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderDashboardShell());
});

function requireAuth(req, res, next) {
    if (!checkDashboardAuth(req)) return res.status(401).json({ error: 'unauthorized' });
    next();
}

app.post('/api/login', async (req, res) => {
    if (!DASHBOARD_PASSWORD) return res.status(503).json({ error: 'Dashboard non configuré (DASHBOARD_PASSWORD manquant)' });
    const ip = getClientIp(req);
    if (await isLockedOut(ip)) {
        await logEvent({ level: 'error', context: 'AUTH', event: 'login_locked', message: 'IP bloquée (trop de tentatives)', meta: { ip } });
        return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${LOCKOUT_SECONDS / 60} minutes.` });
    }
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Mot de passe requis' });

    const isValid = await bcrypt.compare(password, await getPasswordHash());
    await recordLoginAttempt(ip, isValid);
    if (!isValid) {
        await logEvent({ level: 'warn', context: 'AUTH', event: 'login_failed', message: 'Tentative de connexion échouée', meta: { ip } });
        return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    await logEvent({ level: 'info', context: 'AUTH', event: 'login', message: 'Connexion au dashboard', meta: { ip } });
    res.json({ token: generateToken(), expiresIn: SESSION_DURATION_MS });
});

app.get('/api/dashboard-stats', requireAuth, async (req, res) => {
    const stats = await getStats();
    res.json(stats ? { configured: true, ...stats } : { configured: false });
});

app.post('/api/dashboard-stats/reset', requireAuth, async (req, res) => {
    res.json({ success: await resetStats() });
});

// ---- Installations actives ----
app.get('/api/install-stats', requireAuth, async (req, res) => {
    const stats = await getInstallStats();
    res.json(stats ? { configured: true, ...stats } : { configured: false });
});

app.post('/api/install-stats/reset', requireAuth, async (req, res) => {
    res.json({ success: await resetInstalls() });
});

app.delete('/api/install-stats/:id', requireAuth, async (req, res) => {
    res.json({ success: await removeInstall(req.params.id) });
});

app.get('/api/overrides', requireAuth, async (req, res) => {
    res.json(await getOverrides());
});

app.post('/api/overrides', requireAuth, async (req, res) => {
    const { imdbId, season, ytId, url, links, title, hidden, mediaType, notes } = req.body || {};
    const isHidden = hidden === true;
    // `links` = liste prioritaire de liens de repli [{ytId}|{url}, ...]. Si absent, on
    // construit depuis ytId/url (compat). Validation : il faut au moins un lien exploitable.
    const cleanLinks = Array.isArray(links)
        ? links.filter(l => l && (typeof l.ytId === 'string' && l.ytId.trim() || typeof l.url === 'string' && l.url.trim()))
        : [];
    const hasYt = (typeof ytId === 'string' && ytId.trim()) || cleanLinks.some(l => l.ytId);
    const hasUrl = (typeof url === 'string' && url.trim()) || cleanLinks.some(l => l.url);
    if (!imdbId || (!hasYt && !hasUrl && !isHidden)) return res.status(400).json({ error: 'imdbId et (ytId, url ou hidden) requis' });
    const ok = await setOverride({
        imdbId,
        season: season || null,
        ytId: ytId || null,
        url: ytId ? null : (url || null),
        links: cleanLinks.length ? cleanLinks.map(l => ({ ytId: l.ytId ? l.ytId.trim() : null, url: l.ytId ? null : (l.url ? l.url.trim() : null) })) : undefined,
        title: title || null,
        hidden: isHidden,
        mediaType: mediaType || null,
        notes: typeof notes === 'string' ? notes.trim() || null : null,
    });
    if (ok) await logEvent({ level: 'info', context: 'OVERRIDE', event: 'override_set', message: `Override enregistré pour ${imdbId}${isHidden ? ' (masqué)' : ''}`, meta: { imdbId, season: season || null, hidden: isHidden, links: cleanLinks.length } });
    res.json({ success: ok });
});

app.delete('/api/overrides', requireAuth, async (req, res) => {
    const { imdbId, season } = req.query;
    if (!imdbId) return res.status(400).json({ error: 'imdbId requis' });
    const ok = await deleteOverride(imdbId, season || null);
    if (ok) await logEvent({ level: 'info', context: 'OVERRIDE', event: 'override_deleted', message: `Override supprimé pour ${imdbId}`, meta: { imdbId, season: season || null } });
    res.json({ success: ok });
});

// ============================================================
// PROPOSITIONS COMMUNAUTAIRES — page publique /proposer + gestion admin.
// Aucune des routes /api/public/* ni POST /api/contributions n'est protégée par
// requireAuth : elles sont faites pour être appelées par n'importe quel visiteur,
// sans compte. Seules la lecture/validation/refus (ci-dessous, requireAuth) sont
// réservées au dashboard.
// ============================================================

// Page HTML publique de proposition (recherche de titre + lien).
app.get('/proposer', async (req, res) => {
    const settings = await getConfigureSettings();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderContributeHtml(settings));
});

// Page publique /recuperation : migration d'une ancienne URL d'addon vers le domaine
// courant. La config est déjà dans le segment base64url de l'URL -> tout se fait côté
// navigateur, rien n'est lu en base ni envoyé au serveur (la clé TMDB reste chez l'utilisateur).
app.get('/recuperation', async (req, res) => {
    const settings = await getConfigureSettings();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderRecoveryHtml(settings));
});

// Variantes PUBLIQUES (sans requireAuth) des helpers TMDB/YouTube déjà utilisés par le
// dashboard, pour que la page /proposer puisse chercher un titre et vérifier un lien
// sans avoir accès au dashboard. Utilisent la même clé TMDB de secours.
app.get('/api/public/tmdb-search', async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });
    try {
        const [movieRes, tvRes] = await Promise.all([
            fetchT(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&language=fr-FR&query=${encodeURIComponent(q)}`),
            fetchT(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&language=fr-FR&query=${encodeURIComponent(q)}`),
        ]);
        const [movieData, tvData] = await Promise.all([movieRes.json(), tvRes.json()]);
        const toResult = mediaType => r => ({
            tmdbId: r.id,
            mediaType,
            title: mediaType === 'movie' ? r.title : r.name,
            year: (mediaType === 'movie' ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
            poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
            popularity: r.popularity || 0,
        });
        const results = [
            ...(movieData.results || []).map(toResult('movie')),
            ...(tvData.results || []).map(toResult('tv')),
        ].filter(r => r.title).sort((a, b) => b.popularity - a.popularity).slice(0, 12);
        res.json(results);
    } catch (err) {
        console.error('Erreur recherche TMDB (public):', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

app.get('/api/public/tmdb-resolve', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'id et type requis' });
    const tmdbKey = FALLBACK_TMDB_KEY;
    if (!tmdbKey) return res.status(503).json({ error: "Clé TMDB de secours non configurée côté serveur (TMDB_API_KEY)" });
    try {
        const r = await fetchT(`https://api.themoviedb.org/3/${type}/${id}/external_ids?api_key=${tmdbKey}`);
        const data = await r.json();
        if (!data.imdb_id) return res.status(404).json({ error: 'Aucun IMDB ID associé à ce titre TMDB' });
        res.json({ imdbId: data.imdb_id });
    } catch (err) {
        console.error('Erreur résolution TMDB->IMDB (public):', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

app.get('/api/public/youtube-title', async (req, res) => {
    const id = (req.query.id || '').toString().trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'YouTube ID invalide' });
    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
        const r = await fetchT(oembedUrl);
        if (!r.ok) return res.status(404).json({ error: 'Vidéo introuvable, privée ou supprimée' });
        const data = await r.json();
        res.json({ title: data.title });
    } catch (err) {
        console.error('Erreur titre YouTube (public):', err.message);
        res.status(502).json({ error: 'Erreur réseau côté serveur, réessaie.' });
    }
});

app.get('/api/public/test-link', async (req, res) => {
    const ytId = (req.query.ytId || '').toString().trim();
    const url = (req.query.url || '').toString().trim();

    if (ytId && /^[a-zA-Z0-9_-]{11}$/.test(ytId)) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}&format=json`;
            const r = await fetchT(oembedUrl);
            if (!r.ok) return res.json({ ok: false, error: 'Vidéo introuvable, privée ou supprimée' });
            const data = await r.json();
            return res.json({ ok: true, kind: 'youtube', title: data.title || null, ytId });
        } catch (err) {
            return res.status(502).json({ ok: false, error: 'Erreur réseau côté serveur, réessaie.' });
        }
    }

    if (url && /^https?:\/\//i.test(url)) {
        // Vimeo et Dailymotion exposent un oEmbed public comme YouTube : on l'utilise
        // quand l'URL correspond, pour remonter un vrai titre plutôt qu'un simple HEAD.
        const isVimeo = /vimeo\.com\//i.test(url);
        const isDailymotion = /dailymotion\.com\/|dai\.ly\//i.test(url);

        if (isVimeo || isDailymotion) {
            const oembedUrl = isVimeo
                ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
                : `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}&format=json`;
            try {
                const r = await fetchT(oembedUrl);
                if (!r.ok) return res.json({ ok: false, error: 'Vidéo introuvable, privée ou supprimée', kind: isVimeo ? 'vimeo' : 'dailymotion' });
                const data = await r.json();
                return res.json({ ok: true, kind: isVimeo ? 'vimeo' : 'dailymotion', title: data.title || null, thumbnail: data.thumbnail_url || null, url });
            } catch (err) {
                // oEmbed indisponible -> on retombe sur le HEAD générique plutôt que d'échouer
            }
        }

        try {
            const r = await fetchT(url, { method: 'HEAD', redirect: 'follow' });
            return res.json({ ok: r.ok || r.status < 400, kind: 'direct', url });
        } catch (err) {
            return res.json({ ok: false, error: 'URL injoignable' });
        }
    }

    res.status(400).json({ ok: false, error: 'YouTube ID ou URL requis' });
});

// Soumission publique d'une proposition (pseudo obligatoire, pas d'auth).
app.post('/api/contributions', async (req, res) => {
    const { imdbId, season, title, mediaType, ytId, url, pseudo, notes } = req.body || {};
    const cleanImdb = typeof imdbId === 'string' ? imdbId.trim() : '';
    const cleanPseudo = typeof pseudo === 'string' ? pseudo.trim().slice(0, 40) : '';
    const cleanYtId = typeof ytId === 'string' ? ytId.trim() : '';
    const cleanUrl = typeof url === 'string' ? url.trim() : '';

    if (!/^tt\d{6,9}$/.test(cleanImdb)) return res.status(400).json({ error: 'IMDB ID invalide' });
    if (!cleanPseudo) return res.status(400).json({ error: 'Pseudo requis' });
    if (!cleanYtId && !cleanUrl) return res.status(400).json({ error: 'Lien requis (YouTube ou URL directe)' });

    const item = await addContribution({
        imdbId: cleanImdb,
        season: season || null,
        title: typeof title === 'string' ? title.trim().slice(0, 200) || null : null,
        mediaType: mediaType === 'series' ? 'series' : mediaType === 'movie' ? 'movie' : null,
        ytId: cleanYtId || null,
        url: cleanYtId ? null : (cleanUrl || null),
        pseudo: cleanPseudo,
        notes: typeof notes === 'string' ? notes.trim().slice(0, 300) || null : null,
    });
    if (!item) return res.status(500).json({ error: 'Erreur serveur, réessaie.' });
    await logEvent({ level: 'info', context: 'CONTRIB', event: 'contribution_submitted', message: `Proposition reçue pour ${cleanImdb} par ${cleanPseudo}`, meta: { imdbId: cleanImdb, pseudo: cleanPseudo } });
    res.json({ success: true });
});

// ---- Gestion admin (dashboard, requireAuth) ----
app.get('/api/contributions', requireAuth, async (req, res) => {
    res.json(await getContributions());
});

app.post('/api/contributions/:id/accept', requireAuth, async (req, res) => {
    const item = await updateContributionStatus(req.params.id, 'accepted');
    if (!item) return res.status(404).json({ error: 'Proposition introuvable' });
    const ok = await setOverride({
        imdbId: item.imdbId,
        season: item.season || null,
        ytId: item.ytId || null,
        url: item.ytId ? null : (item.url || null),
        title: item.title || null,
        hidden: false,
        mediaType: item.mediaType || null,
        notes: `Proposé par ${item.pseudo}${item.notes ? ' — ' + item.notes : ''}`,
        contributedBy: item.pseudo,
    });
    if (ok) await logEvent({ level: 'info', context: 'CONTRIB', event: 'contribution_accepted', message: `Proposition acceptée pour ${item.imdbId} (${item.pseudo}) — override créé`, meta: { imdbId: item.imdbId, pseudo: item.pseudo } });
    res.json({ success: ok });
});

app.post('/api/contributions/:id/reject', requireAuth, async (req, res) => {
    const item = await updateContributionStatus(req.params.id, 'rejected');
    if (!item) return res.status(404).json({ error: 'Proposition introuvable' });
    await logEvent({ level: 'info', context: 'CONTRIB', event: 'contribution_rejected', message: `Proposition refusée pour ${item.imdbId} (${item.pseudo})`, meta: { imdbId: item.imdbId, pseudo: item.pseudo } });
    res.json({ success: true });
});

app.delete('/api/contributions/:id', requireAuth, async (req, res) => {
    res.json({ success: await deleteContribution(req.params.id) });
});

app.get('/api/failed-log', requireAuth, async (req, res) => {
    res.json(await getFailedLog());
});

app.delete('/api/failed-log', requireAuth, async (req, res) => {
    res.json({ success: await clearFailedLog() });
});

// ---- Résolutions récentes (trailers trouvés automatiquement) ----
app.get('/api/resolved-log', requireAuth, async (req, res) => {
    res.json(await getResolvedLog());
});

app.delete('/api/resolved-log', requireAuth, async (req, res) => {
    res.json({ success: await clearResolvedLog() });
});

app.get('/api/settings/configure', requireAuth, async (req, res) => {
    res.json(await getConfigureSettings());
});

app.post('/api/settings/configure', requireAuth, async (req, res) => {
    const ok = await setConfigureSettings(req.body || {});
    if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_configure_updated', message: 'Page configure mise à jour' });
    res.json({ success: ok });
});

app.post('/api/settings/configure/reset', requireAuth, async (req, res) => {
    const ok = await resetConfigureSettings();
    if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_configure_reset', message: 'Page configure réinitialisée' });
    res.json({ success: ok });
});

app.get('/api/settings/behavior', requireAuth, async (req, res) => {
    res.json(await getBehaviorSettings());
});

app.post('/api/settings/behavior', requireAuth, async (req, res) => {
    const ok = await setBehaviorSettings(req.body || {});
    if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_behavior_updated', message: 'Réglages de comportement mis à jour' });
    // Le délai AIOM vit dans une colonne ajoutée après coup : si elle n'existe pas encore, la valeur
    // n'est pas gardée (le reste l'est). On relit pour le signaler dans les Logs plutôt qu'en silence.
    if (ok && req.body && req.body.aiomTimeoutSeconds !== undefined) {
        const saved = await getBehaviorSettings();
        const wanted = Math.min(12, Math.max(1, Math.round(Number(req.body.aiomTimeoutSeconds)) || 5));
        if (saved.aiomTimeoutSeconds !== wanted) {
            await logEvent({ level: 'warn', context: 'SETTINGS', event: 'aiom_timeout_not_saved', message: 'Délai AIOMetadata non enregistré — colonne aiom_timeout_seconds absente ? Lance la migration SQL (ALTER TABLE behavior_settings ADD COLUMN IF NOT EXISTS aiom_timeout_seconds integer DEFAULT 5;)' });
        }
    }
    res.json({ success: ok });
});

app.post('/api/settings/behavior/reset', requireAuth, async (req, res) => {
    const ok = await resetBehaviorSettings();
    if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'settings_behavior_reset', message: 'Réglages de comportement réinitialisés' });
    res.json({ success: ok });
});

// ---- Cache trailers : stats + purge manuelle (page Réglages du dashboard) ----
app.get('/api/cache/stats', requireAuth, async (req, res) => {
    res.json(await getCacheStats());
});

app.delete('/api/cache', requireAuth, async (req, res) => {
    const only = req.query.only === 'failures' ? 'failures' : null;
    const ok = only ? await clearCacheFailures() : await clearAllCache();
    if (ok) await logEvent({ level: 'info', context: 'SETTINGS', event: 'cache_cleared', message: only ? 'Échecs du cache des bandes-annonces purgés' : 'Cache des bandes-annonces vidé manuellement' });
    res.json({ success: ok });
});

// État système : Redis réellement joignable (pas juste "configuré") + clé TMDB de secours présente.
// Utile car tout le reste de l'app est best-effort silencieux si Redis est down -> sans ça,
// aucun moyen de savoir que quelque chose déconne avant de constater des stats vides.
app.get('/api/system-status', requireAuth, async (req, res) => {
    let redisOk = false;
    if (redis) {
        try {
            await redis.set('system:ping', Date.now());
            redisOk = true;
        } catch (err) {
            redisOk = false;
        }
    }
    res.json({ redis: redisOk, tmdbFallback: !!FALLBACK_TMDB_KEY });
});

// ---- Diagnostic complet (page Réglages du dashboard) ----
// Regroupe en un appel tout ce qu'un admin veut savoir en arrivant sur la page : Redis
// joignable, clé TMDB serveur présente + valide (testée), services externes joignables,
// et état du cache. Le test de clé TMDB est volontairement fait côté serveur : on ne
// renvoie jamais la clé elle-même, juste sa présence + les 4 derniers caractères + validité.
app.get('/api/diagnostics', requireAuth, async (req, res) => {
    let redisOk = false;
    if (redis) {
        try { await redis.set('system:ping', Date.now()); redisOk = true; }
        catch (err) { redisOk = false; }
    }

    const tmdbKeyLast4 = FALLBACK_TMDB_KEY ? String(FALLBACK_TMDB_KEY).slice(-4) : null;
    let tmdbKeyValid = null; // null = pas de clé, true/false sinon
    if (FALLBACK_TMDB_KEY) {
        try {
            const r = await fetchT(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(FALLBACK_TMDB_KEY)}`);
            tmdbKeyValid = r.ok;
        } catch (err) {
            tmdbKeyValid = false;
        }
    }

    const [tmdb, youtube, allocine] = await Promise.all([
        pingUrl('https://www.themoviedb.org'),
        pingUrl('https://www.youtube.com'),
        pingUrl('https://www.allocine.fr'),
    ]);

    const cache = await getCacheStats();

    res.json({
        redis: redisOk,
        tmdbKey: { present: !!FALLBACK_TMDB_KEY, last4: tmdbKeyLast4, valid: tmdbKeyValid },
        services: { tmdb, youtube, allocine },
        cache,
    });
});

// Testeur admin : simule une résolution avec les réglages actuels, sans polluer cache/stats/logs.
app.post('/api/test-resolve', requireAuth, async (req, res) => {
    try {
        const { type, imdbId, season, ignoreOverride, aiom } = req.body || {};
        if (!imdbId || !type) return res.status(400).json({ error: 'imdbId et type requis' });
        const result = await testResolve(type, imdbId.trim(), season ? String(season).trim() : null, ignoreOverride === true, aiom === true);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- Logs ----
app.get('/api/logs', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); // le polling live-tail a besoin de données toujours fraîches
    res.json(await getLogs());
});

app.delete('/api/logs', requireAuth, async (req, res) => {
    res.json({ success: await clearLogs() });
});

// ---- Gestion d'erreurs globales ----
// Toutes les routes renvoient du JSON : les erreurs (body trop gros, JSON invalide...)
// doivent aussi être du JSON propre, sans stack trace leakée au client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err instanceof SyntaxError)) {
        res.status(413).json({ error: 'Payload too large' });
        return;
    }
    res.status(err && err.statusCode || 500).json({ error: err && err.message || 'Internal Server Error' });
});

module.exports = app;