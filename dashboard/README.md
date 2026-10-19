# Dashboard — où modifier quoi

Le dashboard est une page unique générée par `lib/dashboard-view.js`, qui **colle** les fichiers de ce dossier
(la page finale envoyée au navigateur est identique à l'époque où tout était dans un seul fichier).

| Je veux changer…                         | Je modifie…                              |
|------------------------------------------|------------------------------------------|
| le menu latéral, le login, les modales   | `index.html`                             |
| les couleurs, les tailles, le thème      | `style.css`                              |
| le contenu d'une page (cartes, boutons)  | `pages/<page>.html`                      |
| le comportement d'une page               | `js/<NN>-<section>.js`                   |

## Correspondance page ↔ JavaScript

| Page (menu)         | HTML                    | JS                                                                 |
|---------------------|-------------------------|--------------------------------------------------------------------|
| Vue d'ensemble      | `pages/overview.html`   | `js/02-overview.js`                                                |
| Utilisateurs        | `pages/users.html`      | `js/03-users.js`                                                   |
| Récupération        | `pages/recovery.html`   | `js/04-recovery.js`                                                |
| Mapping des liens   | `pages/mapping.html`    | `js/05-mapping.js`, `js/07-mapping-form.js`, `js/09-mapping-io.js` |
| Demandes            | `pages/requests.html`   | `js/06-requests.js`                                                |
| Test des flux       | `pages/test-flux.html`  | `js/08-test-flux.js`                                               |
| Page Configure      | `pages/configure.html`  | `js/12-configure.js`                                               |
| Réglages            | `pages/settings.html`   | `js/13-settings.js`, `js/11-services-status.js`                    |
| Logs                | `pages/logs.html`       | `js/10-logs.js`                                                    |

Divers : `js/00-core.js` (login, navigation entre pages), `js/01-youtube-player.js` (lecteur d'aperçu),
`js/14-utils.js` (thème, toast, échappement HTML), `js/15-init.js` (démarrage).

## Règles à connaître

- **Tous les fichiers JS forment UN SEUL `<script>`** (même portée globale, collés dans l'ordre de `SCRIPTS`).
  Une fonction définie dans un fichier est donc utilisable depuis un autre, et les `onclick="maFonction()"`
  du HTML marchent. L'ordre ne compte que pour le code exécuté au chargement (`const`, appels directs) :
  c'est pour ça que `15-init.js` est en dernier.
- Chaque fichier JS doit rester **valide seul** (ne coupe pas une fonction en deux) — un test le vérifie.
- **Nouvelle page** : crée `pages/ma-page.html` (avec `id="page-ma-page"`), ajoute-la à `PAGES` dans
  `lib/dashboard-view.js`, puis un bouton dans le menu de `index.html`.
- **Nouveau fichier JS** : ajoute-le à `SCRIPTS` (un test échoue si un fichier du dossier n'est pas listé).
- Dans le JS et le HTML, écris du code **normal** : plus aucun échappement spécial (`\\'`, `\${...}`) comme
  à l'époque où tout vivait dans une chaîne de texte.

## En local

`DASHBOARD_NO_CACHE=1 node ...` relit les fichiers à chaque requête : on modifie, on rafraîchit, sans redémarrer.
Sans cette variable, la page est assemblée une fois au démarrage (cas de Vercel).

`npm test` vérifie que la page s'assemble, que le JS est valide, et qu'aucun fichier n'a été oublié.
