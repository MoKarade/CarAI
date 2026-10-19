"use client";

// app/reglages/connecteurMcp.tsx — brancher le connecteur MCP sans taper une commande.
//
// POURQUOI CET ÉCRAN EXISTE
// Le connecteur s'authentifie par OAuth, gardé par deux clés aléatoires. Les obtenir
// supposait de lancer `openssl rand` dans un terminal — or la règle de Marc est de ne
// JAMAIS avoir à lancer une commande sur son PC. Sans ce bouton, la fonctionnalité est
// livrée mais inutilisable par la seule personne qui s'en sert.
//
// DEUX CLÉS, DEUX RÔLES DIFFÉRENTS — les confondre serait une faute :
//   • MCP_SIGNING_KEY signe les jetons. Personne ne la saisit jamais. La CHANGER invalide
//     tous les jetons émis : c'est le bouton d'arrêt d'urgence en cas d'incident.
//   • MCP_ACCESS_KEY est la porte. C'est elle que Marc saisit une fois, sur la page
//     d'autorisation ouverte par Claude. C'est la SEULE chose devinable de tout le
//     système — d'où l'exigence d'aléatoire, jamais une phrase choisie de tête.
//
// CE QUE CET ÉCRAN NE FAIT PAS, ET POURQUOI C'EST IMPORTANT
// Les deux clés sont tirées ICI, dans le navigateur, par `crypto.getRandomValues`. Elles
// ne sont envoyées à AUCUN serveur, écrites dans AUCUNE base, et disparaissent au
// rechargement. L'app ne peut donc pas « savoir » ce que Marc a collé chez Vercel : elle
// propose des valeurs, il les pose, et la comparaison se fait ensuite entre la requête
// entrante et les variables d'environnement. C'est volontaire — une clé que l'app
// stockerait pour l'afficher serait un secret de plus à protéger, dans une base qu'on
// sauvegarde.
//
// Conséquence honnête, dite à l'écran : après avoir généré, on ne peut PAS vérifier que
// les valeurs collées sont les bonnes. Le seul juge est le connecteur lui-même.

import { useState } from "react";

/**
 * 32 octets = 256 bits pour la clé de SIGNATURE (elle doit résister à une attaque sur la
 * signature elle-même), 24 octets = 192 bits pour la clé d'ACCÈS.
 *
 * La clé d'accès est le seul secret qu'un attaquant peut tenter de deviner : le limiteur
 * d'échecs du serveur est un filet faible en serverless (N requêtes parallèles = N
 * compteurs à zéro), donc c'est l'ENTROPIE qui protège, pas le limiteur. 192 bits tirés au
 * hasard sont indevinables ; une phrase mémorisable ne l'est pas — d'où le générateur.
 *
 * base64url et pas base64 : ces valeurs se recopient à la main entre trois écrans, et un
 * `+` ou un `/` s'y perd ou s'y transforme selon le champ qui les reçoit.
 */
const OCTETS_SIGNATURE = 32;
const OCTETS_ACCES = 24;

function tirerCle(OCTETS: number): string {
  const octets = new Uint8Array(OCTETS);
  crypto.getRandomValues(octets);
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function Copiable({ valeur, libelle }: { valeur: string; libelle: string }) {
  // Trois états, pas deux. « Rien ne s'est passé » après un clic est le pire des trois :
  // Marc croit l'app cassée alors que c'est le navigateur qui a refusé le presse-papiers
  // (ce qui arrive hors HTTPS et sur plusieurs navigateurs mobiles). Un échec se DIT.
  const [etat, setEtat] = useState<"repos" | "copie" | "refuse">("repos");

  async function copier() {
    try {
      await navigator.clipboard.writeText(valeur);
      setEtat("copie");
      window.setTimeout(() => setEtat("repos"), 2000);
    } catch {
      setEtat("refuse");
    }
  }

  const libelleBouton = etat === "copie" ? "Copié" : etat === "refuse" ? "Refusé" : "Copier";

  return (
    <div className="copiable">
      <code>{valeur}</code>
      <button type="button" onClick={copier} aria-label={`Copier : ${libelle}`}>
        {libelleBouton}
      </button>
      {/* L'annonce passe par une région live : sans elle, le changement de libellé du
          bouton est muet pour un lecteur d'écran, puisque le bouton garde le focus et
          que son contenu change sans que rien ne le signale. */}
      <span role="status" aria-live="polite" className="sr-only">
        {etat === "copie" ? `${libelle} copié` : ""}
        {etat === "refuse" ? `Copie refusée : sélectionne ${libelle} à la main` : ""}
      </span>
      {etat === "refuse" && (
        <p className="hint">
          Ton navigateur a refusé l’accès au presse-papiers. Sélectionne la valeur
          ci-dessus et copie-la à la main — un clic dessus la sélectionne en entier.
        </p>
      )}
    </div>
  );
}

interface Cles {
  signature: string;
  acces: string;
}

export function ConnecteurMcp({ configure, origine }: { configure: boolean; origine: string }) {
  const [cles, setCles] = useState<Cles | null>(null);

  return (
    <>
      <h2>Connecteur Claude (MCP)</h2>

      <p className="hint">
        {configure ? (
          <>
            <strong>Le connecteur est configuré</strong> côté serveur. Ça ne dit pas que la
            clé que tu saisiras est la BONNE — seul un essai depuis Claude le prouve.
          </>
        ) : (
          <>
            <strong>Le connecteur n’est pas configuré</strong> : il répond « désactivé »
            (503) à tout le monde, y compris à toi. Génère les clés ci-dessous, pose-les
            dans Vercel, puis redéploie — une variable d’environnement ne prend effet
            qu’au déploiement SUIVANT.
          </>
        )}
      </p>

      <button
        type="button"
        onClick={() =>
          setCles({ signature: tirerCle(OCTETS_SIGNATURE), acces: tirerCle(OCTETS_ACCES) })
        }
      >
        {cles ? "Générer d’autres clés" : "Générer les clés"}
      </button>

      {cles === null ? (
        <p className="hint">
          Les clés sont tirées au hasard dans ton navigateur. Elles ne sont envoyées nulle
          part et ne sont pas conservées : si tu recharges la page, elles sont perdues —
          recopie-les avant.
        </p>
      ) : (
        <div className="feuille-resultat ton-attention">
          <p className="hint">
            <strong>1.</strong> Dans Vercel → Settings → Environment Variables, crée{" "}
            <strong>deux</strong> variables.
          </p>

          <p className="hint">
            <code>MCP_SIGNING_KEY</code> — signe les jetons. Tu ne la saisiras jamais nulle
            part. La changer déconnecte Claude immédiatement : c’est l’arrêt d’urgence.
          </p>
          <Copiable key={cles.signature} valeur={cles.signature} libelle="MCP_SIGNING_KEY" />

          <p className="hint">
            <code>MCP_ACCESS_KEY</code> — <strong>c’est celle que tu saisiras</strong> quand
            Claude ouvrira la page d’autorisation. Garde-la dans ton gestionnaire de mots de
            passe.
          </p>
          <Copiable key={cles.acces} valeur={cles.acces} libelle="MCP_ACCESS_KEY" />

          <p className="hint">
            <strong>2.</strong> Redéploie (Deployments → « … » → Redeploy). Sans ça, les
            variables existent mais le code servi ne les voit pas.
          </p>

          <p className="hint">
            <strong>3.</strong> Dans Claude → Connecteurs → « Ajouter un connecteur
            personnalisé », colle cette URL — <em>sans rien après</em>. Laisse{" "}
            <em>Client ID</em> et <em>Client Secret</em> vides : Claude s’enregistre tout
            seul.
          </p>
          <Copiable key={`url-${origine}`} valeur={`${origine}/api/mcp`} libelle="URL du connecteur" />

          <p className="hint">
            <strong>4.</strong> Claude ouvre une page CarAI qui demande ta clé d’accès.
            Saisis <code>MCP_ACCESS_KEY</code> → Autoriser. C’est fini.
          </p>

          <p className="hint">
            Ces clés n’ont pas été enregistrées ici. Si tu les perds, regénères-en et refais
            les étapes — c’est sans conséquence, les anciennes cessent simplement de
            fonctionner.
          </p>
        </div>
      )}

      <p className="hint">
        Le connecteur est en <strong>lecture seule</strong> : ses outils lisent l’état, les
        trajets, les recharges et le bail. Aucun ne verrouille, déverrouille ni ne lance une
        charge. Les jetons voyagent en en-tête, jamais dans l’URL — donc jamais dans les
        journaux de requêtes de l’hébergeur.
      </p>
    </>
  );
}
