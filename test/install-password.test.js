const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function install(dir, password) {
    return spawnSync(process.execPath, ['selfhost/install.js'], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8',
        env: { ...process.env, VF_OUT_DIR: dir, DASHBOARD_PASSWORD: password,
            TOKEN_SECRET: 'fixture-install-secret', DOMAIN: '', TMDB_API_KEY: '', HOST: 'localhost', HOST_PORT: '3000' },
    });
}

test('installeur : mot de passe court accepté, configuration existante conservée', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-install-password-'));
    try {
        const first = install(dir, 'x');
        assert.equal(first.status, 0, first.stderr);
        const envPath = path.join(dir, '.env');
        const original = fs.readFileSync(envPath, 'utf8');
        assert.match(original, /^DASHBOARD_PASSWORD='x'$/m);
        const second = install(dir, 'autre');
        assert.equal(second.status, 0, second.stderr);
        assert.equal(fs.readFileSync(envPath, 'utf8'), original);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installeur : génération automatique conservée lorsqu’aucun mot de passe n’est fourni', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-install-password-'));
    try {
        const result = install(dir, '');
        assert.equal(result.status, 0, result.stderr);
        assert.match(fs.readFileSync(path.join(dir, '.env'), 'utf8'), /^DASHBOARD_PASSWORD='[A-Za-z0-9]{20}'$/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
