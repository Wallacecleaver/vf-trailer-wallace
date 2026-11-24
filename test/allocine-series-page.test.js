const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { hrefFromAcrClass, pickTrailerFromPage } = require('../lib/allocine');

// Extrait réel de la fiche série « Nuits Blanches » (ficheserie_gen_cserie=1000003119) :
// liens encodés en base64 dans la classe, lecteur Dailymotion déclaré dans data-model.
const MODEL = JSON.stringify({ videos: [{ id: 20646368, idDailymotion: 'xbt2su2', title: 'Nuits Blanches - saison 1 Bande-annonce VF' }] });
const HTML = `
<figure class="player js-player" data-model='${MODEL}'></figure>
<span class="ACrL3ZACrpZGVvL3BsYXllcl9nZW5fY21lZGlhPTIwNjQ2MzY4JmNzZXJpZT0xMDAwMDAzMTE5Lmh0bWw= thumbnail-container" title="Nuits Blanches"></span>
<span class="ACrL3ZACrpZGVvL3BsYXllcl9nZW5fY21lZGlhPTIwNjQ2MzY4JmNzZXJpZT0xMDAwMDAzMTE5Lmh0bWw= meta-title-link">Nuits Blanches - saison 1 Bande-annonce VF</span>`;

test('décode le chemin caché dans la classe ACr', () => {
    assert.equal(hrefFromAcrClass('ACrL3ZACrpZGVvL3BsYXllcl9nZW5fY21lZGlhPTIwNjQ2MzY4JmNzZXJpZT0xMDAwMDAzMTE5Lmh0bWw= x'),
        '/video/player_gen_cmedia=20646368&cserie=1000003119.html');
    assert.equal(hrefFromAcrClass('roller-item'), null);
});

test('trouve la bande-annonce VF de la saison 1 et son id Dailymotion', () => {
    const found = pickTrailerFromPage(cheerio.load(HTML), { allocineId: '1000003119', mediaType: 'tv', directOnly: false, season: 1 });
    assert.equal(found.url, 'https://www.allocine.fr/video/player_gen_cmedia=20646368&cserie=1000003119.html');
    assert.equal(found.french, true);
    assert.equal(found.dailymotionId, 'xbt2su2');
});

test('ne sert pas cette bande-annonce de saison 1 pour la saison 2', () => {
    assert.equal(pickTrailerFromPage(cheerio.load(HTML), { allocineId: '1000003119', mediaType: 'tv', directOnly: false, season: 2 }), null);
});

test('saison 2 : accepte une vidéo qui cite explicitement « saison 2 »', () => {
    const html = '<a href="/video/player_gen_cmedia=1999&cserie=5.html">Série - saison 2 Bande-annonce VF</a>';
    const found = pickTrailerFromPage(cheerio.load(html), { allocineId: '5', mediaType: 'tv', directOnly: false, season: 2 });
    assert.equal(found.url, 'https://www.allocine.fr/video/player_gen_cmedia=1999&cserie=5.html');
});

test('un lien sans identifiant de série doit être associé au bon lecteur', () => {
    const model = JSON.stringify({ videos: [{ id: 20646368, relatedEntityType: 'series', relatedEntityId: 1000003119 }] });
    const link = '<a href="/video/video-20646368/">Nuits Blanches - saison 1 Bande-annonce VF</a>';
    const options = { allocineId: '1000003119', mediaType: 'tv', season: 1 };
    assert.equal(pickTrailerFromPage(cheerio.load(link), options), null);
    const found = pickTrailerFromPage(cheerio.load('<figure data-model=\'' + model + '\'></figure>' + link), options);
    assert.equal(found?.url, 'https://www.allocine.fr/video/video-20646368/');
});
