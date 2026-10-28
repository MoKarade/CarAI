// scripts/preuve-ecran/lancer.mjs — lit un écran de l'app CONSTRUITE, avec une session d'essai.
//
// POURQUOI (CarAI#44). Tous les écrans sont derrière la session du hub : sans cookie, 307 vers
// /login. Une tâche d'écran ne pouvait donc être lue en production que par Marc, ou avec ses
// cookies — ce que ni lui ni le PC ne doivent faire. Ici, la session n'existe que le temps du
// contrôle : un cookie Auth.js signé avec un AUTH_SECRET JETABLE (tiré au hasard à chaque
// lancement) pour une adresse FICTIVE déclarée propriétaire dans CE processus seulement.
// Le garde (`middleware.ts`) ne change pas d'un octet : il est exercé, pas contourné.
//
// Usage (après `npm run build`) : node scripts/preuve-ecran/lancer.mjs [dossier-de-sortie]
//   PLAYWRIGHT_MODULE : chemin d'un module Playwright si le paquet n'est pas dans node_modules.
//   PREUVE_JOURS : durée des relevés fictifs (6 par défaut). Au moins 20 : la prévision de fin de
//   mois (CarAI#31) doit apparaître, avec sa fourchette ; sinon elle doit se taire et dire pourquoi.
//   PREUVE_NOM : nom des fichiers de sortie (« tendances » par défaut).
//   PREUVE_ACTIVITE : 1 (par défaut quand la prévision n'est PAS attendue) lit aussi Activité et
//   rejoue le geste « Nommer ce lieu » (CarAI#8) : la ligne avant, le nommage, la ligne après.
// Sortie : preuve-<nom>.png (capture) et preuve-<nom>.json (ce qui a été lu).
// Code de sortie : 0 si toutes les vérifications passent, 1 sinon.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encode } from "next-auth/jwt";
import { demarrerBaseFictive } from "./base-fictive.mjs";

const sortie = resolve(process.argv[2] ?? "preuve-ecran");
const JOURS = Number(process.env.PREUVE_JOURS ?? 6);
const NOM = process.env.PREUVE_NOM ?? "tendances";
const PREVISION_ATTENDUE = JOURS >= 20;
const LIRE_ACTIVITE = (process.env.PREUVE_ACTIVITE ?? (PREVISION_ATTENDUE ? "0" : "1")) === "1";
mkdirSync(sortie, { recursive: true });

const PORT_APP = Number(process.env.PREUVE_PORT ?? 3917);
const ORIGINE = `http://127.0.0.1:${PORT_APP}`;
const COOKIE = "authjs.session-token";
const EMAIL_ESSAI = "essai@example.invalid";

const verifs = [];
const verifie = (nom, ok, lu) => {
  verifs.push({ nom, ok: Boolean(ok), lu });
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${nom}${lu === undefined ? "" : ` — ${JSON.stringify(lu)}`}`);
};

async function attendre(fn, delaiMs, message) {
  const fin = Date.now() + delaiMs;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() > fin) throw new Error(message);
    await new Promise((ok) => setTimeout(ok, 500));
  }
}

const base = await demarrerBaseFictive({ jours: JOURS });
const secret = randomBytes(32).toString("base64url");

const app = spawn(resolve("node_modules/.bin/next"), ["start", "-p", String(PORT_APP), "-H", "127.0.0.1"], {
  env: {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${resolve("scripts/preuve-ecran/precharge.cjs")}`.trim(),
    PREUVE_BASE_URL: `http://127.0.0.1:${base.port}`,
    DATABASE_URL: "postgresql://essai:essai@base-fictive.example.invalid/essai",
    AUTH_SECRET: secret,
    AUTHORIZED_EMAIL: EMAIL_ESSAI,
    AUTH_COOKIE_DOMAIN: "",
    AUTH_URL: ORIGINE,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let journalApp = "";
app.stdout.on("data", (d) => (journalApp += d));
app.stderr.on("data", (d) => (journalApp += d));

let navigateur = null;
let code = 1;
try {
  await attendre(async () => (await fetch(`${ORIGINE}/login`, { redirect: "manual" })).status < 500, 60_000, "l'app ne répond pas");

  // 1. Le garde tient : sans cookie, on est renvoyé vers /login.
  const sansSession = await fetch(`${ORIGINE}/tendances`, { redirect: "manual" });
  verifie(
    "sans session, /tendances renvoie 307 vers /login (le garde n'est pas affaibli)",
    sansSession.status === 307 && (sansSession.headers.get("location") ?? "").includes("/login"),
    { statut: sansSession.status, location: sansSession.headers.get("location") },
  );

  // 2. Avec la session d'essai, l'écran se rend.
  const jeton = await encode({ token: { email: EMAIL_ESSAI, sub: "essai" }, secret, salt: COOKIE, maxAge: 3600 });
  const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
  navigateur = await (pw.chromium ?? pw.default.chromium).launch();
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 1600 }, locale: "fr-CA" });
  await contexte.addCookies([{ name: COOKIE, value: jeton, url: ORIGINE }]);
  const page = await contexte.newPage();
  // « domcontentloaded », pas « networkidle » ni « load » : LIA (montée sur toutes les pages) garde une requête ouverte vers le hub, injoignable ici.
  // Chaque contrôle attend ensuite SON élément (`waitForSelector`), donc rien n'est affaibli.
  const reponse = await page.goto(`${ORIGINE}/tendances`, { waitUntil: "domcontentloaded" });
  verifie("avec la session d'essai, /tendances répond 200", reponse?.status() === 200, { statut: reponse?.status(), url: page.url() });

  await page.waitForSelector("h2", { timeout: 30_000 });
  const titres = await page.$$eval("main h2", (els) => els.map((e) => e.textContent?.trim() ?? ""));
  const courbes = await page.$$eval(".graphiques-lies figure.courbe figcaption", (els) =>
    els.map((e) => (e.textContent ?? "").trim().split("\n")[0]?.trim() ?? ""),
  );
  const prevision = await page.$$eval("main li", (els) =>
    els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter((t) => t.startsWith("Prévision de fin de mois")),
  );
  const sansPrevision = await page.$$eval("main .hint", (els) =>
    els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter((t) => t.startsWith("Pas de prévision de fin de mois")),
  );
  await page.screenshot({ path: resolve(sortie, `preuve-${NOM}.png`), fullPage: true });

  verifie("le premier titre de bloc est « Consommation réelle » (CarAI#30)", titres[0] === "Consommation réelle", titres.slice(0, 4));
  verifie(
    "« Consommation réelle » vient avant « Le véhicule maintenant » (CarAI#30)",
    titres.indexOf("Consommation réelle") !== -1 &&
      titres.indexOf("Consommation réelle") < titres.indexOf("Le véhicule maintenant"),
    titres,
  );
  verifie(
    "la première courbe liée est « Consommation (estimation) » (CarAI#41)",
    (courbes[0] ?? "").startsWith("Consommation (estimation)"),
    courbes.slice(0, 4),
  );

  if (PREVISION_ATTENDUE) {
    // Une fourchette « A à B km · C à D kWh » : l'espace des milliers de fr-CA est insécable.
    const ligne = prevision[0] ?? "";
    verifie(
      "la prévision de fin de mois s'affiche, en fourchette km et kWh, étiquetée estimation (CarAI#31)",
      prevision.length === 1 &&
        ligne.includes("(estimation)") &&
        /\d \u00e0 [\d\s\u00a0\u202f]+ km · [\d\s\u00a0\u202f]+ \u00e0 [\d\s\u00a0\u202f]+ kWh/u.test(ligne.replace(/[\u00a0\u202f]/g, " ")) &&
        !/\$/.test(ligne),
      prevision,
    );
    verifie("la prévision ne se tait pas quand les relevés suffisent (CarAI#31)", sansPrevision.length === 0, sansPrevision);
  } else {
    verifie(
      "avec moins de 14 jours de relevés, la prévision se tait ET dit pourquoi (CarAI#31)",
      prevision.length === 0 && sansPrevision.length === 1 && /au moins 14/.test(sansPrevision[0] ?? ""),
      { prevision, sansPrevision },
    );
  }

  let activite = null;
  if (LIRE_ACTIVITE) {
    // ── Activité : « Nommer ce lieu » sur une recharge dont le lieu est inconnu (CarAI#8) ──
    const lignesRecharge = () =>
      page.$$eval("li.ev-recharge", (els) =>
        els.map((e) => ({
          ou: (e.querySelector(".ou")?.textContent ?? "").trim(),
          prix: (e.querySelector(".liens")?.textContent ?? "").replace(/\s+/g, " ").trim(),
          nommable: Boolean(e.querySelector(".nommer-lieu > summary")),
        })),
      );
    await page.goto(`${ORIGINE}/activite?periode=7j`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("li.ev-recharge", { timeout: 30_000 });
    const avant = await lignesRecharge();
    await page.screenshot({ path: resolve(sortie, "preuve-activite-avant.png"), fullPage: true });
    verifie(
      "avant : des recharges affichent « lieu inconnu » avec le geste « Nommer ce lieu » (CarAI#8)",
      avant.length > 0 && avant.every((l) => l.ou === "lieu inconnu" && l.nommable),
      { nb: avant.length, premiere: avant[0] },
    );
    verifie(
      "avant : leur coût est une estimation (« ~ ») (CarAI#8)",
      avant.every((l) => l.prix.startsWith("~")),
      avant.map((l) => l.prix),
    );

    await page.click("li.ev-recharge .nommer-lieu > summary");
    await page.fill("li.ev-recharge .nommer-lieu input[name=nom]", "Borne d'essai");
    await page.fill("li.ev-recharge .nommer-lieu input[name=tarif]", "0.15");
    await page.selectOption("li.ev-recharge .nommer-lieu select[name=mode]", "kwh");
    await page.click("li.ev-recharge .nommer-lieu button[type=submit]");
    // Succès : la page se rafraîchit et la ligne porte déjà le nom (le formulaire disparaît avec
    // « lieu inconnu »). Un refus, lui, resterait affiché dans `.cl-message`.
    await page.waitForFunction(
      () => [...document.querySelectorAll("li.ev-recharge .ou")].some((e) => e.textContent?.includes("Borne d'essai")),
      undefined,
      { timeout: 30_000 },
    );
    const refus = await page.$$eval("li.ev-recharge .nommer-lieu .cl-message.erreur", (els) =>
      els.map((e) => (e.textContent ?? "").trim()),
    );
    verifie("le geste aboutit sans refus : la ligne porte le nom sans recharger la page (CarAI#8)", refus.length === 0, refus);

    await page.goto(`${ORIGINE}/activite?periode=7j`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("li.ev-recharge", { timeout: 30_000 });
    const apres = await lignesRecharge();
    await page.screenshot({ path: resolve(sortie, "preuve-activite-apres.png"), fullPage: true });
    verifie(
      "après : toutes les recharges au même endroit, passées comme récentes, portent le nom (CarAI#8)",
      apres.length === avant.length && apres.every((l) => l.ou === "Borne d'essai" && !l.nommable),
      { nb: apres.length, premiere: apres[0] },
    );
    verifie(
      "après : avec un tarif, le coût n'est plus une estimation (« ~ ») (CarAI#8)",
      apres.every((l) => /\d/.test(l.prix) && !l.prix.startsWith("~")),
      apres.map((l) => l.prix),
    );

    await page.goto(`${ORIGINE}/reglages`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".liste-lieux li", { timeout: 30_000 });
    const lieuxReglages = await page.$$eval(".liste-lieux li", (els) =>
      els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    verifie(
      "le lieu rejoint la liste des lieux de Réglages, avec son tarif (CarAI#8)",
      lieuxReglages.length === 1 && /Borne d'essai/.test(lieuxReglages[0] ?? "") && /0[.,]150 \$\/kWh/.test(lieuxReglages[0] ?? ""),
      lieuxReglages,
    );
    activite = { avant, apres, lieuxReglages };
  }

  writeFileSync(resolve(sortie, `preuve-${NOM}.json`), JSON.stringify({ jours: JOURS, titres, courbes, prevision, sansPrevision, activite, verifs }, null, 2));
  code = verifs.every((v) => v.ok) ? 0 : 1;
} catch (e) {
  console.error(`ÉCHEC du contrôle : ${e?.message ?? e}`);
  writeFileSync(resolve(sortie, "journal-app.txt"), journalApp);
  code = 1;
} finally {
  if (navigateur) await navigateur.close();
  app.kill("SIGTERM");
  await base.arreter();
}
process.exit(code);
