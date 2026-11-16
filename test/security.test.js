// Vérifie le garde-fou anti-SSRF (lib/security.js) : les adresses internes doivent être
// refusées par défaut, y compris via un nom d'hôte local.
const { test } = require('node:test');
const assert = require('node:assert');
delete process.env.ALLOW_PRIVATE_UPSTREAM;
const { assertSafeUrlSync, assertSafeUrl, isPrivateIp } = require('../lib/security');

test('isPrivateIp reconnaît les plages internes usuelles', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '::1', 'fd00::1', 'fe80::1']) {
        assert.strictEqual(isPrivateIp(ip), true, ip);
    }
    assert.strictEqual(isPrivateIp('8.8.8.8'), false);
    assert.strictEqual(isPrivateIp('1.1.1.1'), false);
});

test('assertSafeUrlSync refuse les URL internes et les schémas dangereux', () => {
    for (const url of [
        'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://localhost/',
    ]) {
        assert.throws(() => assertSafeUrlSync(url), /interne|refusée/, url);
    }
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x']) {
        assert.throws(() => assertSafeUrlSync(url), /schéma/, url);
    }
});

test('assertSafeUrlSync accepte une URL publique', () => {
    assert.doesNotThrow(() => assertSafeUrlSync('https://example.com/video.mp4'));
});

test('assertSafeUrl refuse un nom d’hôte qui résout vers le local', () => {
    assert.throws(() => assertSafeUrl('http://localhost/video.mp4'), /interne/);
});

test('assertSafeUrl refuse une URL contenant des identifiants', () => {
    assert.throws(() => assertSafeUrlSync('https://user:pass@example.com/x'), /identifiants/);
});
