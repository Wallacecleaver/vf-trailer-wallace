// Vérifie le garde-fou anti-SSRF (lib/security.js) : les adresses internes doivent être
// refusées par défaut, y compris via un nom d'hôte local.
const { test } = require('node:test');
const assert = require('node:assert');
delete process.env.ALLOW_PRIVATE_UPSTREAM;
const { assertSafeUrlSync, assertSafeUrl, isPrivateIp } = require('../lib/security');

test('isPrivateIp reconnaît les plages internes usuelles et variantes IPv6', () => {
    for (const ip of [
        '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254',
        '::', '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001',
        'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
        '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::127.0.0.1', '64:ff9b::a9fe:a9fe',
    ]) {
        assert.strictEqual(isPrivateIp(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808']) {
        assert.strictEqual(isPrivateIp(ip), false, ip);
    }
});

test('assertSafeUrlSync refuse les URL internes (dont IPv6 mappée normalisée en hex) et les schémas dangereux', () => {
    for (const url of [
        'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://[0:0:0:0:0:0:0:1]/',
        'http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/',
        'http://[64:ff9b::127.0.0.1]/', 'http://localhost/',
    ]) {
        assert.throws(() => assertSafeUrlSync(url), /interne|refusée/, url);
    }
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x']) {
        assert.throws(() => assertSafeUrlSync(url), /schéma/, url);
    }
});

test('assertSafeUrlSync accepte une URL publique (IPv4, IPv6 et domaine)', () => {
    assert.doesNotThrow(() => assertSafeUrlSync('https://example.com/video.mp4'));
    assert.doesNotThrow(() => assertSafeUrlSync('https://[2606:4700:4700::1111]/video.mp4'));
});

test('assertSafeUrl refuse un nom d’hôte qui résout vers le local', () => {
    assert.throws(() => assertSafeUrl('http://localhost/video.mp4'), /interne/);
});

test('assertSafeUrl refuse une URL contenant des identifiants', () => {
    assert.throws(() => assertSafeUrlSync('https://user:pass@example.com/x'), /identifiants/);
});
