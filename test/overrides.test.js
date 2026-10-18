// Tests de la logique de liens des overrides — lib/overrides.js
// Lancement : npm test

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeLink, buildLinks, linksToLegacy } = require('../lib/overrides');

test('normalizeLink : vide -> null, ytId seul, url seule (jamais les deux)', () => {
    assert.strictEqual(normalizeLink(null), null);
    assert.strictEqual(normalizeLink({}), null);
    assert.strictEqual(normalizeLink({ ytId: '', url: '' }), null);
    assert.deepStrictEqual(normalizeLink({ ytId: 'JwCXFU6K5KA', url: 'https://x' }), { ytId: 'JwCXFU6K5KA' });
    assert.deepStrictEqual(normalizeLink({ ytId: '  ', url: 'https://x/y.mp4' }), { url: 'https://x/y.mp4' });
});

test('buildLinks : rétrocompat ytId/url sans links -> liste prioritaire [premier]', () => {
    const links = buildLinks({ ytId: 'JwCXFU6K5KA', url: null });
    assert.deepStrictEqual(links, [{ ytId: 'JwCXFU6K5KA' }]);
});

test('buildLinks : links présent remplace ytId/url et filtre les entrées vides', () => {
    const links = buildLinks({ ytId: 'AAAA', links: [{ ytId: 'JwCXFU6K5KA' }, { url: 'https://x/alt.mp4' }, { url: '' }] });
    assert.deepStrictEqual(links, [{ ytId: 'JwCXFU6K5KA' }, { url: 'https://x/alt.mp4' }]);
});

test('linksToLegacy : reflète le premier lien sur ytId/url', () => {
    assert.deepStrictEqual(linksToLegacy([{ ytId: 'JwCXFU6K5KA' }]), { ytId: 'JwCXFU6K5KA', url: null });
    assert.deepStrictEqual(linksToLegacy([{ url: 'https://x/alt.mp4' }]), { ytId: null, url: 'https://x/alt.mp4' });
    assert.deepStrictEqual(linksToLegacy([]), { ytId: null, url: null });
});

// ---- Une URL YouTube collée dans "URL directe" devient un vrai lien YouTube ----
test('youtubeIdFromUrl : formats courants', () => {
    const { youtubeIdFromUrl } = require('../lib/overrides');
    assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeIdFromUrl('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.strictEqual(youtubeIdFromUrl('https://cdn.example.com/video.mp4'), null);
    assert.strictEqual(youtubeIdFromUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null, 'pas YouTube');
});
