"use client";

// app/reglages/purgeSimulee.tsx — l'écran de la seule opération irréversible de l'app.
//
// DEUX TEMPS, et c'est le cœur de la conception : l'inventaire est affiché ligne par ligne
// AVANT toute suppression, et c'est cette liste-là — ses identifiants — qui part au serveur.
// Ce qui disparaît est donc exactement ce qui a été lu, pas ce qu'un critère retrouverait au
// moment du clic.
//
// Chaque ligne porte SON MOTIF. « 42 lignes supprimées » ne se vérifie pas ; « position à
// Londres, le 6 août » se vérifie d'un coup d'œil, et c'est ce qui permet à Marc de refuser.

import { useState } from "react";
import { BoutonMaintenir } from "@/app/ui/BoutonMaintenir";
import { dateHeureQuebec } from "@/lib/vehicle/dateQuebec";
import {
  LIBELLES_MOTIFS,
  MESSAGE_ECHEC_INVENTAIRE,
  MESSAGE_ECHEC_SUPPRESSION,
  type CandidatePurge,
  type InventairePurge,
  type MotifPurge,
} from "@/lib/vehicle/purgeSimulee";
import { chargerInventairePurge, purgerMesures } from "./actions";

/**
 * Le point d'entrée de la section : un bouton, puis l'inventaire (CarAI#202).
 *
 * ⚠️ Avant, la page lisait l'inventaire à CHAQUE ouverture de Réglages — une lecture de
 * toute la table pour une section presque jamais ouverte, pendant que la limite mensuelle
 * de transfert Neon était dépassée. Rien n'est lu tant que Marc ne le demande pas.
 */
export function PurgeSimulee() {
  const [inventaire, setInventaire] = useState<InventairePurge | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [echec, setEchec] = useState(false);

  async function charger() {
    setOccupe(true);
    setEchec(false);
    try {
      setInventaire(await chargerInventairePurge());
    } catch {
      // Jamais l'erreur brute, et SURTOUT pas un écran « rien à purger » : une lecture en
      // panne ne doit pas se lire comme une base propre.
      setEchec(true);
    } finally {
      setOccupe(false);
    }
  }

  if (inventaire) {
    return <InventaireAPurger candidates={inventaire.candidates} parMotif={inventaire.parMotif} />;
  }

  return (
    <>
      <h2>Données du véhicule de test</h2>
      <p className="hint">
        La recherche des mesures impossibles parcourt toute la base : elle ne se lance que sur
        ta demande. Elle ne supprime rien.
      </p>
      <button
        type="button"
        className="bouton-rafraichir touch-target"
        disabled={occupe}
        aria-busy={occupe}
        onClick={charger}
      >
        {occupe ? "Recherche…" : "Chercher les mesures impossibles"}
      </button>
      {echec && (
        <p className="hint statut-attention" role="status">
          {MESSAGE_ECHEC_INVENTAIRE}
        </p>
      )}
    </>
  );
}

function InventaireAPurger({
  candidates,
  parMotif,
}: {
  candidates: CandidatePurge[];
  parMotif: Array<{ motif: MotifPurge; nb: number }>;
}) {
  const [resultat, setResultat] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [fait, setFait] = useState(false);

  if (candidates.length === 0 && !fait) {
    return (
      <>
        <h2>Données du véhicule de test</h2>
        <p className="hint">
          Aucune mesure impossible en base. Rien à purger — et c’est une bonne nouvelle, pas
          un écran vide : la recherche a bien tourné.
        </p>
      </>
    );
  }

  async function confirmer() {
    setOccupe(true);
    try {
      const n = await purgerMesures(candidates.map((c) => c.id));
      setResultat(
        n === candidates.length
          ? `${n} mesure${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""} définitivement.`
          : `${n} mesure(s) supprimée(s) sur ${candidates.length} proposée(s) — les autres avaient déjà disparu.`,
      );
      setFait(true);
    } catch {
      // Une purge qui échoue doit le DIRE : un écran qui redeviendrait normal laisserait
      // croire que c'est fait.
      setResultat(MESSAGE_ECHEC_SUPPRESSION);
    } finally {
      setOccupe(false);
    }
  }

  return (
    <>
      <h2>Données du véhicule de test</h2>

      {fait ? (
        <p className="hint">{resultat}</p>
      ) : (
        <>
          <p className="hint">
            Ces mesures sont <strong>impossibles</strong> pour ta bZ — elles viennent du
            véhicule simulé de Smartcar, entré avant que la garde anti-test n’existe. Elles
            sont déjà écartées de tous les calculs ; les supprimer les retire aussi de
            l’inventaire brut. <strong>C’est définitif.</strong>
          </p>

          <ul className="limites">
            {parMotif.map(({ motif, nb }) => (
              <li key={motif}>
                <strong>{nb}</strong> — {LIBELLES_MOTIFS[motif]}
              </li>
            ))}
          </ul>

          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Mesure</th>
                  <th scope="col">Contenu</th>
                  <th scope="col">Pourquoi</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td>{dateHeureQuebec(c.recordedAt)}</td>
                    <td>{c.metricType}</td>
                    <td>{c.apercu}</td>
                    <td>{LIBELLES_MOTIFS[c.motif]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {resultat && <p className="hint statut-attention">{resultat}</p>}

          <BoutonMaintenir
            libelle={`Supprimer ces ${candidates.length} mesures`}
            libelleOccupe="Suppression…"
            danger
            occupe={occupe}
            onConfirme={confirmer}
          />
          <p className="hint">
            Maintenir le bouton pour confirmer. Rien d’autre n’est touché : les trajets, les
            recharges et le bail se recalculent tout seuls à partir de ce qui reste.
          </p>
        </>
      )}
    </>
  );
}
