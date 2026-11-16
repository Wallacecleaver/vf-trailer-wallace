// Auth du dashboard : token signé (HMAC) + bcrypt + anti brute-force.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getCached, setCached } = require('./cache');
const { logEvent } = require('./logs');
const { DASHBOARD_PASSWORD } = require('./config');
const { getTokenSecret } = require('./session-secret');

// ---- Auth dashboard : token signé (HMAC, façon JWT maison) + bcrypt + anti brute-force ----
// Clé dédiée, fournie par TOKEN_SECRET ou conservée dans DATA_DIR ; elle ne change
// pas à chaque redémarrage et n'est jamais dérivée du mot de passe.
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8h
const SESSION_RENEW_BEFORE_MS = 2 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;
const MIN_PASSWORD_LENGTH = 12;

// Mots de passe par défaut / trop faibles : on refuse la connexion (fail closed) au lieu
// de laisser un dashboard exposé avec « change-moi ».
function weakPasswordReason() {
    const pwd = String(DASHBOARD_PASSWORD || '');
    if (!pwd) return 'DASHBOARD_PASSWORD manquant';
    if (/^(change[-_]?moi|changeme|password|motdepasse|admin)$/i.test(pwd)) return 'mot de passe par défaut';
    if (pwd.length < MIN_PASSWORD_LENGTH) return `moins de ${MIN_PASSWORD_LENGTH} caractères`;
    return null;
}

let passwordHashPromise = null;
function getPasswordHash() {
    if (!passwordHashPromise) passwordHashPromise = bcrypt.hash(DASHBOARD_PASSWORD, 12);
    return passwordHashPromise;
}

function generateToken() {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
        role: 'admin',
        ver: String(process.env.SESSION_VERSION || '1'), // changer SESSION_VERSION révoque toutes les sessions
        iat: Date.now(),
        exp: Date.now() + SESSION_DURATION_MS,
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', getTokenSecret()).update(`${header}.${body}`).digest('base64url');
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
    const expectedSig = crypto.createHmac('sha256', getTokenSecret()).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf) ? payload : null;
}

function getClientIp(req) {
    // TRUST_PROXY=0 (défaut) : addon exposé directement -> on ignore X-Forwarded-For, qu'un
    // attaquant pourrait falsifier pour contourner le verrouillage anti brute-force.
    // TRUST_PROXY=1 (ou N) derrière un (ou N) reverse proxy de confiance.
    const direct = req.socket.remoteAddress || 'unknown';
    const raw = process.env.TRUST_PROXY;
    const hops = raw === undefined || raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(hops) || hops <= 0) return direct;
    const parts = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (!parts.length) return direct;
    // On prend l'entrée ajoutée par le proxy le plus proche (la dernière), jamais la
    // première : celle-ci est écrite par le client et peut contenir n'importe quoi.
    return parts[parts.length - hops] || direct;
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
    if (!DASHBOARD_PASSWORD) return null; // pas de mdp configuré = accès refusé (fail closed)
    const token = req.header('x-admin-token');
    return token ? verifyToken(token) : null;
}

function requireAuth(req, res, next) {
    let session;
    try {
        session = checkDashboardAuth(req);
        if (session && session.exp - Date.now() <= SESSION_RENEW_BEFORE_MS) {
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
    if (!DASHBOARD_PASSWORD) return res.status(503).json({ error: 'Dashboard non configuré (DASHBOARD_PASSWORD manquant)' });
    const weak = weakPasswordReason();
    if (weak) {
        await logEvent({ level: 'error', context: 'AUTH', event: 'login_weak_password', message: `Connexion refusée : ${weak}` });
        return res.status(503).json({
            error: `Dashboard désactivé : mot de passe trop faible (${weak}). Définis un DASHBOARD_PASSWORD de ${MIN_PASSWORD_LENGTH} caractères ou plus, aléatoire.`,
        });
    }
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

    let token;
    try { token = generateToken(); }
    catch { return res.status(503).json({ error: 'Authentification temporairement indisponible. Réessaie.' }); }
    await logEvent({ level: 'info', context: 'AUTH', event: 'login', message: 'Connexion au dashboard', meta: { ip } });
    res.json({ token, expiresIn: SESSION_DURATION_MS });
}

module.exports = { requireAuth, login, weakPasswordReason };
