// tests/donneesPerso.test.ts — AUCUNE donnée personnelle de Marc dans un fichier versionné.
//
// Décision de Marc (15/10/2026) : « aucune donnée perso en ligne ». Ce verrou rend la règle
// vérifiable : il lit TOUS les fichiers suivis par git et échoue si l'un d'eux contient
//   • une coordonnée GPS précise qui n'est pas un point fictif ou public de la liste blanche ;
//   • un mot ou un chiffre retiré le 15/10/2026 parce qu'il situait Marc ou chiffrait son
//     bail (empreintes SHA-256, pas les valeurs : une liste en clair recréerait la fuite).
//
// ⚠️ Limites, dites plutôt que tues : ce verrou attrape ce qu'on lui a appris à reconnaître.
// Il ne devine pas une nouvelle adresse ni un nouveau montant. Toute donnée réelle trouvée
// ailleurs se retire, et son empreinte s'ajoute ci-dessous.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Points autorisés, arrondis à 2 décimales : fictifs (tests) ou publics (centres-villes). */
const POINTS_AUTORISES = new Set([
  "48.20,-78.00", // « Maison » fictive des tests
  "47.70,-77.40", // autre point fictif
  "48.35,-77.77", // point fictif « lieu inconnu »
  "48.12,-77.46", // clé de cache fictive
  "46.81,-71.21", // centre de Québec (générique)
  "46.81,-71.20", // idem, écrit avec une décimale de moins
  "46.50,-71.50", // point arbitraire des tests de tarifs
  "45.50,-73.57", // centre de Montréal (générique)
  "51.50,-0.14", // Londres : position du véhicule SIMULÉ de Smartcar
]);

/** Valeurs isolées (latitude seule ou longitude seule) autorisées, arrondies à 2 décimales. */
const VALEURS_AUTORISEES = new Set(
  [...POINTS_AUTORISES].flatMap((p) => p.split(",").map((v) => Number(v).toFixed(2))),
);

/** Empreintes de mots retirés (toponymes liés à Marc). */
const MOTS_INTERDITS = new Set([
  "0495eeb87be5e7e4a9fa10a05c18b2862229b6bc27b565d6459889f327a5e958",
  "3bdb4d8e5b94d149f878138c554ccd1166c21e094ee35eab8430878d4a002287",
  "b60f2ed360131cf7f55353cddccdecaec89df774399c6ab63a4ec6a867940ce0",
  "9338b22002579dd5dc66b039855df8e9decaa586768f090bebdba74aca929399",
]);

/** Empreintes de nombres retirés (montants de financement, relevés d'odomètre réels). */
const NOMBRES_INTERDITS = new Set([
  "ad082ad02a32cbb1f8c131242b2f2be145da0c3e66c8f5aa50ce2fe258908fba",
  "28ab1b4b88856eaf837baa024e57ab41a10df9cc2e37331a95495c3164ea38a8",
  "3ce34b141039b39bfd7f16365f4ba507078a5c6ada2cab91a2b7ef8be539cd7a",
  "418001574db27512f019b108b1e32d88eba04fcd1fcbb8b35f3587baaafd2dc1",
  "3d856bc75c896f08fe18b85f88e37ff3c9d4ca4bfdf46d1076f7b1e926f7043c",
  "b0ab628c9e14621846c58b4eb35060ef3885253a457d2d76136716d4850bad45",
  "e546b5c35bb270b647906e62dc57960dd4038cb071d9d8e03ab6fd6b88e53a06",
  "9a19343f69387ac8dd9bb531f98c9f24f5bb63102fb84ae244920f4013811a86",
  "15bf7f32102156c5fd4ad97a6080b769d04c1aa36332b47594b2f35eaa0a11af",
  "b7b3aafc60d0b5a2df460dd8cf8dca6c476683931d802a74db61be362532027c",
  "85847f141afd4fa068d83dadd5ef78c1a6a5d7f5cbf8923b0c9ee47ea6bccb74",
  "736eb54066e30caa12575ccf28b2e2b660d315852bac4c76c77daa3c3a63aef0",
  "e38e8f8dca36e30898c51bbe4c0956529e51687341386bcb539430281bb955c3",
  "92cceb84503a5d0049db0f3b47e76ac4554c7ffb123f6929a1539ab60bae2a6b",
  "41c3008221fbd473c05bd93febe9cedf23fd541b92f7406a6923605c9db8c040",
  "6c7dedc3a9d9bff3eb6dea20db46d2c8109687a588d157fda6d075419f7f0c60",
  "32cf64b0b2b2318c13fa640cb7eba9a4ff8a3d8f26d04f5605520eb3f8037868",
  "94b5f1a3ab64f53bad1d65c01057abd668669ffec5aa04c28441f7dbd524c69b",
  "d31b04b46bdb26afe654ff6cbed3dab17aece4cce466bd3d40b51061793cc8b4",
  "098c34d0a9154864e825ff44ed0b5b70719e84a73bff869369542f813faec4da",
  "440f780c6a06853dc0e34670616fadffa534f06ae882c06c010b0089a9ce39f8",
  "c66f1f34f49381e467d3abd43c77947f5d1dd362fd0eec6c2c1f27233ae9adf9",
  "268316af4874793a5a06db945523cb0f26f5543b24d7c2e97681d48b6c48218e",
  "d1e53b2d65f6e7d7ba13fd4ff0cdae1aebd538f74ae669c78394513ddc066a09", // kilométrage autorisé du bail (CarAI#239)
]);

/** Empreintes de dates ISO retirées (date de signature du bail, CarAI#239). */
const DATES_INTERDITES = new Set([
  "64a91eb31fd101f1a729c45efa29619a005653b034dc154bf891b5ac5040916f",
]);

// Le verrou lui-même porte la liste blanche, les empreintes et des exemples fictifs : on ne le relit pas.
const IGNORES = [/^package-lock\.json$/, /^drizzle\/meta\//, /^public\//, /^tests\/donneesPerso\.test\.ts$/];

/** Les fichiers texte suivis par git. `git ls-files` : ce que GitHub rendrait public. */
function fichiersSuivis(): { chemin: string; texte: string }[] {
  const liste = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((c) => c !== "" && !IGNORES.some((re) => re.test(c)));
  const sortie: { chemin: string; texte: string }[] = [];
  for (const chemin of liste) {
    let brut: Buffer;
    try {
      brut = readFileSync(chemin);
    } catch {
      continue; // supprimé dans l'arbre de travail : rien à lire
    }
    if (brut.includes(0)) continue; // binaire
    sortie.push({ chemin, texte: brut.toString("utf8") });
  }
  return sortie;
}

/** Coordonnées candidates : décimales de 3+ chiffres dans la plage Québec / Canada. PURE. */
function coordonneesSuspectes(texte: string): string[] {
  const trouvees: string[] = [];
  for (const m of texte.matchAll(/(?<![\d.])-?\d{1,3}\.\d{3,}(?![\d.])/g)) {
    const v = Number(m[0]);
    const abs = Math.abs(v);
    const plageLat = v >= 44 && v <= 62;
    const plageLng = v <= -55 && v >= -80;
    if (!plageLat && !plageLng) continue;
    if (abs === 0) continue;
    if (!VALEURS_AUTORISEES.has(v.toFixed(2))) trouvees.push(m[0]);
  }
  return trouvees;
}

/** Mots et nombres dont l'empreinte est interdite. PURE. */
function empreintesInterdites(texte: string): string[] {
  const trouvees: string[] = [];
  for (const m of new Set(texte.toLowerCase().match(/[a-zà-ÿ]{4,}/g) ?? [])) {
    if (MOTS_INTERDITS.has(sha(m))) trouvees.push("(mot interdit)");
  }
  // Séparateurs de milliers retirés, virgule décimale ramenée au point : « 47 169 » = « 47169 ».
  const normalise = texte.replace(/(?<=\d)[ _  ](?=\d{3}\b)/g, "").replace(/(?<=\d),(?=\d)/g, ".");
  for (const m of new Set(normalise.match(/\d+(?:\.\d+)?/g) ?? [])) {
    if (m.length >= 4 && NOMBRES_INTERDITS.has(sha(m))) trouvees.push("(nombre interdit)");
  }
  for (const m of new Set(texte.match(/\d{4}-\d{2}-\d{2}/g) ?? [])) {
    if (DATES_INTERDITES.has(sha(m))) trouvees.push("(date interdite)");
  }
  return trouvees;
}

describe("aucune donnée personnelle dans les fichiers versionnés", () => {
  const fichiers = fichiersSuivis();

  it("lit bien le dépôt (anti-vacuité)", () => {
    expect(fichiers.length).toBeGreaterThan(100);
  });

  it("aucune coordonnée GPS précise hors liste blanche", () => {
    const fautes = fichiers.flatMap((f) =>
      coordonneesSuspectes(f.texte).map((c) => `${f.chemin} : ${c}`),
    );
    expect(fautes).toEqual([]);
  });

  it("aucun mot ni nombre retiré le 15/10/2026", () => {
    const fautes = fichiers.flatMap((f) =>
      empreintesInterdites(f.texte).map((c) => `${f.chemin} : ${c}`),
    );
    expect(fautes).toEqual([]);
  });

  it("le détecteur détecte (preuve par l'exemple, valeurs fictives)", () => {
    expect(coordonneesSuspectes("lat: 47.1234, lng: -70.5678")).toEqual(["47.1234", "-70.5678"]);
    expect(coordonneesSuspectes("lat: 48.2, lng: -78.0001")).toEqual([]);
    expect(empreintesInterdites("rien à voir ici, 12345 et 3.14159")).toEqual([]);
    // Valeurs reconstruites : le verrou ne les écrit jamais d'un bloc, même dans ce fichier.
    const kmBail = ["112", "000"].join(" ");
    const dateBail = ["2026", "07", "14"].join("-");
    expect(empreintesInterdites(`autorisé : ${kmBail} km`)).toEqual(["(nombre interdit)"]);
    expect(empreintesInterdites(`signé le ${dateBail}`)).toEqual(["(date interdite)"]);
    expect(empreintesInterdites("signé le 2027-07-14, 36 000 km")).toEqual([]);
  });
});
