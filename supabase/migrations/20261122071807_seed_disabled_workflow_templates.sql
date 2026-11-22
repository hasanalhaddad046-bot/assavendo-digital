insert into public.workflow_definitions
  (name, description, trigger_type, trigger_config, conditions, actions, autonomy_mode, enabled)
select
  'Modèle — paiement confirmé, préparer le message client',
  'Prépare un brouillon de confirmation après vérification effective du paiement. Aucun e-mail n’est envoyé automatiquement.',
  'payment_verified',
  '{}'::jsonb,
  '[]'::jsonb,
  '[{"type":"draft_customer_email","subject":"Assavendo Digital — paiement confirmé","body":"Votre paiement a été confirmé par notre prestataire. Votre commande suit maintenant le processus de préparation. Consultez votre espace client ou votre lien de suivi pour les mises à jour."}]'::jsonb,
  'draft',
  false
where not exists (
  select 1 from public.workflow_definitions
  where name = 'Modèle — paiement confirmé, préparer le message client'
);

insert into public.workflow_definitions
  (name, description, trigger_type, trigger_config, conditions, actions, autonomy_mode, enabled)
select
  'Modèle — commande en revue, note interne',
  'Ajoute une proposition de note pour rappeler les contrôles requis avant toute dépense ou livraison.',
  'order_manual_review',
  '{}'::jsonb,
  '[]'::jsonb,
  '[{"type":"internal_order_note","message":"Commande en revue manuelle : vérifier les éléments de paiement, les coordonnées et les justificatifs disponibles avant tout achat fournisseur ou toute expédition."}]'::jsonb,
  'suggest',
  false
where not exists (
  select 1 from public.workflow_definitions
  where name = 'Modèle — commande en revue, note interne'
);

insert into public.workflow_definitions
  (name, description, trigger_type, trigger_config, conditions, actions, autonomy_mode, enabled)
select
  'Modèle — retour demandé, préparer l’accusé de réception',
  'Prépare un brouillon de réponse au client après création d’une demande de retour.',
  'return_requested',
  '{}'::jsonb,
  '[]'::jsonb,
  '[{"type":"draft_customer_email","subject":"Assavendo Digital — demande de retour reçue","body":"Nous avons bien reçu votre demande de retour. Notre équipe va examiner les informations et vous communiquera les prochaines étapes après vérification."}]'::jsonb,
  'draft',
  false
where not exists (
  select 1 from public.workflow_definitions
  where name = 'Modèle — retour demandé, préparer l’accusé de réception'
);

insert into public.workflow_definitions
  (name, description, trigger_type, trigger_config, conditions, actions, autonomy_mode, enabled)
select
  'Modèle — expédition modifiée, préparer la notification',
  'Prépare un brouillon de notification à partir d’un changement de statut d’expédition enregistré.',
  'shipment_status_changed',
  '{}'::jsonb,
  '[]'::jsonb,
  '[{"type":"draft_customer_email","subject":"Assavendo Digital — mise à jour de votre expédition","body":"Le statut de votre expédition a été mis à jour. Consultez le lien de suivi sécurisé de votre commande pour voir les informations les plus récentes."}]'::jsonb,
  'draft',
  false
where not exists (
  select 1 from public.workflow_definitions
  where name = 'Modèle — expédition modifiée, préparer la notification'
);
