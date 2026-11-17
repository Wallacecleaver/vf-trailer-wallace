// Lien AIOMetadata partagé : /aiom/manifest.json (sans config dans l'URL).
process.env.DATA_DIR = process.env.DATA_DIR || require('node:os').tmpdir() + '/vf-aiom-test';
require('node:fs').mkdirSync(process.env.DATA_DIR, { recursive: true });
process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'test';
delete process.env.TMDB_API_KEY;

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const app = require('../api/index.js');

function withServer(fn) {
    return new Promise((resolve, reject) => {
        const srv = http.createServer(app).listen(0, async () => {
            try { await fn(`http://127.0.0.1:${srv.address().port}`); resolve(); }
            catch (e) { reject(e); } finally { srv.close(); }
        });
    });
}

test('manifest AIOM partagé : statique, sans config, resource stream uniquement', () => withServer(async base => {
    const r = await fetch(`${base}/aiom/manifest.json`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
    const m = await r.json();
    assert.deepStrictEqual(m.resources, ['stream']);
    assert.deepStrictEqual(m.catalogs, []);
    assert.ok(!m.behaviorHints, 'pas de bouton Configure : un seul lien pour tous');
}));

test('stream AIOM partagé : liste vide (sans erreur) si TMDB_API_KEY serveur absente', () => withServer(async base => {
    const r = await fetch(`${base}/aiom/stream/movie/tt0111161.json`);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), { streams: [] });
}));

test("l'ancien lien /<config>/manifest.json continue de fonctionner", () => withServer(async base => {
    const m = await (await fetch(`${base}/manifest.json`)).json();
    assert.strictEqual(m.id, 'org.vftrailers');
    assert.strictEqual(m.behaviorHints.configurationRequired, true);
}));
