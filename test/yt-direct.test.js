const { after, before, beforeEach, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-yt-direct-'));
process.env.DATA_DIR = dataDir;
process.env.TOKEN_SECRET = 'fixture-token-secret';
process.env.APP_BASE_URL = 'https://addon.example';
process.env.TMDB_API_KEY = 'fixture-tmdb-key';
process.env.YT_DIRECT_INSTANCES = '';

// ---- Instances simulées ----
const fetched = [];
let invidious = 'ok';
let pipedUrl = 'https://proxy.example/videoplayback?id=1';
const security = require('../lib/security');
mock.method(security, 'safeFetch', async raw => {
    const url = new URL(raw);
    fetched.push(url.href);
    const down = { ok: false, status: 503, body: { destroy() {} } };
    if (url.host === 'inv.example') {
        if (invidious === 'down') return down;
        if (invidious === 'no-mp4') return { ok: true, status: 200, json: async () => ({ formatStreams: [{ itag: '43', container: 'webm', resolution: '360p' }] }) };
        return { ok: true, status: 200, json: async () => ({ formatStreams: [
            { itag: '18', container: 'mp4', type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', resolution: '360p' },
            { itag: '22', container: 'mp4', type: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"', resolution: '720p' },
            { itag: '43', container: 'webm', type: 'video/webm', resolution: '360p' },
        ] }) };
    }
    if (url.host === 'piped.example') {
        return { ok: true, status: 200, json: async () => ({ videoStreams: [
            { url: pipedUrl, mimeType: 'video/mp4', videoOnly: false, quality: '360p', height: 360 },
            { url: 'https://proxy.example/video-only', mimeType: 'video/mp4', videoOnly: true, quality: '1080p', height: 1080 },
        ] }) };
    }
    return down;
});
const probe = mock.method(require('../lib/media-link'), 'probeDirectLink', async () => ({ ok: true, media: 'mp4' }));

// Moteur de recherche VF simulé (utilisé par le repli de lib/aiom-direct.js).
mock.method(require('../lib/resolve-apis'), 'resolveViaApis', async () => ({
    streams: [{ name: 'VF', title: 'Bande-annonce\nFilm VF', ytId: 'cccccccccc1' }],
    officialTitle: 'Film VF',
}));

const ytDirect = require('../lib/yt-direct');
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { resolveAiomDirect, resolveSharedAiom } = require('../lib/aiom-direct');
const app = require('../api');
let server, base;

before(async () => {
    await ensureSchema();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
    process.env.YT_DIRECT_INSTANCES = '';
    invidious = 'ok';
    pipedUrl = 'https://proxy.example/videoplayback?id=1';
    fetched.length = 0;
    probe.mock.resetCalls();
    ytDirect.resetForTests();
});

test('sans configuration la fonction est désactivée et ne fait aucun appel réseau', async () => {
    assert.equal(ytDirect.isEnabled(), false);
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa1'), null);
    assert.equal(await ytDirect.resolvePlayableUrl('aaaaaaaaaa1'), null);
    assert.deepEqual(fetched, []);
});

test('la configuration accepte « auto », des préfixes de type et ignore les adresses non HTTPS', () => {
    assert.ok(ytDirect.parseInstances('auto').length >= 3);
    assert.deepEqual(ytDirect.parseInstances('https://a.example/, piped:https://b.example ,http://c.example, https://a.example'), [
        { type: 'invidious', base: 'https://a.example' },
        { type: 'piped', base: 'https://b.example' },
    ]);
    assert.deepEqual(ytDirect.parseInstances('off'), []);
    assert.deepEqual(ytDirect.parseInstances('https://user:pass@a.example'), []);
});

test('Invidious : prend le meilleur MP4 avec son, renvoie le lien proxifié et le met en cache', async () => {
    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    const found = await ytDirect.resolveYoutubeDirect('aaaaaaaaaa2');
    assert.deepEqual(found, {
        url: 'https://inv.example/latest_version?id=aaaaaaaaaa2&itag=22&local=true',
        height: 720, provider: 'https://inv.example',
    });
    assert.equal(probe.mock.calls[0].arguments[0], found.url);
    const calls = fetched.length;
    assert.deepEqual(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa2'), found);
    assert.equal(fetched.length, calls, 'le second appel vient du cache');
});

test('Piped : ignore les flux sans son et refuse un lien googlevideo lié à l’IP de l’instance', async () => {
    process.env.YT_DIRECT_INSTANCES = 'piped:https://piped.example';
    const found = await ytDirect.resolveYoutubeDirect('aaaaaaaaaa3');
    assert.equal(found.url, 'https://proxy.example/videoplayback?id=1');
    assert.equal(found.height, 360);

    pipedUrl = 'https://rr1---sn-abc.googlevideo.com/videoplayback?ip=1.2.3.4';
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa4'), null);
});

test('un lien que la vérification de lecture refuse est écarté', async () => {
    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    probe.mock.mockImplementationOnce(async () => ({ ok: false, media: null, error: 'Le serveur répond HTTP 403' }));
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa5'), null);
});

test('une instance en panne est contournée puis mise en pause ; un échec est mis en cache', async () => {
    process.env.YT_DIRECT_INSTANCES = 'https://inv.example,piped:https://piped.example';
    invidious = 'down';
    const found = await ytDirect.resolveYoutubeDirect('aaaaaaaaaa6');
    assert.equal(found.provider, 'https://piped.example');
    assert.ok(fetched.some(url => url.startsWith('https://inv.example/')));

    fetched.length = 0;
    await ytDirect.resolveYoutubeDirect('aaaaaaaaaa7');
    assert.ok(!fetched.some(url => url.startsWith('https://inv.example/')), 'instance en pause : plus sollicitée');

    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    ytDirect.resetForTests();
    invidious = 'no-mp4';
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa8'), null);
    fetched.length = 0;
    invidious = 'ok';
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa8'), null, 'échec mémorisé 10 min');
    assert.deepEqual(fetched, []);
});

test('une vidéo sans MP4 ne met pas l’instance en pause', async () => {
    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    invidious = 'no-mp4';
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaaaa9'), null);
    invidious = 'ok';
    assert.ok(await ytDirect.resolveYoutubeDirect('aaaaaaaab10'), 'l’instance répond encore pour une autre vidéo');
});

test('/ytd/ : lien signé, redirection 302 vers le MP4, signature et ID vérifiés', async () => {
    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    const signed = new URL(ytDirect.playbackUrl('bbbbbbbbbb1'));
    assert.match(signed.pathname, /^\/ytd\/bbbbbbbbbb1\.[A-Za-z0-9_-]{16}\.mp4$/);
    assert.equal(signed.origin, 'https://addon.example');

    const ok = await fetch(base + signed.pathname, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), 'https://inv.example/latest_version?id=bbbbbbbbbb1&itag=22&local=true');
    assert.equal(ok.headers.get('cache-control'), 'no-store');

    const forged = signed.pathname.replace(/\.[A-Za-z0-9_-]{16}\.mp4$/, '.AAAAAAAAAAAAAAAA.mp4');
    assert.equal((await fetch(base + forged, { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(base + '/ytd/pas-un-lien.mp4', { redirect: 'manual' })).status, 404);

    process.env.YT_DIRECT_INSTANCES = '';
    assert.equal((await fetch(base + signed.pathname, { redirect: 'manual' })).status, 404);
});

test('repli du moteur : la VF YouTube devient un lien direct, uniquement quand la fonction est active', async () => {
    const behavior = { cacheEnabled: false, youtubeEnabled: true, allocineFallback: false, netflixCatalogueUrl: '' };

    // Désactivé : comportement d'avant (aucun flux direct).
    assert.deepEqual((await resolveAiomDirect('movie', 'tt0000042', null, 'k', behavior, { allowHls: true })).streams, []);

    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    const direct = await resolveAiomDirect('movie', 'tt0000042', null, 'k', behavior, { allowHls: true });
    assert.equal(direct.provider, 'youtube_direct');
    assert.match(direct.streams[0].url, /^https:\/\/addon\.example\/ytd\/cccccccccc1\.[A-Za-z0-9_-]{16}\.mp4$/);
    assert.equal(direct.officialTitle, 'Film VF');

    // Désactivable pour un appel précis (la source externe convertit alors sa propre vidéo).
    const without = await resolveAiomDirect('movie', 'tt0000042', null, 'k', behavior, { allowHls: true, youtubeDirect: false });
    assert.deepEqual(without.streams, []);

    // YouTube coupé dans les réglages : rien n'est tenté.
    const off = await resolveAiomDirect('movie', 'tt0000042', null, 'k', { ...behavior, youtubeEnabled: false }, { allowHls: true });
    assert.deepEqual(off.streams, []);
});

test('lien partagé AIOMetadata : dernier recours après Allociné et Stockage BD', async () => {
    const behavior = { cacheEnabled: false, youtubeEnabled: true, allocineFallback: false, netflixCatalogueUrl: '' };
    const before = await resolveSharedAiom('movie', 'tt0000043', null, 'k', behavior, 5000);
    assert.deepEqual(before.streams, []);

    process.env.YT_DIRECT_INSTANCES = 'https://inv.example';
    const result = await resolveSharedAiom('movie', 'tt0000043', null, 'k', behavior, 5000);
    assert.equal(result.source, 'youtube_direct');
    assert.match(result.streams[0].url, /^https:\/\/addon\.example\/ytd\/cccccccccc1\./);
    assert.equal(result.pending, false);
});
