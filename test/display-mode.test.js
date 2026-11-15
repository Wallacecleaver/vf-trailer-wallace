const test = require('node:test');
const assert = require('node:assert');
const { applyDisplayMode, buildPreviewStreams } = require('../lib/stream-format');
const { decodeConfig } = require('../lib/config');

const streams = [
    { name: '🎬 VF', title: 'Bande-annonce\nDune : Deuxième partie', ytId: 'abc123', __external: false },
    { name: '🎬 VF\n▶️ YouTube', title: 'Bande-annonce\nDune : Deuxième partie\n(ouvrir dans YouTube)', externalUrl: 'https://www.youtube.com/watch?v=abc123', __external: true },
];

test('display : default ne change rien', () => {
    assert.deepStrictEqual(applyDisplayMode(streams, { display: 'default' }, 'tmdb'), streams);
});

test('display : compact tient sur une ligne', () => {
    const out = applyDisplayMode(streams, { display: 'compact' }, 'tmdb');
    assert.ok(out.every(s => !s.title.includes('\n')));
    assert.match(out[0].title, /Bande-annonce • Dune/);
});

test('display : detailed ajoute langue, source, lecture et lien', () => {
    const out = applyDisplayMode(streams, { display: 'detailed' }, 'allocine');
    assert.match(out[0].title, /VF ✓ • 🔎 Allociné/);
    assert.match(out[0].title, /Lecteur intégré/);
    assert.match(out[0].title, /youtube\.com\/watch\?v=abc123/);
    assert.match(out[1].title, /Ouverture externe/);
});

test('display : la qualité TMDB s\'affiche en détaillé/compact et n\'est jamais envoyée', () => {
    const q = [{ name: '🎬 VF', title: 'Bande-annonce\nDune', ytId: 'abc', __quality: 1080 }, { name: '🎬 VF', title: 'Teaser\nDune', ytId: 'def', __quality: 2160 }];
    const det = applyDisplayMode(q, { display: 'detailed' }, 'tmdb');
    assert.match(det[0].title, /🎞️ 1080p/);
    assert.match(det[1].title, /4K 2160p/);
    assert.match(applyDisplayMode(q, { display: 'compact' }, 'tmdb')[0].title, /Bande-annonce • 1080p • Dune/);
    for (const mode of ['default', 'compact', 'detailed']) {
        assert.ok(applyDisplayMode(q, { display: mode }, 'tmdb').every(s => !('__quality' in s)));
    }
    const noQ = applyDisplayMode([{ name: 'x', title: 'Bande-annonce\nDune', url: 'https://a.b/c.mp4' }], { display: 'detailed' }, 'allocine');
    assert.ok(!/🎞️/.test(noQ[0].title));
});

test('display : decodeConfig n\'accepte que des modes connus', () => {
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    assert.strictEqual(decodeConfig(enc({ display: 'detailed' })).display, 'detailed');
    assert.strictEqual(decodeConfig(enc({ display: 'nimporte' })).display, 'default');
});

test('aperçu : le lien externe garde le type et le titre du film (pas "Bande-annonce" seul)', () => {
    const out = buildPreviewStreams({ display: 'detailed' });
    const ext = out.find(s => s.externalUrl);
    assert.match(ext.title, /^Bande-annonce • Dune : Deuxième partie\n/);
    assert.match(ext.title, /Ouverture externe/);
    assert.ok(!ext.title.includes('(ouvrir dans YouTube)'));
});

test('aperçu : respecte externalOnly, maxLinks et aiom comme le vrai /stream', () => {
    assert.strictEqual(buildPreviewStreams({ display: 'default' }).length, 4);
    assert.ok(buildPreviewStreams({ display: 'default', externalOnly: true }).every(s => s.externalUrl));
    assert.strictEqual(buildPreviewStreams({ display: 'default', maxLinks: 2 }).length, 2);
    const aiom = buildPreviewStreams({ display: 'detailed', aiom: true });
    assert.strictEqual(aiom.length, 1);
    assert.ok(aiom[0].ytId && !('__quality' in aiom[0]));
});

test('aperçu : le film choisi remplace le film d\'exemple', () => {
    const out = buildPreviewStreams({ display: 'default' }, 'Oppenheimer');
    assert.ok(out.every(s => s.title.includes('Oppenheimer')));
    assert.ok(!out.some(s => s.title.includes('Dune')));
});
