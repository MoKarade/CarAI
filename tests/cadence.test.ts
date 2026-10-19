// tests/cadence.test.ts — surveillance de la cadence du poll (fonctions pures).
//
// Ce que ces tests protègent : la capacité à DISTINGUER trois situations qui donnent toutes
// un écran calme aujourd'hui — « tout va bien », « le poll saute des passages », et « la
// surveillance vient d'être installée ». Les confondre est exactement ce qui a laissé un
// tiers des polls disparaître sans que personne ne le voie.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CADENCE_FILET_GITHUB_MINUTES,
  CADENCE_POLL_MINUTES,
  FACTEUR_OUBLI,
  analyserCadence,
  consequenceCadence,
  graviteCadence,
  mediane,
  seuilOubliMinutes,
  type PassagePoll,
} from "@/lib/vehicle/cadence";

const T = new Date("2026-08-17T12:00:00.000Z");
const ilYA = (min: number) => new Date(T.getTime() - min * 60_000);

/** Suite de passages RÉGULIERS, du plus ancien au plus récent. */
function reguliers(nb: number, cadence = CADENCE_POLL_MINUTES): PassagePoll[] {
  return Array.from({ length: nb }, (_, i) => ({ t: ilYA((nb - 1 - i) * cadence), ok: true }));
}

// ══ LE TRIPWIRE ═════════════════════════════════════════════════════════════════════
// La cadence du FILET GitHub Actions vit dans DEUX fichiers qui ne se parlent pas : un YAML
// de workflow et une constante TypeScript. Si elles divergent, la mesure d'écart mentirait
// en silence — le module annoncerait « 60 attendus » pendant que GitHub en planifie 15 (ou
// l'inverse). Même famille que le tripwire du nom de classe des tuiles : un nom qui vit à
// deux endroits se verrouille.
//
// ⚠️ Ceci verrouille le FILET (`CADENCE_FILET_GITHUB_MINUTES`), pas le déclencheur PRINCIPAL
// (`CADENCE_POLL_MINUTES`, service de cron externe hors dépôt, aucun test possible dessus) :
// les deux ont été DÉCOUPLÉS le 28/09/2026 pour préserver le quota GitHub Actions.
describe("la cadence du FILET est la MÊME des deux côtés", () => {
  it("correspond au cron de .github/workflows/smartcar-poll.yml", () => {
    const yaml = readFileSync(".github/workflows/smartcar-poll.yml", "utf8");
    // On ne lit que le cron ACTIF : les lignes commentées documentent des alternatives.
    const ligne = yaml
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("- cron:"));
    expect(ligne, "aucun cron actif dans le workflow de poll").toBeDefined();

    // Deux formes seulement, et toute autre FAIT ÉCHOUER le test (pas de cron deviné) :
    //  - `*/N * * * *` : période N minutes ;
    //  - `M * * * *`   : une fois par heure, période 60 minutes (le filet actuel, ex. « 0 * * * * »).
    // Le workflow est le FILET du déclencheur externe (cadence cible = CADENCE_POLL_MINUTES) :
    // sa période doit être un MULTIPLE entier de la cadence cible (jamais plus rapide, jamais
    // décalée), et égale à la constante du filet, sinon les mesures d'écart mentent.
    const texte = ligne!;
    const pas = texte.match(/"\*\/(\d+)\s+\*\s+\*\s+\*\s+\*"/);
    const horaire = texte.match(/"\d{1,2}\s+\*\s+\*\s+\*\s+\*"/);
    expect(pas ?? horaire, `cron non reconnu : ${texte}`).not.toBeNull();
    const periode = pas ? Number(pas[1]) : 60;
    expect(periode).toBe(CADENCE_FILET_GITHUB_MINUTES);
    expect(periode % CADENCE_POLL_MINUTES, `période ${periode} min`).toBe(0);
    expect(periode).toBeGreaterThanOrEqual(CADENCE_POLL_MINUTES);
  });
});

describe("seuil d'oubli", () => {
  it("est DÉRIVÉ de la cadence, jamais écrit en dur", () => {
    expect(seuilOubliMinutes()).toBe(CADENCE_POLL_MINUTES * FACTEUR_OUBLI);
    expect(seuilOubliMinutes(10)).toBe(10 * FACTEUR_OUBLI);
  });
});

describe("analyserCadence", () => {
  it("distingue « aucun historique » d'une cadence rompue", () => {
    const vide = analyserCadence({ passages: [], maintenant: T });
    expect(vide.aucunHistorique).toBe(true);
    expect(vide.nbPassages).toBe(0);
    // ⚠️ Une installation neuve ne doit PAS crier à la panne : elle n'a rien observé.
    expect(graviteCadence(vide)).toBe("normale");
  });

  // ⚠️ Tout se DÉRIVE de la constante : ce cas décrit une PROPRIÉTÉ (à la cadence visée,
  // la couverture vaut 1), pas une mesure. Les chiffres étaient écrits en dur — 48
  // passages, 48 attendus, 30 min d'écart — et sont devenus faux le jour où la cadence
  // visée est passée à 15 min, alors que rien de ce qu'ils défendent n'avait bougé.
  it("voit une cadence saine", () => {
    const parJour = (24 * 60) / CADENCE_POLL_MINUTES;
    const c = analyserCadence({
      passages: reguliers(parJour),
      maintenant: T,
      fenetreHeures: 24,
    });
    expect(c.nbPassages).toBe(parJour);
    expect(c.nbAttendus).toBe(parJour);
    expect(c.couverture).toBe(1);
    expect(c.ecartMedianMinutes).toBe(CADENCE_POLL_MINUTES);
    expect(c.trous).toHaveLength(0);
    expect(graviteCadence(c)).toBe("normale");
  });

  // Le cas RÉEL mesuré le 17/08 : ~30 passages là où 44 étaient attendus.
  // ⚠️ `cadenceMinutes: 30` est écrit ici EXPRÈS : c'était la cadence visée ce jour-là.
  // Ce cas est un RÉCIT daté, pas une propriété — le dériver de la constante courante
  // réécrirait une mesure, ce qui est précisément ce qu'on ne fait pas d'un récit.
  it("détecte le tiers de passages manquants observé en production", () => {
    const passages = reguliers(30, 41); // écart médian réel de 41 min
    const c = analyserCadence({
      passages,
      maintenant: T,
      fenetreHeures: 22,
      cadenceMinutes: 30,
    });
    expect(c.ecartMedianMinutes).toBe(41);
    expect(c.couverture).toBeLessThan(0.8);
    expect(graviteCadence(c)).toBe("degradee");
  });

  it("compte les trous et combien de passages ils ont sauté", () => {
    const passages: PassagePoll[] = [
      { t: ilYA(200), ok: true },
      { t: ilYA(99), ok: true }, // trou de 101 min — le maximum mesuré en production
      { t: ilYA(69), ok: true },
    ];
    // Récit daté, comme ci-dessus : 101 min ont été mesurés SOUS une cadence de 30 min.
    const c = analyserCadence({ passages, maintenant: T, fenetreHeures: 24, cadenceMinutes: 30 });
    expect(c.trous).toHaveLength(1);
    expect(Math.round(c.trous[0]!.minutes)).toBe(101);
    // 101 min à 30 de cadence : deux passages sautés avant celui qui a fini par tourner.
    expect(c.trous[0]!.passagesManques).toBe(2);
  });

  // ⚠️ PROPRIÉTÉ, donc dérivée du seuil : un écart qui reste SOUS le seuil d'oubli est du
  // retard, pas un passage sauté. Les instants étaient en dur (45 min, juste sous le seuil
  // de 60) et le cas s'est inversé tout seul quand la cadence a changé.
  it("ne compte PAS comme trou un écart de simple retard", () => {
    const juste = seuilOubliMinutes() - 1;
    const passages: PassagePoll[] = [
      { t: ilYA(juste * 3), ok: true },
      { t: ilYA(juste * 2), ok: true },
      { t: ilYA(juste), ok: true },
    ];
    const c = analyserCadence({ passages, maintenant: T });
    expect(c.trous).toHaveLength(0);
  });

  // ⚠️ Le trou de FIN est EN COURS : le confondre avec les autres ferait clignoter une
  // alerte à chaque fois qu'on regarde l'écran 31 min après le dernier poll.
  it("traite le retard EN COURS à part des trous refermés", () => {
    const sousLeSeuil = seuilOubliMinutes() - 1;
    const c = analyserCadence({
      passages: [
        { t: ilYA(sousLeSeuil * 2), ok: true },
        { t: ilYA(sousLeSeuil), ok: true },
      ],
      maintenant: T,
    });
    expect(c.trous).toHaveLength(0); // l'écart entre les deux reste sous le seuil
    expect(Math.round(c.depuisDernierMinutes!)).toBe(sousLeSeuil);
    expect(c.enRetardMaintenant).toBe(false);
  });

  it("signale un retard en cours au-delà du seuil", () => {
    const c = analyserCadence({
      passages: [{ t: ilYA(seuilOubliMinutes() + 15), ok: true }],
      maintenant: T,
    });
    expect(c.enRetardMaintenant).toBe(true);
  });

  it("ignore ce qui est hors de la fenêtre, et le futur", () => {
    const passages: PassagePoll[] = [
      { t: ilYA(60 * 48), ok: true }, // deux jours : hors fenêtre de 24 h
      { t: ilYA(30), ok: true },
      { t: new Date(T.getTime() + 60_000), ok: true }, // dans le futur
    ];
    const c = analyserCadence({ passages, maintenant: T, fenetreHeures: 24 });
    expect(c.nbPassages).toBe(1);
  });

  it("borne la couverture à 1 — un doublon n'est pas une meilleure couverture", () => {
    const c = analyserCadence({ passages: reguliers(96, 15), maintenant: T, fenetreHeures: 24 });
    expect(c.couverture).toBe(1);
  });
});

describe("graviteCadence", () => {
  it("juge « rompue » sous la moitié des passages attendus", () => {
    const c = analyserCadence({ passages: reguliers(20, 72), maintenant: T, fenetreHeures: 24 });
    expect(c.couverture).toBeLessThan(0.5);
    expect(graviteCadence(c)).toBe("rompue");
  });

  it("juge « rompue » quand plus rien n'arrive depuis trois heures", () => {
    const c = analyserCadence({ passages: [{ t: ilYA(200), ok: true }], maintenant: T });
    expect(graviteCadence(c)).toBe("rompue");
  });
});

describe("consequenceCadence", () => {
  // La statistique seule ne dit rien à personne. C'est la PHRASE qui relie « trou de
  // 101 min » à « la recharge d'hier soir n'existe nulle part ».
  it("relie le plus grand trou à ce qu'il fait disparaître", () => {
    const c = analyserCadence({
      passages: [{ t: ilYA(200), ok: true }, { t: ilYA(99), ok: true }],
      maintenant: T,
    });
    const phrase = consequenceCadence(c)!;
    expect(phrase).toContain("101 min");
    expect(phrase).toMatch(/recharge|trajet/);
  });

  it("ne dit RIEN quand tout va bien — une phrase rassurante serait du bruit", () => {
    expect(consequenceCadence(analyserCadence({ passages: reguliers(48), maintenant: T }))).toBeNull();
    expect(consequenceCadence(analyserCadence({ passages: [], maintenant: T }))).toBeNull();
  });
});

describe("mediane", () => {
  // Pas la moyenne : un seul trou de 101 min donnerait une « cadence moyenne » que le poll
  // n'a jamais eue.
  it("résiste à une valeur extrême", () => {
    expect(mediane([30, 30, 30, 30, 101])).toBe(30);
  });

  it("moyenne les deux centrales sur un compte pair", () => {
    expect(mediane([10, 20, 30, 40])).toBe(25);
  });
});
