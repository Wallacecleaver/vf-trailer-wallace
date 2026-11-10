// Client SPARQL Wikidata partagé (utilisé par la synchro du catalogue et par la recherche d'ID Netflix en direct).
// Une requête en erreur (réseau, HTTP non 2xx, JSON illisible) LÈVE une exception : à l'appelant de décider
// s'il retente plus tard (jamais « aucun résultat » à la place d'une panne).

const { fetchT } = require('./net');

// Wikidata exige un User-Agent descriptif.
const USER_AGENT = 'vf-trailers-addon/3.5 (https://github.com/Wallacecleaver/vf-trailer-wallace)';

/** Exécute une requête SPARQL sur `endpoint` et renvoie la liste des lignes (`results.bindings`). */
async function sparql(endpoint, query, timeoutMs) {
    const res = await fetchT(`${endpoint}?format=json&query=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    }, timeoutMs);
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    const data = await res.json();
    return (data && data.results && data.results.bindings) || [];
}

/** Valeur (texte) d'une cellule de résultat SPARQL, ou null si elle est absente. */
const bindingValue = cell => (cell && cell.value !== undefined ? String(cell.value) : null);

module.exports = { sparql, bindingValue };
