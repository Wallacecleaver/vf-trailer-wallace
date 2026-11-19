const test = require('node:test');
const assert = require('node:assert');
const { applyDisplayMode, buildPreviewStreams, formatStreamName, toAiomStreams } = require('../lib/stream-format');
const { detectPlatform, platformFromProviders } = require('../lib/tmdb');
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
    assert.match(out[0].title, /🔗 YouTube/);
    assert.ok(!out[0].title.includes('watch?v='));
    assert.match(out[1].title, /🔗 YouTube/);
    assert.ok(!out[1].title.includes('watch?v='));
    assert.match(out[1].title, /Ouverture externe/);
});

test('display : le mode détaillé masque l’URL directe dans le texte et la conserve pour la lecture', () => {
    const url = 'https://fr.vid.web.acsta.net/nmedia/33/26/10/trailer.mp4?source=www';
    const [stream] = applyDisplayMode([{ name: '🎬 VF', title: 'Bande-annonce\nAvec toi pour toujours', url }],
        { display: 'detailed' }, 'allocine');
    assert.strictEqual(stream.url, url);
    assert.deepStrictEqual(stream.title.split('\n'), [
        'Bande-annonce • Avec toi pour toujours',
        '🇫🇷 VF ✓ • 🔎 Allociné',
        '▶️ Lien vidéo direct',
    ]);
});

test('display : la langue vidéo inconnue est indiquée dans chaque mode et exclue d’AIOM', () => {
    const unknown = { name: '🔴 Netflix', title: 'Bande-annonce\nDune', url: 'https://cdn.example/trailer.mp4', __unverifiedAudio: true };
    for (const display of ['default', 'compact', 'detailed']) {
        const [stream] = applyDisplayMode([unknown], { display }, 'netflix_catalogue');
        assert.match(stream.title, /Audio non vérifié/);
        assert.doesNotMatch(stream.title, /VF ✓/);
        assert.strictEqual(stream.url, unknown.url);
        assert.ok(!Object.hasOwn(stream, '__unverifiedAudio'));
    }
    assert.deepStrictEqual(toAiomStreams([unknown]), []);
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

test('plateforme : détection Netflix / Apple TV d\'après la fiche TMDB', () => {
    assert.strictEqual(detectPlatform({ networks: [{ name: 'Netflix' }] }), 'netflix');
    assert.strictEqual(detectPlatform({ production_companies: [{ name: 'Netflix Animation' }] }), 'netflix');
    assert.strictEqual(detectPlatform({ networks: [{ name: 'Apple TV+' }] }), 'apple');
    assert.strictEqual(detectPlatform({ networks: [{ name: 'Apple TV' }] }), 'apple');
    assert.strictEqual(detectPlatform({ production_companies: [{ name: 'Apple Original Films' }, { name: 'Skydance' }] }), 'apple');
    assert.strictEqual(detectPlatform({ networks: [{ name: 'HBO' }], production_companies: [{ name: 'Legendary' }] }), 'max');
    assert.strictEqual(detectPlatform({}), null);
});

test('plateforme : le nom du flux suit la plateforme, VF par défaut', () => {
    assert.strictEqual(formatStreamName(), '🎬 VF');
    assert.match(formatStreamName('netflix'), /Netflix/);
    assert.match(formatStreamName('apple'), /Apple TV/);
    const out = buildPreviewStreams({ display: 'default' }, 'Severance', 'apple');
    assert.ok(out.every(s => /Apple TV/.test(s.name)));
    assert.match(out[1].name, /YouTube/);
});

test('disponibilité : marque pour les abonnements, VOD pour l’achat et la location', () => {
    assert.strictEqual(platformFromProviders({ flatrate: [{ provider_name: 'Netflix' }] }), 'netflix');
    assert.strictEqual(platformFromProviders({ flatrate: [{ provider_name: 'Netflix Standard with Ads' }] }), 'netflix');
    assert.strictEqual(platformFromProviders({ flatrate: [{ provider_name: 'Apple TV Plus' }] }), 'apple');
    assert.strictEqual(platformFromProviders({ flatrate: [{ provider_name: 'Apple TV' }] }), 'apple');
    assert.strictEqual(platformFromProviders({ flatrate: [{ provider_name: 'Disney Plus' }, { provider_name: 'Apple TV+' }] }), 'disney');
    // Les boutiques n'attribuent pas la marque d'un service par abonnement.
    assert.strictEqual(platformFromProviders({ rent: [{ provider_name: 'Apple TV' }], buy: [{ provider_name: 'Apple TV' }] }), 'vod');
    assert.strictEqual(platformFromProviders({ rent: [{ provider_name: 'Apple TV Store' }], buy: [{ provider_name: 'Apple TV Store' }] }), 'vod');
    assert.strictEqual(platformFromProviders({ flatrate: [{ provider_name: 'Canal+' }] }), 'canal');
    assert.strictEqual(platformFromProviders(undefined), null);
});
