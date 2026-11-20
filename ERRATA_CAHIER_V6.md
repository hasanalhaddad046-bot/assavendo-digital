# Errata et corrections — Cahier des charges Assavendo Digital V6.0

Corrections appliquées dans le code livré. Chaque point : problème → correction retenue.

## A. Erreurs techniques (bloquantes si codées telles quelles)

1. **Secret de signature webhook Paystack (§11.2, §41.9).** Le cahier prévoit `PAYSTACK_WEBHOOK_SIGNING_SECRET`. Paystack signe les webhooks en HMAC-SHA512 avec la **clé secrète du compte** (en-tête `x-paystack-signature`). Il n'existe pas de secret de signature distinct. → Variable supprimée ; la clé secrète sert à la vérification, sur le **corps brut**.
2. **Montants en virgule flottante (§11, §43, §46).** Risque d'écarts d'arrondi et de refus Paystack. → Tous les montants envoyés/stockés en **unités mineures entières** (cents). Paystack attend des sous-unités (USD ×100, KES ×100).
3. **Formule de prix circulaire (§41.5 vs §43.6).** §41.5 additionne la marge ; §43.6 la calcule sur le prix de vente ; les frais Paystack (%) et la provision retours (%) dépendent du prix lui-même. → Formule unique et exacte : `P = (coûts fixes + frais fixes) ÷ (1 − marge − frais% − provision%)`. Refus si le dénominateur ≤ 0.
4. **Source FX (§46.2).** Frankfurter repose sur des taux de référence BCE : toutes les devises (ex. TZS) ne sont pas garanties. → Fournisseur principal + secondaire configurables, vérification **par devise** ; si la devise est absente, pas d'affichage converti (jamais de taux inventé).
5. **Adresse IP client (§45.2).** → `REMOTE_ADDR` par défaut ; `CF-Connecting-IP`/`CF-IPCountry` acceptés uniquement si l'option « derrière Cloudflare » est activée.
6. **Idempotence webhook (§11.2-G).** → Table `asv_webhook_events` avec clé unique ; traitement `UPDATE … WHERE statut <> 'paid_verified'` pour garantir un seul déclenchement.

## B. Contradictions internes

7. **Catégories (§1.4 vs §4).** §1.4 : « aucune catégorie bloquée » ; §4 : catégories inactives masquées. → Toutes les catégories **existent** techniquement ; elles ne sont **visibles/vendables** que si au moins une offre vérifiée est publiée.
8. **Version (en-tête V6 vs pied « BASE V5.0 »).** → Document unifié V6.1 ; la section 41 reste valable sauf formules remplacées par ce document.
9. **« Marge » (§11.6, §41.5, §43.6).** Trois définitions. → Marge = bénéfice ÷ prix de vente ; majoration = bénéfice ÷ coût. Deux champs distincts.
10. **Ordre des phases (§20 vs §36).** Deux plans différents. → Plan unique en lots : (1) données métier, (2) FX + prix, (3) Paystack verrouillé, (4) risque, (5) IA, (6) UI boutique.

## C. Lacunes juridiques et commerciales à traiter

11. **Dropshipping non éligible chez Paystack Kenya (§11.1).** Correctement identifié ; le code applique un **verrou dur** : aucun paiement physique/sans stock n'est initialisé tant que le statut n'est pas `approved` avec référence de preuve. Aucun contournement n'est implémenté. Produits numériques/services : même verrou par catégorie (matrice à renseigner).
12. **« Pas de société » (§14).** Techniquement possible, mais **ne dispense pas** des obligations fiscales (TRA en Tanzanie), de la loi de protection des données (PDPA 2022) ni du droit de la consommation des pays de vente ; Paystack Kenya exige un KYC cohérent avec l'activité. → Ajouter une page légale avec l'identité réelle du vendeur ; faire valider par un juriste local.
13. **Scraping Alibaba/1688 (§43.3).** Risque contractuel (CGU). → Import par API/fichier/saisie ; aucune lecture automatisée de pages protégées. Le champ « source des données » est conservé.
14. **TVA/taxes de vente et numérotation de factures** : absentes. → Champs `tax_note` et numéro de facture séquentiel à prévoir au lot 6.
15. **Frais Paystack figés** : ne jamais coder 3,8 %. → Réglage `PAYSTACK_FEE_PCT` modifiable, valeur par défaut vide (blocage de publication si vide).
16. **Retours (§41.4).** Le cahier ne couvre pas le droit de rétractation selon le pays. → Politique par pays à rédiger avant ouverture.

## D. Simplifications recommandées

17. Pas d'éditeur de workflows visuel au lancement (§30) : règles codées + interrupteurs.
18. Manus : adaptateur asynchrone, pas dans le chemin critique.
19. Checkout : aucune dépendance à l'IA (déjà prévu §18.8, appliqué).
