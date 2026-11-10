// Auth du dashboard : token signé (HMAC) + bcrypt + anti brute-force.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getCached, setCached } = require('./cache');
const { logEvent } = require('./logs');
const { DASHBOARD_PASSWORD } = require('./config');

// ---- Auth dashboard : token signé (HMAC, façon JWT maison) + bcrypt + anti brute-force ----
// Clé de signature dérivée de DASHBOARD_PASSWORD (pas de secret aléatoire à gérer) : les sessions
// survivent à un redémarrage de l'addon, sans variable d'environnement en plus.
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

function getTokenSecret() {
    return crypto.createHash('sha256').update(DASHBOARD_PASSWORD || '').digest();
}

let passwordHashPromise = null;
function getPasswordHash() {
    if (!passwordHashPromise) passwordHashPromise = bcrypt.hash(DASHBOARD_PASSWORD, 10);
    return passwordHashPromise;
}

function generateToken() {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ role: 'admin', iat: Date.now(), exp: Date.now() + SESSION_DURATION_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', getTokenSecret()).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    try {
        const [header, body, sig] = token.split('.');
        if (!header || !body || !sig) return false;
        const expectedSig = crypto.createHmac('sha256', getTokenSecret()).update(`${header}.${body}`).digest('base64url');
        const sigBuf = Buffer.from(sig);
        const expectedBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
        return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now();
    } catch {
        return false;
    }
}

function getClientIp(req) {
    // TRUST_PROXY=0 : addon exposé directement (sans reverse proxy devant) -> on ignore X-Forwarded-For,
    // qu'un attaquant pourrait falsifier pour contourner le verrouillage anti brute-force.
    if (process.env.TRUST_PROXY === '0') return req.socket.remoteAddress || 'unknown';
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
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

function checkDashboardAuth(req) {
    if (!DASHBOARD_PASSWORD) return false; // pas de mdp configuré = accès refusé (fail closed)
    const token = req.header('x-admin-token');
    return !!token && verifyToken(token);
}

function requireAuth(req, res, next) {
    if (!checkDashboardAuth(req)) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// POST /api/login
async function login(req, res) {
    if (!DASHBOARD_PASSWORD) return res.status(503).json({ error: 'Dashboard non configuré (DASHBOARD_PASSWORD manquant)' });
    const ip = getClientIp(req);
    if (await isLockedOut(ip)) {
        await logEvent({ level: 'error', context: 'AUTH', event: 'login_locked', message: 'IP bloquée (trop de tentatives)', meta: { ip } });
        return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${LOCKOUT_SECONDS / 60} minutes.` });
    }
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Mot de passe requis' });

    const isValid = await bcrypt.compare(password, await getPasswordHash());
    await recordLoginAttempt(ip, isValid);
    if (!isValid) {
        await logEvent({ level: 'warn', context: 'AUTH', event: 'login_failed', message: 'Tentative de connexion échouée', meta: { ip } });
        return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    await logEvent({ level: 'info', context: 'AUTH', event: 'login', message: 'Connexion au dashboard', meta: { ip } });
    res.json({ token: generateToken(), expiresIn: SESSION_DURATION_MS });
}

module.exports = { requireAuth, login };
