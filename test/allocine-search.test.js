const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRef } = require('../lib/title-match');

test('Allociné : le lien encodé et la date permettent de choisir le bon homonyme', async () => {
    const paths = [];
    const fetchModule = require.resolve('node-fetch');
    const originalFetch = require(fetchModule);
    const card = (id, date) => {
        const path = Buffer.from(`/film/fichefilm_gen_cfilm=${id}.html`).toString('base64');
        return `<div class="entity-card">
            <span class="ACr${path.slice(0, 3)}ACr${path.slice(3)} meta-title-link">Avec toi pour toujours</span>
            <div class="meta-body-info"><span class="date">${date}</span> | 2h 07min</div>
        </div>`;
    };
    const pages = {
        '/rechercher/': `<main>${card(287159, '8 juin 2021')}${card(1000033111, '19 novembre 2026')}</main>`,
        '/videos/fichefilm-1000033111/toutes/': '<a href="/video/video-20645654/">Avec toi pour toujours Bande-annonce VF</a>',
        '/video/video-20645654/': '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example/trailer.mp4"}</script>',
    };
    require.cache[fetchModule].exports = async raw => {
        const url = new URL(raw);
        paths.push(url.pathname);
        if (url.pathname === '/rechercher/') assert.equal(url.searchParams.get('q'), 'Avec toi pour toujours');
        return { ok: Object.hasOwn(pages, url.pathname), text: async () => pages[url.pathname] || '' };
    };
    const allocineModule = require.resolve('../lib/allocine');
    try {
        const { getAllocineTrailerStreams } = require(allocineModule);
        const ref = buildRef({ allTitles: ['Avec toi pour toujours', 'Son Yemek', 'Last Meal'], year: 2026 });
        const streams = await getAllocineTrailerStreams('Avec toi pour toujours', ref);
        assert.equal(streams[0]?.url, 'https://cdn.example/trailer.mp4');
        assert.deepEqual(paths, Object.keys(pages));
    } finally {
        require.cache[fetchModule].exports = originalFetch;
        delete require.cache[allocineModule];
    }
});
