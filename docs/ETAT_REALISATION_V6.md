# Assavendo Digital — état de réalisation V6

Mise à jour : 22 novembre 2026  
Branche de travail : assavendo-v6-hardening-20261121

Ce bilan sépare ce qui est développé, vérifié, ou encore dépendant d'un compte, d'une autorisation, d'un partenaire réel ou des informations du propriétaire.

## 1. Socle et sécurité

- [x] Next.js 16.4.6, proxy.ts et intégration Supabase SSR.
- [x] RLS activé sur 54/54 tables publiques.
- [x] RBAC avec huit rôles, contrôle serveur des pages et actions sensibles.
- [x] Connexion client par e-mail et historique de commande.
- [x] Limitation de débit et garde-fous serveur.
- [ ] Renseigner SUPABASE_SERVICE_ROLE_KEY dans Vercel.
- [ ] Configurer SMTP et les redirections de Supabase Auth.
- [ ] Créer le premier compte propriétaire : admin_members est vide.
- [ ] Vérifier en exécution les secrets ADMIN_SESSION_SECRET et CRON_SECRET. Leur valeur chiffrée n'est pas visible depuis la lecture des variables.

## 2. Paiements et trésorerie

- [x] Le paiement Paystack pour le dropshipping reste bloqué sans approbation écrite.
- [x] Connecteur MALIPOPAY Mobile Money préparé pour les commandes livrées en Tanzanie.
- [x] USD reste la devise de gestion ; conversion USD/TZS datée, arrondie au TZS entier supérieur et enregistrée sur le paiement.
- [x] Webhook HMAC-SHA256, déduplication, contrôle du paiement dans l'API, vérification du montant/de la devise et revue manuelle des anomalies.
- [x] Séparation du paiement confirmé, des frais connus, du net versé au portefeuille marchand et du dépôt bancaire.
- [x] Rapprochement quotidien des références en attente ; statuts finaux confirmés par l'API, partiels ou ambigus envoyés en revue manuelle.
- [ ] Ouvrir le compte MALIPOPAY et passer le KYC individuel.
- [ ] Obtenir par écrit l'accord sur le statut du titulaire, les catégories et l'activité exacte de vente à la commande/dropshipping.
- [ ] Faire approuver le compte bancaire de règlement.
- [ ] Ajouter MALIPOPAY_API_KEY et MALIPOPAY_WEBHOOK_SECRET dans Vercel.
- [ ] Paramétrer l'URL de webhook, tester sur les destinataires autorisés et obtenir l'approbation go-live.
- [ ] Vérifier les frais effectifs et un premier règlement bancaire sur preuve.
- [ ] Activer PAYMENT_PROVIDER et les drapeaux MALIPOPAY uniquement après ces validations.

Périmètre du code actuel : collecte Mobile Money seulement. Les cartes, les encaissements bancaires/USSD et les sorties automatiques de fonds ne sont pas intégrés au checkout. Un statut paid_verified ne prouve pas que l'argent a déjà été versé sur le compte bancaire.

## 3. Catalogue et fournisseurs

- [x] Schémas catalogue, variantes, offres, paliers fournisseurs et calculs de prix.
- [x] Conversion multi-devises et instantanés FX.
- [ ] Enregistrer les premiers produits, variantes, SKU, prix source et documents fiables.
- [ ] Enregistrer les fournisseurs avec leurs coordonnées, URL, MOQ, prix, délais et conditions réelles.
- [ ] Importer les offres et confirmer les prix de chaque variante.
- [ ] Tester un prix source en CNY conservé en CNY et converti côté Assavendo en USD.
- [ ] Déterminer les catégories réellement vendues et celles exclues par les prestataires/transporteurs.

## 4. Agences et livraisons physiques

- [x] Bons d'achat, approbation humaine, réception, contrôle qualité, colis multiples, suivi et réexpédition.
- [x] Modèles de données d'agences, tarifs et règles de livraison.
- [ ] Enregistrer les agences réelles en Chine et en Tanzanie, leurs entrepôts, contacts et contrats.
- [ ] Entrer les tarifs par poids/volume, manutention, stockage, consolidation et réexpédition.
- [ ] Confirmer destinations, produits interdits, délais, assurance, taxes et responsabilités.
- [ ] Faire un test réel de commande/colis avec références fournisseur et transporteur.
- [ ] Ne promettre ni DDP, ni destination, ni délai avant confirmation écrite du partenaire.

## 5. Produits numériques et services

- [x] Stockage privé, droits d'accès, liens signés temporaires et quotas.
- [x] Déclencheur digital_delivery_failed raccordé aux échecs réels d'actif protégé ou de création d'URL signée.
- [x] Modèle de workflow pour cet échec créé mais désactivé.
- [ ] Connecter un vrai scanner antivirus. Les contrôles MIME/taille et la revue humaine ne remplacent pas un scan anti-malware.
- [ ] Fournir les fichiers sous licence et preuves de droits.
- [ ] Tester un achat, l'accès numérique, la révocation et les révisions d'un service.

## 6. IA et workflows

- [x] AI Gateway avec routage Groq/OpenRouter/DeepSeek, fallback et masquage des e-mails/téléphones.
- [x] L'assistant n'invente plus de produits lorsque le catalogue publié ne retourne aucune correspondance.
- [x] Suivi IA des tokens, tâches, latences, succès/échecs et coût connu/inconnu selon les tarifs enregistrés.
- [x] Panneau admin affichant l'état des clés/modèles sans exposer de secrets.
- [x] Quatre fournisseurs référencés ; Manus reste désactivé.
- [x] Cinq modèles de workflow créés désactivés : paiement, revue manuelle, retour, expédition et échec de livraison numérique.
- [ ] Configurer ASV_KEY_OPENROUTER, ASV_KEY_GROQ, ASV_KEY_DEEPSEEK et MANUS_API_KEY.
- [ ] Choisir les IDs de modèles présents dans les comptes réels, tester les API et renseigner ai_models.
- [ ] Enregistrer les tarifs réels par modèle ; tant qu'ils manquent, le coût IA reste déclaré inconnu.
- [ ] Fixer budgets journaliers/mensuels après enregistrement des tarifs.
- [ ] Faire relire et activer les workflows un par un. Tous les modèles actuels sont désactivés et aucune exécution réelle n'a eu lieu.
- [ ] Ajouter les alertes de santé et reprise des tâches bloquées.

## 7. E-mails, conformité et parcours client

- [x] File d'attente e-mail et clés d'idempotence.
- [x] Pages de confidentialité, mentions légales, livraison et retours présentes dans le projet.
- [ ] Fournir les vraies informations du vendeur, pays d'établissement, adresse et contacts publics.
- [ ] Faire valider juridiquement les textes, taxes, facturation, confidentialité, conservation et transferts de données selon les pays ciblés.
- [ ] Configurer Resend et un expéditeur vérifié.
- [ ] Tester les e-mails, tickets, retours, remboursements et avis après commande réelle.
- [ ] Valider les campagnes marketing/consentements et les règles de fidélisation.

## 8. Mise en production

- [x] Migrations de cette phase appliquées à Supabase.
- [x] Crons quotidiens MALIPOPAY et workflows configurés dans vercel.json.
- [x] TypeScript, tests, build Next.js et npm audit passés.
- [ ] Synchroniser la branche locale vers GitHub.
- [ ] Ajouter les secrets dans Preview et valider leur fonctionnement.
- [ ] Déployer une Preview et faire le test d'acceptation de bout en bout.
- [ ] Vérifier alertes, sauvegardes, restauration et procédure incident.
- [ ] Passer à un plan Vercel autorisant l'usage commercial. Hobby est réservé à l'usage personnel/non commercial et ses tâches planifiées ne s'exécutent qu'une fois par jour ; évaluer un plan commercial approprié ou un ordonnanceur dédié avant l'ouverture.
- [ ] Après validation des tests et des autorisations marchandes, préparer seulement alors la mise en production.

## 9. Vérifications techniques du 22 novembre 2026

- TypeScript : réussi.
- Tests unitaires : 34/34 réussis à la dernière exécution complète.
- Build Next.js : réussi.
- npm audit : 0 vulnérabilité signalée.
- Supabase : RLS sur 54/54 tables ; aucune alerte de sécurité. Les avertissements de performance restants sont des index encore inutilisés, à réévaluer après les premières données et requêtes réelles.
- Données : 39 catégories ; 0 produit, fournisseur, offre, agence, variante ou commande réelle au dernier contrôle.
- Administration : 0 membre dans admin_members.
- IA : 0 modèle dans ai_models.
- Workflows : 5 modèles désactivés ; 0 exécution réelle.
- Paiement : aucun encaissement réel testé.

## 10. Publication

Les changements de cette phase restent sur la branche locale. Ils n'ont pas été poussés vers GitHub et ne sont pas déployés en production. La production n'a pas été modifiée pendant ces travaux.

Conclusion : le socle applicatif et les garde-fous sont avancés et les tests locaux passent. La boutique n'est toutefois pas prête à accepter des commandes réelles avant obtention des approbations, ajout des secrets, saisie des partenaires/données commerciales et tests réels.
