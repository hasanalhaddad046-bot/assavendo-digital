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

## Comptes clients

- Activer le fournisseur e-mail Supabase Auth et vérifier les modèles de confirmation/lien magique.
- Ajouter l'URL `https://<domaine-public>/compte` et les URL de prévisualisation explicitement autorisées dans la liste Redirect URLs Supabase Auth.
- Tester création de compte, connexion par lien, expiration, déconnexion, rafraîchissement de session, modification du profil, adresses et historique.
- Les commandes invitées existantes ne sont pas automatiquement rattachées à un compte ; seules les nouvelles commandes dont la session a été vérifiée sont liées à `orders.user_id`.


## Accès administrateur et automatisations V6.1

- Les comptes nominatifs de l'équipe utilisent Supabase Auth par lien e-mail ; chaque compte doit exister dans `admin_members` avec un rôle actif.
- Le compte propriétaire de secours par secret partagé reste disponible séparément ; il est nécessaire pour provisionner le premier propriétaire Auth si aucun rôle n'est encore enregistré.
- La clé `SUPABASE_SERVICE_ROLE_KEY` reste indispensable pour inviter, suspendre et rechercher les membres côté serveur. Elle n'est pas présente dans Vercel actuellement.
- Ajouter `https://<domaine>/admin/auth/callback` aux Redirect URLs de Supabase Auth ; activer l'envoi des invitations et liens magiques via un fournisseur e-mail vérifié.
- Les routes et actions contrôlent les permissions côté serveur. Le rôle auditeur est en lecture seule ; comptabilité, support, catalogue, achats et logistique ont des portées différentes.
- Les workflows déclenchés par paiement, revue de risque, transport ou retour sont idempotents et journalisés. Le moteur n'accepte que des notes internes ou des brouillons d'e-mail non envoyés ; achat, paiement, remboursement, changement de prix, publication ou envoi d'e-mail restent interdits.
- Les exécutions qui ne sont pas des brouillons automatiques nécessitent une approbation humaine. La tâche planifiée reprend les exécutions interrompues et applique un plafond de tentatives.
- Les workflows doivent être testés sur des événements réels non financiers avant activation à grande échelle.

## Framework et sécurité des dépendances

- Next.js a été mis à niveau vers `16.4.6` ; `middleware.ts` a été migré vers `proxy.ts` selon la convention Next.js 16.
- `npm audit` ne rapporte aucune vulnérabilité après cette mise à niveau.
- Dernière vérification : 27 tests unitaires, vérification TypeScript et build de production réussis.

## Automatisations V6.1

- Déclencheurs journalisés et idempotents : paiement vérifié, revue antifraude, transport et demande de retour.
- Actions autorisées : note interne ou brouillon d’e-mail non envoyé uniquement. Aucun achat, paiement, remboursement, changement de prix, publication ou envoi d’e-mail ne peut être déclenché par le moteur.
- Les opérations exigeant une approbation attendent la validation humaine. Le cron quotidien reprend les exécutions interrompues ; la fréquence reste quotidienne pour respecter l’offre Vercel observée.
- Les exécutions réelles restent à tester une fois les secrets, les comptes e-mail et les données opérationnelles configurés.


## Automatisation — échec de livraison numérique
L'API de téléchargement déclenche désormais le trigger digital_delivery_failed uniquement lorsqu'un actif déjà autorisé manque ou que la génération de l'URL signée échoue. Les URL invalides et les tentatives malformées ne déclenchent pas d'automatisation afin d'éviter de saturer le journal. Le déclencheur est idempotent par actif et motif ; les actions éventuelles restent soumises à la configuration et aux approbations du workflow.
