// Exploration de Netflix en arrière-plan : on lit les pages titre une à une, doucement, et on remplit la table
// netflix_titles (ID Netflix, titre, année, type, puis TMDB/IMDB quand la correspondance est sûre).
//
// Comment on trouve « tous » les ID sans les deviner un par un (des millions de requêtes, blocage assuré) :
//  • on part de ce que la table contient déjà (Wikidata, TMDB, saisies manuelles) ;
//  • chaque page titre cite d'autres titres (« titres similaires ») : leurs ID entrent dans la table, « à explorer » ;
//  • la boucle explore ces nouveaux ID à leur tour, et ainsi de suite — le catalogue se déploie de proche en proche.
//
// Garde-fous : une requête à la fois, cadence réglable (4 s par défaut, 1,5 s minimum) avec un peu d'aléatoire,
// pause automatique et croissante (15 min -> 6 h) si Netflix répond 403/429, désactivée par défaut
// (à activer depuis le dashboard), NETFLIX_CRAWL=0 la coupe complètement. Le scraping de netflix.com va à
// l'encontre de leurs CGU : prévois une IP dont tu peux te passer.

const sql = require('./db');
const store = require('./netflix-titles');
const { fetchNetflixPage, parsePage } = require('./netflix-trailer');
const { verifyLink } = require('./netflix-link-check');
const { searchTmdb, imdbOf } = require('./netflix-url-link');

const MIN_DELAY_MS = 1500;
const DEFAULT_DELAY_MS = 4000;
const MAX_DELAY_MS = 60000;
const BASE_PAUSE_MS = 15 * 60 * 1000;
const MAX_PAUSE_MS = 6 * 60 * 60 * 1000;
const IDLE_MS = 5 * 60 * 1000;      // rien à explorer : on revérifie dans 5 min
const OFF_POLL_MS = 15 * 1000;      // désactivé : on revérifie l'état de temps en temps

const state = {
    enabled: false,
    delayMs: DEFAULT_DELAY_MS,
    blockedUntil: 0,
    blocks: 0,                       // blocages consécutifs (sert au calcul de la pause)
    session: { startedAt: null, explored: 0, discovered: 0, matched: 0, mismatch: 0, withTrailer: 0, missing: 0, errors: 0 },
    lastNid: null,
    lastTitle: null,
    lastError: null,
    lastAt: null,
};
let timer = null;
let tmdbKey = '';
let started = false;

// ---------- état persistant ----------
async function loadState() {
    const rows = await sql`SELECT key, value FROM netflix_crawl_state`;
    const kv = Object.fromEntries(rows.map(r => [r.key, r.value]));
    state.enabled = kv.enabled === '1';
    const d = Number(kv.delayMs);
    state.delayMs = Number.isFinite(d) && d >= MIN_DELAY_MS ? Math.min(d, MAX_DELAY_MS) : DEFAULT_DELAY_MS;
    const b = Number(kv.blockedUntil);
    state.blockedUntil = Number.isFinite(b) ? b : 0;
}

async function saveKey(key, value) {
    await sql`INSERT INTO netflix_crawl_state (key, value) VALUES (${key}, ${String(value)})
              ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}

// ---------- une étape ----------
// Connexion réutilisée d'une page à l'autre (pas de nouvelle poignée de main TLS à chaque fois) ; une seule à la fois.
const https = require('https');
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 1, keepAliveMsecs: 30000 });
const agentFor = url => (url.protocol === 'https:' ? keepAliveAgent : undefined);

/**
 * Explore un ID avec UNE requête Netflix, UN parsing et UNE écriture en base :
 * titre/année/type, bande-annonce présente ou non, ID cités (→ nouveaux ID à explorer), et liaison IMDB :
 *  • s'il y a déjà un IMDB (Wikidata, TMDB…) : on VÉRIFIE le lien en comparant la page Netflix à la fiche TMDB ;
 *  • sinon : on cherche le titre sur TMDB et on ne lie que si titre ET année concordent.
 */
async function exploreOne(nid) {
    let html;
    try {
        html = await fetchNetflixPage(nid, undefined, { agent: agentFor });
    } catch (err) {
        if (err.status === 404) {                      // titre absent du catalogue de ce pays : définitif
            await store.markCrawled(nid, 'missing');
            state.session.missing++;
            return 'missing';
        }
        if (err.status === 403 || err.status === 429) { // on nous freine : pause, sans compter d'échec pour ce titre
            const e = new Error(err.message);
            e.blocked = true;
            throw e;
        }
        await store.markCrawled(nid, 'error');
        state.session.errors++;
        state.lastError = err.message;
        return 'error';
    }

    const { info, trailers, related } = parsePage(html, nid);
    if (related.length) state.session.discovered += await store.addDiscovered(related, nid);

    if (!info) {
        await store.markCrawled(nid, 'noinfo');
        return 'noinfo';
    }

    const row = await store.getTitle(nid);
    const result = { title: info.title, year: info.year, type: info.mediaType, hasTrailer: trailers.length > 0, status: 'done' };

    if (tmdbKey && row) {
        if (row.imdb_id) {
            if (row.source !== 'manual') {              // une saisie manuelle fait foi : on ne la remet pas en cause
                const v = await verifyLink(row, info, tmdbKey);
                if (v) {
                    result.linkStatus = v.status;
                    if (v.tmdbId) { result.tmdbId = v.tmdbId; result.type = row.type || v.type || info.mediaType; }
                    if (v.status === 'mismatch') state.session.mismatch++;
                }
            }
        } else {
            try {
                const { match } = await searchTmdb(info, tmdbKey, 3);
                if (match) {
                    const imdb = await imdbOf(match.type, match.tmdbId, tmdbKey);
                    Object.assign(result, { tmdbId: match.tmdbId, type: match.type, imdbId: imdb, linkStatus: 'ok' });
                    if (imdb) state.session.matched++;
                }
            } catch { /* TMDB indisponible : on reste sans IMDB, un autre passage pourra le lier */ }
        }
    }
    await store.saveCrawlResult(nid, result);
    if (result.hasTrailer) state.session.withTrailer++;
    state.lastTitle = info.title;
    return 'done';
}

function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
    if (timer.unref) timer.unref();
}

async function tick() {
    try {
        if (!state.enabled) return schedule(OFF_POLL_MS);
        const wait = state.blockedUntil - Date.now();
        if (wait > 0) return schedule(Math.min(wait, OFF_POLL_MS * 4));
        const nid = await store.nextToCrawl();
        if (!nid) return schedule(IDLE_MS);

        state.lastNid = nid;
        try {
            await exploreOne(nid);
            state.blocks = 0;
            state.session.explored++;
            state.lastAt = new Date().toISOString();
        } catch (err) {
            if (!err.blocked) throw err;
            state.blocks++;
            const pause = Math.min(MAX_PAUSE_MS, BASE_PAUSE_MS * 2 ** (state.blocks - 1));
            state.blockedUntil = Date.now() + pause;
            state.lastError = `${err.message} — pause de ${Math.round(pause / 60000)} min`;
            await saveKey('blockedUntil', state.blockedUntil);
            console.warn('[exploration Netflix]', state.lastError);
        }
    } catch (err) {
        state.lastError = err.message;
        console.warn('[exploration Netflix]', err.message);
    }
    const jitter = 0.75 + Math.random() * 0.75;
    schedule(Math.round(state.delayMs * jitter));
}

// ---------- pilotage (dashboard) ----------
async function setEnabled(on) {
    state.enabled = !!on;
    if (state.enabled) {
        state.blocks = 0;
        state.blockedUntil = 0;
        state.session.startedAt = state.session.startedAt || new Date().toISOString();
        await saveKey('blockedUntil', 0);
    }
    await saveKey('enabled', state.enabled ? '1' : '0');
    if (started) schedule(state.enabled ? 0 : OFF_POLL_MS);
}

async function setDelay(ms) {
    const d = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(Number(ms) || DEFAULT_DELAY_MS)));
    state.delayMs = d;
    await saveKey('delayMs', d);
    return d;
}

/** État pour le dashboard : réglages, compteurs de la session, répartition de la table, estimation du temps restant. */
async function getStatus() {
    const counts = await store.crawlCounts();
    const total = counts.pending + counts.done + counts.missing + counts.noinfo + counts.error;
    const processed = total - counts.pending;
    const paused = state.blockedUntil > Date.now();
    return {
        available: process.env.NETFLIX_CRAWL !== '0',
        enabled: state.enabled, paused, pausedUntil: paused ? new Date(state.blockedUntil).toISOString() : null,
        delayMs: state.delayMs, minDelayMs: MIN_DELAY_MS,
        counts, total, progress: total ? processed / total : 0,
        etaHours: Math.round((counts.pending * state.delayMs * 1.125) / 3600000 * 10) / 10,
        session: { ...state.session },
        last: { nid: state.lastNid, title: state.lastTitle, at: state.lastAt, error: state.lastError },
    };
}

async function start(key) {
    if (started || process.env.NETFLIX_CRAWL === '0') return;
    tmdbKey = key || '';
    try { await loadState(); } catch (err) { console.warn('[exploration Netflix] état illisible :', err.message); }
    started = true;
    schedule(state.enabled ? 10 * 1000 : OFF_POLL_MS);
}

function stop() { clearTimeout(timer); started = false; }

// Pour les tests : clé TMDB sans démarrer la boucle.
const _setTmdbKey = k => { tmdbKey = k || ''; };

module.exports = { start, stop, setEnabled, setDelay, getStatus, exploreOne, _state: state, _setTmdbKey, MIN_DELAY_MS };
