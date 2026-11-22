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
    const found = pickTrailerFromPage(cheerio.load(HTML), { mediaType: 'tv', directOnly: false, season: 1 });
    assert.equal(found.url, 'https://www.allocine.fr/video/player_gen_cmedia=20646368&cserie=1000003119.html');
    assert.equal(found.french, true);
    assert.equal(found.dailymotionId, 'xbt2su2');
});

test('ne sert pas cette bande-annonce de saison 1 pour la saison 2', () => {
    assert.equal(pickTrailerFromPage(cheerio.load(HTML), { mediaType: 'tv', directOnly: false, season: 2 }), null);
});
