// Clé de signature indépendante du mot de passe. Sans TOKEN_SECRET explicite,
// elle est créée une seule fois dans le volume persistant de l'addon.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sql = require('./db');

let cachedDirectory = null;
let cachedSecret = null;

function getTokenSecret() {
    if (process.env.TOKEN_SECRET) {
        // Conserve exactement la signature des sessions déjà émises avec cette variable.
        return crypto.createHash('sha256').update(String(process.env.TOKEN_SECRET)).digest();
    }
    const dir = path.resolve(sql.dataDir());
    if (cachedSecret && cachedDirectory === dir) return cachedSecret;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'dashboard-session-secret');
    let value;
    try {
        value = fs.readFileSync(file, 'utf8').trim();
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const temporary = path.join(dir, `.session-secret-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
        fs.writeFileSync(temporary, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
        try {
            // Publication atomique sans écraser une clé créée par un autre processus.
            try { fs.linkSync(temporary, file); }
            catch (linkError) { if (linkError.code !== 'EEXIST') throw linkError; }
        } finally {
            fs.unlinkSync(temporary);
        }
        value = fs.readFileSync(file, 'utf8').trim();
    }
    if (!/^[a-f0-9]{64}$/.test(value)) {
        throw new Error('Clé de session persistante invalide dans DATA_DIR');
    }
    cachedDirectory = dir;
    cachedSecret = Buffer.from(value, 'hex');
    return cachedSecret;
}

let cachedPasswordInput = null;
let cachedPasswordSecret = null;

// Clé déterministe dérivée du mot de passe (scrypt) utilisée quand TOKEN_SECRET
// n'est pas défini : garantit que deux conteneurs (déploiement sans coupure WDock/Docker
// ou recréation sans volume /data partagé) vérifient la même signature.
function getPasswordDerivedSecret(password) {
    const raw = String(password || '');
    if (!raw) return null;
    if (cachedPasswordSecret && cachedPasswordInput === raw) return cachedPasswordSecret;
    cachedPasswordInput = raw;
    cachedPasswordSecret = crypto.scryptSync(raw, 'vf-trailers:dashboard-session:v1', 32);
    return cachedPasswordSecret;
}

module.exports = { getTokenSecret, getPasswordDerivedSecret };

