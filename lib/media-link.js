// ============================================================
// LIENS DIRECTS (.mp4 / .m3u8) du mapping.
//
// Le mapping accepte déjà une "URL directe" à côté du lien YouTube. Problèmes d'avant :
//  - le test ne faisait qu'un HEAD : beaucoup de CDN répondent 403/405 à un HEAD alors que le GET marche,
//    donc un lien parfaitement bon était déclaré mort (et sauté dans la chaîne de repli) ;
//  - aucun contrôle du contenu : coller une page web (Dailymotion, un article...) passait pour "jouable"
//    alors que Stremio ne peut rien en faire.
// Ici : un vrai GET sur les premiers octets, et on reconnaît le contenu (mp4 / playlist HLS / page web).
// ============================================================

const fetch = require('node-fetch');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function readHead(res, maxBytes) {
    const chunks = [];
    let n = 0;
    for await (const chunk of res.body) {
        chunks.push(chunk);
        n += chunk.length;
        if (n >= maxBytes) { if (res.body.destroy) res.body.destroy(); break; }
    }
    return Buffer.concat(chunks).slice(0, maxBytes);
}

// Renvoie { ok, media: 'mp4' | 'hls' | 'video' | null, error? }
async function probeDirectLink(url, timeoutMs = 6000) {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, media: null, error: 'Le lien doit commencer par http:// ou https://' };
    if (/(?:youtube\.com|youtu\.be)\//i.test(url)) return { ok: false, media: null, error: 'Lien YouTube : colle-le dans le champ « YouTube ID », pas ici' };
    if (/dailymotion\.com\/|dai\.ly\//i.test(url) && !/\.(mp4|m3u8)(\?|$)/i.test(url)) return { ok: false, media: null, error: 'Page Dailymotion : Stremio ne peut pas la lire. Il faut un lien direct .mp4 ou .m3u8' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-2047', Accept: '*/*' }, redirect: 'follow', signal: ctrl.signal });
        if (res.status !== 200 && res.status !== 206) {
            if (res.body && res.body.destroy) res.body.destroy();
            return { ok: false, media: null, error: `Le serveur répond HTTP ${res.status}` };
        }
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const head = await readHead(res, 2048);
        const text = head.toString('utf8', 0, 512);
        const extHls = /\.m3u8(\?|$)/i.test(url);
        const extMp4 = /\.mp4(\?|$)/i.test(url);

        if (text.trimStart().startsWith('#EXTM3U')) return { ok: true, media: 'hls' };
        if (head.length >= 12 && head.slice(4, 8).toString('latin1') === 'ftyp') return { ok: true, media: 'mp4' };
        if (ct.includes('mpegurl')) return { ok: false, media: null, error: 'Playlist HLS vide ou invalide' };
        if (ct.startsWith('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
            return { ok: false, media: null, error: 'C\'est une page web, pas une vidéo : il faut le lien direct .mp4 ou .m3u8' };
        }
        if (ct.startsWith('video/')) return { ok: true, media: ct.includes('mp4') ? 'mp4' : 'video' };
        // Type générique (octet-stream...) : on se fie à l'extension, sans pouvoir le confirmer.
        if (extMp4 || extHls) return { ok: true, media: extHls ? 'hls' : 'mp4' };
        return { ok: false, media: null, error: `Contenu non reconnu (${ct || 'type inconnu'}) : attendu .mp4 ou .m3u8` };
    } catch (err) {
        return { ok: false, media: null, error: err.name === 'AbortError' ? 'Le serveur met trop de temps à répondre' : 'Lien injoignable' };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { probeDirectLink };
