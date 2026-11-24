const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRef } = require('../lib/title-match');

test('Allociné : le lien encodé et la date permettent de choisir le bon homonyme', async () => {
    const paths = [];
    let requestedTitle = 'Avec toi pour toujours';
    const fetchModule = require.resolve('node-fetch');
    const originalFetch = require(fetchModule);
    const card = (id, date) => {
        const path = Buffer.from(`/film/fichefilm_gen_cfilm=${id}.html`).toString('base64');
        return `<div class="entity-card">
            <span class="ACr${path.slice(0, 3)}ACr${path.slice(3)} meta-title-link">Avec toi pour toujours</span>
            <div class="meta-body-info"><span class="date">${date}</span> | 2h 07min</div>
        </div>`;
    };
    const filmPlayer = '/video/player_gen_cmedia=20645654&cfilm=1000033111.html';
    const seriesPlayer = '/video/player_gen_cmedia=20645655&cserie=12345.html';
    const recommended = '<a href="/video/player_gen_cmedia=20645344&amp;cfilm=312529.html">Billie, à la croisée des mondes Bande-annonce VF</a>';
    const playerHtml = '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example/trailer.mp4"}</script>';
    const pages = {
        '/rechercher/': `<main>${card(287159, '8 juin 2021')}${card(1000033111, '19 novembre 2026')}</main>`,
        '/videos/fichefilm-1000033111/toutes/': [
            recommended,
            '<a href="/video/player_gen_cmedia=20645652&cfilm=1000033111.html">Avec toi pour toujours Bande-annonce VO</a>',
            '<a href="/video/player_gen_cmedia=20645653&cfilm=1000033111.html">Avec toi pour toujours Bande-annonce</a>',
            '<a href="' + filmPlayer + '">Avec toi pour toujours Bande-annonce VF</a>',
        ].join(''),
        [filmPlayer]: playerHtml,
    };
    require.cache[fetchModule].exports = async raw => {
        const url = new URL(raw);
        paths.push(url.pathname);
        if (url.pathname === '/rechercher/') assert.equal(url.searchParams.get('q'), requestedTitle);
        return { ok: Object.hasOwn(pages, url.pathname), text: async () => pages[url.pathname] || '' };
    };
    const allocineModule = require.resolve('../lib/allocine');
    try {
        const { getAllocineTrailerStreams } = require(allocineModule);
        const ref = buildRef({ allTitles: ['Avec toi pour toujours', 'Son Yemek', 'Last Meal'], year: 2026 });
        const streams = await getAllocineTrailerStreams('Avec toi pour toujours', ref);
        assert.equal(streams[0]?.url, 'https://cdn.example/trailer.mp4');
        assert.deepEqual(paths, Object.keys(pages));
        paths.length = 0;
        pages['/videos/fichefilm-1000033111/toutes/'] =
            recommended + '<a href="/video/player_gen_cmedia=20645652&cfilm=1000033111.html">Avec toi pour toujours Bande-annonce VO</a>';
        assert.deepEqual(await getAllocineTrailerStreams('Avec toi pour toujours', ref), []);
        assert.deepEqual(paths, Object.keys(pages).slice(0, 2));

        paths.length = 0;
        requestedTitle = 'Lupin';
        pages['/rechercher/'] = '<a href="/series/ficheserie_gen_cserie=12345.html">Lupin (2021)</a>';
        pages['/videos/ficheserie-12345/toutes/'] = [
            '<a href="/video/player_gen_cmedia=20645656&cserie=99999.html">Autre série Saison 1 Bande-annonce VF</a>',
            '<a href="/video/player_gen_cmedia=20645657&cserie=12345.html">Lupin Saison 2 Bande-annonce VF</a>',
            '<a href="' + seriesPlayer + '">Lupin Saison 1 Bande-annonce VF</a>',
        ].join('');
        pages[seriesPlayer] = playerHtml;
        const lupin = buildRef({ allTitles: ['Lupin'], year: 2021 });
        const [seasonOne] = await getAllocineTrailerStreams('Lupin', lupin, { mediaType: 'tv', season: '1' });
        assert.equal(seasonOne?.url, 'https://cdn.example/trailer.mp4');
        assert.equal(paths.at(-1), seriesPlayer);
    } finally {
        require.cache[fetchModule].exports = originalFetch;
        delete require.cache[allocineModule];
    }
});
