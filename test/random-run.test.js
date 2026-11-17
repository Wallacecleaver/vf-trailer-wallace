// Test du test aléatoire côté dashboard (dashboard/js/08b-random-run.js) avec un faux DOM et un faux réseau.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup({ titlesByCall, resolveFor }) {
    const els = {};
    const el = id => els[id] || (els[id] = { id, value: '', checked: true, hidden: false, disabled: false, textContent: '', innerHTML: '', style: {} });
    els['rt-count'] = Object.assign(el('rt-count'), { value: '6' });
    els['rt-type'] = Object.assign(el('rt-type'), { value: 'both' });
    els['rt-pool'] = Object.assign(el('rt-pool'), { value: 'popular' });
    let call = 0;
    const context = {
        document: { getElementById: el },
        SOURCE_LABELS: { tmdb: 'TMDB', allocine: 'Allociné', youtube_search: 'YouTube (recherche)' },
        TRACE_STEP_LABELS: { 'tmdb-videos': 'TMDB vidéos', allocine: 'Allociné' },
        authHeaders: h => h || {},
        escapeHtml: s => String(s),
        setTimeout, clearTimeout, Promise, Math, JSON, Date, Set, Object, Number, Array,
        authFetch: async (url, opts) => {
            if (url.startsWith('/api/random-titles')) {
                return { ok: true, status: 200, json: async () => ({ titles: titlesByCall[call++ % titlesByCall.length] }) };
            }
            const body = JSON.parse(opts.body);
            return { ok: true, status: 200, json: async () => resolveFor(body) };
        },
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dashboard/js/08b-random-run.js'), 'utf8')
        + '\n;this.__rt = () => rt;', context);
    return { context, els };
}

const mk = (n, type) => Array.from({ length: 4 }, (_, i) => ({ imdbId: `tt${type === 'movie' ? 1 : 2}${String(n * 10 + i).padStart(6, '0')}`, type, title: `T${n}${i}`, year: '2026' }));

test('agrège réussites, absences, erreurs, vidéos TMDB rejetées et doublons', async () => {
    const dup = mk(1, 'movie');
    const { context, els } = setup({
        titlesByCall: [dup, dup.concat(mk(2, 'series')), mk(3, 'movie'), mk(4, 'series')],
        resolveFor: body => {
            const n = Number(body.imdbId.slice(-3));
            if (n % 4 === 0) return { source: 'tmdb', streams: [{}], trace: [{ step: 'tmdb-videos', ok: true, detail: 'Vidéos globales (fr-FR): 1/1 retenue(s)' }] };
            if (n % 4 === 1) return { source: 'allocine', streams: [{}], trace: [{ step: 'tmdb-videos', ok: false, detail: 'Vidéos globales (fr-FR): 0/2 retenue(s)' }] };
            if (n % 4 === 2) return { source: null, streams: [], trace: [{ step: 'allocine', ok: false, detail: '' }] };
            return { error: 'boom', trace: [] };
        },
    });
    await context.startRandomTest();
    const rt = context.__rt();
    assert.strictEqual(rt.running, false);
    assert.strictEqual(rt.results.length, 6);
    assert.strictEqual(new Set(rt.results.map(r => r.imdbId)).size, 6, 'aucun doublon testé');
    assert.ok(rt.results.some(r => r.status === 'ok' && r.source === 'tmdb'));
    assert.ok(rt.results.some(r => r.tmdbSeen === 2 && r.tmdbKept === 0), 'vidéo TMDB rejetée repérée');
    const html = els['rt-results'].innerHTML;
    assert.ok(html.includes('Bande-annonce trouvée'));
    assert.ok(html.includes('Vidéo TMDB présente mais rejetée'));
    assert.ok(els['rt-progress-label'].textContent.includes('6 / 6'));
});
