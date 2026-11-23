# Sécurité

La sécurité est la raison d'être de VINAC Link. Il permet aux agents IA de vos ordinateurs de
travailler ensemble sans accorder à aucun d'eux plus de confiance que vous n'avez décidé de lui en
donner.

## Notre technologie, sur des bases éprouvées

VINAC Link combine une technologie que nous avons conçue nous-mêmes et une cryptographie que la
communauté de la sécurité étudie depuis des années :

- **Un jumelage que seules des personnes peuvent terminer.** Deux ordinateurs se trouvent sur votre
  réseau, les deux écrans affichent le même code à 6 chiffres, et une personne appuie sur Autoriser sur
  chacun. Le code découle de l'échange de clés lui-même : un appareil intercalé ne peut pas faire
  concorder les deux écrans. Une invitation (créée seulement par une personne sur la page, à usage
  unique, valide 10 minutes) remplace cette vérification quand l'autre ordinateur est ailleurs.
  Quelqu'un à proximité, quelqu'un sur le réseau ou un agent sur l'un ou l'autre ordinateur ne peut pas
  terminer un jumelage seul.
- **Un pare-feu d'intentions.** Les agents ne s'envoient pas de commandes libres. Chaque demande nomme
  son but dans une liste fixe et versionnée, et vos règles décident (autoriser, vous demander
  d'abord, ou bloquer) avant que votre agent voie quoi que ce soit. Choisissez un mode (Restreint,
  Standard ou Auto) pour régler les valeurs par défaut en un clic; les demandes à risque élevé restent
  bloquées dans tous les modes.
- **Des secrets qui ne touchent jamais la conversation.** Les clés et les jetons vont directement dans
  le magasin de clés sécurisé de votre système d'exploitation. Une clé que personne n'a demandée arrive
  comme une offre et ne peut pas être utilisée avant que vous l'acceptiez. Les agents peuvent demander
  une clé par son nom et l'utiliser dans des programmes que vous approuvez; les outils d'agent de
  VINAC Link ne renvoient pas les valeurs secrètes. D'autres programmes exécutés sous le même compte
  du système peuvent encore lire les secrets déverrouillés dans le magasin de clés : verrouillez le
  coffre avec une phrase de passe et, tant qu'il est verrouillé, aucun programme ne peut les lire.
- **Une cryptographie publiée et bien étudiée.** Le jumelage et chaque connexion reposent sur le cadre
  du protocole Noise, la famille de protocoles derrière WireGuard et le chiffrement de transport de
  WhatsApp, avec de nouvelles clés à chaque session.

## Comment vous êtes protégé

| Protection | Ce que cela signifie pour vous |
|---|---|
| **Chiffrement de bout en bout** | Tout ce qui passe entre vos ordinateurs est chiffré pour l'appareil jumelé seulement, avec des clés qui changent à chaque session. |
| **Direct par défaut** | Vos ordinateurs se parlent directement. Le relais facultatif reste désactivé tant que vous ne l'activez pas, ne fonctionne qu'entre vos propres ordinateurs jumelés en personne, et ne fait que transmettre des messages scellés qu'il ne peut pas lire. Nous ne voyons aucun de vos échanges et ne détenons aucune de vos clés. |
| **Le compte est facultatif** | Un compte contient votre adresse courriel et, pour vos ordinateurs liés, leur nom, leur clé publique et leur *dernière activité* : jamais de contenu, de clés ni votre journal d'activité. Les agents ne peuvent pas se connecter, lier un ordinateur ni activer le relais. |
| **Preuve de livraison** | « Livré » signifie que l'autre ordinateur a prouvé avoir reçu exactement ce message. Les messages rejoués ou modifiés sont refusés. |
| **Vos règles d'abord** | Les demandes, les fichiers et les simples messages sont vérifiés selon vos règles avant qu'un agent les voie. Vous seul pouvez changer les règles ou approuver une demande, sur la page VINAC Link. |
| **Un humain dans la boucle** | Les agents peuvent utiliser les appareils jumelés, mais seule une personne peut jumeler un appareil, approuver une demande, changer une règle ou révéler un secret. |
| **Des clés protégées au repos** | Les clés de jumelage et les secrets sont conservés par le magasin de clés de Windows, macOS ou Linux, et l'historique des messages est chiffré sur le disque. Avec une phrase de passe, les secrets sont scellés de nouveau avec une clé que seule votre phrase de passe ouvre. |
| **Pas de déluge de demandes** | Au plus 25 demandes d'un même appareil vous attendent à la fois, et une demande sans décision expire après 3 jours. |
| **Un registre vérifiable** | Un journal des jumelages, des approbations et de l'utilisation des secrets, sans contenu, qui révèle toute modification : une ligne modifiée ou retirée est détectée, mais quelqu'un qui contrôle entièrement l'ordinateur pourrait encore remplacer tout le journal. Cherchez-y dans la page Journal d'activité, exportez-le, et créez des rapports signés avec la clé de l'appareil que n'importe qui peut vérifier. Il appuie un programme de conformité; il ne prouve pas à lui seul la conformité. |
| **Des agents dans des limites** | Une exécution autorisée permet à un agent d'utiliser des clés nommées pour une commande, dans un dossier, jusqu'à une heure fixée. VINAC Link lance lui-même le programme : les valeurs ne passent ni par l'agent ni par ses outils (le programme, lui, les reçoit); vous pouvez la révoquer en tout temps. |
| **Une page locale privée** | La page VINAC Link ne répond que sur votre propre ordinateur et refuse les autres sites Web. |
| **Discret sur le réseau** | Un ordinateur ne s'annonce sur votre réseau local (son nom et un code à usage unique) que pendant que *Jumeler un appareil* est ouvert. Cela seul ne peut rien jumeler, et cela s'arrête quand vous quittez l'écran. |

## Testé, et bientôt examiné

Ces protections sont couvertes par des tests automatisés qui les attaquent : rejouer des messages, les
modifier, forcer d'anciennes versions du protocole, se faire passer pour un autre appareil. Un audit de
sécurité indépendant est prévu, et nous en publierons les résultats.

## Bon à savoir

- VINAC Link est en accès anticipé. Pour les clés de production les plus sensibles, nous suggérons
  d'attendre l'audit publié.
- Comme toute application, VINAC Link ne peut pas vous protéger entièrement d'un logiciel malveillant
  qui fonctionne déjà sur votre ordinateur sous votre compte. Une phrase de passe garde vos secrets
  scellés tant que le coffre est verrouillé.
- Un message que vos règles laissent passer reste du simple texte : un agent doit le traiter comme de
  l'information, pas comme des ordres.
- Le coffre mobile et le transfert par le son sont en bêta.

## Signaler un problème

Si vous trouvez un problème de sécurité, écrivez à **hello@vinac.tech** avec « Security » dans
l'objet (en français ou en anglais), et ne le publiez pas avant que nous l'ayons corrigé. Nous
répondons en quelques jours et nous serons heureux de vous en donner le crédit. Les spécialistes de la
sécurité peuvent nous demander la conception technique complète (en anglais).
