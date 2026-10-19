# ADR 0004 — Le bail en DOLLARS vient de FinanceAI, par un lien direct et un jeton dédié (Marc, 2026-09-15)

**Statut** : accepté et livré.

## Contexte

Marc, 2026-09-15 : « je veux aussi voir ce que j'ai payé par rapport au prix total du prêt […]
regarde ces infos dans financeai ». Emplacement choisi par lui : **le bandeau Bail de l'accueil**.

Le bandeau montre aujourd'hui des KILOMÈTRES — consommés sur alloués, rythme, jours restants. Il ne
peut pas montrer de dollars, et pas par oubli : **CarAI n'en connaît aucun**. `TermesBail`
(`lib/vehicle/lease.ts`) porte la date de signature, la durée, le kilométrage autorisé et le tarif au
kilomètre excédentaire. Ni mensualité, ni montant financé, ni solde.

Ces chiffres existent — dans **FinanceAI**, comme la dette « bZ » (solde, taux, versement mensuel).
Deux faits de cadrage, tranchés par Marc le même jour : le contrat est un **bail**, et il n'y a eu
**aucun comptant** à la signature.

## Décision

1. **Un lien DIRECT CarAI → FinanceAI**, sur un endpoint dédié : `GET /vehicule/bail`
   (ADR 0017 de FinanceAI). Pas de relais par le hub.
2. **Un jeton DÉDIÉ** (`FINANCEAI_BAIL_TOKEN` ici, `FINANCEAI_VEHICULE_TOKEN` là-bas), distinct de
   `HUB_TOKEN`. Il n'ouvre que la dette du véhicule.
3. **Le total du bail est `mensualité × durée`**, jamais le montant financé. Les deux ne coïncident
   qu'à taux nul ; le second est le CAPITAL, pas la somme des versements. `montantOrigine` sert de
   **contrôle de cohérence** (`lib/vehicle/paiementsBail.ts`), jamais de numérateur.
4. **Sept états de lecture, sept messages** (`lib/vehicle/messageBail.ts`). FinanceAI tourne sur le
   PC de Marc : « injoignable » est un état NORMAL et fréquent, qui n'appelle aucun geste. Le
   confondre avec « jeton refusé » ou « aucune dette enregistrée » enverrait corriger la mauvaise
   chose. Un tiret unique aurait fait exactement ça.
5. **Les écarts entre les deux sources sont DITS, jamais corrigés.** Solde qui ne concorde pas avec
   les versements restants, montant financé qui s'écarte du total, date de début divergente : chacun
   veut dire qu'une des deux saisies est fausse, et CarAI n'est pas en position d'arbitrer.
   ⚠️ Le contrôle du solde **s'abstient** dès que le taux n'est pas nul : la relation n'y est plus
   linéaire, et un faux écart signalé chaque jour est un avertissement qu'on apprend à ignorer.
6. **CarAI fait foi sur les TERMES**, FinanceAI sur les DOLLARS. Le calcul s'ancre donc sur la date
   et la durée de CarAI, même quand FinanceAI en publie d'autres — et la divergence est signalée.

## Pourquoi pas le hub

Le hub est **générique par le contrat** : « il ne connaît AUCUNE app en particulier ». Une route
`/api/vehicule/bail` chez Hubperso serait sa première exception — et les exceptions d'un routeur
générique ne restent jamais seules. Elle ferait de surcroît du hub un point de passage critique pour
une donnée d'affichage, alors qu'il est délibérément hors du chemin critique de l'autorisation
(ADR 0001 du hub, `AUTHORIZED_EMAIL` vérifié **sans réseau**).

Marc a demandé le même jour « que toutes les apps soient connectées entre elles, que hubperso fasse
tout connecter entre eux ». Cette décision **reste ouverte** : ce lot ouvre UN lien pour UN besoin
nommé et ne la préjuge pas. Si le maillage se fait, cet endpoint reste la source de la donnée.

## Trade-offs

- **Deux variables à poser pour Marc** (ici et côté FinanceAI), plus un redémarrage du serveur MCP.
  Sans elles, le bandeau dit « FinanceAI n'est pas branché ». Aucun chiffre n'est inventé.
- **Un appel réseau de plus au rendu de l'accueil.** Borné à 3 s, il ne lève jamais (les sept états
  sont des valeurs de retour), donc il ne peut ni ralentir durablement ni casser l'écran.
- **Le coût des recharges n'est PAS ajouté à ce bandeau**, alors que Marc avait répondu « contrat +
  recharges » à la question de ce qu'il fallait compter. Raison mesurée : le cumul des recharges
  depuis la signature exige tout l'historique de positions (685 lignes aujourd'hui, et ça grandit) —
  l'écran Activité le charge déjà et l'affiche, l'accueil ne charge que le mois. Le dupliquer ici
  paierait ce coût sur l'écran le plus consulté, ou pire, produirait un second cumul qui divergerait
  du premier. **Le bandeau porte donc le CONTRAT ; le cumul des recharges reste sur Activité.**
  Si Marc veut les deux au même endroit, c'est un lot à part, avec sa mesure de coût.

## Alternatives rejetées

- **Saisir la mensualité à la main dans CarAI.** Rejeté par la demande (« regarde ces infos dans
  financeai ») : une valeur recopiée diverge au premier changement, en silence, et c'est un montant.
- **Réutiliser `HUB_TOKEN`.** Rejeté : il identifie CarAI auprès du hub et n'a rien à voir avec
  FinanceAI. Et côté FinanceAI, réutiliser le jeton du hub aurait donné la valeur nette pour lire
  une mensualité.
- **Prendre `montantOrigine` comme total.** Rejeté : faux dès que le taux n'est pas nul, et le
  test qui l'interdit fait justement varier le taux pour le prouver.
