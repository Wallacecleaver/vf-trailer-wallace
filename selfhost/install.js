#!/usr/bin/env node
// Installeur interactif embarqué dans l'image Docker. Il n'installe rien lui-même : il pose
// quelques questions puis écrit docker-compose.yml, Caddyfile et .env dans le dossier monté sur /data.
//
//   mkdir vf-trailers && cd vf-trailers
//   docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/data IMAGE install
//   docker compose up -d
//
// Sans terminal (scripts), les réponses peuvent venir de variables :
//   DOMAIN, TMDB_API_KEY, DASHBOARD_PASSWORD, HOST, HOST_PORT

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { Writable } = require('stream');

const OUT = process.env.VF_OUT_DIR || '/data';
const IMAGE = process.env.VF_IMAGE || 'vf-trailers:local';
const TEMPLATES = path.join(__dirname, 'deploy');
const INTERACTIVE = !!process.stdin.isTTY;

const say = (...a) => console.log(...a);
const die = msg => { console.error(`\n❌ ${msg}`); process.exit(1); };
const rand = n => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.randomBytes(n), b => chars[b % chars.length]).join('');
};

// ---- Saisie (avec masquage pour le mot de passe) ----
// Les lignes saisies sont mises en file d'attente : rien n'est perdu si plusieurs réponses arrivent
// d'un coup (collage de plusieurs lignes, entrée redirigée...).
let rl = null;
const queue = [];
let waiter = null;
if (INTERACTIVE) {
    const output = new Writable({
        write(chunk, enc, cb) { if (!rl.muted) process.stdout.write(chunk, enc); cb(); },
    });
    rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    rl.on('line', line => {
        if (waiter) { const w = waiter; waiter = null; w(line); } else queue.push(line);
    });
    rl.on('close', () => { if (waiter) { const w = waiter; waiter = null; w(''); } });
}
function ask(question, { hidden = false } = {}) {
    if (!rl) return Promise.resolve('');
    if (queue.length) return Promise.resolve(queue.shift().trim());
    return new Promise(resolve => {
        if (hidden) { process.stdout.write(question); rl.setPrompt(''); rl.muted = true; }
        else rl.setPrompt(question);
        waiter = answer => {
            if (hidden) { rl.muted = false; process.stdout.write('\n'); }
            resolve(answer.trim());
        };
        if (!hidden) rl.prompt();
    });
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
const cleanDomain = d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();

async function main() {
    // Le dossier de sortie doit être monté depuis l'hôte, sinon les fichiers disparaîtraient avec le conteneur.
    try { fs.accessSync(OUT, fs.constants.W_OK); }
    catch {
        die(`Impossible d'écrire dans ${OUT}.\n   Lance la commande depuis un dossier vide, avec :  --user "$(id -u):$(id -g)" -v "$PWD":/data`);
    }

    const envPath = path.join(OUT, '.env');
    if (fs.existsSync(envPath)) {
        say('ℹ️  Un fichier .env existe déjà dans ce dossier : je ne touche à rien.');
        say('   (supprime-le pour refaire la configuration)');
        say('\n👉 Démarre avec :  docker compose up -d');
        process.exit(0);
    }

    say('\nBandes-Annonces VF — installation\n');
    say('Quelques questions (Entrée pour passer / valeur par défaut) :\n');

    // ① Domaine
    let domain = process.env.DOMAIN || '';
    if (!domain && INTERACTIVE) {
        say('① Nom de domaine pour l\'accès HTTPS (ex. trailers.mondomaine.fr).');
        say('   Nécessaire pour installer l\'addon dans Stremio depuis un autre appareil.');
        say('   Il doit déjà pointer vers l\'IP de ce serveur, ports 80 et 443 ouverts.');
    }
    for (;;) {
        if (!domain && INTERACTIVE) domain = await ask('   Domaine : ');
        domain = cleanDomain(domain);
        if (!domain || DOMAIN_RE.test(domain)) break;
        if (!INTERACTIVE) die(`DOMAIN invalide : ${domain}`);
        say(`   ⚠️  « ${domain} » n'est pas un nom de domaine valide.`);
        domain = '';
    }

    // ② Clé TMDB
    let tmdb = process.env.TMDB_API_KEY || '';
    if (!tmdb && INTERACTIVE) {
        say('\n② Clé API TMDB (facultatif : https://www.themoviedb.org/settings/api).');
        tmdb = await ask('   Clé TMDB : ');
    }
    if (tmdb && !/^[A-Za-z0-9]+$/.test(tmdb)) die('La clé TMDB ne doit contenir que des lettres et des chiffres.');

    // ③ Mot de passe du dashboard
    let password = process.env.DASHBOARD_PASSWORD || '';
    let generated = false;
    if (!password && INTERACTIVE) {
        say('\n③ Mot de passe du dashboard d\'administration (8 caractères minimum, sans apostrophe).');
        for (;;) {
            password = await ask('   Mot de passe (Entrée = en générer un) : ', { hidden: true });
            if (!password) break;
            if (password.length < 8) { say('   ⚠️  Trop court (8 minimum).'); continue; }
            if (password.includes("'")) { say('   ⚠️  Sans apostrophe, s\'il te plaît.'); continue; }
            const confirm = await ask('   Confirme le mot de passe : ', { hidden: true });
            if (confirm === password) break;
            say('   ⚠️  Les deux mots de passe ne correspondent pas.');
        }
    }
    if (password) {
        if (password.length < 8) die('DASHBOARD_PASSWORD : 8 caractères minimum.');
        if (password.includes("'") || /[\r\n]/.test(password)) die('DASHBOARD_PASSWORD ne doit contenir ni apostrophe ni retour à la ligne.');
    } else {
        password = rand(20);
        generated = true;
    }

    // ④ Sans domaine : adresse du serveur + port
    let host = process.env.HOST || '';
    let port = process.env.HOST_PORT || '';
    if (!domain) {
        if (!host && INTERACTIVE) {
            say('\n④ Adresse de ton serveur (IP ou nom), utilisée dans les liens de l\'addon.');
            host = await ask('   Adresse [localhost] : ');
        }
        if (!port && INTERACTIVE) port = await ask('   Port d\'écoute [3000] : ');
        host = host || 'localhost';
        port = port || '3000';
        if (!/^[A-Za-z0-9.:\[\]-]+$/.test(host)) die(`Adresse invalide : ${host}`);
        if (!/^\d{2,5}$/.test(port)) die(`Port invalide : ${port}`);
    }

    // ---- Écriture ----
    const baseUrl = domain ? `https://${domain}` : `http://${host}:${port}`;
    const env = [
        '# Généré par l\'installeur — modifie puis relance : docker compose up -d',
        `DASHBOARD_PASSWORD='${password}'`,
        `POSTGRES_PASSWORD=${rand(24)}`,
        `APP_BASE_URL=${baseUrl}`,
    ];
    if (tmdb) env.push(`TMDB_API_KEY=${tmdb}`);
    if (domain) {
        env.push(`DOMAIN=${domain}`, 'BIND_ADDRESS=127.0.0.1', 'COMPOSE_PROFILES=https');
    } else {
        env.push('TRUST_PROXY=0');
        if (port !== '3000') env.push(`HOST_PORT=${port}`);
    }
    fs.writeFileSync(envPath, env.join('\n') + '\n', { mode: 0o600 });

    const compose = fs.readFileSync(path.join(TEMPLATES, 'compose.template.yml'), 'utf8').replace(/__IMAGE__/g, IMAGE);
    fs.writeFileSync(path.join(OUT, 'docker-compose.yml'), compose);
    fs.copyFileSync(path.join(TEMPLATES, 'Caddyfile.template'), path.join(OUT, 'Caddyfile'));

    say('\n✅ Configuration écrite dans ce dossier : docker-compose.yml, Caddyfile, .env');
    if (generated) say(`\n🔑 Mot de passe du dashboard généré : ${password}   (conservé dans .env)`);
    say('\n👉 Démarre maintenant avec :  docker compose up -d');
    say(`\n   Installation dans Stremio : ${baseUrl}`);
    say(`   Dashboard                 : ${baseUrl}/dashboard`);
    say('\n   Mise à jour plus tard     : docker compose pull && docker compose up -d');
    say('   Logs                      : docker compose logs -f app\n');
    if (rl) rl.close();
}

main().catch(err => die(err.message));
