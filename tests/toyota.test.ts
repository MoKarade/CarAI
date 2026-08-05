// tests/toyota.test.ts — module Toyota : OTP, poll deux vitesses, santé/isolation (Doc 3).

import { describe, expect, it } from "vitest";
import { codeUtilisable, expediteurToyota, extraireCodeOtp } from "@/lib/toyota/otp";
import {
  deciderPoll,
  etatApresCycle,
  PLANCHER_REVEIL_MINUTES,
  SEUIL_DEPLACEMENT_KM,
} from "@/lib/toyota/poll";
import {
  apresEchec,
  apresSucces,
  moduleActif,
  ressembleABlocageToyota,
  SEUIL_DESACTIVATION,
} from "@/lib/toyota/health";
import { SANTE_TOYOTA_DEFAUT } from "@/lib/config";

const MAINTENANT = new Date("2026-08-05T12:00:00.000Z");

function ilYA(minutes: number): Date {
  return new Date(MAINTENANT.getTime() - minutes * 60_000);
}

describe("extraireCodeOtp", () => {
  it("trouve un code ancré à sa formulation", () => {
    const r = extraireCodeOtp("Your verification code: 483920. It expires in 10 minutes.");
    expect(r.code).toBe("483920");
    expect(r.methode).toBe("ancrage");
  });

  it("trouve un code ancré en français", () => {
    expect(extraireCodeOtp("Votre code de vérification est 112233.").code).toBe("112233");
  });

  it("trouve un code annoncé avant sa formulation", () => {
    expect(extraireCodeOtp("665544 is your verification code").code).toBe("665544");
  });

  it("préfère le code ANCRÉ même quand d'autres suites de six chiffres traînent", () => {
    // Le bug qu'on évite : un identifiant de message attrapé à la place du vrai code.
    const corps =
      "Ref 998877. Message id 123456. Your security code: 424242. Ticket 777888.";
    expect(extraireCodeOtp(corps).code).toBe("424242");
  });

  it("accepte un candidat unique sans ancrage", () => {
    const r = extraireCodeOtp("Toyota\n\n314159\n\nMerci.");
    expect(r.code).toBe("314159");
    expect(r.methode).toBe("candidat_unique");
  });

  it("REFUSE de choisir entre plusieurs candidats non ancrés", () => {
    // Refuser vaut mieux que tirer au sort : un code faux consomme la fenêtre de validité
    // et fait passer une erreur d'extraction pour une panne côté Toyota.
    const r = extraireCodeOtp("Codes possibles : 111111 et 222222.");
    expect(r.code).toBeNull();
    expect(r.methode).toBe("ambigu");
  });

  it("ne découpe pas une suite plus longue de chiffres", () => {
    expect(extraireCodeOtp("Numéro de dossier 1234567890.").code).toBeNull();
  });

  it("lit un corps HTML", () => {
    const html = "<html><body><p>Your verification code: <b>987654</b></p></body></html>";
    expect(extraireCodeOtp(html).code).toBe("987654");
  });

  it("rend null sur un corps vide", () => {
    expect(extraireCodeOtp("").code).toBeNull();
  });
});

describe("expediteurToyota", () => {
  it("accepte un expéditeur Toyota", () => {
    expect(expediteurToyota("donotreply@toyotaconnectedservices.com")).toBe(true);
  });
  it("refuse un expéditeur sans rapport et l'absence d'expéditeur", () => {
    expect(expediteurToyota("promo@exemple.com")).toBe(false);
    expect(expediteurToyota(null)).toBe(false);
  });
});

describe("codeUtilisable", () => {
  it("accepte un code frais et non consommé", () => {
    expect(
      codeUtilisable({ recuLe: ilYA(2), consommeLe: null, maintenant: MAINTENANT }),
    ).toBe(true);
  });

  it("refuse un code déjà consommé — sinon on le rejoue en boucle", () => {
    expect(
      codeUtilisable({ recuLe: ilYA(2), consommeLe: ilYA(1), maintenant: MAINTENANT }),
    ).toBe(false);
  });

  it("refuse un code trop vieux", () => {
    expect(
      codeUtilisable({ recuLe: ilYA(45), consommeLe: null, maintenant: MAINTENANT }),
    ).toBe(false);
  });
});

describe("deciderPoll — le réveil forcé reste l'exception", () => {
  const etatNeuf = { dernierPollLe: null, dernierReveilLe: null, dernierOdometre: null };

  it("poll léger au premier cycle, sans réveiller le véhicule", () => {
    const d = deciderPoll({ etat: etatNeuf, maintenant: MAINTENANT, odometreCourant: null });
    expect(d.pollLeger).toBe(true);
    expect(d.reveilForce).toBe(false);
  });

  it("ne fait rien avant l'intervalle", () => {
    const d = deciderPoll({
      etat: { ...etatNeuf, dernierPollLe: ilYA(30) },
      maintenant: MAINTENANT,
      odometreCourant: null,
    });
    expect(d.pollLeger).toBe(false);
    expect(d.reveilForce).toBe(false);
  });

  it("réveille quand le véhicule vient de rouler", () => {
    const d = deciderPoll({
      etat: { dernierPollLe: ilYA(130), dernierReveilLe: ilYA(200), dernierOdometre: 4200 },
      maintenant: MAINTENANT,
      odometreCourant: 4230,
    });
    expect(d.reveilForce).toBe(true);
    expect(d.raisonReveil).toBe("vehicule_vient_de_s_arreter");
  });

  it("ne réveille pas pour une variation d'odomètre sous le seuil (bruit d'arrondi)", () => {
    const d = deciderPoll({
      etat: { dernierPollLe: ilYA(130), dernierReveilLe: ilYA(200), dernierOdometre: 4200 },
      maintenant: MAINTENANT,
      odometreCourant: 4200 + SEUIL_DEPLACEMENT_KM / 2,
    });
    expect(d.reveilForce).toBe(false);
  });

  it("respecte le plancher entre deux réveils, même si le véhicule a roulé", () => {
    // C'est la protection de la batterie 12 V : un long trajet ferait sinon réveiller le
    // véhicule à chaque cycle.
    const d = deciderPoll({
      etat: {
        dernierPollLe: ilYA(130),
        dernierReveilLe: ilYA(PLANCHER_REVEIL_MINUTES - 10),
        dernierOdometre: 4200,
      },
      maintenant: MAINTENANT,
      odometreCourant: 4300,
    });
    expect(d.reveilForce).toBe(false);
  });

  it("honore une demande explicite de Marc", () => {
    const d = deciderPoll({
      etat: etatNeuf,
      maintenant: MAINTENANT,
      odometreCourant: null,
      demandeExplicite: true,
    });
    expect(d.reveilForce).toBe(true);
    expect(d.raisonReveil).toBe("demande_explicite");
  });

  it("soumet MÊME la demande explicite au plancher (bouton cliqué vingt fois)", () => {
    const d = deciderPoll({
      etat: { ...etatNeuf, dernierReveilLe: ilYA(5) },
      maintenant: MAINTENANT,
      odometreCourant: null,
      demandeExplicite: true,
    });
    expect(d.reveilForce).toBe(false);
    expect(d.pollLeger).toBe(true);
  });
});

describe("etatApresCycle", () => {
  it("n'avance la date de réveil QUE si un réveil a eu lieu", () => {
    // Sans ce garde, le plancher se réinitialiserait à chaque cycle et laisserait passer
    // des réveils bien plus souvent que prévu — visible seulement sur une batterie à plat.
    const etat = { dernierPollLe: ilYA(200), dernierReveilLe: ilYA(90), dernierOdometre: 10 };
    const apres = etatApresCycle({
      etat,
      decision: { pollLeger: true, reveilForce: false, raisonReveil: "aucune", explication: "" },
      odometreCourant: 20,
      maintenant: MAINTENANT,
    });
    expect(apres.dernierReveilLe).toEqual(etat.dernierReveilLe);
    expect(apres.dernierPollLe).toEqual(MAINTENANT);
    expect(apres.dernierOdometre).toBe(20);
  });
});

describe("moduleActif — désactivé par défaut", () => {
  const base = { TOYOTA_USERNAME: "a@b.c", TOYOTA_PASSWORD: "x" };

  it("refuse tant que TOYOTA_NA_ENABLED n'est pas explicitement true", () => {
    const r = moduleActif({ sante: SANTE_TOYOTA_DEFAUT, maintenant: MAINTENANT, env: base });
    expect(r.actif).toBe(false);
    expect(r.raison).toContain("désactivé");
  });

  it("refuse sans identifiants même si le drapeau est posé", () => {
    const r = moduleActif({
      sante: SANTE_TOYOTA_DEFAUT,
      maintenant: MAINTENANT,
      env: { TOYOTA_NA_ENABLED: "true" },
    });
    expect(r.actif).toBe(false);
  });

  it("accepte quand tout est configuré", () => {
    const r = moduleActif({
      sante: SANTE_TOYOTA_DEFAUT,
      maintenant: MAINTENANT,
      env: { ...base, TOYOTA_NA_ENABLED: "true" },
    });
    expect(r.actif).toBe(true);
  });

  it("reste désactivé pendant le délai après une désactivation automatique", () => {
    const r = moduleActif({
      sante: { ...SANTE_TOYOTA_DEFAUT, desactiveLe: ilYA(60).toISOString() },
      maintenant: MAINTENANT,
      env: { ...base, TOYOTA_NA_ENABLED: "true" },
    });
    expect(r.actif).toBe(false);
  });

  it("RETENTE une fois le délai écoulé — le chemin de retour existe", () => {
    // Sans ce chemin, une panne de quelques heures condamnerait le module à vie.
    const r = moduleActif({
      sante: { ...SANTE_TOYOTA_DEFAUT, desactiveLe: ilYA(60 * 30).toISOString() },
      maintenant: MAINTENANT,
      env: { ...base, TOYOTA_NA_ENABLED: "true" },
    });
    expect(r.actif).toBe(true);
  });
});

describe("santé — le compteur mesure des échecs CONSÉCUTIFS", () => {
  it("désactive au seuil", () => {
    let sante = SANTE_TOYOTA_DEFAUT;
    for (let i = 0; i < SEUIL_DESACTIVATION; i += 1) {
      sante = apresEchec({ sante, erreur: "boom", maintenant: MAINTENANT });
    }
    expect(sante.echecsConsecutifs).toBe(SEUIL_DESACTIVATION);
    expect(sante.desactiveLe).not.toBeNull();
  });

  it("un seul succès remet le compteur à zéro", () => {
    // Sinon cinq pannes réparties sur six mois désactiveraient un module qui marche : un
    // compteur cumulatif ne mesure pas une panne, il mesure l'âge.
    let sante = SANTE_TOYOTA_DEFAUT;
    for (let i = 0; i < SEUIL_DESACTIVATION - 1; i += 1) {
      sante = apresEchec({ sante, erreur: "boom", maintenant: MAINTENANT });
    }
    sante = apresSucces(sante, MAINTENANT);
    expect(sante.echecsConsecutifs).toBe(0);
    expect(sante.desactiveLe).toBeNull();

    sante = apresEchec({ sante, erreur: "boom", maintenant: MAINTENANT });
    expect(sante.desactiveLe).toBeNull();
  });

  it("un succès lève une désactivation en cours", () => {
    const desactive = { ...SANTE_TOYOTA_DEFAUT, desactiveLe: MAINTENANT.toISOString() };
    expect(apresSucces(desactive, MAINTENANT).desactiveLe).toBeNull();
  });
});

describe("ressembleABlocageToyota", () => {
  it("reconnaît les signatures documentées d'un blocage", () => {
    expect(ressembleABlocageToyota("Not Logged In")).toBe(true);
    expect(ressembleABlocageToyota("KeyError: 'vehicleStatus'")).toBe(true);
    expect(ressembleABlocageToyota("Cannot read properties of undefined")).toBe(true);
  });

  it("ne crie pas au blocage sur un incident réseau ordinaire", () => {
    expect(ressembleABlocageToyota("ETIMEDOUT")).toBe(false);
  });
});
