"use client";

// app/ui/SchemaInteractif.tsx — la voiture qui se PILOTE (refonte constructeur, 17/08).
//
// Choix de Marc au cadrage : « on tape le cadenas du schéma pour verrouiller, la prise
// pour la charge — l'app se pilote par la voiture dessinée elle-même. » Ce composant pose
// deux boutons SUR le schéma : le cadenas au centre du toit, la prise à l'aile avant.
//
// ══ APPUI MAINTENU, SANS RECHARGEMENT (Marc, 18/08) ══════════════════════════════════
// « Je veux pas que ça refresh la page ni la carte. Je veux juste appuyer longtemps pour
// confirmer une commande. » Le tap ouvre toujours la feuille (c'est elle qui choisit la
// DIRECTION — un bascule aveugle sur un état peut-être périmé enverrait la commande
// inverse de celle voulue), mais dedans : MAINTENIR un bouton ~800 ms déclenche l'envoi,
// via `commanderInline` qui RETOURNE le résultat au lieu de rediriger. Rien d'autre ne
// bouge — la carte reste exactement où elle est.
//
// ⚠️ L'appui long est une commodité de SAISIE : la confirmation qui compte est re-validée
// côté serveur (`autoriserCommande`), comme l'était la case à cocher qu'il remplace.
//
// ══ POURQUOI LE SCHÉMA ARRIVE EN `children` ══════════════════════════════════════════
// ⚠️ `SchemaVehicule` importe (par `schemaVehicule.ts` → `alertes.ts` → `analyse.ts`) le
// module de BASE DE DONNÉES. L'importer ICI, dans un composant "use client", tirerait
// cette chaîne entière dans le bundle du NAVIGATEUR. Le schéma reste donc rendu côté
// serveur et passe en `children` — le patron d'imbrication serveur-dans-client de React.
//
// ⚠️ L'icône du cadenas dit ce que la DERNIÈRE MESURE dit — pas ce que la dernière
// commande a demandé. Une commande acceptée n'est pas une preuve que l'action a eu lieu.

import { useCallback, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { commanderInline, type RetourCommande } from "@/app/actions/commandes";
import { commandeOfferte } from "@/lib/vehicle/commandes";
import {
  IcoCompteur,
  IcoEclair,
  IcoHorloge,
  IcoJauge,
  IcoVerrou,
  IcoVerrouOuvert,
} from "./Icones";
import { IcoPneu, IcoPortiere } from "./IndicateursVoiture";
import { BoutonMaintenir } from "./BoutonMaintenir";
import { bullesAFermer } from "@/lib/vehicle/bulles";
import { ANCRES, cotePastille, type IdPoint, type PointVoiture } from "@/lib/vehicle/pointsVoiture";

/**
 * L'icône de chaque point. ⚠️ Choisie ICI et pas côté serveur : `PointVoiture` traverse la
 * frontière serveur → client et ne peut donc porter que des données. Un `Record` complet
 * (jamais un `?.`) — TypeScript refuse alors d'ajouter un point sans lui donner d'icône.
 */
const ICONES: Record<IdPoint, (p: { taille?: number }) => ReactNode> = {
  charge: IcoEclair,
  autonomie: IcoJauge,
  verrou: IcoVerrou,
  odometre: IcoCompteur,
  ouvrants: IcoPortiere,
  synchro: IcoHorloge,
  "pneu-avant-gauche": IcoPneu,
  "pneu-avant-droite": IcoPneu,
  "pneu-arriere-gauche": IcoPneu,
  "pneu-arriere-droite": IcoPneu,
};

/** Une information posée sur la carrosserie : la valeur se lit, le tap donne le détail. */
function PointLecture({ point }: { point: PointVoiture }) {
  const ancre = ANCRES[point.id];
  const Icone = ICONES[point.id];
  return (
    <details
      // `name` partagé = accordéon EXCLUSIF du HTML : ouvrir une pastille ferme l'autre,
      // sans une ligne de JavaScript. Le repli pour les navigateurs qui l'ignorent encore
      // est dans l'effet de `SchemaInteractif` — deux bulles ouvertes sur une carrosserie
      // se recouvrent et on ne sait plus laquelle parle de quoi.
      name="pt-voiture"
      data-pt={point.id}
      // ⚠️ La bulle s'ouvre VERS LE HAUT dans la moitié basse : vers le bas, elle sortirait
      // sous la carrosserie et se ferait couper par le bas de la carte.
      //
      // ⚠️ Et elle s'accroche À GAUCHE ou À DROITE près d'un bord, pour la même raison en
      // horizontal : centrée, elle sortait de l'écran de 53 px sur les pressions (mesuré
      // au banc à 390 px). Le côté se DÉRIVE de l'ancre, comme le sens d'ouverture juste
      // au-dessus — jamais d'une liste de points, qui serait fausse au premier ajout.
      className={`pt-voiture ton-${point.ton} ${point.vedette ? "pt-vedette" : ""} ${
        ancre.y > 55 ? "pt-vers-haut" : ""
      } pt-bord-${cotePastille(ancre)}`}
      style={{ left: `${ancre.x}%`, top: `${ancre.y}%` }}
    >
      <summary aria-label={`${point.libelle} : ${point.valeur}${point.unite ? " " + point.unite : ""}`}>
        <span className="pt-icone" aria-hidden="true">
          <Icone taille={point.vedette ? 15 : 13} />
        </span>
        <span className="pt-valeur">
          {point.valeur}
          {point.unite && <span className="pt-unite">{point.unite}</span>}
        </span>
      </summary>
      <div className="pt-bulle">
        <strong>{point.libelle}</strong>
        {point.detail.map((paragraphe) => (
          <p key={paragraphe}>{paragraphe}</p>
        ))}
      </div>
    </details>
  );
}

type Feuille = "verrou" | "charge" | null;

/** Une commande de la feuille : sa phrase d'effet (du CATALOGUE) + son bouton maintenu. */
function CommandeMaintenir({
  type,
  libelle,
  danger,
  occupe,
  onEnvoyer,
}: {
  type: string;
  libelle: string;
  danger?: boolean;
  occupe: boolean;
  onEnvoyer: (type: string) => void;
}) {
  const commande = commandeOfferte(type);
  return (
    <div className="feuille-form">
      {commande?.effet && <p className="feuille-effet">{commande.effet}</p>}
      <BoutonMaintenir
        libelle={libelle}
        danger={danger}
        occupe={occupe}
        onConfirme={() => onEnvoyer(type)}
      />
    </div>
  );
}

/**
 * La LIMITE DE CHARGE — un curseur 50–100 par pas de 5 (choix de Marc, cadrage 17/08).
 * Le curseur est une commodité de saisie ; les bornes qui comptent sont re-validées côté
 * serveur (`normaliserLimiteCharge`), comme tout le reste.
 */
function LimiteCharge({
  occupe,
  onEnvoyer,
}: {
  occupe: boolean;
  onEnvoyer: (limite: number) => void;
}) {
  const [limite, setLimite] = useState(80);
  const idCurseur = useId();
  return (
    <div className="feuille-form">
      <label htmlFor={idCurseur} className="feuille-effet">
        Limite de charge : <strong>{limite} %</strong>
      </label>
      <input
        id={idCurseur}
        type="range"
        min={50}
        max={100}
        step={5}
        value={limite}
        onChange={(e) => setLimite(Number(e.target.value))}
        className="curseur-limite"
      />
      <BoutonMaintenir
        libelle={`Appliquer ${limite} %`}
        occupe={occupe}
        onConfirme={() => onEnvoyer(limite)}
      />
    </div>
  );
}

export function SchemaInteractif({
  verrouillee,
  points = [],
  children,
}: {
  /** L'état MESURÉ du verrou — `null` quand aucune mesure. */
  verrouillee: boolean | null;
  /**
   * Tout ce qui se pose SUR la carrosserie (Marc, 20/08 : « toutes ces infos je veux
   * qu'elles soient sur la voiture »). Les deux points qui portent une `commande` sont
   * rendus en boutons ; le reste en pastilles de lecture.
   */
  points?: PointVoiture[];
  /** Le `SchemaVehicule` rendu côté serveur. */
  children: ReactNode;
}) {
  const [feuille, setFeuilleBrute] = useState<Feuille>(null);
  const [resultat, setResultat] = useState<RetourCommande | null>(null);
  const [enCours, demarrer] = useTransition();

  // Changer de feuille efface le résultat de la précédente — il décrivait un autre geste.
  const setFeuille = (f: Feuille) => {
    setFeuilleBrute(f);
    setResultat(null);
  };

  const envoyer = (type: string, limite?: number) => {
    setResultat(null);
    demarrer(async () => {
      // L'appui maintenu EST le consentement : il porte la confirmation. Le serveur la
      // re-valide contre le catalogue — une requête sans elle est refusée là-bas.
      setResultat(await commanderInline({ type, confirme: true, limite }));
    });
  };

  // Échap ferme la feuille — le geste attendu de tout dialogue.
  useEffect(() => {
    if (!feuille) return;
    const fermer = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFeuille(null);
    };
    window.addEventListener("keydown", fermer);
    return () => window.removeEventListener("keydown", fermer);
  }, [feuille]);

  // ⚠️ FERMER EN CLIQUANT AILLEURS (Marc, 20/08 : « je veux pouvoir cliquer autre part
  // pour désélectionner ce que j'ai cliqué sur la voiture »). Un `<details>` natif ne se
  // referme QUE par un second clic sur son propre résumé : sans ça, une bulle ouverte
  // reste ouverte pendant qu'on lit ailleurs, et masque la carrosserie qu'elle décrit.
  //
  // `pointerdown` plutôt que `click` : le geste se solde à l'appui, donc la bulle disparaît
  // au moment où le doigt touche l'écran, pas quand il le quitte. Et l'écouteur vit sur le
  // DOCUMENT, pas sur le conteneur : un clic à côté de la voiture — sur une tuile, sur le
  // fond de la page — doit fermer lui aussi, or il n'atteint jamais le conteneur.
  const conteneur = useRef<HTMLDivElement>(null);

  // Le composant TRADUIT, il ne décide pas : nœuds ouverts → identifiants, règle pure,
  // puis fermeture. La règle et ses cas limites vivent dans `lib/vehicle/bulles.ts`.
  const fermerLesBulles = useCallback((sauf?: Element | null) => {
    const racine = conteneur.current;
    if (!racine) return;
    const ouvertes = [...racine.querySelectorAll<HTMLDetailsElement>("details.pt-voiture[open]")];
    const parId = new Map(ouvertes.map((d, i) => [d.dataset.pt ?? String(i), d]));
    const viseeId = [...parId].find(([, d]) => d === sauf)?.[0] ?? null;
    for (const id of bullesAFermer([...parId.keys()], viseeId)) {
      const d = parId.get(id);
      if (d) d.open = false;
    }
  }, []);

  useEffect(() => {
    const surAppui = (e: PointerEvent) => {
      const cible = e.target instanceof Element ? e.target : null;
      // Un appui DANS une pastille la laisse faire son travail (ouvrir ou refermer), et
      // ferme les autres — c'est le repli du `name` exclusif quand il n'est pas supporté.
      fermerLesBulles(cible?.closest("details.pt-voiture") ?? null);
    };
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermerLesBulles();
    };
    document.addEventListener("pointerdown", surAppui);
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("pointerdown", surAppui);
      document.removeEventListener("keydown", surTouche);
    };
  }, [fermerLesBulles]);

  return (
    <div className="schema-pilote" ref={conteneur}>
      {children}

      {/* ⚠️ Les points de LECTURE d'abord, les boutons de COMMANDE ensuite : un bouton qui
          agit sur la voiture ne doit jamais passer sous une pastille informative. */}
      {points
        .filter((p) => !p.commande)
        .map((p) => (
          <PointLecture key={p.id} point={p} />
        ))}

      {/* ⚠️ Les points qui COMMANDENT portent leur propre valeur. Avant, la charge était
          dite deux fois — une pastille de lecture ET un bouton-éclair à la même ancre, qui
          se recouvraient. Une information, un endroit, et c'est ce même endroit qui agit. */}
      {points
        .filter((p) => p.commande)
        .map((p) => {
          const ancre = ANCRES[p.id];
          const Icone = p.id === "verrou" && verrouillee === false ? IcoVerrouOuvert : ICONES[p.id];
          return (
            <button
              key={p.id}
              type="button"
              className={`pt-voiture pt-commande ton-${p.ton} ${p.vedette ? "pt-vedette" : ""}`}
              style={{ left: `${ancre.x}%`, top: `${ancre.y}%` }}
              aria-haspopup="dialog"
              aria-label={`${p.libelle} : ${p.valeur} — tape pour agir`}
              onClick={() => setFeuille(p.commande!)}
            >
              <span className="pt-icone" aria-hidden="true">
                <Icone taille={p.vedette ? 15 : 13} />
              </span>
              <span className="pt-valeur">
                {p.valeur}
                {p.unite && <span className="pt-unite">{p.unite}</span>}
              </span>
            </button>
          );
        })}


      {feuille && (
        <>
          {/* Le fond cliquable ferme — même geste que tous les dialogues du téléphone. */}
          <div className="feuille-fond" onClick={() => setFeuille(null)} aria-hidden="true" />
          <div
            className="feuille"
            role="dialog"
            aria-modal="true"
            aria-label={feuille === "verrou" ? "Verrouillage" : "Charge"}
          >
            <div className="feuille-titre">
              {feuille === "verrou" ? (
                <>
                  <IcoVerrou taille={18} /> Verrouillage
                </>
              ) : (
                <>
                  <IcoEclair taille={18} /> Charge
                </>
              )}
              <button
                type="button"
                className="feuille-fermer"
                aria-label="Fermer"
                onClick={() => setFeuille(null)}
              >
                ✕
              </button>
            </div>

            {feuille === "verrou" ? (
              <>
                <CommandeMaintenir
                  type="lock"
                  libelle="Verrouiller"
                  occupe={enCours}
                  onEnvoyer={envoyer}
                />
                <CommandeMaintenir
                  type="unlock"
                  libelle="Déverrouiller"
                  danger
                  occupe={enCours}
                  onEnvoyer={envoyer}
                />
              </>
            ) : (
              <>
                <CommandeMaintenir
                  type="start_charge"
                  libelle="Démarrer la charge"
                  occupe={enCours}
                  onEnvoyer={envoyer}
                />
                <CommandeMaintenir
                  type="stop_charge"
                  libelle="Arrêter la charge"
                  occupe={enCours}
                  onEnvoyer={envoyer}
                />
                <LimiteCharge
                  occupe={enCours}
                  onEnvoyer={(limite) => envoyer("set_charge_limit", limite)}
                />
              </>
            )}

            {resultat && (
              <p className={`feuille-resultat ton-${resultat.ton}`} role="status">
                {resultat.message}
              </p>
            )}

            <p className="feuille-note">
              Maintenir un bouton confirme et envoie. Smartcar accuse réception ; l’effet
              peut prendre un moment, et « acceptée » n’est pas une preuve que l’action a eu
              lieu — l’état publié ensuite par la voiture fait foi.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
