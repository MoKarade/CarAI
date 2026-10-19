// lib/vehicle/dateQuebec.ts — un instant écrit à l'heure du Québec, pour l'écran.
//
// Pourquoi : `toISOString()` donne l'heure UTC, soit 4 h (l'été) ou 5 h (l'hiver) d'avance
// sur ce que Marc lit sur sa montre. Format voulu : « 12 août, 10 h 03 ».

import { FUSEAU_MARC } from "./fenetre";

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** « 12 août, 10 h 03 » à l'heure du Québec. PURE. */
export function dateHeureQuebec(instant: Date, fuseau = FUSEAU_MARC): string {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const valeur = (type: string) => parties.find((p) => p.type === type)?.value ?? "";
  const mois = MOIS[Number(valeur("month")) - 1] ?? "";
  return `${Number(valeur("day"))} ${mois}, ${Number(valeur("hour"))} h ${valeur("minute")}`;
}
