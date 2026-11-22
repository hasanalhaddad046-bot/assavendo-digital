insert into public.workflow_definitions
  (name, description, trigger_type, trigger_config, conditions, actions, autonomy_mode, enabled)
select
  'Modèle — téléchargement numérique en échec, note interne',
  'Signale un échec technique de livraison numérique pour examen par un opérateur.',
  'digital_delivery_failed',
  '{}'::jsonb,
  '[]'::jsonb,
  '[{"type":"internal_order_note","message":"Échec technique du téléchargement d’un produit numérique. Vérifier l’actif protégé, les droits de livraison, le stockage privé et la génération du lien signé. Ne pas élargir les droits sans contrôle."}]'::jsonb,
  'suggest',
  false
where not exists (
  select 1 from public.workflow_definitions
  where name = 'Modèle — téléchargement numérique en échec, note interne'
);
