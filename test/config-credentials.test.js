const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeConfig } = require('../lib/config');

test('Configuration Stremio : accepte les identifiants TheTVDB personnels', () => {
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const config = decodeConfig(encoded({
        tmdbKey: 'TMDB_KEY',
        tvdbKey: 'TVDB_PROJECT_KEY',
        tvdbPin: 'SUBSCRIBER_PIN',
    }));
    assert.strictEqual(config.tmdbKey, 'TMDB_KEY');
    assert.strictEqual(config.tvdbKey, 'TVDB_PROJECT_KEY');
    assert.strictEqual(config.tvdbPin, 'SUBSCRIBER_PIN');
});

test('Configuration Stremio : tronque les identifiants anormalement longs', () => {
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const config = decodeConfig(encoded({ tvdbKey: 'K'.repeat(200), tvdbPin: 'P'.repeat(100) }));
    assert.strictEqual(config.tvdbKey.length, 160);
    assert.strictEqual(config.tvdbPin.length, 80);
});
