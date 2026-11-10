// Tâches périodiques du catalogue Netflix local.
//  • Au démarrage : table vide -> import Wikidata complet, puis TMDB en profondeur (NETFLIX_TMDB_FULL_PAGES, 100 par défaut).
//  • Toutes les 6 h : contrôle léger des nouveautés (TMDB discover trié par date, 3 pages) ; Wikidata en différé
//    (lot de 300 titres au plus, les introuvables sont réessayés après 7 jours). Jamais de re-balayage du catalogue.
// NETFLIX_SYNC=0 désactive tout. Ces synchros n'appellent pas netflix.com (l'exploration, elle, est dans netflix-crawler.js, activable depuis le dashboard). Les erreurs sont journalisées, jamais fatales.

const store = require('./netflix-titles');
const wikidata = require('./netflix-wikidata-sync');
const tmdb = require('./netflix-tmdb-sync');
const crawler = require('./netflix-crawler');

const SIX_HOURS = 6 * 60 * 60 * 1000;
let running = false;

async function guarded(label, fn) {
    if (running) return null;
    running = true;
    try {
        const r = await fn();
        console.log(`[catalogue Netflix] ${label} :`, JSON.stringify(r));
        return r;
    } catch (err) {
        console.warn(`[catalogue Netflix] ${label} impossible :`, err.message);
        return null;
    } finally {
        running = false;
    }
}

/** Contrôle périodique : nouveautés TMDB + résolution des ID Netflix manquants. */
const checkNew = key => guarded('contrôle des nouveautés', () => tmdb.syncFromTmdb(key, { pages: 3 }));

/** Premier remplissage (table vide). */
const initialFill = key => guarded('remplissage initial', async () => {
    const w = await wikidata.syncFromWikidata();
    const pages = Math.max(1, Math.min(500, Number(process.env.NETFLIX_TMDB_FULL_PAGES) || 100));
    const t = await tmdb.syncFromTmdb(key, { pages });
    return { wikidata: w, tmdb: t };
});

function start() {
    if (process.env.NETFLIX_SYNC === '0') return;
    const key = process.env.TMDB_API_KEY || '';
    if (!key) console.warn('[catalogue Netflix] TMDB_API_KEY absente : seul Wikidata alimente le catalogue.');
    store.countTitles()
        .then(n => (n === 0 ? initialFill(key) : checkNew(key)))
        .catch(err => console.warn('[catalogue Netflix] démarrage :', err.message));
    setInterval(() => checkNew(key), SIX_HOURS).unref();
    crawler.start(key).catch(err => console.warn('[exploration Netflix] démarrage :', err.message));
}

module.exports = { start, checkNew, initialFill };
