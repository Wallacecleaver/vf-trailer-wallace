#!/usr/bin/env node
// Étape 1 du mapping Netflix -> IMDB : pour UN titre Netflix, lit son nom / année / type sur la page,
// le cherche sur TMDB et affiche l'IMDB ID trouvé. N'écrit rien nulle part (test à blanc).
//
//   TMDB_API_KEY=xxxx node scripts/netflix-id.js 81944880
//   TMDB_API_KEY=xxxx node scripts/netflix-id.js https://www.netflix.com/fr/title/81944880

const { fetchNetflixPage, extractTitleInfo, parseNetflixId } = require('../lib/netflix-trailer');
const { API } = require('../lib/tmdb');
const { fetchT } = require('../lib/net');

// Minuscules, sans accents ni ponctuation : « Trouble échange » ~ « trouble echange ».
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function searchTmdb(info, key) {
    const kind = info.mediaType === 'tv' ? 'tv' : 'movie';
    const yearParam = kind === 'tv' ? 'first_air_date_year' : 'year';
    const results = [];
    for (const withYear of info.year ? [true, false] : [false]) {
        const url = `${API}/search/${kind}?api_key=${key}&language=fr-FR&query=${encodeURIComponent(info.title)}${withYear ? `&${yearParam}=${info.year}` : ''}`;
        const data = await (await fetchT(url)).json();
        results.push(...(data.results || []));
        if (results.length) break; // avec l'année on a déjà des candidats : inutile de relâcher le filtre
    }
    return { kind, results };
}

// 'ok' seulement si UN seul candidat porte exactement ce titre (FR ou original) à ±1 an près.
function pickMatch(info, kind, results) {
    const want = norm(info.title);
    const yearOf = r => Number(String(kind === 'tv' ? r.first_air_date : r.release_date || '').slice(0, 4)) || null;
    const exact = results.filter(r => [r.title, r.name, r.original_title, r.original_name].some(t => norm(t) === want)
        && (!info.year || !yearOf(r) || Math.abs(yearOf(r) - info.year) <= 1));
    return exact.length === 1 ? { status: 'ok', match: exact[0] } : { status: 'a_verifier', candidates: results.slice(0, 5) };
}

async function main() {
    const nid = parseNetflixId(process.argv[2]);
    const key = process.env.TMDB_API_KEY;
    if (!nid) { console.error('Usage : TMDB_API_KEY=xxx node scripts/netflix-id.js <id Netflix ou URL>'); process.exit(1); }
    if (!key) { console.error('Variable TMDB_API_KEY manquante.'); process.exit(1); }

    const info = extractTitleInfo(await fetchNetflixPage(nid), nid);
    console.log('Page Netflix  :', nid, '→', JSON.stringify(info));
    if (!info.title) { console.error('Titre introuvable sur la page (page bloquée ou structure changée).'); process.exit(2); }

    const { kind, results } = await searchTmdb(info, key);
    const verdict = pickMatch(info, kind, results);
    if (verdict.status === 'ok') {
        const m = verdict.match;
        const ids = await (await fetchT(`${API}/${kind}/${m.id}/external_ids?api_key=${key}`)).json();
        console.log('TMDB          :', kind, m.id, '-', m.title || m.name);
        console.log('IMDB          :', ids.imdb_id || '(TMDB ne connaît pas encore d\'IMDB ID)');
        console.log('Statut        : ok');
    } else {
        console.log('Statut        : a_verifier —', results.length ? 'plusieurs candidats ou titre différent :' : 'aucun résultat TMDB');
        for (const r of verdict.candidates) console.log(`   - ${kind} ${r.id} : ${r.title || r.name} (${String(r.release_date || r.first_air_date || '').slice(0, 4)})`);
    }
}
main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
