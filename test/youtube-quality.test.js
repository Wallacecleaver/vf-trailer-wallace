const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyYoutubeQualityToStreams, makeYoutubeProxyToken, verifyYoutubeProxyToken, parseByteRange } = require('../lib/youtube-quality');

test('qualité YouTube : remplace ytId par un relais local sans exposer l’URL Googlevideo', async () => {
    const streams = [
        { name: '🔴 Netflix', title: 'Bande-annonce\nBelow', ytId: 'abcdefghijk' },
        { name: '🔴 Netflix\n▶️ YouTube', title: 'Bande-annonce\nBelow', externalUrl: 'https://www.youtube.com/watch?v=abcdefghijk' },
        { name: '🎬 VF', title: 'Bande-annonce\nAutre film', url: 'https://cdn.example/video.mp4' },
    ];
    const calls = [];
    const out = await applyYoutubeQualityToStreams(streams, async (id, quality, options) => {
        calls.push({ id, quality, options });
        return { height: 720, container: 'mp4' };
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].id, 'abcdefghijk');
    assert.strictEqual(calls[0].quality, '1080p');
    assert.ok(out[0].url.includes('/youtube/'));
    assert.ok(!out[0].url.includes('googlevideo.com'));
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
                height: 720,
        container: 'webm',
    }));
    assert.ok(out[0].url.includes('/youtube/'));
    assert.deepStrictEqual(out[0].behaviorHints, { notWebReady: true });
});


test('relais YouTube : le jeton signé ne contient que le nécessaire et expire', () => {
    const token = makeYoutubeProxyToken('abcdefghijk', '1080p');
    assert.ok(token && token.includes('.'));
    assert.deepStrictEqual(verifyYoutubeProxyToken(token).ytId, 'abcdefghijk');
    assert.strictEqual(verifyYoutubeProxyToken(token + 'x'), null);
    assert.strictEqual(verifyYoutubeProxyToken('not-a-token'), null);
});

test('relais YouTube : les plages HTTP sont correctement interprétées', () => {
    assert.deepStrictEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepStrictEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 });
    assert.deepStrictEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
    assert.throws(() => parseByteRange('bytes=150-160', 100), { statusCode: 416 });
});
