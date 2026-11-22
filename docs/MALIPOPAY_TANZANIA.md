# MALIPOPAY — encaissement local en Tanzanie

## Décision technique
MALIPOPAY est le connecteur local prioritaire pour les commandes livrées en Tanzanie. L'application conserve USD comme devise comptable et utilise un instantané USD/TZS horodaté pour le montant réellement facturé en TZS. L'API Unified Collection v2 est utilisée pour déclencher une collecte mobile money. Le canal est détecté par MALIPOPAY à partir du numéro tanzanien.

Ce connecteur ne prétend pas prendre en charge automatiquement les cartes et les paiements bancaires au checkout. Ces canaux exigent une intégration et des tests distincts. Ils restent disponibles dans le compte MALIPOPAY seulement s'ils y sont activés.

## Conditions d'activation manuelle
1. Ouvrir un compte sur le portail MALIPOPAY.
2. Soumettre le KYC. Le dossier individuel publié demande une pièce d'identité ou un passeport valide, un certificat TIN et un justificatif de domicile. La conformité peut demander des pièces supplémentaires.
3. Faire confirmer par écrit l'éligibilité du porteur, le pays d'activité, les catégories vendues et le modèle de dropshipping/achat après commande.
4. Ajouter au maximum trois numéros de test autorisés et effectuer des essais de collecte faibles. Avant approbation go-live, la documentation annonce une limite de TZS 100 000 par jour et un accès limité aux destinataires test.
5. Configurer le webhook de paiement dans Settings > Webhooks avec l'URL https://<domaine>/api/webhooks/malipopay, puis copier le secret de signature associé à ce webhook.
6. Ajouter la clé API secrète dans Vercel, puis soumettre l'application à l'approbation go-live de MALIPOPAY.
7. Après approbation, vérifier les plafonds du projet, les canaux autorisés, les frais effectivement appliqués et le compte de règlement.
8. Effectuer des transactions réelles de faible montant uniquement lorsque le prestataire a confirmé l'approbation.

## Variables serveur
Les secrets ne doivent jamais être exposés au navigateur ni commis dans Git.

- PAYMENT_PROVIDER=malipopay uniquement après validation complète.
- MALIPOPAY_ENABLED=true uniquement après validation.
- MALIPOPAY_ACCOUNT_APPROVED=true uniquement après activation du compte.
- MALIPOPAY_DROPSHIPPING_APPROVED=true uniquement après acceptation écrite de ce modèle.
- MALIPOPAY_CURRENCY=TZS.
- MALIPOPAY_API_KEY : clé de projet.
- MALIPOPAY_WEBHOOK_SECRET : secret du webhook, distinct de la clé API.

Les drapeaux d'approbation sont des décisions humaines et ne sont modifiés ni par une IA ni par un webhook. La configuration déployée est volontairement désactivée tant que les justificatifs ne sont pas reçus.

## Flux d'encaissement
- Le checkout n'autorise MALIPOPAY que pour le pays de livraison TZ et la devise sélectionnée TZS.
- Le taux de référence USD/TZS vient du service FX serveur. La conversion est arrondie au TZS entier supérieur et le taux, la source et l'arrondi sont sauvegardés.
- POST /api/v2/payment/collection reçoit le montant entier TZS, un numéro tanzanien, amountType=FULL et push=true.
- Le webhook est validé par HMAC-SHA256 sur le corps HTTP brut et le header X-Malipopay-Signature. Assavendo enregistre d'abord un événement idempotent minimal et répond rapidement en HTTP 200, puis traite le paiement en tâche post-réponse.
- Le serveur vérifie ensuite la transaction sur GET /api/v1/payment/reference/{reference}. Un webhook ou un retour navigateur ne suffit jamais à déclarer la commande payée.
- Le statut, la référence, la devise et le montant payé doivent correspondre exactement au montant attendu. Une différence déclenche une revue manuelle.
- Les événements sont dédupliqués et les paiements sont rapprochés par référence.
- Le webhook étant livré sans nouvelle tentative par MALIPOPAY, Assavendo conserve un rapprochement quotidien des références non résolues. Le guide webhook indique que l'enregistrement de paiement reste disponible pour le rapprochement ; le job effectue une seule recherche quotidienne par référence (et non un polling fréquent). Un statut final SUCCESSFUL/PAID est validé par l'API, FAILED/REJECTED/CANCELLED est clôturé en échec, PARTIAL ou un état encore indéterminé au-delà de la fenêtre USSD de 90 secondes est placé en revue manuelle. Aucun paiement n'est déduit comme réussi à partir d'un simple timeout.

## Portefeuille marchand et versement bancaire
La confirmation du paiement client crédite le portefeuille MALIPOPAY net des frais annoncés par la plateforme. Cela ne prouve pas que l'argent est déjà arrivé sur le compte bancaire. Assavendo enregistre donc séparément le paiement, les frais, le net crédité au portefeuille (wallet_credited) et le règlement bancaire (bank_settled) qui doit être confirmé à partir d'un relevé ou d'une preuve de règlement.

Les frais réels doivent être lus sur les données du paiement et/ou les tarifs propres au projet ; les tarifs publics sont indicatifs et peuvent évoluer. Aucune opération de reversement ou de payout n'est exécutée automatiquement par le checkout. Les sorties d'argent restent soumises à validation humaine et aux contrôles du prestataire.

## Limite de disponibilité
MALIPOPAY annonce actuellement un service pour les entreprises opérant en Tanzanie. Le fait qu'une documentation accepte les commerçants individuels n'assure pas qu'un demandeur donné, son statut de résidence, son activité de dropshipping ou son compte bancaire sera approuvé. Si le compte ou les versements sont refusés, le connecteur reste désactivé ; aucune fausse identité, aucun compte tiers ni aucune catégorie dissimulée ne doit être utilisé.
