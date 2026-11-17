const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-aiom-stats-'));
process.env.DATA_DIR = dataDir;
process.env.TMDB_API_KEY = 'c'.repeat(32);
process.env.DASHBOARD_PASSWORD = 'aiom-fixture';
process.env.TOKEN_SECRET = 'aiom-stats-fixture';
const sql = require('../lib/db');
const { ensureSchema } = require('../lib/migrate');
const { lastDays } = require('../lib/dates');
const app = require('../api');
let server, base, headers;

before(async () => {
    await ensureSchema();
    const days = lastDays(15), today = days[14], yesterday = days[13];
    for (const [day, outcome, count, hits, ms] of [
        [today, 'ytId', 12, 8, 1200], [today, 'url', 3, 1, 900], [today, 'aucun', 3, 1, 300],
        [today, 'timeout', 2, 0, 10000], [yesterday, 'ytId', 5, 0, 1000], [days[0], 'ytId', 100, 0, 1000],
    ]) {
        await sql`INSERT INTO aiom_stats (day, outcome, count, cache_hits, total_ms) VALUES (${day}, ${outcome}, ${count}, ${hits}, ${ms})`;
    }
    await sql`INSERT INTO event_logs (context, event, message) VALUES ('AIOM', 'aiom_request', 'Trailer trouvé')`;
    await sql`INSERT INTO event_logs (context, event, message) VALUES ('SYSTEM', 'fixture', 'Événement système')`;
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'aiom-fixture' }),
    }).then(response => response.json());
    headers = { 'x-admin-token': login.token };
});
after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    sql.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('statistiques AIOM : accès admin uniquement, présence de la clé sans sa valeur', async () => {
    assert.equal((await fetch(base + '/api/aiom-stats')).status, 401);
    const response = await fetch(base + '/api/aiom-stats', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const data = await response.json();
    assert.equal(data.tmdbConfigured, true);
    assert.equal(JSON.stringify(data).includes(process.env.TMDB_API_KEY), false);
});

test('statistiques AIOM : vrais compteurs sur 14 jours, indépendants du journal et lecture sans écriture', async () => {
    const before = await sql`SELECT * FROM aiom_stats ORDER BY day, outcome`;
    const data = await fetch(base + '/api/aiom-stats', { headers }).then(response => response.json());
    assert.equal(data.total, 25);
    assert.equal(data.today, 20);
    assert.equal(data.found, 20);
    assert.equal(data.hitRate, 80);
    assert.equal(data.avgMs, 536);
    assert.equal(data.cacheRate, 40);
    assert.equal(data.byOutcome.timeout, 2);
    assert.equal(data.days.length, 14);
    assert.equal(data.days.at(-1).count, 20);
    assert.equal(data.days.at(-2).count, 5);
    assert.equal(data.timeoutSeconds, 5);
    assert.equal(data.recent.length, 1);
    assert.equal(data.recent[0].context, 'AIOM');
    assert.deepEqual(await sql`SELECT * FROM aiom_stats ORDER BY day, outcome`, before);
});
