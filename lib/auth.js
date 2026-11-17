// Auth du dashboard : token signé (HMAC) + bcrypt + anti brute-force.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getCached, setCached } = require('./cache');
const { logEvent } = require('./logs');
const { DASHBOARD_PASSWORD } = require('./config');
const { getTokenSecret, getPasswordDerivedSecret } = require('./session-secret');

// ---- Auth dashboard : token signé (HMAC, façon JWT maison) + bcrypt + anti brute-force ----
// Clé dédiée : TOKEN_SECRET si fourni, sinon dérivée de DASHBOARD_PASSWORD (+ clé fichier
// conservée dans DATA_DIR pour compatibilité des sessions existantes et survie aux redéploiements).
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const SESSION_RENEW_AFTER_MS = 2 * 60 * 60 * 1000;    // renouvellement glissant dès 2h d'âge
const SESSION_RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

let passwordHashPromise = null;
function getPasswordHash() {
    if (!passwordHashPromise) passwordHashPromise = bcrypt.hash(DASHBOARD_PASSWORD, 12);
    return passwordHashPromise;
}

function getSigningSecret() {
    const primary = getTokenSecret();
    if (process.env.TOKEN_SECRET) return primary;
    return getPasswordDerivedSecret(DASHBOARD_PASSWORD) || primary;
}

function verifySignature(data, sig, secret) {
    if (!secret) return false;
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
}

function generateToken() {
    const now = Date.now();
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
        role: 'admin',
        ver: String(process.env.SESSION_VERSION || '1'), // changer SESSION_VERSION révoque toutes les sessions
        iat: now,
        exp: now + SESSION_DURATION_MS,
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', getSigningSecret()).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    let header, body, sig, payload;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        [header, body, sig] = parts;
        if (!header || !body || !sig) return null;
        const descriptor = JSON.parse(Buffer.from(header, 'base64url').toString());
        if (descriptor.alg !== 'HS256' || descriptor.typ !== 'JWT') return null;
        payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.role !== 'admin' || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
        if (String(payload.ver || '1') !== String(process.env.SESSION_VERSION || '1')) return null;
    } catch {
        return null;
    }
    // Une panne du stockage du secret doit produire un 503, pas un faux « session expirée ».
    const primary = getTokenSecret();
    const signedData = `${header}.${body}`;
    if (process.env.TOKEN_SECRET) {
        return verifySignature(signedData, sig, primary) ? payload : null;
    }
    const derived = getPasswordDerivedSecret(DASHBOARD_PASSWORD);
    return (verifySignature(signedData, sig, derived) || verifySignature(signedData, sig, primary)) ? payload : null;
}

function getClientIp(req) {
    // TRUST_PROXY=0 (défaut) : addon exposé directement -> on ignore X-Forwarded-For, qu'un
    // attaquant pourrait falsifier pour contourner le verrouillage anti brute-force.
    // TRUST_PROXY=1 (ou N) derrière un (ou N) reverse proxy de confiance.
    const direct = (req.socket && req.socket.remoteAddress) || 'unknown';
    const raw = process.env.TRUST_PROXY;
    const hops = raw === undefined || raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(hops) || hops <= 0) return direct;
    const parts = String((req.headers && req.headers['x-forwarded-for']) || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (!parts.length) return direct;
    // On prend l'entrée ajoutée par le proxy le plus proche ; si la chaîne est plus courte que
    // hops, on garde la première entrée plutôt que `direct` (qui bloquerait le reverse proxy entier).
    return parts[Math.max(0, parts.length - hops)] || direct;
}

// Compteur de tentatives stocké en base (via lib/cache) plutôt qu'en mémoire : le verrouillage
// survit à un redémarrage de l'addon.
async function isLockedOut(ip) {
    const attempts = await getCached(`loginattempts:${ip}`);
    return !!(attempts && attempts.count >= MAX_LOGIN_ATTEMPTS);
}

async function recordLoginAttempt(ip, success) {
    const key = `loginattempts:${ip}`;
    if (success) { await setCached(key, null, 1); return; }
    const attempts = (await getCached(key)) || { count: 0 };
    await setCached(key, { count: attempts.count + 1 }, LOCKOUT_SECONDS);
}

// File d'attente mémoire par IP pour sérialiser les vérifications bcrypt et empêcher que
// N requêtes simultanées ne contournent MAX_LOGIN_ATTEMPTS pendant les ~250 ms du hachage.
const loginQueues = new Map();
function withIpLock(ip, fn) {
    const prev = loginQueues.get(ip) || Promise.resolve();
    const run = prev.then(fn, fn);
    const cleanup = () => { if (loginQueues.get(ip) === tail) loginQueues.delete(ip); };
    const tail = run.then(cleanup, cleanup);
    loginQueues.set(ip, tail);
    return run;
}

function extractRequestToken(req) {
    const custom = req.header('x-admin-token');
    if (custom) return custom.trim();
    const auth = typeof req.header === 'function' ? req.header('authorization') : null;
    if (auth && /^Bearer\s+\S+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
    return null;
}

function shouldRenewSession(session, now) {
    if (Number.isFinite(session.iat) && now - session.iat >= SESSION_RENEW_AFTER_MS) return true;
    return session.exp - now <= SESSION_RENEW_BEFORE_MS;
}

function checkDashboardAuth(req) {
    if (!DASHBOARD_PASSWORD) return null; // pas de mdp configuré = accès refusé (fail closed)
    const token = extractRequestToken(req);
    return token ? verifyToken(token) : null;
}

function requireAuth(req, res, next) {
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
    let session;
    try {
        session = checkDashboardAuth(req);
        const now = Date.now();
        if (session && shouldRenewSession(session, now)) {
            res.setHeader('X-Admin-Token', generateToken());
        }
    } catch {
        return res.status(503).json({ error: 'Authentification temporairement indisponible. Réessaie.' });
    }
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// POST /api/login
async function login(req, res) {
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
    if (!DASHBOARD_PASSWORD) return res.status(503).json({ error: 'Dashboard non configuré (DASHBOARD_PASSWORD manquant)' });
    const { password } = req.body || {};
    const ip = getClientIp(req);
    return withIpLock(ip, async () => {
        if (await isLockedOut(ip)) {
            await logEvent({ level: 'error', context: 'AUTH', event: 'login_locked', message: 'IP bloquée (trop de tentatives)', meta: { ip } });
            return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${LOCKOUT_SECONDS / 60} minutes.` });
        }
        if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Mot de passe requis' });

        const isValid = await bcrypt.compare(password, await getPasswordHash());
        await recordLoginAttempt(ip, isValid);
        if (!isValid) {
            await logEvent({ level: 'warn', context: 'AUTH', event: 'login_failed', message: 'Tentative de connexion échouée', meta: { ip } });
            return res.status(401).json({ error: 'Mot de passe incorrect' });
        }

        let token;
        try { token = generateToken(); }
        catch { return res.status(503).json({ error: 'Authentification temporairement indisponible. Réessaie.' }); }
        await logEvent({ level: 'info', context: 'AUTH', event: 'login', message: 'Connexion au dashboard', meta: { ip } });
        return res.json({ token, expiresIn: SESSION_DURATION_MS });
    });
}

module.exports = { requireAuth, login, SESSION_DURATION_MS };

