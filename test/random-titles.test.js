// Tests du tirage aléatoire de titres TMDB (lib/random-titles.js), sans réseau.
const { test } = require('node:test');
const assert = require('node:assert');
const { pickRandomTitles } = require('../lib/random-titles');

function fakeFetch(calls) {
    return async url => {
        calls.push(url);
        if (url.includes('/discover/movie')) {
            return { results: [
                { id: 1, title: 'Lucky', release_date: '2026-03-01', original_language: 'en' },
                { id: 2, title: 'Sans IMDB', release_date: '2025-01-01' },
                { id: 3, title: 'Erreur réseau', release_date: '2024-01-01' },
            ] };
        }
        if (url.includes('/discover/tv')) return { results: [{ id: 9, name: 'The Bear', first_air_date: '2022-06-23' }] };
        if (url.includes('/movie/1/external_ids') || url.includes('/tv/9/external_ids')) return { imdb_id: url.includes('/tv/') ? 'tt14452776' : 'tt34866681' };
        if (url.includes('/movie/2/external_ids')) return { imdb_id: null };
        throw new Error('boom');
    };
}

test('films : garde seulement les titres avec IMDB ID, ignore les erreurs', async () => {
    const calls = [];
    const out = await pickRandomTitles({ type: 'movie', tmdbKey: 'k', fetchJson: fakeFetch(calls), rand: () => 0 });
    assert.deepStrictEqual(out.map(t => t.imdbId), ['tt34866681']);
    assert.strictEqual(out[0].type, 'movie');
    assert.strictEqual(out[0].year, '2026');
    assert.ok(calls[0].includes('page=1'));
});

test('séries : type "series" renvoyé pour le test de résolution', async () => {
    const out = await pickRandomTitles({ type: 'tv', tmdbKey: 'k', fetchJson: fakeFetch([]), rand: () => 0 });
    assert.strictEqual(out[0].type, 'series');
    assert.strictEqual(out[0].title, 'The Bear');
});

test('page tirée dans la plage du pool', async () => {
    const calls = [];
    await pickRandomTitles({ type: 'movie', pool: 'wide', tmdbKey: 'k', fetchJson: fakeFetch(calls), rand: () => 0.9999 });
    assert.ok(calls[0].includes('page=100'));
    const calls2 = [];
    await pickRandomTitles({ type: 'movie', pool: 'popular', tmdbKey: 'k', fetchJson: fakeFetch(calls2), rand: () => 0.9999 });
    assert.ok(calls2[0].includes('page=25'));
});

test('type invalide : erreur', async () => {
    await assert.rejects(() => pickRandomTitles({ type: 'x', tmdbKey: 'k', fetchJson: fakeFetch([]) }));
});
