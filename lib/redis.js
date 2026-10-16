// Client Redis partagé (Upstash REST, compatible serverless).
// Un seul point de configuration -> tous les autres modules l'importent.
// Si les env vars ne sont pas définies, `redis` reste null : chaque module
// qui l'utilise doit gérer ce cas en no-op silencieux (jamais bloquer l'addon).

const { Redis } = require('@upstash/redis');

let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}

module.exports = redis;
