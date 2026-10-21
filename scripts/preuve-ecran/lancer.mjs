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
// Sortie : preuve-tendances.png (capture) et preuve-tendances.json (ce qui a été lu).
// Code de sortie : 0 si toutes les vérifications passent, 1 sinon.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encode } from "next-auth/jwt";
import { demarrerBaseFictive } from "./base-fictive.mjs";

const sortie = resolve(process.argv[2] ?? "preuve-ecran");
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

const base = await demarrerBaseFictive();
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
  const reponse = await page.goto(`${ORIGINE}/tendances`, { waitUntil: "networkidle" });
  verifie("avec la session d'essai, /tendances répond 200", reponse?.status() === 200, { statut: reponse?.status(), url: page.url() });

  await page.waitForSelector("h2", { timeout: 30_000 });
  const titres = await page.$$eval("main h2", (els) => els.map((e) => e.textContent?.trim() ?? ""));
  const courbes = await page.$$eval(".graphiques-lies figure.courbe figcaption", (els) =>
    els.map((e) => (e.textContent ?? "").trim().split("\n")[0]?.trim() ?? ""),
  );
  await page.screenshot({ path: resolve(sortie, "preuve-tendances.png"), fullPage: true });

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

  writeFileSync(resolve(sortie, "preuve-tendances.json"), JSON.stringify({ titres, courbes, verifs }, null, 2));
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
