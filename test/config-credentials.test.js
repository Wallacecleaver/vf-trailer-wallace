const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeConfig } = require('../lib/config');

test('Configuration Stremio : accepte la clé TheTVDB personnelle sans PIN', () => {
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const config = decodeConfig(encoded({
        tmdbKey: 'TMDB_KEY',
        tvdbKey: 'TVDB_PROJECT_KEY',
    }));
    assert.strictEqual(config.tmdbKey, 'TMDB_KEY');
    assert.strictEqual(config.tvdbKey, 'TVDB_PROJECT_KEY');
    assert.strictEqual(Object.hasOwn(config, 'tvdbPin'), false);
});

test('Configuration Stremio : ignore les anciens PIN encodés dans les liens déjà créés', () => {
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const config = decodeConfig(encoded({
        tmdbKey: 'TMDB_KEY',
        tvdbKey: 'TVDB_PROJECT_KEY',
        tvdbPin: 'OLD_PIN',
    }));
    assert.strictEqual(config.tvdbKey, 'TVDB_PROJECT_KEY');
    assert.strictEqual(Object.hasOwn(config, 'tvdbPin'), false);
});

test('Configuration Stremio : tronque les clés anormalement longues', () => {
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const config = decodeConfig(encoded({ tvdbKey: 'K'.repeat(200) }));
    assert.strictEqual(config.tvdbKey.length, 160);
});
