// Tests du contrôle des liens directs .mp4 / .m3u8 du mapping (lib/media-link.js)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { probeDirectLink } = require('../lib/media-link');

let server, base;
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(300)]);
before(async () => {
    server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
        switch (u.pathname) {
            case '/film.mp4': return send(206, 'video/mp4', mp4);
            case '/generique': return send(200, 'application/octet-stream', mp4);                // type générique, mais vrai mp4
            case '/master.m3u8': return send(200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n');
            case '/liste': return send(200, 'text/plain', '#EXTM3U\n');                          // playlist servie sans type HLS
            case '/page': return send(200, 'text/html; charset=utf-8', '<!DOCTYPE html><html><body>Une page</body></html>');
            case '/mort.mp4': return send(404, 'text/plain', 'nope');
            case '/refuse-head.mp4': return req.method === 'HEAD' ? send(405, 'text/plain', '') : send(206, 'video/mp4', mp4);
            case '/redirige.mp4': return send(302, 'text/plain', '', { Location: '/film.mp4' });
            case '/vide.m3u8': return send(200, 'application/x-mpegurl', 'rien');
            case '/lent.mp4': return setTimeout(() => send(200, 'video/mp4', mp4), 1500);
            case '/inconnu': return send(200, 'image/png', Buffer.alloc(100));
            default: return send(404, 'text/plain', 'nope');
        }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); });

test('vrai mp4 reconnu (par le contenu, même servi en octet-stream)', async () => {
    assert.deepStrictEqual(await probeDirectLink(`${base}/film.mp4`), { ok: true, media: 'mp4' });
    assert.deepStrictEqual(await probeDirectLink(`${base}/generique`), { ok: true, media: 'mp4' });
});

test('playlist HLS (.m3u8) reconnue, même sans le bon type MIME', async () => {
    assert.deepStrictEqual(await probeDirectLink(`${base}/master.m3u8`), { ok: true, media: 'hls' });
    assert.deepStrictEqual(await probeDirectLink(`${base}/liste`), { ok: true, media: 'hls' });
});

test('page web collée à la place d\'une vidéo -> refusée avec une explication', async () => {
    const r = await probeDirectLink(`${base}/page`);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /page web/);
});

test('lien mort, playlist invalide, type inconnu -> refusés', async () => {
    assert.strictEqual((await probeDirectLink(`${base}/mort.mp4`)).ok, false);
    assert.match((await probeDirectLink(`${base}/mort.mp4`)).error, /404/);
    assert.strictEqual((await probeDirectLink(`${base}/vide.m3u8`)).ok, false);
    assert.strictEqual((await probeDirectLink(`${base}/inconnu`)).ok, false);
});

test('serveur qui refuse HEAD mais sert le GET : le lien est bon', async () => {
    assert.strictEqual((await probeDirectLink(`${base}/refuse-head.mp4`)).ok, true);
});

test('redirection suivie', async () => {
    assert.deepStrictEqual(await probeDirectLink(`${base}/redirige.mp4`), { ok: true, media: 'mp4' });
});

test('trop lent -> échec propre (timeout)', async () => {
    const r = await probeDirectLink(`${base}/lent.mp4`, 300);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /trop de temps/);
});

test('mauvaises saisies : pas http, lien YouTube, page Dailymotion', async () => {
    assert.strictEqual((await probeDirectLink('ftp://x/y.mp4')).ok, false);
    assert.match((await probeDirectLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).error, /YouTube ID/);
    assert.match((await probeDirectLink('https://www.dailymotion.com/video/x8abc12')).error, /Dailymotion/);
});
