const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyYoutubeQualityToStreams } = require('../lib/youtube-quality');

test('qualité YouTube : remplace ytId par le meilleur flux direct disponible', async () => {
    const streams = [
        { name: '🔴 Netflix', title: 'Bande-annonce\nBelow', ytId: 'video123' },
        { name: '🔴 Netflix\n▶️ YouTube', title: 'Bande-annonce\nBelow', externalUrl: 'https://www.youtube.com/watch?v=video123' },
        { name: '🎬 VF', title: 'Bande-annonce\nAutre film', url: 'https://cdn.example/video.mp4' },
    ];
    const calls = [];
    const out = await applyYoutubeQualityToStreams(streams, async (id, quality, options) => {
        calls.push({ id, quality, options });
        return { url: 'https://rr.example.googlevideo.com/video.mp4', height: 720, container: 'mp4' };
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].id, 'video123');
    assert.strictEqual(calls[0].quality, '1080p');
    assert.strictEqual(calls[0].options.allowRetry, false);
    assert.strictEqual(out[0].url, 'https://rr.example.googlevideo.com/video.mp4');
    assert.strictEqual(out[0].__quality, 720);
    assert.ok(!('ytId' in out[0]));
    assert.strictEqual(out[1], streams[1]);
    assert.strictEqual(out[2], streams[2]);
    assert.ok('ytId' in streams[0], 'la liste d’entrée ne doit pas être modifiée');
});

test('qualité YouTube : conserve le lecteur natif si l’extraction échoue', async () => {
    const original = { name: '🎬 VF', title: 'Bande-annonce\nBelow', ytId: 'blocked123' };
    const out = await applyYoutubeQualityToStreams([original], async () => null);
    assert.strictEqual(out[0], original);
    assert.strictEqual(out[0].ytId, 'blocked123');
    assert.ok(!out[0].url);
});

test('qualité YouTube : indique notWebReady pour un format non MP4', async () => {
    const original = { name: '🎬 VF', title: 'Bande-annonce\nBelow', ytId: 'webm123' };
    const out = await applyYoutubeQualityToStreams([original], async () => ({
        url: 'https://rr.example.googlevideo.com/video.webm',
        height: 720,
        container: 'webm',
    }));
    assert.strictEqual(out[0].url, 'https://rr.example.googlevideo.com/video.webm');
    assert.deepStrictEqual(out[0].behaviorHints, { notWebReady: true });
});
