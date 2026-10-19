// tests/commandes.test.ts — les gardes des commandes envoyées au véhicule.
//
// Ce que ces tests protègent n'est pas un affichage : c'est une portière qui s'ouvre dans
// la rue. Le garde qui compte est celui qui tourne CÔTÉ SERVEUR — un `required` sur une
// case à cocher vit dans le navigateur et ne rencontre jamais une requête fabriquée.

import { describe, expect, it } from "vitest";
import {
  COMMANDES_OFFERTES,
  autoriserCommande,
  commandeOfferte,
  libelleStatut,
  TON_PAR_STATUT,
} from "@/lib/vehicle/commandes";
import { CHEMINS_COMMANDES } from "@/lib/smartcar/commands";

describe("le catalogue", () => {
  // ⚠️ Une commande offerte à l'écran sans chemin Smartcar partirait vers `undefined`.
  it("n'offre que des commandes que Smartcar sait router", () => {
    for (const c of COMMANDES_OFFERTES) {
      expect(CHEMINS_COMMANDES[c.type], `pas de chemin pour ${c.type}`).toBeTruthy();
    }
  });

  it("ne propose pas deux fois la même commande", () => {
    const types = COMMANDES_OFFERTES.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
  });

  // ⚠️ LE test de ce fichier. `unlock` ouvre une voiture garée dans la rue, et rien dans
  // l'app ne peut la refermer si Marc n'est pas à côté. Si un jour quelqu'un retire cette
  // exigence, c'est ici que ça doit tomber.
  it("EXIGE une confirmation pour déverrouiller", () => {
    expect(commandeOfferte("unlock")!.confirmationRequise).toBe(true);
  });

  // Et l'inverse compte tout autant : exiger une confirmation partout apprend à cocher
  // sans lire, ce qui détruit la valeur de celle qui protège vraiment quelque chose.
  it("n'exige PAS de confirmation pour ce qui est réversible", () => {
    for (const type of ["lock", "start_charge", "stop_charge", "set_charge_limit"]) {
      expect(commandeOfferte(type)!.confirmationRequise, type).toBe(false);
    }
  });

  it("ne connaît que ce qu'il offre", () => {
    expect(commandeOfferte("constructor")).toBeNull();
    expect(commandeOfferte("toString")).toBeNull();
    expect(commandeOfferte("")).toBeNull();
    expect(commandeOfferte(null)).toBeNull();
    expect(commandeOfferte("open_trunk")).toBeNull();
  });
});

describe("autoriserCommande", () => {
  it("laisse passer une commande réversible sans confirmation", () => {
    const r = autoriserCommande({ type: "lock", confirme: false });
    expect(r.ok).toBe(true);
  });

  // ⚠️ La garde côté SERVEUR : une requête POST fabriquée à la main ne rencontre jamais le
  // `required` du navigateur. Sans cette vérification, déverrouiller ne demanderait rien.
  it("REFUSE un déverrouillage non confirmé, même si le navigateur l'a laissé passer", () => {
    const r = autoriserCommande({ type: "unlock", confirme: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("confirmation");
      expect(r.motif).toContain("effet physique");
    }
  });

  it("laisse passer un déverrouillage CONFIRMÉ", () => {
    expect(autoriserCommande({ type: "unlock", confirme: true }).ok).toBe(true);
  });

  // ⚠️ La table des chemins Smartcar ne doit pas être atteignable par une valeur d'URL
  // arbitraire — ni par un nom de propriété héritée d'`Object`.
  it("refuse tout ce qui n'est pas au catalogue", () => {
    for (const type of ["", null, undefined, "constructor", "__proto__", "start_engine"]) {
      const r = autoriserCommande({ type, confirme: true });
      expect(r.ok, `${type} aurait dû être refusé`).toBe(false);
    }
  });
});

describe("ce qu'on dit du résultat", () => {
  // ⚠️ Smartcar peut accepter une commande sans que l'effet atteigne le véhicule
  // (Doc 4 §4.5). Aucun libellé ne doit donc affirmer que l'action a EU LIEU.
  it("n'affirme jamais que l'action a eu lieu", () => {
    for (const statut of ["success", "pending", "failed", "unknown"]) {
      const texte = libelleStatut(statut).toLowerCase();
      expect(texte).not.toMatch(/verrouill(é|ee)|effectu|réussi|fait/);
    }
    expect(libelleStatut("success")).toBe("Acceptée par Smartcar");
  });

  // « Sort inconnu » n'est pas « refusée » : le ranger dans l'échec ferait croire qu'il ne
  // s'est rien passé, alors que le véhicule a peut-être reçu l'ordre.
  it("distingue « refusée » de « on ne sait pas »", () => {
    expect(libelleStatut("failed")).not.toBe(libelleStatut("unknown"));
    expect(TON_PAR_STATUT.failed).toBe("danger");
    expect(TON_PAR_STATUT.unknown).toBe("attention");
  });

  it("rend le statut brut plutôt que rien sur une valeur inattendue", () => {
    expect(libelleStatut("bizarre")).toBe("bizarre");
  });
});
