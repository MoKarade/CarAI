# 13. LIA dans l'app

LIA, l'assistant de Marc, vit chez **MemoryAI** (cerveau, mémoire, outils). Chaque app ne fait que
l'afficher et lui relayer les questions **par le hub**, seul détenteur des jetons (MemoryAI ne détient aucun jeton d'app). Le corps (traits en canvas, vie propre, chat au clic,
menu au clic droit) vient du paquet `@mokarade/lia-ui`, épinglé **par tag** (`github:MoKarade/lia-ui#v0.39.0`),
jamais par branche, jamais publié sur npm. Mise à jour = changer le tag, comme `hub-contract`.

## Chemin d'une question

```
navigateur ──POST /api/lia/ask──▶ app ──POST /api/lia/ask (x-hub-token)──▶ hub ──▶ MemoryAI
 (cookie de session)            (requireSession)   (HUB_TOKEN de l'app)
```

| Pièce | Rôle |
|---|---|
| `lib/lia/contrat.ts` | Schémas Zod de la demande et de la réponse (pur) |
| `lib/lia/demander.ts` | Appel serveur vers le hub : https, jeton en en-tête, délai 35 s, échec fermé |
| `app/api/lia/ask/route.ts` | Route derrière le proxy ET `requireSession()` ; corps ≤ 8 Ko ; 401 / 400 / 413 / 503 |
| `lib/lia/client.ts` | Le `ask` du navigateur : parle à la route de l'app, jamais au hub |
| `components/LiaDemarrage.tsx` | LIA est démarrée sur TOUTES les pages, `/login` comprise (Marc, 23/10/2026 : présente tout le temps) : le layout rend `LiaDemarrage` sans condition de session, et le module appelle `demarrerLia` à son chargement. Sans session, la question reçoit 401 de la route et LIA dit « indisponible » |

## L'état partagé (une seule LIA, un seul état)

```
navigateur ──GET|PUT /api/lia/etat──▶ app ──GET|PUT /api/lia/etat (cookie de session)──▶ hub ──▶ MemoryAI
 (etatHttp, même origine)         (requireSession)     (jamais HUB_TOKEN)
```

| Pièce | Rôle |
|---|---|
| `app/api/lia/etat/route.ts` | Route derrière le proxy ET `requireSession()` ; corps jugé avant tout saut réseau (16 Ko, `validerEtat`) ; 401 / 403 / 429 du hub rendus, tout autre échec = 503 (LIA garde alors son état local) |
| `lib/lia/etat.ts` | Jugement pur de ce qui passe dans les deux sens, avec la même fonction que LIA (`validerEtat`) |
| `lib/lia/etatHub.ts` | Appel serveur vers `/api/lia/etat` du hub avec le cookie de l'utilisateur : https, délai 10 s, échec fermé |
| `lib/lia/hubCookie.ts` | Suit à la main la redirection `hubperso.com` → `www.hubperso.com` : `fetch` perd le cookie quand l'origine change (constaté le 24/10/2026) |
| `components/LiaDemarrage.tsx` | Passe `etat: etatHttp("/api/lia/etat")` à `demarrerLia`, dans le navigateur seulement |

- **v0.39.0 : la discussion suit Marc.** L'état peut porter `discussion` (≤ 20 messages de 600 caractères, 4 000 au total, fermée = sans texte). C'est du texte de Marc : relayé sans être lu, jamais journalisé ; MemoryAI le garde chiffré (MemoryAI#263). Rouverte à la première lecture dans l'app suivante (moins de 30 min, jamais sur un champ où Marc écrit).
- Aucun jeton d'app ne part avec l'état : le hub juge la session du propriétaire (401 sans session, 403 pour un invité).

## Règles

- **`HUB_TOKEN` identifie l'app chez le hub** (comme pour `/api/acces`) : aucun identifiant d'app dans le corps. Il ne sort jamais du serveur.
- **`proprietaire`** : l'app envoie au hub `proprietaire: true` seulement si l'email de session égale `AUTHORIZED_EMAIL` (`estProprietaire`). Une app a des invités, MemoryAI jamais : sans ce champ MemoryAI répond 403, donc un invité n'interroge pas la mémoire de Marc.
- **Échec fermé** : sans `HUB_TOKEN`, hub ou MemoryAI en panne, trop lents ou non conformes → 503, et LIA dit « indisponible ». Jamais de réponse inventée.
- **Texte reçu du hub = donnée** : validé par Zod, affiché par `textContent` (jamais `innerHTML`).
- **v1 : texte, puces et humeur seulement.** Les blocs composés (`blocks`) sont strippés ; l'app n'a pas de rendu pour eux.
- **Pas d'actions** dans le menu du clic droit en v1 : LIA propose, le hub exécute (catalogue : `hub-contract#78`).
- **Une seule LIA par page, une seule voie** : `demarrerLia` (`@mokarade/lia-ui/boot`), au chargement du module `LiaDemarrage`, jamais dans un effet ; jamais `<Lia>` en plus. Elle reste là pendant un chargement ou si une page plante. Pas de LIA sur les routes d'API (pas de page) ; partout ailleurs elle est là, `/login` comprise (CarAI#132, mesuré le 24/10/2026 en local : 2 canvas LIA sans session comme avec session). Sans session, `/api/lia/ask` reste derrière le proxy (401) : aucune donnée exposée.
- L'URL est `NEXT_PUBLIC_HUB_URL` (déjà utilisée par `accesHub.ts`, défaut `https://hubperso.com`) ; `http:` est refusé.
- ⚠️ Un fork avec une **CSP** doit autoriser les styles que le paquet injecte (`style-src`), sinon LIA s'affiche sans habillage.
