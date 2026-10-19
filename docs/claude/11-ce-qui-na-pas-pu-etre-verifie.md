<!-- Extrait de l'ancien CLAUDE.md (§ 11. Ce qui n'a pas pu être vérifié (et où ça en est)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Ce qui n'a pas pu être vérifié (et où ça en est)

## 11. Ce qui n'a pas pu être vérifié (et où ça en est)

1. **`smartcar.com` est filtré par la politique d'egress** → le mapping avait été bâti sur
   hypothèses. Depuis le 06/08, **les livraisons réelles font foi** : 15 codes confirmés
   `SUCCESS` mappés un à un (`SIGNAUX_CONFIRMES_BZ`), structure d'enveloppe verrouillée par
   `tests/livraisonReelle.test.ts`. Un code encore inconnu est stocké sous son code brut —
   rien n'est jeté, `signal_code` garde toujours l'origine. Ce qui reste non vérifiable
   sans la doc : le nom des **scopes** du Connect (d'où `SMARTCAR_SCOPES_EXTRA`).
2. **`toyota-na` est une bibliothèque Python inaccessible** → l'adaptateur réseau Toyota
   (`lib/toyota/client.ts`) est **déclaré, pas deviné**. Des URLs plausibles auraient produit
   du code qui compile et échoue au premier appel, en faisant croire à un changement d'API
   côté Toyota. La marche à suivre pour le brancher est dans l'en-tête du fichier.
