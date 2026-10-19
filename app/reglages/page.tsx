// app/reglages/page.tsx — les chiffres du CONTRAT, saisis par Marc.
//
// ══ POURQUOI CET ÉCRAN EXISTE (Marc, 13/08 : « le prix pour les recharges marche toujours
//    pas — sois plus précis et logique ») ═══════════════════════════════════════════════
//
// Le prix ne marchait pas parce que `tarifKwh` ne pouvait être renseigné NULLE PART.
// La valeur vivait dans la config (`CLE_BAIL`) et aucun code de l'application n'écrivait
// jamais cette clé — `ecrireConfig` ne servait qu'aux identifiants Smartcar. Refuser
// d'inventer un prix du kWh était juste ; ne laisser aucun moyen de le fournir était un
// défaut. Cet écran est la moitié qui manquait.
//
// Il porte les CINQ chiffres qui décident de tout ce que CarAI peut chiffrer :
//   • tarif du kWh          → les recharges passent des kWh aux dollars ;
//   • coût au km excédentaire → le dépassement de bail passe des km aux dollars ;
//   • date, durée, allocation → la droite du contrat, donc la projection ;
//   • odomètre à la signature → l'ancrage du rythme (un facteur QUATRE sur la projection :
//     sans lui, l'app annonçait un dépassement bien trop bas).
//
// ⚠️ Aucune valeur par défaut n'est écrite dans un CHAMP : un champ vide reste vide.
//
// ⚠️⚠️ CE QUI A CHANGÉ LE 14/09, et qui contredit ce que ce fichier affirmait jusque-là :
// le tarif du kWh absent ne laisse plus les recharges SANS MONTANT. Marc : « signalé mais
// tout estimé ». Faute de tarif, `prixSession` retombe sur un ordre de grandeur
// résidentiel, marqué `estime`, avec une explication qui dit d'où il vient et comment
// l'exacter — et cet écran porte un bandeau tant que le tarif manque. Le raisonnement
// d'origine tient toujours (le tarif d'Hydro-Québec dépend du palier, de l'abonnement et
// de la date, donc l'écrire en dur produit un chiffre plausible-mais-faux) ; ce qui a été
// arbitré, c'est qu'un trou dans un cumul coûte plus cher qu'un ordre de grandeur ANNONCÉ.
//
// Server Component derrière le middleware. La Server Action REVÉRIFIE la session — défense
// en profondeur : une action est une route POST comme une autre.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { classerPanne, messagePanne } from "@/lib/panne";
import {
  CLE_BAIL,
  CLE_REJEU_CURSEUR,
  REJEU_TERMINE,
  ecrireConfig,
  lireBail,
  lireConfigTexte,
  type Bail,
} from "@/lib/config";
import { lireReglages, valeursFormulaireBail } from "@/lib/vehicle/reglages";
import { db } from "@/lib/db";
import { desc } from "drizzle-orm";
import { vehicleCommandsLog, type CommandLogEntry } from "@/lib/db/schema";
import { TON_PAR_STATUT, libelleStatut } from "@/lib/vehicle/commandes";
import { analyserCadence, graviteCadence } from "@/lib/vehicle/cadence";
import { passagesRecents } from "@/lib/vehicle/pollJournal";
import { Indicateur, Indicateurs } from "@/app/ui/IndicateursVoiture";
import { IcoBase, IcoEclair, IcoHorloge } from "@/app/ui/Icones";
import { formaterAge } from "@/lib/vehicle/state";
import { derniereLivraison } from "@/lib/smartcar/ingest";
import { NonAutorise, requireSession } from "@/lib/session";
import { Onglets } from "@/app/ui/Onglets";
import { LieuxDeRecharge } from "./lieux";
import { FormulaireReglages, type EtatFormulaire } from "./FormulaireReglages";
import { ConnecteurMcp } from "./connecteurMcp";
import { PurgeSimulee } from "./purgeSimulee";
import { lireEnvMcp } from "@/lib/mcp/oauth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Enregistre les termes du bail.
 *
 * ⚠️ `requireSession()` est appelé ICI, pas seulement dans la page : une Server Action est
 * un point d'entrée POST à part entière. S'appuyer sur le fait que le formulaire n'est
 * affiché qu'aux gens connectés serait vérifier à l'AFFICHAGE une chose qui doit l'être à
 * l'ÉCRITURE (même famille que le piège du jeton vérifié à l'émission plutôt qu'à l'usage).
 */
async function enregistrer(
  _precedent: EtatFormulaire,
  form: FormData,
): Promise<EtatFormulaire> {
  "use server";

  try {
    await requireSession();
  } catch {
    return {
      statut: "erreur",
      messages: ["Session expirée — reconnecte-toi."],
    };
  }

  const resultat = lireReglages(form);
  if (!resultat.ok || !resultat.bail) {
    return { statut: "erreur", messages: resultat.erreurs };
  }

  try {
    await assurerMigrations();
    await ecrireConfig(CLE_BAIL, resultat.bail);
  } catch (err) {
    console.error("[reglages] écriture impossible", err);
    return { statut: "erreur", messages: [messagePanne(classerPanne(err))] };
  }

  // Les écrans qui consomment ces chiffres sont en `force-dynamic`, mais on invalide
  // explicitement : « enregistré » doit vouloir dire « visible partout », pas « visible au
  // prochain rafraîchissement ».
  revalidatePath("/", "layout");
  return { statut: "ok", messages: ["Réglages enregistrés."] };
}

function Coquille({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="carte carte-large">
        <h1>Réglages</h1>
        <Onglets actif="/reglages" />
        {children}
      </div>
    </main>
  );
}

export default async function Reglages() {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) redirect("/login");
    throw err;
  }

  if (!baseConfiguree()) {
    return (
      <Coquille>
        <p className="lead">
          La base de données n’est pas branchée : les réglages ne peuvent pas être lus.
        </p>
      </Coquille>
    );
  }

  // `null` = aucun bail en base : le formulaire s'affiche vide (aucun terme n'est dans le code).
  let bail: Bail | null = null;
  let journal: CommandLogEntry[] = [];
  let livraison: Date | null = null;
  let cadenceOk: boolean | null = null;
  // Par DÉFAUT « terminé » : si la lecture échoue, on n'affiche pas un chantier qui
  // n'existe peut-être plus. Le rattrapage, lui, continue côté poll quoi qu'il arrive.
  let rejeuFini = true;
  try {
    await assurerMigrations();
    bail = await lireBail();
    // La SANTÉ et le JOURNAL dégradent séparément : une panne ici ne prive pas Marc du
    // formulaire de bail — c'est lui, l'écran.
    try {
      const [lignes, derniere, passages] = await Promise.all([
        db
          .select()
          .from(vehicleCommandsLog)
          .orderBy(
            desc(vehicleCommandsLog.issuedAt),
            desc(vehicleCommandsLog.id),
          )
          .limit(10),
        derniereLivraison(),
        passagesRecents(24),
      ]);
      journal = lignes;
      livraison = derniere;
      const cadence = analyserCadence({ passages, maintenant: new Date() });
      cadenceOk = cadence.aucunHistorique
        ? null
        : graviteCadence(cadence) === "normale";
      rejeuFini = (await lireConfigTexte(CLE_REJEU_CURSEUR)) === REJEU_TERMINE;
    } catch (err) {
      console.error("[reglages] santé/journal illisibles", err);
    }
  } catch (err) {
    console.error("[reglages] lecture impossible", err);
    return (
      <Coquille>
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  const depart = valeursFormulaireBail(bail);

  // eslint-disable-next-line react-hooks/purity -- Server Component (page force-dynamic) : rendu une fois par requête, l'âge affiché EST celui de la requête.
  const maintenant = Date.now();
  const silence =
    livraison === null ? null : (maintenant - livraison.getTime()) / 60_000;
  const fluxOk = silence !== null && silence < 6 * 60;

  // Booléen SEULEMENT — aucune valeur de clé ne sort jamais du serveur. Savoir que la
  // configuration est posée suffit à distinguer « connecteur désactivé » de « mauvaise
  // clé », qui appellent deux gestes différents.
  //
  // On lit la config OAuth (`lireEnvMcp`), pas l'ancien `MCP_TOKEN` : c'est OAuth qui fait
  // marcher le connecteur dans claude.ai, donc c'est de lui que Marc a besoin de savoir
  // s'il est en place. Un écran qui répondrait « configuré » sur la foi d'un jeton statique
  // le laisserait chercher pendant que la vraie cause est ailleurs.
  const mcpConfigure = lireEnvMcp() !== null;
  // L'origine se LIT dans la requête, elle ne se code pas en dur : sur une préversion,
  // une URL figée sur carai.hubperso.com enverrait Marc brancher son connecteur sur la
  // production alors qu'il teste ailleurs (même piège qu'app/login/page.tsx).
  const enTetes = await headers();
  const hote =
    enTetes.get("x-forwarded-host") ??
    enTetes.get("host") ??
    "carai.hubperso.com";
  const protocole =
    hote.startsWith("localhost") || hote.startsWith("127.") ? "http" : "https";
  const origine = `${protocole}://${hote}`;

  return (
    <Coquille>
      {/* ── SANTÉ D'ABORD (choix de Marc au cadrage) : le flux, en icônes-tap. ───────── */}
      <Indicateurs>
        <Indicateur
          ton={livraison === null ? "inconnu" : fluxOk ? "ok" : "attention"}
          libelle={
            livraison === null
              ? "Réception des données : rien reçu pour l’instant"
              : `Réception des données : dernière fois ${formaterAge(silence!)}`
          }
          icone={<IcoEclair taille={18} />}
        >
          <p>
            {livraison === null
              ? "Aucune livraison Smartcar en base."
              : `Dernière livraison ${formaterAge(silence!)}.`}{" "}
            L’état complet du canal (webhook actif, véhicule abonné) se lit sur
            la page <a href="/donnees">Données</a>.
          </p>
        </Indicateur>
        <Indicateur
          ton={cadenceOk === null ? "inconnu" : cadenceOk ? "ok" : "attention"}
          libelle={
            cadenceOk === null
              ? "Relevé de secours : pas encore d’historique"
              : cadenceOk
                ? "Relevé de secours : régulier"
                : "Relevé de secours : des passages sautés"
          }
          icone={<IcoHorloge taille={18} />}
        >
          <p>
            Le poll va chercher l’état aux 30 min quand le webhook se tait. Le
            détail des passages sautés vit sur la page{" "}
            <a href="/donnees">Données</a>.
          </p>
        </Indicateur>
        <Indicateur
          ton="ok"
          libelle="Données techniques"
          icone={<IcoBase taille={18} />}
        >
          <p>
            La base complète, l’export CSV, la santé du webhook et la cadence du
            poll : <a href="/donnees">ouvrir les Données techniques</a>.
          </p>
        </Indicateur>
      </Indicateurs>

      {/* ── RÉPARATION de l'incident du 18/08 ─────────────────────────────────────────
          La purge 0005 a supprimé l'historique de positions (donc les trajets et les prix
          de recharge). Le rattrapage tourne SEUL au fil des passages du poll ; ce bouton
          existe parce que ce poll saute des passages — attendre pouvait durer des heures.
          Relancer est SANS RISQUE : l'écriture est idempotente (index unique). */}
      {rejeuFini ? null : (
        <p className="hint" role="status">
          Une partie de l’historique (positions, donc trajets et prix de
          recharge) est en cours de <strong>reconstruction automatique</strong>{" "}
          depuis les livraisons archivées. Elle avance à chaque affichage d’une
          page et s’arrête d’elle-même une fois terminée — rien à faire.
        </p>
      )}

      <p className="lead">
        Les chiffres de ton contrat. Ce sont eux qui permettent à CarAI de
        passer des kilomètres et des kWh aux <strong>dollars</strong>.
      </p>

      {/* ⚠️ Tant que le tarif manque, l'app estime — et elle le DIT ici. Sans ce
          bandeau, « signalé mais tout estimé » ne serait que la seconde moitié :
          des montants partout, et rien à l'écran pour rappeler qu'un seul champ
          les rendrait exacts. Il disparaît de lui-même dès que le champ est
          rempli : un avertissement permanent est un avertissement mort. */}
      {bail === null && (
        <p className="bandeau-manque" role="status">
          <strong>Bail non renseigné.</strong> Saisis les termes ci-dessous : tant
          qu’ils manquent, l’accueil, l’activité, les tendances et le connecteur
          Claude le disent au lieu d’afficher un chiffre.
        </p>
      )}

      {depart.tarifKwh === undefined && (
        <p className="bandeau-manque" role="status">
          <strong>Ton tarif du kWh n’est pas renseigné.</strong> Les recharges
          faites hors de tes lieux enregistrés sont donc comptées à un{" "}
          <em>ordre de grandeur</em> résidentiel, pas à ton prix. Renseigne-le
          ci-dessous et elles deviendront exactes.
        </p>
      )}

      <FormulaireReglages action={enregistrer} className="reglages">
        <fieldset>
          <legend>Ce qui chiffre les coûts</legend>

          <label>
            <span className="etiquette-champ">Tarif du kWh</span>
            <input
              type="number"
              name="tarifKwh"
              step="0.0001"
              min="0"
              inputMode="decimal"
              defaultValue={depart.tarifKwh}
              placeholder="ex. 0.0785"
            />
            <span className="aide">
              Le prix que tu paies réellement, en {depart.devise} par kWh (regarde
              une facture d’Hydro-Québec). <strong>Laissé vide</strong>, les
              recharges hors de tes lieux connus sont comptées à un ordre de
              grandeur résidentiel — un montant qui s’affiche comme{" "}
              <em>estimé</em>, jamais comme mesuré.
            </span>
          </label>

          <label>
            <span className="etiquette-champ">Coût du km excédentaire</span>
            <input
              type="number"
              name="coutParKmExcedentaire"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={depart.coutParKmExcedentaire}
              placeholder="ex. 0.15"
            />
            <span className="aide">
              Écrit noir sur blanc dans ton bail. Vide, le dépassement reste en
              kilomètres.
            </span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Les termes du bail</legend>

          <label>
            <span className="etiquette-champ">Date de signature</span>
            <input
              type="date"
              name="debut"
              defaultValue={depart.debut}
              required
            />
          </label>

          <label>
            <span className="etiquette-champ">Durée (mois)</span>
            <input
              type="number"
              name="dureeMois"
              step="1"
              min="1"
              defaultValue={depart.dureeMois}
              required
            />
          </label>

          <label>
            <span className="etiquette-champ">Kilométrage autorisé</span>
            <input
              type="number"
              name="kilometrageAutorise"
              step="1"
              min="1"
              defaultValue={depart.kilometrageAutorise}
              required
            />
          </label>

          <label>
            <span className="etiquette-champ">Odomètre à la signature</span>
            <input
              type="number"
              name="kilometrageInitial"
              step="1"
              min="0"
              defaultValue={depart.kilometrageInitial}
              placeholder="km au contrat"
            />
            <span className="aide">
              C’est ce qui ancre la mesure de ton rythme sur TOUT le bail. Sans
              lui, la projection ne voit que la fenêtre observée par CarAI et
              sous-estime le dépassement (mesuré : un facteur quatre).
            </span>
          </label>

          <label>
            <span className="etiquette-champ">Devise</span>
            <input
              type="text"
              name="devise"
              maxLength={3}
              defaultValue={depart.devise}
              placeholder="CAD"
            />
          </label>
        </fieldset>

      </FormulaireReglages>

      <p className="hint">
        Ce qui est <strong>mesuré</strong> et ce qui est <strong>estimé</strong>{" "}
        ne sont jamais additionnés, où que ce soit dans l’app. Un chiffre que tu
        renseignes ici fait passer une estimation du côté mesuré — c’est tout ce
        que ces champs servent à faire.
      </p>
      <LieuxDeRecharge />

      {/* ══ CE QU'ON NE VIENT PAS CHERCHER TOUS LES JOURS, REPLIÉ ════════════════════
          Marc, 14/09 : « replier les blocs rares ». Mesuré avant : la page faisait
          2 006 px de haut sur un téléphone de 360 px — on vient y changer un tarif ou un
          lieu, et il faut traverser le connecteur MCP, la purge et le journal des
          commandes pour en sortir.

          ⚠️ LE REPLI VAUT AUSSI SUR GRAND ÉCRAN, ET CE N'EST PAS UN CHOIX. J'ai cherché à
          le limiter au téléphone : un `<details>` fermé masque son contenu par le shadow
          DOM du navigateur, et une règle d'auteur sur les enfants ne le défait pas.
          Mesuré (`checkVisibility()`, avec un `<details>` nu comme témoin) : la tentative
          rendait le contenu ET son résumé INVISIBLES à 1280 px — le bloc devenait
          inatteignable. Replier partout est donc la seule forme honnête ; un clic le
          rouvre, et l'écran de bureau y gagne la même respiration.

          ⚠️ `.replie` EXISTE DÉJÀ — elle sert sur Tendances depuis le 13/08, et son
          commentaire dans `globals.css` décrit exactement ce besoin (« ce sur quoi il n'y a
          plus rien à faire ne doit pas repousser hors de l'écran ce qui compte »). Mon
          premier jet créait une classe `.repli` jumelle : greper le CONCEPT avant d'écrire
          un style, pas seulement le nom qu'on s'apprête à lui donner. */}
      {/* CarAI#202 : l'inventaire de la purge n'est PLUS lu à l'ouverture de la page. Il se
          charge sur clic (`chargerInventairePurge`), parce qu'il parcourt toute la table pour
          une section que Marc ouvre presque jamais. */}
      <details className="replie">
        <summary>Purge du véhicule de test</summary>
        <PurgeSimulee />
      </details>

      <details className="replie">
        <summary>Connecteur MCP — brancher Claude</summary>
        <ConnecteurMcp configure={mcpConfigure} origine={origine} />
      </details>

      <details className="replie">
        <summary>
          Dernières commandes{journal.length > 0 ? ` (${journal.length})` : ""}
        </summary>
        {journal.length === 0 ? (
          <p className="hint">Aucune commande envoyée pour l’instant.</p>
        ) : (
          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Quand</th>
                  <th scope="col">Commande</th>
                  <th scope="col">Résultat</th>
                  <th scope="col">Détail</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {formaterAge(
                        (maintenant - l.issuedAt.getTime()) / 60_000,
                      )}
                    </td>
                    <td>{l.commandType}</td>
                    <td
                      className={`statut-${TON_PAR_STATUT[l.status] ?? "attention"}`}
                    >
                      {libelleStatut(l.status)}
                    </td>
                    <td>{l.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Les commandes s’envoient depuis le SCHÉMA de l’accueil (cadenas,
          prise). Toute commande est journalisée, <strong>même ratée</strong> —
          et « acceptée » n’est jamais une preuve que la voiture a obéi : l’état
          publié ensuite fait foi.
        </p>
      </details>
    </Coquille>
  );
}
