// Assemble le shell HTML du dashboard à partir des fichiers du dossier /dashboard :
//
//   dashboard/index.html   -> squelette (login, menu latéral, modales) avec 3 repères {{css}} {{pages}} {{js}}
//   dashboard/style.css    -> tout le CSS
//   dashboard/pages/*.html -> le contenu de chaque page (Vue d'ensemble, Mapping, Réglages...)
//   dashboard/js/*.js      -> le JavaScript, découpé par section
//
// Tout est en client-side : login -> fetch API avec header x-admin-token -> rendu par page.
// Voir dashboard/README.md pour savoir où modifier quoi.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'dashboard');

// Ordre = ordre d'apparition dans la page / dans le <script>. Les fichiers JS sont COLLÉS bout à bout
// dans une seule balise <script> (même portée globale) : l'ordre compte pour le code exécuté au
// chargement (const/let, appels directs) ; les fonctions déclarées, elles, sont remontées.
const PAGES = [
    'overview', 'users', 'mapping', 'requests',
    'test-flux', 'configure', 'settings', 'logs',
];

const SCRIPTS = [
    '00-core', '01-youtube-player', '02-overview', '03-users',
    '05-mapping', '06-requests', '07-mapping-form', '08-test-flux', '09-mapping-io',
    '10-logs', '11-services-status', '12-configure', '13-settings', '14-utils', '15-init',
];

const read = rel => fs.readFileSync(path.join(DIR, rel), 'utf8');
// Les fichiers finissent par un saut de ligne ; le gabarit en place déjà un autour du repère.
const chomp = s => s.replace(/\n$/, '');

function build() {
    const parts = {
        css: read('style.css'),
        pages: PAGES.map(p => read(`pages/${p}.html`)).join(''),
        js: SCRIPTS.map(s => read(`js/${s}.js`)).join(''),
    };
    // Remplacement par FONCTION : le code contient des `$` (ex. `$&`, `$'`) qu'un remplacement
    // en chaîne interpréterait.
    return read('index.html').replace(/\{\{(css|pages|js)\}\}/g, (_, key) => chomp(parts[key]));
}

let cache = null;
function renderDashboardShell() {
    // DASHBOARD_NO_CACHE=1 : relit les fichiers à chaque requête (pratique en local, sans redémarrer).
    if (process.env.DASHBOARD_NO_CACHE === '1') return build();
    return cache || (cache = build());
}

module.exports = { renderDashboardShell, PAGES, SCRIPTS };
