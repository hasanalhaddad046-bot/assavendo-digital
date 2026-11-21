# Assavendo Digital V6 — mise en service et contrôles restants

## État technique vérifié

- Application Next.js : compilation de production réussie sur la branche de travail.
- Tests : 16 tests unitaires réussis.
- TypeScript : `npm run typecheck` réussi.
- Supabase : migrations V6 `v6_core_foundation`, `v6_security_logistics_ai` et `v6_foreign_key_indexes` appliquées.
- Base : 53 tables publiques, 53 avec RLS activé ; politiques de refus explicites sur les tables privées ; trois surfaces publiques limitées au catalogue publié et aux variantes publiques.
- Supabase Security Advisor : aucun lint.
- Supabase Performance Advisor : aucune clé étrangère non indexée après ajout des 20 index.
- Bucket `digital-assets` : privé.
- Aucun déploiement Vercel n'a été lancé pour les modifications en cours.

## Variables Vercel indispensables avant tests réels

Les variables ci-dessous sont absentes de la configuration Vercel inspectée et doivent être fournies via les paramètres sécurisés du projet :

- `SUPABASE_SERVICE_ROLE_KEY` : accès serveur aux données privées et fonctions protégées.
- `PAYSTACK_SECRET_KEY` : initialisation et vérification serveur des paiements.
- `PAYSTACK_WEBHOOK_SECRET` : signature du nouvel en-tête Paystack.
- `ADMIN_PASSWORD` et `ADMIN_SESSION_SECRET` : accès au Control Center.
- `CRON_SECRET` : autorisation des tâches planifiées ; variable présente mais valeur non vérifiable depuis l'inspection non déchiffrée.
- `RESEND_API_KEY` et `MAIL_FROM` : e-mails transactionnels.
- `MANUS_API_KEY` : tâches Manus.
- `ASV_KEY_OPENROUTER`, `ASV_KEY_GROQ`, `ASV_KEY_DEEPSEEK` et modèles correspondants : fonctions IA.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` et `TURNSTILE_SECRET_KEY` : facultatifs, requis uniquement si le challenge anti-bot est activé.

Aucune clé ni aucun mot de passe ne doit être placé dans le dépôt ou dans une variable `NEXT_PUBLIC_*` sauf les clés explicitement publiques.

## Conditions Paystack et trésorerie

- L'activation du checkout reste verrouillée tant que le statut dropshipping Paystack n'est pas `approved` et qu'une preuve écrite n'est pas enregistrée.
- Vérifier l'éligibilité réelle du pays, de l'activité et des devises avec Paystack avant toute activation.
- Confirmer le compte bancaire bénéficiaire, les devises de règlement et le relevé de règlement.
- Effectuer des transactions de test puis une réconciliation de bout en bout avant la production.

## Données opérationnelles à fournir et vérifier

- Fournisseurs : contacts, SKU, prix source, devise, MOQ, paliers, stock, dimensions, poids, délais, documents et conditions de retour.
- Agences chinoises : nom légal, adresse locale et latine, contact d'entrepôt, code de réception, frais, poids volumétrique, conditions de réception et de réexpédition.
- Transporteurs : services, tarifs, restrictions produits/pays, tracking et preuve de livraison.
- Produits : descriptions, images autorisées, variantes, offres vérifiées, coûts complets, droits de distribution numérique.
- Identité publique et support : coordonnées réellement utilisables, politique de retour, CGV et politique de confidentialité relues selon les obligations applicables.

## Tests de recette encore nécessaires

- Parcours réel Paystack (succès, échec, signature invalide, doublon, remboursement partiel et total).
- Vérification du dépôt effectif des fonds et rapprochement bancaire.
- Livraison réelle fournisseur → entrepôt → client avec adresses séparées.
- Vérification physique des poids, frais d'agence, transport, douanes et délais.
- Scan antivirus réel des fichiers numériques avant validation manuelle des droits.
- Tests d'e-mails Resend, reprises de file, rebonds et idempotence.
- Tests IA avec budgets, limites, erreurs fournisseurs et webhook Manus réel.
- Tests mobile, accessibilité, SEO, sauvegarde/restauration et procédure d'incident.

## Politique de livraison

Ne pas lancer de déploiement ni ouvrir les paiements réels avant :
1. configuration des variables secrètes ;
2. validation écrite Paystack et vérification des comptes de règlement ;
3. données fournisseurs/agences et contenus juridiques vérifiés ;
4. tests d'intégration et recette métier réussis ;
5. décision explicite de mise en production.
