const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-ytdlp-'));
process.env.DATA_DIR = dataDir;
process.env.TOKEN_SECRET = 'fixture-token-secret';
process.env.APP_BASE_URL = 'https://addon.example';
process.env.TMDB_API_KEY = 'fixture-tmdb-key';
process.env.YT_DIRECT_INSTANCES = '';
process.env.DASHBOARD_PASSWORD = 'yt-dlp-fixture';

// Faux yt-dlp : écrit un MP4 factice, ou échoue selon l'identifiant demandé.
const fake = path.join(dataDir, 'fake-yt-dlp.js');
const callsLog = path.join(dataDir, 'calls.log');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsLog)}, args.join(' ') + '\\n');
const url = args[args.length - 1];
if (/botbotbot01/.test(url)) { console.error('ERROR: [youtube] botbotbot01: Sign in to confirm you’re not a bot'); process.exit(1); }
if (/privateeee1/.test(url)) { console.error('ERROR: [youtube] privateeee1: Private video. Sign in if you\\'ve been granted access'); process.exit(1); }
if (args.includes('--simulate')) { console.log('720'); process.exit(0); }
fs.writeFileSync(args[args.indexOf('-o') + 1], Buffer.from('0123456789abcdefghij'));
`, { mode: 0o755 });
process.env.YTDLP_BIN = fake;

const ytdlp = require('../lib/yt-dlp');
const ytDirect = require('../lib/yt-direct');
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const app = require('../api');
let server, base, headers;

const save = body => fetch(base + '/api/settings/behavior', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

before(async () => {
    await ensureSchema();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'yt-dlp-fixture' }),
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
    ytdlp.resetForTests();
    ytDirect.resetForTests();
});

test('cookies : seuls YouTube/Google sont gardés, le fichier est privé et le statut ne révèle rien', () => {
    const tab = (...c) => c.join('\t');
    const text = [
        '# Netscape HTTP Cookie File',
        tab('.youtube.com', 'TRUE', '/', 'TRUE', '2000000000', '__Secure-3PSID', 'secretvalue'),
        tab('#HttpOnly_.google.com', 'TRUE', '/', 'TRUE', '2000000000', 'SAPISID', 'another'),
        tab('.autre-site.com', 'TRUE', '/', 'TRUE', '2000000000', 'session', 'nope'),
        'ligne invalide',
    ].join('\r\n');
    const saved = ytdlp.saveCookies(text);
    assert.deepEqual(saved, { count: 2, hasAuth: true });
    const stored = fs.readFileSync(ytdlp.cookiesFile(), 'utf8');
    assert.ok(!stored.includes('autre-site'));
    assert.equal(fs.statSync(ytdlp.cookiesFile()).mode & 0o077, 0);
    assert.throws(() => ytdlp.saveCookies('n’importe quoi'), /Aucun cookie/);
    ytdlp.deleteCookies();
    assert.equal(ytdlp.cookiesStatus().present, false);
});

test('dashboard : les routes de cookies exigent la connexion et ne renvoient jamais les cookies', async () => {
    assert.equal((await fetch(base + '/api/yt-direct/cookies')).status, 401);
    const line = ['.youtube.com', 'TRUE', '/', 'TRUE', '2000000000', 'LOGIN_INFO', 'topsecret'].join('\t');
    const post = await fetch(base + '/api/yt-direct/cookies', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ cookies: line }),
    });
    assert.equal(post.status, 200);
    const body = await post.text();
    assert.ok(!body.includes('topsecret'));
    assert.equal(JSON.parse(body).hasAuth, true);
    const bad = await fetch(base + '/api/yt-direct/cookies', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ cookies: 'rien' }),
    });
    assert.equal(bad.status, 400);
    const del = await fetch(base + '/api/yt-direct/cookies', { method: 'DELETE', headers }).then(r => r.json());
    assert.equal(del.present, false);
});

test('getFile : télécharge une fois, réutilise le cache, passe les cookies et déduplique les appels', async () => {
    fs.writeFileSync(callsLog, '');
    ytdlp.saveCookies(['.youtube.com', 'TRUE', '/', 'TRUE', '2000000000', 'LOGIN_INFO', 'x'].join('\t'));
    const [a, b] = await Promise.all([ytdlp.getFile('aaaaaaaaaa1'), ytdlp.getFile('aaaaaaaaaa1')]);
    assert.equal(a, b);
    assert.equal(fs.readFileSync(a).length, 20);
    await ytdlp.getFile('aaaaaaaaaa1');
    const calls = fs.readFileSync(callsLog, 'utf8').trim().split('\n');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /--cookies/);
    assert.match(calls[0], /--max-filesize 80M/);
    ytdlp.deleteCookies();
});

test('erreurs : blocage « pas un robot » = panne d’instance mémorisée ; vidéo privée = erreur propre à la vidéo', async () => {
    await assert.rejects(ytdlp.getFile('botbotbot01'), /cookies d’un compte Google jetable/);
    fs.writeFileSync(callsLog, '');
    await assert.rejects(ytdlp.getFile('botbotbot01'), /cookies/); // échec mémorisé : pas de nouvel appel
    assert.equal(fs.readFileSync(callsLog, 'utf8'), '');
    await assert.rejects(ytdlp.getFile('privateeee1'), err => err instanceof ytdlp.VideoError);
});

test('/ytd/ avec « ytdlp » : sert le MP4 du disque avec lecture partielle (Range)', async () => {
    await save({ ytDirectEnabled: true, ytDirectInstances: 'ytdlp' });
    assert.deepEqual(ytDirect.parseInstances('ytdlp'), [{ type: 'ytdlp', base: 'ytdlp' }]);
    const playable = await ytDirect.resolvePlayableUrl('bbbbbbbbbb1');
    assert.match(playable, /^https:\/\/addon\.example\/ytd\/bbbbbbbbbb1\.[\w-]{16}\.mp4$/);
    const pathPart = new URL(playable).pathname;
    const full = await fetch(base + pathPart);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal((await full.arrayBuffer()).byteLength, 20);
    const part = await fetch(base + pathPart, { headers: { Range: 'bytes=0-3' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '0123');
});

test('la lecture directe retombe sur le YouTube d’origine quand yt-dlp échoue', async () => {
    await save({ ytDirectEnabled: true, ytDirectInstances: 'ytdlp' });
    assert.equal(await ytDirect.resolvePlayableUrl('botbotbot01'), null);
});

test('Tester : vérifie yt-dlp sans rien télécharger', async () => {
    const res = await fetch(base + '/api/yt-direct/test?instances=ytdlp', { headers }).then(r => r.json());
    assert.equal(res.results[0].ok, true);
    assert.equal(res.results[0].height, 720);
    assert.equal(res.results[0].type, 'ytdlp');
});
