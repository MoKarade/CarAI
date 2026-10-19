// tests/aides/controles.ts — « quels contrôles ce conteneur emploie-t-il VRAIMENT ? ».
//
// ⚠️ NÉ D'UN DÉFAUT MESURÉ, pas d'un goût pour l'abstraction. Le 14/09, le bloc mobile
// portait `.filtres input[type="date"]`, `.filtres button` et `.filtres a` — écrits pour
// le sélecteur de fenêtre, qui n'a pas de menu déroulant. Le formulaire de l'écran
// Données, lui, n'est QUE des menus déroulants : ils sont restés à 29,6 px de haut et
// 14,1 px de police, à côté de contrôles parfaitement dimensionnés. Une famille de règles
// qui ÉNUMÈRE des types de contrôle en oublie un, et l'oubli ne se voit que sur l'écran
// qui l'emploie.
//
// La parade est de DÉRIVER la liste du code plutôt que de l'écrire à la main. Ce module
// porte ce mécanisme une seule fois : `donneesMobile` et `reglagesMobile` s'en servent
// tous les deux, et une règle tenue à deux endroits est une règle et demie (c'est déjà
// l'histoire de `aides/css.ts`, extrait pour la même raison le même jour).
//
// ⚠️ CE QUE CE RECENSEMENT NE VOIT PAS, et il faut le savoir avant de s'y fier : il lit
// le JSX du fichier qui porte la classe, donc il ignore les contrôles rendus par un
// COMPOSANT appelé à l'intérieur (`<ChoixLieu />` dans `.form-lieu`, par exemple). Côté
// CSS ces contrôles-là sont bien couverts — un sélecteur descendant traverse les
// composants — mais côté recensement ils sont invisibles. La garde sous-compte donc
// plutôt qu'elle ne sur-compte : elle n'invente jamais une exigence, elle peut en rater
// une. C'est le bon sens de l'erreur pour une garde qu'on veut voir rester allumée.

/** Les balises qu'on tape du doigt. `<label>` n'en est pas une : il relaie le clic. */
export const CONTROLES_TAPABLES = ["a", "button", "input", "select", "textarea"] as const;

/** Les contrôles où l'on SAISIT — les seuls que la police d'iOS fait zoomer. */
export const CONTROLES_DE_SAISIE = ["input", "select", "textarea"] as const;

/** Le JSX privé de ses commentaires — les nôtres CITENT les motifs cherchés ici. */
export function sansCommentairesJsx(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Le `>` qui ferme une balise ouvrante commencée à `depuis`. PURE.
 *
 * ⚠️ Un `>` peut ne pas fermer quoi que ce soit : `action={(f) => g(f)}` en porte un au
 * milieu de la balise, et `app/reglages/page.tsx` en a exactement un. On saute donc tout
 * `>` précédé d'un `=`. Sans ça, la portée de `.reglages` s'arrêterait AVANT le premier
 * champ et la garde deviendrait vide sans rien dire.
 */
function finDeBaliseOuvrante(source: string, depuis: number): number {
  let i = depuis;
  for (;;) {
    const j = source.indexOf(">", i);
    if (j === -1) return -1;
    if (source[j - 1] !== "=") return j;
    i = j + 1;
  }
}

/**
 * Le contenu de CHAQUE élément portant `className="<classe>"`, borné à sa balise
 * fermante par comptage. PURE.
 *
 * ⚠️ POURQUOI BORNER, alors que « prendre jusqu'à la fin du fichier » suffisait pour
 * `.filtres`. Parce que ça ne tient que par accident de position : dans
 * `app/reglages/page.tsx`, le formulaire est suivi de trois blocs repliés, et les trois
 * liens de la page le PRÉCÈDENT. Une portée large exigerait demain `.reglages a` dès
 * qu'un lien passerait après le formulaire — un faux positif. Et un faux positif qu'on
 * « assouplit une fois parce que c'en était un » est une garde qui ne garde plus rien.
 */
export function porteesDeLaClasse(source: string, classe: string): string[] {
  const portees: string[] = [];
  const marque = `className="${classe}"`;
  let depuis = 0;
  for (;;) {
    const pos = source.indexOf(marque, depuis);
    if (pos === -1) return portees;
    depuis = pos + marque.length;
    const ouvrante = source.lastIndexOf("<", pos);
    const nom = ouvrante === -1 ? null : /^<([A-Za-z][\w.-]*)/.exec(source.slice(ouvrante))?.[1];
    if (!nom) continue;
    const fin = finDeBaliseOuvrante(source, depuis);
    if (fin === -1) continue;
    if (source[fin - 1] === "/") continue; // auto-fermante : elle ne contient rien
    portees.push(corpsDe(source, nom, fin + 1));
  }
}

/** Le corps d'un élément `<nom>` ouvert juste avant `debut`, imbrications comptées. PURE. */
function corpsDe(source: string, nom: string, debut: number): string {
  const motif = new RegExp(`<${nom}(?=[\\s/>])|</${nom}>`, "g");
  motif.lastIndex = debut;
  let profondeur = 1;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(source)) !== null) {
    if (m[0].startsWith("</")) {
      profondeur--;
      if (profondeur === 0) return source.slice(debut, m.index);
      continue;
    }
    const fin = finDeBaliseOuvrante(source, m.index);
    if (fin !== -1 && source[fin - 1] === "/") continue; // `<div … />` n'ouvre rien
    profondeur++;
  }
  // Fermeture introuvable : on rend large plutôt que vide. Une garde qui sous-estime sa
  // portée serait satisfaite par un fichier qu'elle n'a pas su lire.
  return source.slice(debut);
}

/**
 * Les contrôles tapables employés dans ces portées. PURE.
 *
 * Un `<input type="hidden">` ne se tape pas : il ne compte pas.
 */
export function controlesEmployes(portees: string[]): Set<string> {
  const employes = new Set<string>();
  for (const portee of portees) {
    for (const balise of CONTROLES_TAPABLES) {
      const motif = new RegExp(`<${balise}(?=[\\s/>])`, "g");
      let m: RegExpExecArray | null;
      while ((m = motif.exec(portee)) !== null) {
        const fin = finDeBaliseOuvrante(portee, m.index);
        const ouvrante = fin === -1 ? portee.slice(m.index) : portee.slice(m.index, fin);
        if (balise === "input" && /type="hidden"/.test(ouvrante)) continue;
        employes.add(balise);
        break;
      }
    }
  }
  return employes;
}

/**
 * Ce que le bloc téléphone déclare pour `.classe balise`, tous sélecteurs confondus. PURE.
 *
 * Rend des FAITS, jamais un verdict : c'est au test d'exiger ce qu'il exige. Les deux
 * écrans n'ont pas la même dette et sommer leurs exigences ici les rendrait illisibles.
 *
 * ⚠️ Le sélecteur peut porter un suffixe (`.filtres input[type="date"]`) et vivre dans un
 * groupe (`.reglages input,\n  .reglages button { … }`). Un motif qui cherche
 * `.classe balise {` ne verrait NI l'un NI l'autre — mesuré le 14/09 : une garde écrite
 * ainsi rendait `null` quoi qu'il arrive, donc passait même quand la règle était fausse.
 */
export function couvertureMobile(
  telephone: string,
  classe: string,
  balise: string,
): { regles: number; hauteur: boolean; police: boolean } {
  const motif = new RegExp(`^\\.${classe}\\s+${balise}(\\[|:|$)`);
  const corps: string[] = [];
  for (const bloc of telephone.split("}")) {
    const i = bloc.indexOf("{");
    if (i === -1) continue;
    const selecteurs = bloc
      .slice(0, i)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (selecteurs.some((s) => motif.test(s))) corps.push(bloc.slice(i + 1));
  }
  const tout = corps.join("");
  return {
    regles: corps.length,
    hauteur: /min-height:\s*44px/.test(tout),
    // 16 px est le SEUIL du zoom automatique d'iOS, pas une préférence esthétique.
    police: /font-size:\s*1rem/.test(tout),
  };
}
