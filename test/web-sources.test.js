// Tests du moteur de sources web (lib/web-sources.js) : extraction, garde-fous SSRF, vérification
// des liens, et résolution complète contre un FAUX site local (vraies pages, vrais .mp4/.m3u8).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const ws = require('../lib/web-sources');
const { buildRef } = require('../lib/title-match');

const duneRef = buildRef({ tmdbId: 1, year: '2024', allTitles: ['Dune : Deuxième partie', 'Dune: Part Two'], allPosterPaths: [] });

// ---------- extraction (fonction pure) ----------
test('extraction : JSON-LD, og:video, balise video, script échappé ; pubs et vidéos d\'ambiance écartées', () => {
    const html = `<html><head>
      <title>Dune : Deuxième partie - Bande-annonce VF</title>
      <meta property="og:video" content="https://cdn.example.com/og/dune-720.mp4">
      <script type="application/ld+json">{"@type":"VideoObject","name":"Dune 2 BA VF","contentUrl":"https://cdn.example.com/ld/dune-1080.mp4"}</script>
    </head><body>
      <video><source src="/media/local-trailer.mp4"></video>
      <video src="https://cdn.example.com/bg-loop.mp4"></video>
      <script>var cfg={"hls":"https:\\/\\/stream.example.com\\/hls\\/master.m3u8?t=1\\u0026k=2","ad":"https://ads.example.com/preroll.mp4","pix":"https://cdn.example.com/a.mp4.jpg"}</script>
    </body></html>`;
    const { candidates, titles } = ws.extractMedia(html, 'https://site.example.com/film/dune');
    const urls = candidates.map(c => c.url);
    assert.ok(urls.includes('https://cdn.example.com/ld/dune-1080.mp4'));
    assert.ok(urls.includes('https://cdn.example.com/og/dune-720.mp4'));
    assert.ok(urls.includes('https://site.example.com/media/local-trailer.mp4'), 'URL relative résolue');
    assert.ok(urls.includes('https://stream.example.com/hls/master.m3u8?t=1&k=2'), 'slashes et & échappés décodés');
    assert.ok(!urls.some(u => /preroll/.test(u)), 'pub écartée');
    assert.ok(!urls.some(u => /bg-loop/.test(u)), 'vidéo d\'ambiance écartée');
    assert.ok(!urls.some(u => /a\.mp4\.jpg/.test(u)), 'image déguisée écartée');
    assert.strictEqual(candidates[0].url, 'https://cdn.example.com/ld/dune-1080.mp4', 'JSON-LD 1080p en tête');
    assert.ok(titles.some(t => /Dune/.test(t)));
});

test('page : mauvais film, VO, VF obligatoire', () => {
    assert.strictEqual(ws.judgePage(['Oppenheimer - Bande-annonce'], 'https://x.fr/f', duneRef, false).ok, false);
    assert.strictEqual(ws.judgePage(['Dune : Deuxième partie - Bande-annonce VOSTFR'], 'https://x.fr/f', duneRef, false).ok, false);
    assert.strictEqual(ws.judgePage(['Dune : Deuxième partie - Bande-annonce'], 'https://x.fr/f', duneRef, true).ok, false);
    assert.strictEqual(ws.judgePage(['Dune : Deuxième partie - Bande-annonce VF'], 'https://x.fr/f', duneRef, true).ok, true);
    assert.strictEqual(ws.judgePage(['Dune 2 - Bande-annonce'], 'https://x.fr/f', duneRef, false).ok, true);
});

test('DuckDuckGo : résultats décodés (lien enveloppé uddg)', () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.exemple.fr%2Ffilm%2Fdune&amp;rut=abc">Dune : Deuxième partie - Bande-annonce VF</a></div>
                  <a class="result__a" href="https://autre.fr/x">Direct</a><a href="https://pub.com">Pas un résultat</a>`;
    const r = ws.parseDuckDuckGo(html);
    assert.deepStrictEqual(r.map(x => x.url), ['https://www.exemple.fr/film/dune', 'https://autre.fr/x']);
});

test('domaine nettoyé', () => {
    assert.strictEqual(ws.cleanDomain('https://www.Pathe.fr/films?x=1'), 'pathe.fr');
    assert.strictEqual(ws.cleanDomain('ugc.fr'), 'ugc.fr');
    assert.strictEqual(ws.cleanDomain('  '), '');
});

// ---------- SSRF ----------
test('SSRF : réseau privé, localhost, métadonnées cloud, identifiants, DNS piégé -> refusés', async () => {
    ws._setTestMode({ allowPrivate: false, lookup: async h => (h === 'piege.example' ? [{ address: '127.0.0.1' }] : [{ address: '93.184.216.34' }]) });
    try {
    for (const u of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.10/x', 'http://169.254.169.254/latest/meta-data',
        'http://172.16.0.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://user:pass@exemple.fr/x', 'ftp://exemple.fr/x', 'http://piege.example/x', 'http://nas.local/x', 'file:///etc/passwd',
        'http://[::ffff:10.0.0.1]/x', 'http://[::ffff:a9fe:a9fe]/x', 'http://[fd00::1]/x', 'http://[fe80::1]/x', 'http://[::]/x', 'http://[64:ff9b::7f00:1]/x', 'http://0.0.0.0/x', 'http://2130706433/x']) {
        await assert.rejects(() => ws.assertPublicUrl(u), undefined, u);
    }
    await assert.doesNotReject(() => ws.assertPublicUrl('https://www.exemple.fr/film'));
    await assert.doesNotReject(() => ws.assertPublicUrl('http://8.8.8.8/x'));
    assert.strictEqual(ws.isPrivateIp('100.64.1.1'), true);
    assert.strictEqual(ws.isPrivateIp('8.8.8.8'), false);
    assert.strictEqual(ws.isPrivateIp('2606:4700:4700::1111'), false, 'IPv6 publique autorisée');
    } finally { ws._setTestMode({ allowPrivate: true }); }
});

// ---------- résolution complète contre un faux site ----------
let server, base;
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(300)]);
before(async () => {
    server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
        const page = (title, inner) => `<html><head><title>${title}</title></head><body><h1>${title}</h1>${inner}</body></html>`;
        switch (u.pathname) {
            case '/recherche':
                return send(200, 'text/html', `<a href="/film/dune-2">Dune : Deuxième partie - Bande-annonce VF</a>
                    <a href="/film/autre">Oppenheimer - Bande-annonce</a><a href="/film/vide">Dune 2 (fiche sans vidéo)</a><a href="/film/referer">Dune: Part Two - extrait VF</a>`);
            case '/film/dune-2':
                return send(200, 'text/html', page('Dune : Deuxième partie - Bande-annonce VF',
                    `<video><source src="/media/dune2-trailer-720.mp4"></video><video src="/media/bg-loop.mp4"></video>`));
            case '/film/autre':
                return send(200, 'text/html', page('Oppenheimer - Bande-annonce', `<video src="/media/oppenheimer.mp4"></video>`));
            case '/film/vide':
                return send(200, 'text/html', page('Dune 2 - Bande-annonce VF', '<p>Lecteur chargé en JavaScript</p>'));
            case '/film/referer':
                return send(200, 'text/html', page('Dune: Part Two - extrait VF', `<script>var u="http:\\/\\/${req.headers.host}\\/media\\/protege\\/master.m3u8"</script>`));
            case '/media/dune2-trailer-720.mp4':
                return send(206, 'video/mp4', mp4);
            case '/media/protege/master.m3u8':
                if (!/\/film\/referer$/.test(req.headers.referer || '')) return send(403, 'text/plain', 'interdit');
                return send(200, 'application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-VERSION:3\n');
            case '/media/oppenheimer.mp4':
                return send(206, 'video/mp4', mp4);
            default:
                return send(404, 'text/plain', 'nope');
        }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    ws._setTestMode({ allowPrivate: true });
});
after(() => { server.close(); ws._setTestMode({ allowPrivate: false }); });

const source = (extra = {}) => ({ id: 's1', name: 'Faux site', searchUrl: `${base}/recherche?q={query}`, enabled: true, ...extra });

test('résolution : bonne page, mp4 vérifié, vidéo d\'ambiance et mauvais film ignorés', async () => {
    const { hit, trace } = await ws.resolveWebSources({ title: 'Dune : Deuxième partie', year: 2024, ref: duneRef, sources: [source()] });
    assert.ok(hit, JSON.stringify(trace, null, 1));
    assert.strictEqual(hit.url, `${base}/media/dune2-trailer-720.mp4`);
    assert.strictEqual(hit.kind, 'mp4');
    assert.strictEqual(hit.needsReferer, false);
    assert.ok(!trace.some(t => /oppenheimer/i.test(t.detail) && t.ok), 'la page du mauvais film n\'est jamais retenue');
});

test('résolution : lien HLS protégé par Referer -> trouvé avec en-têtes proxy', async () => {
    const onlyReferer = { ...source(), searchUrl: `${base}/recherche?q={query}`, linkPattern: 'referer' };
    const { hit } = await ws.resolveWebSources({ title: 'Dune : Deuxième partie', year: 2024, ref: duneRef, sources: [onlyReferer] });
    assert.ok(hit);
    assert.strictEqual(hit.kind, 'hls');
    assert.strictEqual(hit.needsReferer, true);
    const stream = ws.buildWebStream(hit, 'Dune 2');
    assert.strictEqual(stream.url, hit.url);
    assert.strictEqual(stream.behaviorHints.notWebReady, true);
    assert.ok(/\/film\/referer$/.test(stream.behaviorHints.proxyHeaders.request.Referer));
});

test('résolution : page sans lien vidéo -> rien, avec une explication dans la trace', async () => {
    const onlyEmpty = source({ linkPattern: 'vide' });
    const { hit, trace } = await ws.resolveWebSources({ title: 'Dune : Deuxième partie', year: 2024, ref: duneRef, sources: [onlyEmpty] });
    assert.strictEqual(hit, null);
    assert.ok(trace.some(t => /aucun lien \.mp4\/\.m3u8/.test(t.detail)));
});

test('résolution : aucune source activée -> rien, sans erreur', async () => {
    const r = await ws.resolveWebSources({ title: 'Dune', ref: duneRef, sources: [source({ enabled: false })] });
    assert.strictEqual(r.hit, null);
});

test('résolution : film inconnu du site -> rien (pas de mauvais film)', async () => {
    const other = buildRef({ tmdbId: 2, year: '1999', allTitles: ['Le Dîner de cons'], allPosterPaths: [] });
    const { hit } = await ws.resolveWebSources({ title: 'Le Dîner de cons', year: 1999, ref: other, sources: [source()] });
    assert.strictEqual(hit, null);
});

test('résolution : budget dépassé -> rend la main à temps', async () => {
    const slow = http.createServer((req, res) => { setTimeout(() => { res.writeHead(200); res.end('<a href="/x">Dune</a>'); }, 4000); });
    await new Promise(r => slow.listen(0, '127.0.0.1', r));
    const s = { id: 'slow', name: 'Lent', searchUrl: `http://127.0.0.1:${slow.address().port}/?q={query}`, enabled: true };
    const t0 = Date.now();
    const { hit } = await ws.resolveWebSources({ title: 'Dune', ref: duneRef, sources: [s], budgetMs: 600 });
    slow.closeAllConnections && slow.closeAllConnections();
    slow.close();
    assert.strictEqual(hit, null);
    assert.ok(Date.now() - t0 < 2500, 'doit rendre la main près du budget');
});
