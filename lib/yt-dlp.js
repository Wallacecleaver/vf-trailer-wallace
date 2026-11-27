// ============================================================
// yt-dlp intégré : télécharge UNE FOIS la bande-annonce YouTube sur le VPS (MP4 avec son, ≤ 720p),
// la garde en cache disque, puis la sert au lecteur (Odin, Nuvio…) via /ytd/…, avec lecture partielle (Range).
//
// Pourquoi télécharger : YouTube lie les liens vidéo à l'IP qui les demande. Un lien obtenu par le VPS
// n'est pas lisible depuis un téléphone ; la vidéo doit donc passer par le VPS. Une bande-annonce fait
// quelques Mo et reste en cache : la charge est faible.
//
// Garde-fous : un seul yt-dlp à la fois (file de 3 au maximum), 90 s maximum par téléchargement,
// fichiers ≤ 80 Mo, cache disque plafonné (400 Mo, 12 h), échec mémorisé 10 min, mise à jour de yt-dlp
// automatique une fois par jour. Les IP de serveurs sont souvent bloquées par YouTube : fournir les cookies
// d'un compte Google JETABLE (dashboard > Réglages) règle presque toujours le problème.
//
// Activation : mettre « ytdlp » dans le champ des instances du dashboard (Lecture directe YouTube).
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BIN = process.env.YTDLP_BIN || 'yt-dlp';
const EXTRA_ARGS = String(process.env.YTDLP_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const CHECK_TIMEOUT_MS = 40_000;
const FILE_TTL_MS = 12 * 3600 * 1000;
const MAX_CACHE_BYTES = 400 * 1024 * 1024;
const MAX_FILE_MB = 80;
const FAIL_TTL_MS = 10 * 60 * 1000;
const MAX_QUEUE = 3;
const UPDATE_EVERY_MS = 24 * 3600 * 1000;
// MP4 « vidéo + son » en HTTPS direct uniquement : les flux HLS (m3u8) donneraient, sans ffmpeg, un fichier
// .mp4 illisible (MPEG-TS brut).
const FORMAT = 'b[ext=mp4][protocol=https][height<=720]/b[ext=mp4][protocol=https]';

class VideoError extends Error {}

function dataDir() {
    if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
    return path.resolve(fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data'));
}
const cacheDir = () => path.join(dataDir(), 'ytdlp-cache');
const cookiesFile = () => path.join(dataDir(), 'youtube-cookies.txt');
const fileFor = id => path.join(cacheDir(), `${id}.mp4`);

// ---- Cookies (fichier Netscape, jamais renvoyé au navigateur) ----
function normalizeCookies(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const kept = [];
    let hasAuth = false;
    for (const raw of lines) {
        const line = raw.replace(/^\s+/, '');
        if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
        const parts = line.split('\t');
        if (parts.length < 7) continue;
        const domain = parts[0].replace(/^#HttpOnly_/, '').toLowerCase();
        if (!/(^|\.)(youtube\.com|google\.com|youtube-nocookie\.com)$/.test(domain)) continue; // rien d'autre n'est conservé
        if (/^(__Secure-)?(1|3)PSID$|^SAPISID$|^LOGIN_INFO$/.test(parts[5])) hasAuth = true;
        kept.push(parts.slice(0, 7).join('\t'));
    }
    return { content: kept.length ? `# Netscape HTTP Cookie File\n${kept.join('\n')}\n` : '', count: kept.length, hasAuth };
}

function saveCookies(text) {
    const parsed = normalizeCookies(text);
    if (!parsed.count) throw new Error('Aucun cookie YouTube/Google valide (format Netscape « cookies.txt » attendu)');
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(cookiesFile(), parsed.content, { mode: 0o600 });
    return { count: parsed.count, hasAuth: parsed.hasAuth };
}

function deleteCookies() {
    try { fs.unlinkSync(cookiesFile()); } catch { /* déjà absent */ }
}

function cookiesStatus() {
    try {
        const stat = fs.statSync(cookiesFile());
        const parsed = normalizeCookies(fs.readFileSync(cookiesFile(), 'utf8'));
        return { present: true, count: parsed.count, hasAuth: parsed.hasAuth, updatedAt: stat.mtime.toISOString() };
    } catch { return { present: false, count: 0, hasAuth: false }; }
}

// ---- Exécution de yt-dlp ----
function baseArgs() {
    const args = ['--no-playlist', '--no-warnings', '--no-color', '--socket-timeout', '15', '--retries', '2',
        '--js-runtimes', 'node', '-f', FORMAT];
    if (fs.existsSync(cookiesFile())) {
        // yt-dlp réécrit parfois le fichier de cookies : on lui donne une copie, l'original reste intact.
        const copy = path.join(dataDir(), 'youtube-cookies.run.txt');
        try { fs.copyFileSync(cookiesFile(), copy); fs.chmodSync(copy, 0o600); args.push('--cookies', copy); } catch { /* sans cookies */ }
    }
    return [...args, ...EXTRA_ARGS];
}

// Traduit la sortie d'erreur de yt-dlp en message lisible ; VideoError = problème propre à la vidéo.
function explain(stderr, code) {
    const text = String(stderr || '');
    const last = text.split('\n').filter(l => /ERROR/i.test(l)).pop() || text.trim().split('\n').pop() || `code ${code}`;
    const clean = last.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/i, '').slice(0, 140);
    if (/Video unavailable|Private video|has been removed|not available in your country|members-only|age-restricted|Premieres in|live event|This video is not available/i.test(text)
        && !/Sign in to confirm|not a bot/i.test(text)) return new VideoError(clean);
    if (/Sign in to confirm|not a bot|cookies/i.test(text)) return new Error('YouTube bloque l’IP : ajoute les cookies d’un compte Google jetable (' + clean.slice(0, 60) + ')');
    if (/Requested format is not available/i.test(text)) return new VideoError('aucun MP4 avec son disponible');
    return new Error(clean);
}

function run(args, timeoutMs) {
    return new Promise((resolve, reject) => {
        let child;
        try { child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { return reject(err); }
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('délai dépassé')); }, timeoutMs);
        child.stdout.on('data', d => { if (out.length < 20000) out += d; });
        child.stderr.on('data', d => { if (err.length < 20000) err += d; });
        child.on('error', e => {
            clearTimeout(timer);
            reject(e.code === 'ENOENT' ? new Error('yt-dlp n’est pas installé dans l’image (redéploie la dernière version)') : e);
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve({ out, err });
            else reject(explain(err, code));
        });
    });
}

// ---- Mise à jour quotidienne (au mieux : sans effet si le binaire n'est pas modifiable) ----
let lastUpdate = 0;
function maybeUpdate() {
    if (Date.now() - lastUpdate < UPDATE_EVERY_MS) return;
    lastUpdate = Date.now();
    run(['-U'], 60_000).catch(() => { /* ignoré */ });
}

// ---- Cache disque ----
function listCache() {
    try {
        return fs.readdirSync(cacheDir()).filter(n => n.endsWith('.mp4')).map(name => {
            const file = path.join(cacheDir(), name);
            const st = fs.statSync(file);
            return { file, size: st.size, mtime: st.mtimeMs };
        });
    } catch { return []; }
}

function prune() {
    const now = Date.now();
    let entries = listCache();
    for (const e of entries) if (now - e.mtime > FILE_TTL_MS) { try { fs.unlinkSync(e.file); } catch { /* ignoré */ } }
    entries = listCache().sort((a, b) => a.mtime - b.mtime);
    let total = entries.reduce((n, e) => n + e.size, 0);
    for (const e of entries) {
        if (total <= MAX_CACHE_BYTES * 0.8) break;
        try { fs.unlinkSync(e.file); total -= e.size; } catch { /* ignoré */ }
    }
    // Restes de téléchargements interrompus
    try {
        for (const name of fs.readdirSync(cacheDir())) {
            if (/\.(part|ytdl|temp)/.test(name)) {
                const f = path.join(cacheDir(), name);
                if (now - fs.statSync(f).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(f);
            }
        }
    } catch { /* dossier absent */ }
}

// Un vrai MP4 commence par une boîte « ftyp » (octets 4 à 8) ; sinon le fichier est inutilisable.
function isMp4(file) {
    try {
        const fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(8);
        fs.readSync(fd, head, 0, 8, 0);
        fs.closeSync(fd);
        return head.toString('latin1', 4, 8) === 'ftyp';
    } catch { return false; }
}

function freshFile(id) {
    try {
        const st = fs.statSync(fileFor(id));
        if (st.size > 0 && Date.now() - st.mtimeMs < FILE_TTL_MS && isMp4(fileFor(id))) return fileFor(id);
    } catch { /* absent */ }
    return null;
}

// ---- File d'attente : un téléchargement à la fois ----
const failed = new Map();    // id -> { until, error }
const inflight = new Map();  // id -> promesse
let chain = Promise.resolve();
let waiting = 0;

async function download(id) {
    maybeUpdate();
    fs.mkdirSync(cacheDir(), { recursive: true });
    prune();
    const target = fileFor(id);
    try {
        await run([...baseArgs(), '--max-filesize', `${MAX_FILE_MB}M`, '--no-mtime', '--force-overwrites',
            '-o', target, '--', `https://www.youtube.com/watch?v=${id}`], DOWNLOAD_TIMEOUT_MS);
    } catch (err) {
        try { fs.unlinkSync(target); } catch { /* ignoré */ }
        throw err;
    }
    if (!freshFile(id)) {
        try { fs.unlinkSync(target); } catch { /* ignoré */ }
        throw new Error('fichier téléchargé illisible (format non MP4)');
    }
    return target;
}

/** Chemin du MP4 en cache (le télécharge si besoin) ; lève une erreur si impossible. */
function getFile(id) {
    if (!ID_RE.test(String(id || ''))) return Promise.reject(new VideoError('identifiant invalide'));
    const ready = freshFile(id);
    if (ready) { try { const now = new Date(); fs.utimesSync(ready, now, now); } catch { /* ignoré */ } return Promise.resolve(ready); }
    const known = failed.get(id);
    if (known && known.until > Date.now()) return Promise.reject(known.error);
    if (inflight.has(id)) return inflight.get(id);
    if (waiting >= MAX_QUEUE) return Promise.reject(new Error('trop de téléchargements en attente'));
    waiting++;
    const job = chain.then(() => freshFile(id) || download(id));
    chain = job.catch(() => { /* la chaîne continue */ });
    const work = job
        .then(file => { failed.delete(id); return file; })
        .catch(err => { failed.set(id, { until: Date.now() + FAIL_TTL_MS, error: err }); throw err; })
        .finally(() => { waiting--; inflight.delete(id); });
    inflight.set(id, work);
    return work;
}

/** Test rapide sans rien télécharger (bouton « Tester » du dashboard) : renvoie la hauteur du MP4 choisi. */
async function check(id) {
    const { out } = await run([...baseArgs(), '--simulate', '--print', '%(height)s', '--', `https://www.youtube.com/watch?v=${id}`], CHECK_TIMEOUT_MS);
    const height = Number(String(out).trim().split('\n').pop());
    return { height: Number.isFinite(height) && height > 0 ? height : null };
}

function resetForTests() { failed.clear(); inflight.clear(); chain = Promise.resolve(); waiting = 0; lastUpdate = Date.now(); }

module.exports = {
    getFile, check, saveCookies, deleteCookies, cookiesStatus, normalizeCookies, resetForTests, VideoError,
    cacheDir, cookiesFile,
};
