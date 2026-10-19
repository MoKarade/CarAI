// tests/sentryConfig.test.ts — verrou de la configuration Sentry (CarAI#218).
//
// Trois promesses : sans DSN rien ne part (l'app construit et démarre sans bruit), même avec un
// DSN aucune donnée personnelle ne part (CarAI sert la position du véhicule), et la CSP laisse
// le navigateur joindre Sentry le jour où elle sera enforcée.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EN_TETES_SECURITE } from "../next.config.mjs";
import {
  PARAMETRES_RETIRES,
  optionsSentry,
  retirerDonneesPersonnelles,
  type EvenementNettoyable,
} from "@/lib/sentryConfig";

describe("optionsSentry", () => {
  it("est éteint sans DSN (absent, vide ou en blancs)", () => {
    for (const dsn of [undefined, "", "   "]) {
      const options = optionsSentry(dsn);
      expect(options.enabled, `dsn = ${JSON.stringify(dsn)}`).toBe(false);
      expect(options.dsn).toBeUndefined();
    }
  });

  it("est allumé avec un DSN, sans traces ni donnée personnelle par défaut", () => {
    const options = optionsSentry("  https://cle@exemple.invalid/1  ");
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe("https://cle@exemple.invalid/1");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
  });
});

describe("retirerDonneesPersonnelles", () => {
  it("retire corps, cookies, en-têtes, chaîne de requête, utilisateur et fil d'appels, garde le reste", () => {
    const evenement = retirerDonneesPersonnelles({
      message: "Erreur d'essai",
      request: {
        url: "https://exemple.invalid/page",
        data: { courriel: "fictif@exemple.invalid" },
        cookies: { session: "fictif" },
        headers: { authorization: "fictif", "x-forwarded-for": "203.0.113.7" },
        query_string: "jeton=fictif",
      } as Record<string, unknown>,
      user: { ip_address: "203.0.113.7", email: "fictif@exemple.invalid" },
      breadcrumbs: [{ category: "fetch", data: { url: "https://exemple.invalid/trajet?lat=1.5" } }],
    });
    expect(evenement.request).toEqual({ url: "https://exemple.invalid/page" });
    expect(evenement).not.toHaveProperty("user");
    expect(evenement).not.toHaveProperty("breadcrumbs");
    expect(evenement.message).toBe("Erreur d'essai");
  });

  it("accepte un événement sans requête ni utilisateur", () => {
    expect(retirerDonneesPersonnelles({ message: "seul" })).toEqual({ message: "seul" });
  });

  it("remplace les paramètres SQL du message d'une erreur de base, garde la requête", () => {
    const evenement: EvenementNettoyable = {
      exception: {
        values: [
          { value: "Failed query: select * from mesures where lat = $1 and lon = $2\nparams: 1.5,2.5,odometre=99" },
          { value: "Erreur sans paramètres" },
          {},
        ],
      },
    };
    const propre = retirerDonneesPersonnelles(evenement);
    const [requete, autre, vide] = propre.exception!.values!;
    expect(requete!.value).toContain("Failed query: select * from mesures where lat = $1 and lon = $2");
    expect(requete!.value).toContain(PARAMETRES_RETIRES);
    expect(requete!.value).not.toMatch(/1\.5|2\.5|odometre/);
    expect(autre!.value).toBe("Erreur sans paramètres");
    expect(vide).toEqual({});
  });

  it("est bien branché dans les options (beforeSend)", () => {
    const options = optionsSentry("https://cle@exemple.invalid/1");
    expect(options.beforeSend({ user: { email: "x" } })).not.toHaveProperty("user");
  });
});

describe("branchement", () => {
  const lire = (chemin: string): string => readFileSync(join(process.cwd(), chemin), "utf8");

  it("aucun fichier ne réactive l'envoi de données personnelles", () => {
    for (const chemin of ["instrumentation.ts", "instrumentation-client.ts", "lib/sentryConfig.ts"]) {
      expect(lire(chemin), chemin).not.toMatch(/sendDefaultPii\s*:\s*true/);
    }
  });

  it("le serveur et le navigateur passent par optionsSentry, jamais par un Sentry.init libre", () => {
    for (const chemin of ["instrumentation.ts", "instrumentation-client.ts"]) {
      expect(lire(chemin), chemin).toMatch(/Sentry\.init\(optionsSentry\(/);
    }
  });

  it("les deux écrans d'erreur envoient l'erreur à Sentry", () => {
    for (const chemin of ["app/error.tsx", "app/global-error.tsx"]) {
      expect(lire(chemin), chemin).toContain("Sentry.captureException(error)");
    }
  });

  it("la CSP laisse le navigateur joindre Sentry (région us de l'organisation mokarade)", () => {
    const csp = EN_TETES_SECURITE.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value;
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src "))!;
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://*.ingest.us.sentry.io");
  });
});
