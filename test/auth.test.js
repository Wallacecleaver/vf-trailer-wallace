const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-auth-'));
const password = 'mot-de-passe-fixture-long-et-unique';
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_PASSWORD = password;
delete process.env.TOKEN_SECRET;
delete process.env.SESSION_VERSION;
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { login, requireAuth, SESSION_DURATION_MS } = require('../lib/auth');
const { getTokenSecret } = require('../lib/session-secret');
const root = path.join(__dirname, '..');
let server, base, token;

before(async () => {
    await ensureSchema();
    const app = express();
    app.use(express.json());
    app.post('/api/login', login);
    app.get('/api/protected', requireAuth, (req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const response = await signIn(password);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    token = data.token;
    assert.equal(data.expiresIn, 30 * 24 * 60 * 60 * 1000);
    assert.equal(SESSION_DURATION_MS, 30 * 24 * 60 * 60 * 1000);
});
beforeEach(() => {
    delete process.env.TOKEN_SECRET;
    process.env.SESSION_VERSION = '1';
});
after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function signIn(value) {
    return fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }) });
}
function protectedRequest(value = token, headerName = 'x-admin-token') {
    const headers = {};
    if (value) headers[headerName] = headerName === 'authorization' ? 'Bearer ' + value : value;
    return fetch(base + '/api/protected', { headers });
}
function payload(value) { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url')); }
function signed(body, secret = getTokenSecret()) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    return `${header}.${encoded}.` + crypto.createHmac('sha256', secret).update(`${header}.${encoded}`).digest('base64url');
}

// Un nouveau processus ne peut pas réutiliser une clé gardée seulement en mémoire.
const childCheck = `
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { requireAuth } = require('./lib/auth');
let status = 200;
const res = { status(value) { status = value; return this; },
    setHeader() {}, json() { process.stdout.write(JSON.stringify({ status })); } };
requireAuth({ header: name => name === 'x-admin-token' ? input.token : null }, res, () => process.stdout.write(JSON.stringify({ status: 200 })));
`;
function checkInNewProcess(value, dir = dataDir) {
    return JSON.parse(execFileSync(process.execPath, ['-e', childCheck], {
        cwd: root, env: { ...process.env, DATA_DIR: dir }, input: JSON.stringify({ token: value }), encoding: 'utf8',
    }));
}

test('auth : session conservée après redémarrage, recréation sans volume partagé et via Bearer', async () => {
    const file = path.join(dataDir, 'dashboard-session-secret');
    const original = fs.readFileSync(file, 'utf8');
    assert.match(original.trim(), /^[a-f0-9]{64}$/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const res = await protectedRequest();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await protectedRequest(token, 'authorization')).status, 200);
    assert.equal(checkInNewProcess(token).status, 200);
    // Simule un nouveau conteneur Docker/WDock avec un DATA_DIR vierge (déploiement sans coupure ou sans volume).
    const freshContainerDir = fs.mkdtempSync(path.join(dataDir, 'redeploy-'));
    assert.equal(checkInNewProcess(token, freshContainerDir).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('auth : sessions déjà signées avec TOKEN_SECRET toujours compatibles', async () => {
    const file = path.join(dataDir, 'dashboard-session-secret');
    const original = fs.readFileSync(file, 'utf8');
    process.env.TOKEN_SECRET = 'secret-explicite-de-fixture';
    // Signature de l'ancien format, indépendante du générateur du nouveau code.
    const secret = crypto.createHash('sha256').update(process.env.TOKEN_SECRET).digest();
    const legacy = signed({ role: 'admin', ver: '1', iat: Date.now(), exp: Date.now() + 3600000 }, secret);
    assert.equal((await protectedRequest(legacy)).status, 200);
    assert.equal(checkInNewProcess(legacy).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('auth : une heure ne termine pas la session', async t => {
    t.mock.method(Date, 'now', () => payload(token).iat + 3600000);
    const response = await protectedRequest();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-admin-token'), null);
});

test('auth : renouvellement glissant dès 2h et ancien jeton expiré toujours refusé', async t => {
    let now = payload(token).iat + 7 * 3600000;
    t.mock.method(Date, 'now', () => now);
    const response = await protectedRequest();
    assert.equal(response.status, 200);
    const renewed = response.headers.get('x-admin-token');
    assert.ok(renewed);
    assert.equal(payload(renewed).exp, now + SESSION_DURATION_MS);
    now = payload(token).exp + 3600000;
    assert.equal((await protectedRequest(renewed)).status, 200);
    const expired = await protectedRequest(token);
    assert.equal(expired.status, 401);
    assert.equal(expired.headers.get('x-admin-token'), null);
});

test('auth : jetons absents, altérés, malformés et rôles incorrects refusés', async () => {
    const body = payload(token);
    for (const invalid of ['', 'invalide', token + '.suffixe', token.slice(0, -3) + 'xxx',
        signed({ ...body, role: 'visitor' }), signed({ ...body, exp: '9999999999999' }),
        signed({ ...body, exp: Date.now() - 1 })]) {
        assert.equal((await protectedRequest(invalid)).status, 401);
    }
});

test('auth : SESSION_VERSION révoque les sessions sans changer la clé persistante', async () => {
    const original = fs.readFileSync(path.join(dataDir, 'dashboard-session-secret'), 'utf8');
    process.env.SESSION_VERSION = '2';
    assert.equal((await protectedRequest()).status, 401);
    const response = await signIn(password);
    assert.equal(response.status, 200);
    const fresh = (await response.json()).token;
    assert.equal(payload(fresh).ver, '2');
    assert.equal((await protectedRequest(fresh)).status, 200);
    assert.equal(fs.readFileSync(path.join(dataDir, 'dashboard-session-secret'), 'utf8'), original);
});

test('auth : clé persistante corrompue, refus temporaire sans remplacement silencieux', () => {
    const dir = fs.mkdtempSync(path.join(dataDir, 'corrompu-'));
    const file = path.join(dir, 'dashboard-session-secret');
    fs.writeFileSync(file, 'fichier-a-ne-pas-ecraser');
    assert.equal(checkInNewProcess(token, dir).status, 503);
    assert.equal(fs.readFileSync(file, 'utf8'), 'fichier-a-ne-pas-ecraser');
});

test('auth : initialisation concurrente, une seule clé commune et aucun fichier temporaire résiduel', async () => {
    const dir = fs.mkdtempSync(path.join(dataDir, 'concurrent-'));
    const run = promisify(execFile);
    const script = "const crypto = require('crypto'); const { getTokenSecret } = require('./lib/session-secret'); process.stdout.write(crypto.createHash('sha256').update(getTokenSecret()).digest('hex'));";
    const results = await Promise.all(Array.from({ length: 4 }, () => run(process.execPath, ['-e', script], {
        cwd: root, env: { ...process.env, DATA_DIR: dir },
    })));
    assert.equal(new Set(results.map(result => result.stdout)).size, 1);
    assert.deepEqual(fs.readdirSync(dir), ['dashboard-session-secret']);
});

test('auth : un mot de passe incorrect reste refusé et les tentatives restent limitées', async () => {
    // Un succès remet d'abord le compteur de cette fixture à zéro.
    assert.equal((await signIn(password)).status, 200);
    for (let i = 0; i < 5; i++) {
        const response = await signIn('mauvais-mot-de-passe');
        assert.equal(response.status, 401);
        assert.ok(!('token' in await response.json()));
    }
    assert.equal((await signIn(password)).status, 429);
});

function loginInNewProcess(configured, supplied) {
    const script = `
const fs = require('node:fs');
console.log = () => {};
const { login } = require('./lib/auth');
let status = 200;
const res = { status(value) { status = value; return this; }, json(data) {
    process.stdout.write(JSON.stringify({ status, hasToken: typeof data.token === 'string' }));
    require('./lib/db').close();
} };
login({ body: JSON.parse(fs.readFileSync(0, 'utf8')), socket: { remoteAddress: '127.0.0.2' } }, res)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
`;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root,
        env: { ...process.env, DASHBOARD_PASSWORD: configured }, input: JSON.stringify({ password: supplied }), encoding: 'utf8' }));
}

test('auth : longueur libre, y compris un caractère et un mot de passe courant', () => {
    for (const value of ['x', '1234', 'court123', 'admin']) {
        assert.deepEqual(loginInNewProcess(value, value), { status: 200, hasToken: true });
    }
});

test('auth : mot de passe court incorrect, saisie vide et configuration vide toujours refusés', () => {
    assert.deepEqual(loginInNewProcess('1234', '1235'), { status: 401, hasToken: false });
    assert.deepEqual(loginInNewProcess('1234', ''), { status: 400, hasToken: false });
    assert.deepEqual(loginInNewProcess('', ''), { status: 503, hasToken: false });
});
