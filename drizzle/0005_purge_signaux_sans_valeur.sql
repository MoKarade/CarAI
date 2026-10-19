-- 0005 — purge de l'HISTORIQUE des signaux qui n'ont JAMAIS porté de valeur.
-- Décision explicite de Marc (18/08/2026) : « supprime l'historique de toutes les données
-- qui ont jamais eu de data ». BORNÉE PAR CONSTRUCTION : une métrique dont UNE SEULE ligne
-- porte une valeur (numérique ou texte) est intégralement conservée — les MESURES restent
-- à vie (décision du 06/08, inchangée). Ne disparaissent que les lignes d'état sans aucune
-- valeur (statuts PERMISSION/COMPATIBILITY répétés de signaux que la bZ ne fournit pas).
-- ⚠️ Les livraisons futures peuvent recréer de telles lignes au compte-gouttes : c'est
-- l'inventaire de /donnees qui les masque durablement (nb_valeurs = 0).
DELETE FROM "vehicle_snapshots"
WHERE "metric_type" IN (
  SELECT "metric_type"
  FROM "vehicle_snapshots"
  GROUP BY "metric_type"
  HAVING bool_and("value_numeric" IS NULL AND ("value_text" IS NULL OR "value_text" = ''))
);
