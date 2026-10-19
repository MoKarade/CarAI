-- 0006 — purge des métriques qui n'ont JAMAIS porté la moindre valeur.
--
-- Décision de Marc, répétée le 19/08/2026 : « supprime-les ». La souscription élargie du
-- 06/08 a abonné CarAI à des signaux que la bZ refuse (VEHICLE_NOT_CAPABLE) : une ligne
-- s'écrit à chaque livraison, sans jamais aucune valeur — ampérages, tension, puissance de
-- charge, températures, batterie 12 V, carburant sur un électrique…
--
-- ⚠️ CE QUE 0005 A RATÉ, ET QU'IL NE FAUT PAS REFAIRE : sa clause ne regardait que
-- value_numeric et value_text. Une métrique dont les valeurs vivent UNIQUEMENT dans
-- value_json — position, pression des pneus, état des ouvrants — y passait pour « n'ayant
-- jamais rien livré ». Les TROIS colonnes sont donc testées ici, exactement comme
-- `porteValeur` (lib/smartcar/ingest.ts) et comme le comptage de `inventaireMesures`.
--
-- BORNÉE PAR CONSTRUCTION : il suffit d'UNE SEULE ligne portant une valeur, dans n'importe
-- laquelle des trois colonnes, pour que toute l'histoire de la métrique soit conservée. Les
-- mesures RÉELLES restent à vie (décision du 06/08, inchangée).
--
-- ⚠️ Les livraisons futures recréeront de telles lignes au compte-gouttes : c'est normal, et
-- c'est `estMuette` (lib/vehicle/analyse.ts) qui les tient hors des écrans durablement. Une
-- migration nettoie l'accumulé ; elle ne remplace pas la règle d'affichage.
DELETE FROM "vehicle_snapshots"
WHERE "metric_type" IN (
  SELECT "metric_type"
  FROM "vehicle_snapshots"
  GROUP BY "metric_type"
  HAVING bool_and(
    "value_numeric" IS NULL
    AND ("value_text" IS NULL OR "value_text" = '')
    AND "value_json" IS NULL
  )
);
