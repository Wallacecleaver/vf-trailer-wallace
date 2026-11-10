// ============================================================
// CATALOGUE NETFLIX (France) — correspondances ID Netflix <-> TMDB <-> IMDB, stockées dans SQLite
// (table `netflix_titles`) et rafraîchies automatiquement toutes les 6 h.
//
// Netflix ne publie aucune liste de ses IDs (et les tester un par un est impossible), donc le catalogue
// se remplit à partir de sources qui, elles, les exposent :
//   1. Wikidata  — tous les éléments qui ont un « ID Netflix » (P1874), avec leur IMDB (P345) et TMDB
//                  (P4947 film / P4983 série). Passe complète au départ puis chaque semaine,
//                  et entre-temps uniquement les éléments modifiés depuis la dernière synchro.
//   2. TMDB      — tout ce qui est disponible sur Netflix France (discover + fournisseur Netflix).
//                  Ces titres n'ont pas encore d'ID Netflix (nid NULL) : ils sont fusionnés avec les lignes
//                  Wikidata dès qu'un IMDB / TMDB commun apparaît, et marqués `on_netflix_fr`.
//   3. À la demande — une URL Netflix collée dans le dashboard : on lit titre / année / type sur la page
//                  puis on cherche l'équivalent TMDB (-> IMDB). Voir addFromNetflixUrl().
//
// L'addon interroge ensuite cette table (findNidByImdb) avant de passer par Wikidata en direct.
// ============================================================

const sql = require('./db');
const { fetchT } = require('./net');
const { logEvent } = require('./logs');
const { parseNetflixId, getPageInfo } = require('./netflix-trailer');

// Points d'accès réseau (remplaçables uniquement par les tests).
const ENDPOINTS = {
    wikidata: 'https://query.wikidata.org/sparql',
    tmdb: 'https://api.themoviedb.org/3',
};

const REGION = (process.env.NETFLIX_COUNTRY || 'fr').toUpperCase().replace(/[^A-Z]/g, '') || 'FR';
const NETFLIX_PROVIDER_ID = 8; // identifiant TMDB de Netflix
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WIKIDATA_FULL_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const WIKIDATA_PAGE = 1000;
const WIKIDATA_MAX_PAGES = 100;
const WIKIDATA_TIMEOUT_MS = 60 * 1000;
const TMDB_MAX_PAGES = 500; // plafond imposé par TMDB (10 000 résultats par requête discover)
const TMDB_CONCURRENCY = 4;
const IMDB_LOOKUPS_PER_RUN = 3000;
const IMDB_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isNid = v => /^\d{5,}$/.test(String(v || ''));
const isImdb = v => /^tt\d{5,10}$/.test(String(v || ''));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// ---------- état de la synchro ----------
async function getState(key) {
    const rows = await sql`SELECT value FROM netflix_sync_state WHERE key = ${key}`;
    return rows[0] ? rows[0].value : null;
}
async function setState(key, value) {
    await sql`INSERT INTO netflix_sync_state (key, value, updated_at) VALUES (${key}, ${String(value)}, ${sql.nowIso()})
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
}

// ---------- lecture ----------
/** ID Netflix d'un IMDB ID d'après le catalogue local (en priorité un titre dispo en France), sinon null. */
async function findNidByImdb(imdbId) {
    if (!isImdb(imdbId)) return null;
    const rows = await sql`SELECT nid FROM netflix_titles WHERE imdb_id = ${imdbId} AND nid IS NOT NULL
                           ORDER BY on_netflix_fr DESC, id LIMIT 1`;
    return rows[0] ? rows[0].nid : null;
}

async function getByNid(nid) {
    const rows = await sql`SELECT * FROM netflix_titles WHERE nid = ${String(nid)}`;
    return rows[0] || null;
}

async function getCatalogStats() {
    const [counts] = await sql`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN nid IS NOT NULL THEN 1 ELSE 0 END) AS with_nid,
        SUM(CASE WHEN imdb_id IS NOT NULL THEN 1 ELSE 0 END) AS with_imdb,
        SUM(CASE WHEN on_netflix_fr = 1 THEN 1 ELSE 0 END) AS on_fr,
        SUM(CASE WHEN on_netflix_fr = 1 AND nid IS NULL THEN 1 ELSE 0 END) AS on_fr_without_nid
        FROM netflix_titles`;
    let lastReport = null;
    try { lastReport = JSON.parse(await getState('last_report')); } catch { /* aucun rapport */ }
    return {
        total: counts.total || 0, withNid: counts.with_nid || 0, withImdb: counts.with_imdb || 0,
        onFr: counts.on_fr || 0, onFrWithoutNid: counts.on_fr_without_nid || 0,
        running, lastReport,
    };
}

// ---------- écriture : fusion des sources ----------
function mergeData(oldJson, extra) {
    let base = {};
    try { base = JSON.parse(oldJson || '{}') || {}; } catch { /* JSON abîmé : on repart de zéro */ }
    return JSON.stringify({ ...base, ...(extra || {}) });
}

/** Fusionne dans la ligne `id` les lignes SANS ID Netflix qui décrivent le même titre (même IMDB ou même TMDB). */
async function absorbOrphans(id) {
    const [row] = await sql`SELECT * FROM netflix_titles WHERE id = ${id}`;
    if (!row || !row.nid) return;
    const orphans = await sql`SELECT * FROM netflix_titles WHERE id != ${id} AND nid IS NULL AND (
        (${row.imdb_id} IS NOT NULL AND imdb_id = ${row.imdb_id})
        OR (${row.tmdb_id} IS NOT NULL AND media_type = ${row.media_type} AND tmdb_id = ${row.tmdb_id}))`;
    for (const o of orphans) {
        await sql`UPDATE netflix_titles SET
            media_type = COALESCE(media_type, ${o.media_type}), tmdb_id = COALESCE(tmdb_id, ${o.tmdb_id}),
            imdb_id = COALESCE(imdb_id, ${o.imdb_id}), title = COALESCE(title, ${o.title}),
            year = COALESCE(year, ${o.year}), on_netflix_fr = MAX(on_netflix_fr, ${o.on_netflix_fr}),
            data = ${mergeData(row.data, JSON.parse(o.data || '{}'))}
            WHERE id = ${id}`;
        await sql`DELETE FROM netflix_titles WHERE id = ${o.id}`;
    }
}

/**
 * Ajoute ou met à jour un titre. `rec` : { nid?, mediaType?, tmdbId?, imdbId?, title?, year?, onFr?, source?, data? }.
 * Retrouve la ligne existante par ID Netflix, puis par TMDB / IMDB (une ligne sans nid est « adoptée »).
 * Renvoie l'id de la ligne.
 */
async function upsertTitle(rec) {
    const nid = isNid(rec.nid) ? String(rec.nid) : null;
    const imdbId = isImdb(rec.imdbId) ? rec.imdbId : null;
    const tmdbId = Number(rec.tmdbId) > 0 ? Number(rec.tmdbId) : null;
    const mediaType = rec.mediaType === 'movie' || rec.mediaType === 'tv' ? rec.mediaType : null;
    const year = Number(rec.year) > 1800 ? Number(rec.year) : null;
    const now = sql.nowIso();

    let row = nid ? (await sql`SELECT * FROM netflix_titles WHERE nid = ${nid}`)[0] : null;
    if (!row) {
        const candidates = [];
        if (mediaType && tmdbId) candidates.push(...await sql`SELECT * FROM netflix_titles WHERE media_type = ${mediaType} AND tmdb_id = ${tmdbId}`);
        if (imdbId) candidates.push(...await sql`SELECT * FROM netflix_titles WHERE imdb_id = ${imdbId}`);
        // Avec un ID Netflix on n'adopte qu'une ligne qui n'en a pas ; sans, n'importe quelle ligne du même titre.
        row = nid ? candidates.find(r => !r.nid) : candidates[0];
    }

    let id;
    if (row) {
        id = row.id;
        await sql`UPDATE netflix_titles SET
            nid = COALESCE(nid, ${nid}), media_type = COALESCE(${mediaType}, media_type),
            tmdb_id = COALESCE(${tmdbId}, tmdb_id), imdb_id = COALESCE(${imdbId}, imdb_id),
            title = COALESCE(${rec.title || null}, title), year = COALESCE(${year}, year),
            on_netflix_fr = MAX(on_netflix_fr, ${rec.onFr ? 1 : 0}), source = COALESCE(source, ${rec.source || null}),
            data = ${mergeData(row.data, rec.data)}, last_seen = ${now}
            WHERE id = ${id}`;
        // Un titre vu dans TMDB peut exister sur plusieurs lignes (plusieurs ID Netflix) : toutes sont dispo en France.
        if (rec.onFr && tmdbId && mediaType) {
            await sql`UPDATE netflix_titles SET on_netflix_fr = 1, last_seen = ${now} WHERE media_type = ${mediaType} AND tmdb_id = ${tmdbId}`;
        }
    } else {
        const inserted = await sql`INSERT INTO netflix_titles (nid, media_type, tmdb_id, imdb_id, title, year, on_netflix_fr, source, data, first_seen, last_seen)
            VALUES (${nid}, ${mediaType}, ${tmdbId}, ${imdbId}, ${rec.title || null}, ${year}, ${rec.onFr ? 1 : 0},
                    ${rec.source || null}, ${JSON.stringify(rec.data || {})}, ${now}, ${now}) RETURNING id`;
        id = inserted[0].id;
    }
    await absorbOrphans(id);
    return id;
}

// Les boucles d'écriture sont groupées en transaction (beaucoup plus rapide : un seul fsync).
async function inTransaction(fn) {
    sql.exec('BEGIN');
    try { return await fn(); } finally { sql.exec('COMMIT'); }
}

// ---------- source 1 : Wikidata ----------
function wikidataQuery(offset, since) {
    const safeSince = since && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since) ? since : null;
    const filter = safeSince ? `?i schema:dateModified ?m . FILTER(?m > "${safeSince}"^^xsd:dateTime)` : '';
    return `SELECT ?n ?imdb ?tm ?tt ?l WHERE {
  { SELECT ?i ?n WHERE { ?i wdt:P1874 ?n . ${filter} } ORDER BY ?n LIMIT ${WIKIDATA_PAGE} OFFSET ${offset} }
  OPTIONAL { ?i wdt:P345 ?imdb }
  OPTIONAL { ?i wdt:P4947 ?tm }
  OPTIONAL { ?i wdt:P4983 ?tt }
  OPTIONAL { ?i rdfs:label ?l FILTER(LANG(?l) = "fr") }
}`;
}

async function fetchWikidataPage(offset, since) {
    const url = `${ENDPOINTS.wikidata}?format=json&query=${encodeURIComponent(wikidataQuery(offset, since))}`;
    const res = await fetchT(url, {
        headers: {
            'User-Agent': 'vf-trailers-addon/3.5 (https://github.com/Wallacecleaver/vf-trailer-wallace)', // exigé par Wikidata
            Accept: 'application/sparql-results+json',
        },
    }, WIKIDATA_TIMEOUT_MS);
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    const data = await res.json();
    return (data && data.results && data.results.bindings) || [];
}

/** Importe les ID Netflix de Wikidata. `since` (ISO) : uniquement les éléments modifiés depuis. */
async function syncWikidata({ since = null } = {}) {
    let rows = 0;
    let pages = 0;
    for (let page = 0; page < WIKIDATA_MAX_PAGES; page++) {
        const bindings = await fetchWikidataPage(page * WIKIDATA_PAGE, since);
        pages++;
        const distinct = new Set();
        await inTransaction(async () => {
            for (const b of bindings) {
                const nid = b.n && b.n.value;
                if (!isNid(nid)) continue;
                distinct.add(nid);
                const tmdbMovie = b.tm && b.tm.value;
                const tmdbTv = b.tt && b.tt.value;
                await upsertTitle({
                    nid,
                    imdbId: b.imdb && b.imdb.value,
                    tmdbId: tmdbMovie || tmdbTv,
                    mediaType: tmdbMovie ? 'movie' : tmdbTv ? 'tv' : null,
                    title: b.l && b.l.value,
                    source: 'wikidata',
                });
                rows++;
            }
        });
        if (distinct.size < WIKIDATA_PAGE) break; // dernière page
        await sleep(1000); // on ménage Wikidata
    }
    return { rows, pages };
}

// ---------- source 2 : TMDB (disponible sur Netflix France) ----------
async function tmdbGet(path, params, key) {
    const url = new URL(ENDPOINTS.tmdb + path);
    const headers = { accept: 'application/json' };
    if (String(key).startsWith('eyJ')) headers.authorization = `Bearer ${key}`; // jeton « lecture » v4
    else url.searchParams.set('api_key', key);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetchT(url.toString(), { headers }, 15000);
            if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 2) * 1000); continue; }
            if (!res.ok) throw new Error(`TMDB HTTP ${res.status} ${path}`);
            return await res.json();
        } catch (err) {
            if (attempt === 2) throw err;
            await sleep(1000 * (attempt + 1));
        }
    }
    throw new Error(`TMDB injoignable ${path}`);
}

const discoverParams = (kind, page) => ({
    with_watch_providers: NETFLIX_PROVIDER_ID,
    watch_region: REGION,
    with_watch_monetization_types: 'flatrate',
    language: 'fr-FR',
    include_adult: 'false',
    sort_by: kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc', // tri stable pendant l'exploration
    page,
});

/** Parcourt tout le catalogue Netflix FR d'un type et l'enregistre. Renvoie les clés vues + les nouveautés. */
async function syncTmdbKind(kind, key, seen) {
    const first = await tmdbGet(`/discover/${kind}`, discoverParams(kind, 1), key);
    const totalPages = Math.min(Number(first.total_pages) || 1, TMDB_MAX_PAGES);
    let added = 0;

    const store = async results => {
        await inTransaction(async () => {
            for (const r of results || []) {
                const title = kind === 'movie' ? r.title : r.name;
                const date = kind === 'movie' ? r.release_date : r.first_air_date;
                const before = (await sql`SELECT id FROM netflix_titles WHERE media_type = ${kind} AND tmdb_id = ${r.id}`).length;
                await upsertTitle({
                    mediaType: kind, tmdbId: r.id, title, year: date ? Number(date.slice(0, 4)) : null,
                    onFr: true, source: 'tmdb',
                });
                seen.add(`${kind}:${r.id}`);
                if (!before) added++;
            }
        });
    };

    await store(first.results);
    for (let p = 2; p <= totalPages; p += TMDB_CONCURRENCY) {
        const batch = [];
        for (let q = p; q < p + TMDB_CONCURRENCY && q <= totalPages; q++) batch.push(tmdbGet(`/discover/${kind}`, discoverParams(kind, q), key));
        for (const data of await Promise.all(batch)) await store(data.results);
        await sleep(150);
    }
    return { pages: totalPages, added };
}

/** Passe `on_netflix_fr` à 0 pour les titres qui ne sont plus dans le catalogue TMDB FR (après une synchro complète réussie). */
async function markRemoved(seen) {
    const rows = await sql`SELECT id, media_type, tmdb_id FROM netflix_titles WHERE on_netflix_fr = 1`;
    const gone = rows.filter(r => !seen.has(`${r.media_type}:${r.tmdb_id}`)).map(r => r.id);
    for (let i = 0; i < gone.length; i += 200) {
        await sql`UPDATE netflix_titles SET on_netflix_fr = 0 WHERE id IN (${gone.slice(i, i + 200)})`;
    }
    return gone.length;
}

/** Cherche l'IMDB ID des titres connus par TMDB seulement (puis les fusionne avec la ligne Wikidata correspondante). */
async function fillMissingImdb(key, limit = IMDB_LOOKUPS_PER_RUN) {
    const recheckBefore = new Date(Date.now() - IMDB_RECHECK_MS).toISOString();
    const rows = await sql`SELECT id, media_type, tmdb_id, data FROM netflix_titles
        WHERE imdb_id IS NULL AND tmdb_id IS NOT NULL AND media_type IS NOT NULL
          AND COALESCE(json_extract(data, '$.imdbChecked'), '') < ${recheckBefore}
        ORDER BY on_netflix_fr DESC, id LIMIT ${limit}`;
    let filled = 0;
    for (let i = 0; i < rows.length; i += 5) {
        const batch = rows.slice(i, i + 5);
        const results = await Promise.all(batch.map(r =>
            tmdbGet(`/${r.media_type}/${r.tmdb_id}/external_ids`, {}, key).then(d => d.imdb_id || null, () => undefined)));
        await inTransaction(async () => {
            for (let j = 0; j < batch.length; j++) {
                const imdb = results[j];
                if (imdb === undefined) continue; // erreur réseau : on retentera à la prochaine synchro
                const r = batch[j];
                await sql`UPDATE netflix_titles SET imdb_id = COALESCE(${isImdb(imdb) ? imdb : null}, imdb_id),
                          data = ${mergeData(r.data, { imdbChecked: sql.nowIso() })} WHERE id = ${r.id}`;
                if (isImdb(imdb)) { filled++; await absorbOrphansByImdb(imdb); }
            }
        });
        await sleep(200);
    }
    return filled;
}

// Une ligne TMDB vient d'obtenir un IMDB ID : si une ligne avec ID Netflix a le même, on les fusionne.
async function absorbOrphansByImdb(imdbId) {
    const rows = await sql`SELECT id FROM netflix_titles WHERE imdb_id = ${imdbId} AND nid IS NOT NULL ORDER BY id LIMIT 1`;
    if (rows[0]) await absorbOrphans(rows[0].id);
}

// ---------- orchestration ----------
let running = false;

/**
 * Une synchro complète : Wikidata, puis TMDB (si TMDB_API_KEY est défini), puis IMDB manquants.
 * Une source en erreur n'empêche pas les autres. Une seule synchro à la fois. Renvoie le rapport.
 */
async function runSync({ forceFull = false } = {}) {
    if (running) return { skipped: 'déjà en cours' };
    running = true;
    const startedAt = sql.nowIso();
    const report = { startedAt, wikidata: null, tmdb: null, imdbFilled: 0 };
    try {
        // 1) Wikidata
        try {
            const lastFull = await getState('wikidata_last_full');
            const lastOk = await getState('wikidata_last_ok');
            const full = forceFull || !lastFull || !lastOk || Date.now() - Date.parse(lastFull) > WIKIDATA_FULL_EVERY_MS;
            const since = full ? null : new Date(Date.parse(lastOk) - 60 * 60 * 1000).toISOString();
            const out = await syncWikidata({ since });
            await setState('wikidata_last_ok', startedAt);
            if (full) await setState('wikidata_last_full', startedAt);
            report.wikidata = { ok: true, mode: full ? 'complète' : 'incrémentale', ...out };
        } catch (err) {
            report.wikidata = { ok: false, error: err.message };
        }

        // 2) TMDB : catalogue Netflix France
        const key = process.env.TMDB_API_KEY;
        if (!key) {
            report.tmdb = { ok: false, error: 'TMDB_API_KEY non défini : source TMDB ignorée' };
        } else {
            try {
                const seen = new Set();
                const movies = await syncTmdbKind('movie', key, seen);
                const shows = await syncTmdbKind('tv', key, seen);
                const removed = await markRemoved(seen); // seulement si les deux parcours sont allés au bout
                report.tmdb = { ok: true, seen: seen.size, added: movies.added + shows.added, removed };
            } catch (err) {
                report.tmdb = { ok: false, error: err.message };
            }
            try { report.imdbFilled = await fillMissingImdb(key); } catch (err) { report.imdbError = err.message; }
        }

        report.finishedAt = sql.nowIso();
        await setState('last_report', JSON.stringify(report));
        if (report.wikidata.ok || (report.tmdb && report.tmdb.ok)) await setState('last_sync_ok', startedAt);
        const failed = !report.wikidata.ok || (report.tmdb && !report.tmdb.ok);
        await logEvent({
            level: failed ? 'warn' : 'info', context: 'CATALOG', event: 'netflix_catalog_sync',
            message: `Synchro du catalogue Netflix : Wikidata ${report.wikidata.ok ? `${report.wikidata.rows} lignes` : 'échec'}, `
                + `TMDB ${report.tmdb && report.tmdb.ok ? `${report.tmdb.seen} titres FR (+${report.tmdb.added})` : 'échec / ignoré'}`,
            meta: report,
        });
        return report;
    } finally {
        running = false;
    }
}

let timer = null;

/** Lance la synchro en arrière-plan : peu après le démarrage si elle a plus de 6 h, puis toutes les 6 h. */
function startScheduler({ firstDelayMs = 30 * 1000 } = {}) {
    if (timer || process.env.NETFLIX_CATALOG_SYNC === '0') return;
    const tick = () => runSync().catch(err => console.error('[catalogue netflix] synchro impossible :', err.message));
    getState('last_sync_ok').then(last => {
        const age = last ? Date.now() - Date.parse(last) : Infinity;
        setTimeout(tick, age >= SYNC_INTERVAL_MS ? firstDelayMs : Math.max(firstDelayMs, SYNC_INTERVAL_MS - age)).unref();
    }).catch(() => setTimeout(tick, firstDelayMs).unref());
    timer = setInterval(tick, SYNC_INTERVAL_MS);
    timer.unref();
}

function stopScheduler() { if (timer) { clearInterval(timer); timer = null; } }

// ---------- source 3 : URL Netflix -> TMDB -> IMDB ----------
/** Meilleur résultat TMDB pour un titre Netflix : titre identique (+2) et année à ±1 (+1) ; 2 points minimum. */
function pickBest(results, info, kind) {
    let best = null;
    let bestScore = 0;
    for (const r of (results || []).slice(0, 8)) {
        const date = kind === 'movie' ? r.release_date : r.first_air_date;
        const names = [r.title, r.name, r.original_title, r.original_name];
        let score = 0;
        if (names.some(n => n && norm(n) === norm(info.title))) score += 2;
        if (info.year && date && Math.abs(Number(date.slice(0, 4)) - info.year) <= 1) score += 1;
        if (score > bestScore) { best = r; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
}

async function searchTmdb(info, key) {
    const kinds = info.mediaType === 'movie' ? ['movie', 'tv'] : info.mediaType === 'tv' ? ['tv', 'movie'] : ['tv', 'movie'];
    const candidates = [];
    for (const kind of kinds) {
        const yearKey = kind === 'tv' ? 'first_air_date_year' : 'year';
        let data = await tmdbGet(`/search/${kind}`, { query: info.title, language: 'fr-FR', [yearKey]: info.year || undefined }, key);
        if (!(data.results || []).length && info.year) data = await tmdbGet(`/search/${kind}`, { query: info.title, language: 'fr-FR' }, key);
        const best = pickBest(data.results, info, kind);
        if (best) return { match: { kind, tmdbId: best.id, title: kind === 'movie' ? best.title : best.name }, candidates };
        for (const r of (data.results || []).slice(0, 3)) {
            const date = kind === 'movie' ? r.release_date : r.first_air_date;
            candidates.push({ mediaType: kind, tmdbId: r.id, title: kind === 'movie' ? r.title : r.name, year: date ? date.slice(0, 4) : null });
        }
    }
    return { match: null, candidates };
}

/** Enregistre « ID Netflix = ce titre TMDB » (le TMDB est choisi à la main ou par addFromNetflixUrl). */
async function linkNetflixToTmdb(nid, { mediaType, tmdbId, title, year, source = 'manual' }, key) {
    if (!isNid(nid)) throw new Error('ID Netflix invalide');
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new Error('Type invalide (movie ou tv)');
    if (!(Number(tmdbId) > 0)) throw new Error('ID TMDB invalide');
    let imdbId = null;
    if (key) {
        try { imdbId = (await tmdbGet(`/${mediaType}/${Number(tmdbId)}/external_ids`, {}, key)).imdb_id || null; } catch { /* on enregistre quand même sans IMDB */ }
    }
    const id = await upsertTitle({ nid, mediaType, tmdbId, imdbId, title, year, source });
    return (await sql`SELECT * FROM netflix_titles WHERE id = ${id}`)[0];
}

/**
 * Colle une URL Netflix (ou un ID) -> lit le titre sur la page -> cherche sur TMDB -> IMDB.
 * Renvoie { status: 'exists' | 'linked' | 'ambiguous' | 'no_match', row?, info?, candidates? }.
 * `ambiguous` / `no_match` : à confirmer avec linkNetflixToTmdb (choix manuel dans le dashboard).
 */
async function addFromNetflixUrl(input, key) {
    const nid = parseNetflixId(input);
    if (!nid) throw new Error('URL Netflix non reconnue (attendu : netflix.com/.../title/<id>)');
    const existing = await getByNid(nid);
    if (existing && existing.imdb_id) return { status: 'exists', row: existing };
    if (!key) throw new Error('Clé TMDB indisponible (TMDB_API_KEY)');

    const info = await getPageInfo(nid);
    if (!info) throw new Error('Page Netflix illisible (bloquée, introuvable ou format changé)');

    const { match, candidates } = await searchTmdb(info, key);
    if (!match) return { status: candidates.length ? 'ambiguous' : 'no_match', nid, info, candidates };
    const row = await linkNetflixToTmdb(nid, { mediaType: match.kind, tmdbId: match.tmdbId, title: info.title, year: info.year, source: 'url' }, key);
    return { status: 'linked', row, info };
}

module.exports = {
    findNidByImdb, getByNid, getCatalogStats,
    upsertTitle, syncWikidata, syncTmdbKind, fillMissingImdb, runSync,
    startScheduler, stopScheduler,
    addFromNetflixUrl, linkNetflixToTmdb,
    // pour les tests
    _endpoints: ENDPOINTS, _wikidataQuery: wikidataQuery,
};
