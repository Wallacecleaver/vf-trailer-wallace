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
process.env.DASHBOARD_PASSWORD = 'yt-direct-fixture';

// ---- Instances simulées ----
const fetched = [];
let invidious = 'ok';
let pipedUrl = 'https://proxy.example/videoplayback?id=1';
let pipedProxy = 'https://proxy.example';
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
        return { ok: true, status: 200, json: async () => ({ proxyUrl: pipedProxy, videoStreams: [
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
let server, base, headers;

// Passe par la vraie route du dashboard (enregistrement SQL + application immédiate).
const save = body => fetch(base + '/api/settings/behavior', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

before(async () => {
    await ensureSchema();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'yt-direct-fixture' }),
    }).then(r => r.json());
    headers = { 'x-admin-token': login.token };
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
    await fetch(base + '/api/settings/behavior/reset', { method: 'POST', headers });
    process.env.YT_DIRECT_INSTANCES = '';
    invidious = 'ok';
    pipedUrl = 'https://proxy.example/videoplayback?id=1';
    pipedProxy = 'https://proxy.example';
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

test('Piped : ignore les flux sans son et passe les liens googlevideo par le proxy de l’instance', async () => {
    process.env.YT_DIRECT_INSTANCES = 'piped:https://piped.example';
    const found = await ytDirect.resolveYoutubeDirect('aaaaaaaaaa3');
    assert.equal(found.url, 'https://proxy.example/videoplayback?id=1');
    assert.equal(found.height, 360);

    // Lien googlevideo brut : réécrit comme le site Piped (hôte du proxy + paramètre host).
    pipedUrl = 'https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&itag=18';
    const proxied = await ytDirect.resolveYoutubeDirect('aaaaaaaaaa4');
    assert.equal(proxied.url, 'https://proxy.example/videoplayback?expire=1&itag=18&host=rr1---sn-abc.googlevideo.com');

    // Sans proxy utilisable, un lien googlevideo (lié à l'IP de l'instance) est refusé.
    ytDirect.resetForTests();
    pipedProxy = '';
    assert.equal(await ytDirect.resolveYoutubeDirect('aaaaaaaab11'), null);
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
    assert.deepEqual(await save({ ytDirectEnabled: true, ytDirectInstances: 'https://inv.example' }), { success: true });
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

    await save({ ytDirectEnabled: false });
    assert.equal((await fetch(base + signed.pathname, { redirect: 'manual' })).status, 404, 'désactivé depuis le dashboard');
});

test('dashboard : l’interrupteur active la liste automatique, le champ la remplace, la réinitialisation désactive', async () => {
    const read = () => fetch(base + '/api/settings/behavior', { headers }).then(r => r.json());
    const defaults = await read();
    assert.equal(defaults.ytDirectEnabled, false);
    assert.equal(defaults.ytDirectInstances, '');
    assert.equal(ytDirect.isEnabled(), false);

    await save({ ytDirectEnabled: true });                       // champ vide = liste automatique
    assert.equal(ytDirect.isEnabled(), true);
    assert.equal((await read()).ytDirectEnabled, true);

    await save({ ytDirectInstances: 'https://inv.example, piped:https://piped.example' });
    assert.equal((await read()).ytDirectInstances, 'https://inv.example, piped:https://piped.example');
    assert.equal((await ytDirect.resolveYoutubeDirect('dddddddddd1')).provider.startsWith('https://'), true);
    assert.ok(fetched.every(url => !/kavin\.rocks|leptons/.test(url)), 'la liste saisie remplace la liste automatique');

    await save({ ytDirectEnabled: false });
    assert.equal(ytDirect.isEnabled(), false);
    assert.equal((await read()).ytDirectInstances.length > 0, true, 'la liste saisie est conservée');

    await save({ ytDirectEnabled: true });
    await fetch(base + '/api/settings/behavior/reset', { method: 'POST', headers });
    assert.equal(ytDirect.isEnabled(), false);
});

test('dashboard : /api/yt-direct/test exige la connexion et vérifie chaque instance', async () => {
    const url = '/api/yt-direct/test?instances=' + encodeURIComponent('https://inv.example, piped:https://piped.example, https://mort.example');
    assert.equal((await fetch(base + url)).status, 401);
    const { results } = await fetch(base + url, { headers }).then(r => r.json());
    assert.equal(results.length, 3);
    const byHost = Object.fromEntries(results.map(r => [new URL(r.base).host, r]));
    assert.equal(byHost['inv.example'].ok, true);
    assert.equal(byHost['inv.example'].height, 720);
    assert.equal(byHost['piped.example'].ok, true);
    assert.equal(byHost['mort.example'].ok, false);
    assert.match(byHost['mort.example'].error, /503/);

    // Champ vide ou « auto » : la liste automatique est testée ; sans effet sur le cache ni sur la pause.
    fetched.length = 0;
    const auto = await fetch(base + '/api/yt-direct/test?instances=', { headers }).then(r => r.json());
    assert.ok(auto.results.length >= 3);
    assert.ok(auto.results.every(r => r.ok === false));
    assert.equal(ytDirect.isEnabled(), false, 'tester ne modifie pas le réglage');
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

test('Test des flux (mode AIOMetadata) : la VF YouTube est convertie en lecture directe, avec une étape dans la trace', async () => {
    const { testResolve } = require('../lib/resolver');
    const off = await testResolve('movie', 'tt0000044', null, true, true);
    assert.ok(off.streams[0].ytId, 'désactivé : lien YouTube comme avant');
    assert.ok(!off.trace.some(step => step.step === 'Lecture directe YouTube'));

    await save({ ytDirectEnabled: true, ytDirectInstances: 'https://inv.example' });
    const on = await testResolve('movie', 'tt0000044', null, true, true);
    assert.match(on.streams[0].url, /^https:\/\/addon\.example\/ytd\/cccccccccc1\./);
    assert.ok(on.streams.some(s => s.ytId), 'le lien YouTube reste en repli');
    assert.equal(on.trace.find(step => step.step === 'Lecture directe YouTube').ok, true);

    const plain = await testResolve('movie', 'tt0000044', null, true, false);
    assert.ok(!plain.streams.some(s => s.url && /\/ytd\//.test(s.url)), 'hors mode AIOMetadata : inchangé');
});

test('Test des flux : si la conversion échoue, la trace donne la raison de chaque instance', async () => {
    const { testResolve } = require('../lib/resolver');
    await save({ ytDirectEnabled: true, ytDirectInstances: 'https://inv.example' });
    invidious = 'no-mp4';
    await require('../lib/cache').setCached('cache:aiom-direct:yt:v1:cccccccccc1', { none: true }, 60); // purge du résultat des tests précédents
    const result = await testResolve('movie', 'tt0000045', null, true, true);
    assert.ok(result.streams[0].ytId && !result.streams[0].url);
    const step = result.trace.find(item => item.step === 'Lecture directe YouTube');
    assert.equal(step.ok, false);
    assert.match(step.detail, /cccccccccc1/);
    assert.match(step.detail, /inv\.example : aucun MP4 avec son/);
});
