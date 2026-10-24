<!-- Extrait de l'ancien CLAUDE.md (§ 8. Documentation (où vit quoi)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Documentation (où vit quoi)

## 8. Documentation (où vit quoi)

| Fichier | Contenu |
|---|---|
| `README.md` | À quoi sert l'app, pour un lecteur extérieur. |
| `CLAUDE.md` | Ce fichier. Se charge à **chaque session** → il reste **court**. |
| `HANDOVER.md` | L'état RÉEL : ce qui tourne, ce qui reste à configurer. À lire en premier. |
| `BACKLOG.md` | Un renvoi vers les issues du dépôt, où vit ce qui est décidé mais pas fait. |
| `docs/adr/` | Décisions architecturales, `NNNN-slug.md`. |
| `docs/SMARTCAR_API.md` | Ce que l'API Smartcar rend vraiment, mesuré. |

⚠️ **Doc périmée = pire que pas de doc.** Le 19/08/2026, le README annonçait « login Google
mono-adresse » à trois endroits alors qu'`auth.ts` déclare `providers: []` depuis cinq jours,
et comptait « quatre routes hors garde » quand il y en a treize. Mettre à jour la doc touchée
dans la MÊME PR que le code.

⚠️ **Un compte se recompte, il ne se recopie pas.** Les treize routes de
`ROUTES_A_AUTH_PROPRE` sont la seule source ; le nombre écrit ailleurs dérive au premier ajout.
