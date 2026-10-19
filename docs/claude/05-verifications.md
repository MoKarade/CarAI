<!-- Extrait de l'ancien CLAUDE.md (§ 5. Vérifications avant commit), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Vérifications avant commit

## 5. Vérifications avant commit

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

*(`lint` = ESLint CLI : `next lint` est déprécié et retiré dans Next 16. Le bloc `ignores`
de `eslint.config.mjs` est indispensable.)* La CI rejoue ce gate, plus un job `audit`
séparé — un avis de sécurité paraît sans qu'une ligne n'ait changé, et mêlé au gate il
peindrait un dépôt sain en rouge jusqu'à ce qu'on prenne l'habitude du rouge.

⚠️ **Il n'y a PAS de formateur automatique ici — ne lance jamais `prettier --write`.** Le
dépôt ne porte aucune configuration prettier et son code n'est pas conforme au prettier par
défaut : lancé par réflexe sur `app/activite/page.tsx` le 14/09, il a reformaté **323
lignes** dont une seule était à moi, et fait rougir une garde qui ancrait la forme exacte
d'un appel. Le formatage se fait à la main, au style du fichier qu'on édite.
