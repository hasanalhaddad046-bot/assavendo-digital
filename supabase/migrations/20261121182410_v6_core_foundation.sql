-- Assavendo Digital V6 — hardening financier et socle métier.
-- Migration additive: aucune commande, offre ou donnée client existante n'est supprimée.

-- 1. Paiements et webhooks : journal durable, reprises et rapprochement.
alter table public.payments
  add column if not exists provider_status text,
  add column if not exists provider_transaction_id text,
  add column if not exists settled_at timestamptz,
  add column if not exists reversed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists provider_payload jsonb;

alter table public.webhook_events
  add column if not exists processed_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'received',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

update public.webhook_events
set status = case when processed_at is not null then 'processed' else status end,
    updated_at = coalesce(processed_at, received_at, now());

alter table public.webhook_events drop constraint if exists webhook_events_status_check;
alter table public.webhook_events add constraint webhook_events_status_check
  check (status in ('received','processing','processed','failed'));
alter table public.webhook_events add constraint webhook_events_attempt_count_check
  check (attempt_count >= 0);
create index if not exists webhook_events_status_updated_idx
  on public.webhook_events(status, updated_at);

-- Existing offers.status check only allowed draft/verified/blocked.
-- V6 introduces an explicit review/expiry lifecycle.
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status in ('draft','review','verified','blocked','expired'));

-- Atomically reserve a webhook for processing. Duplicate processed events are ignored;
-- failed events and stale in-progress events can be retried safely.
create or replace function public.claim_webhook_event(
  p_event_key text, p_event_type text, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare v_key text;
begin
  insert into public.webhook_events(event_key,event_type,payload,status,attempt_count,updated_at)
  values(p_event_key,p_event_type,coalesce(p_payload,'{}'::jsonb),'processing',1,now())
  on conflict(event_key) do update set
    event_type=excluded.event_type,
    payload=excluded.payload,
    status='processing',
    attempt_count=public.webhook_events.attempt_count+1,
    last_error=null,
    updated_at=now()
  where public.webhook_events.status in ('received','failed')
     or (public.webhook_events.status='processing' and public.webhook_events.updated_at < now()-interval '5 minutes')
  returning event_key into v_key;
  return v_key is not null;
end;
$$;

create or replace function public.finish_webhook_event(
  p_event_key text, p_status text, p_error text default null
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('processed','failed','received') then
    raise exception 'webhook_status_invalid';
  end if;
  update public.webhook_events
  set status=p_status,
      processed_at=case when p_status='processed' then coalesce(processed_at,now()) else processed_at end,
      last_error=case when p_status='failed' then left(coalesce(p_error,'Processing failed'),1000) else null end,
      updated_at=now()
  where event_key=p_event_key;
end;
$$;

-- 2. Remboursements : réservation atomique, plafond cumulé, état confirmé par Paystack.
alter table public.rma_requests drop constraint if exists rma_requests_status_check;
alter table public.rma_requests add constraint rma_requests_status_check
  check (status in ('requested','approved','rejected','received','refund_pending','refunded','closed'));

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  rma_id uuid not null references public.rma_requests(id) on delete restrict,
  request_reference text not null unique,
  provider_reference text unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null default 'pending'
    check (status in ('pending','processing','needs_attention','processed','failed')),
  prior_rma_status text not null check (prior_rma_status in ('approved','received')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  provider_payload jsonb
);
create index if not exists refunds_payment_status_idx on public.refunds(payment_id,status);
create index if not exists refunds_rma_status_idx on public.refunds(rma_id,status);
create unique index if not exists refunds_one_active_per_rma_idx
  on public.refunds(rma_id) where status in ('pending','processing','needs_attention');

create or replace function public.reserve_refund(
  p_payment_reference text, p_rma_id uuid, p_amount_minor bigint, p_request_reference text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_rma public.rma_requests%rowtype;
  v_existing public.refunds%rowtype;
  v_refund_id uuid;
  v_reserved bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'refund_amount_invalid'; end if;
  if p_request_reference is null or p_request_reference !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'refund_reference_invalid';
  end if;

  select * into v_rma from public.rma_requests where id=p_rma_id for update;
  if not found then raise exception 'rma_not_found'; end if;

  select * into v_payment from public.payments
  where reference=p_payment_reference and order_id=v_rma.order_id and status='paid_verified'
  for update;
  if not found then raise exception 'verified_payment_not_found'; end if;

  select * into v_existing from public.refunds
  where rma_id=p_rma_id and status in ('pending','processing','needs_attention')
  for update;
  if found then
    if v_existing.payment_id=v_payment.id and v_existing.amount_minor=p_amount_minor then
      return v_existing.id;
    end if;
    raise exception 'refund_already_in_progress';
  end if;
  if v_rma.status not in ('approved','received') then raise exception 'rma_not_refundable'; end if;

  select coalesce(sum(amount_minor),0)::bigint into v_reserved
  from public.refunds where payment_id=v_payment.id and status <> 'failed';
  if v_reserved+p_amount_minor > v_payment.amount_minor then
    raise exception 'refund_exceeds_captured_amount';
  end if;

  insert into public.refunds(payment_id,rma_id,request_reference,amount_minor,currency,status,prior_rma_status)
  values(v_payment.id,p_rma_id,p_request_reference,p_amount_minor,v_payment.currency,'pending',v_rma.status)
  returning id into v_refund_id;

  update public.rma_requests
  set status='refund_pending',refund_usd_minor=p_amount_minor,refund_reference=p_request_reference,updated_at=now()
  where id=p_rma_id;
  return v_refund_id;
end;
$$;

create or replace function public.apply_refund_provider_status(
  p_transaction_reference text,
  p_refund_reference text,
  p_status text,
  p_amount_minor bigint,
  p_provider_payload jsonb default null,
  p_error text default null
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_payment_id uuid;
  v_refund public.refunds%rowtype;
begin
  if p_status not in ('pending','processing','needs_attention','processed','failed') then
    raise exception 'refund_status_invalid';
  end if;
  select id into v_payment_id from public.payments where reference=p_transaction_reference;
  if v_payment_id is null then return null; end if;

  if p_refund_reference is not null and p_refund_reference <> '' then
    select * into v_refund from public.refunds
    where payment_id=v_payment_id and
      (provider_reference=p_refund_reference or request_reference=p_refund_reference)
    for update;
  end if;

  if v_refund.id is null then
    select * into v_refund from public.refunds
    where payment_id=v_payment_id and amount_minor=p_amount_minor
      and status in ('pending','processing','needs_attention')
    order by requested_at desc limit 1 for update;
  end if;
  if v_refund.id is null then return null; end if;
  if v_refund.amount_minor <> p_amount_minor then
    raise exception 'refund_amount_mismatch';
  end if;
  if p_provider_payload ? 'currency'
     and nullif(upper(p_provider_payload->>'currency'),'') is not null
     and upper(p_provider_payload->>'currency') <> upper(v_refund.currency) then
    raise exception 'refund_currency_mismatch';
  end if;

  update public.refunds
  set provider_reference=coalesce(nullif(p_refund_reference,''),provider_reference),
      status=p_status,
      provider_payload=coalesce(p_provider_payload,provider_payload),
      last_error=case when p_status='failed' then left(coalesce(p_error,'Refund failed'),1000) else null end,
      updated_at=now(),
      processed_at=case when p_status='processed' then coalesce(processed_at,now()) else processed_at end
  where id=v_refund.id;

  if p_status='processed' then
    update public.rma_requests set status='refunded',
      refund_reference=coalesce(nullif(p_refund_reference,''),refund_reference),updated_at=now()
    where id=v_refund.rma_id;
  elsif p_status='failed' then
    update public.rma_requests set status=v_refund.prior_rma_status,
      refund_reference=null,refund_usd_minor=null,updated_at=now()
    where id=v_refund.rma_id;
  else
    update public.rma_requests set status='refund_pending',
      refund_reference=coalesce(nullif(p_refund_reference,''),refund_reference),updated_at=now()
    where id=v_refund.rma_id;
  end if;
  return v_refund.id;
end;
$$;

-- 3. Historique FX : le snapshot courant est conservé, chaque refresh est aussi historisé.
create table if not exists public.fx_rate_history (
  id bigint generated always as identity primary key,
  base char(3) not null default 'USD',
  rates jsonb not null,
  sources jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists fx_rate_history_fetched_idx on public.fx_rate_history(fetched_at desc);

-- 4. Variantes, paliers et coûts de l'offre fournisseur.
alter table public.products
  add column if not exists brand text,
  add column if not exists source_name text,
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists package_contents text,
  add column if not exists warranty_terms text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.offers
  add column if not exists supplier_product_name text,
  add column if not exists availability_status text not null default 'unknown',
  add column if not exists available_qty integer,
  add column if not exists weight_grams numeric(12,2),
  add column if not exists dimensions_mm jsonb,
  add column if not exists lead_days_min integer,
  add column if not exists lead_days_max integer,
  add column if not exists last_checked_at timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists quality_score numeric(5,2),
  add column if not exists priority integer not null default 100,
  add column if not exists is_preferred boolean not null default false,
  add column if not exists fx_snapshot jsonb,
  add column if not exists converted_price_usd_minor bigint,
  add column if not exists converted_at timestamptz;

alter table public.offers drop constraint if exists offers_availability_status_check;
alter table public.offers add constraint offers_availability_status_check
  check (availability_status in ('unknown','available','low_stock','out_of_stock','preorder','discontinued'));

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_variants_product_idx on public.product_variants(product_id,active,sort_order);

create table if not exists public.offer_price_tiers (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  min_qty integer not null check (min_qty > 0),
  max_qty integer check (max_qty is null or max_qty >= min_qty),
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null,
  created_at timestamptz not null default now(),
  unique(offer_id,min_qty)
);
create index if not exists offer_price_tiers_offer_idx on public.offer_price_tiers(offer_id,min_qty);

create table if not exists public.offer_cost_components (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  kind text not null check(kind in ('supplier_fee','packaging','customization','sample','domestic_shipping','insurance','handling','bank_fee','fx_fee','other')),
  label text not null,
  amount_minor bigint not null check(amount_minor >= 0),
  currency char(3) not null,
  converted_usd_minor bigint,
  fx_snapshot jsonb,
  included_in_supplier_price boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offer_cost_components_offer_idx on public.offer_cost_components(offer_id);

-- 5. Tarifs d'agence réels par destination et validité de devis.
alter table public.agencies
  add column if not exists service_types text[] not null default '{}',
  add column if not exists supported_categories text[] not null default '{}',
  add column if not exists supported_countries text[] not null default '{}',
  add column if not exists prohibited_goods text[] not null default '{}',
  add column if not exists service_terms text,
  add column if not exists verified_at timestamptz,
  add column if not exists quote_valid_until timestamptz;

create table if not exists public.agency_rates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  origin_country char(2) not null default 'CN',
  destination_country char(2) not null,
  pricing_method text not null check(pricing_method in ('flat','actual_weight','volumetric_weight','greater_weight','tiered','quote')),
  currency char(3) not null,
  base_fee_minor bigint not null default 0 check(base_fee_minor >= 0),
  rate_per_kg_minor bigint check(rate_per_kg_minor is null or rate_per_kg_minor >= 0),
  volumetric_divisor numeric(12,2),
  tiers jsonb not null default '[]'::jsonb,
  duties_mode text not null default 'DAP' check(duties_mode in ('DDP','DAP','OTHER')),
  days_min integer,
  days_max integer,
  min_charge_minor bigint not null default 0 check(min_charge_minor >= 0),
  surcharges jsonb not null default '[]'::jsonb,
  restrictions text,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists agency_rates_route_idx on public.agency_rates(agency_id,origin_country,destination_country,active);

-- 6. Achats fournisseurs : création de brouillons et approbation séparée avant toute dépense.
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  purchase_reference text not null unique,
  status text not null default 'draft'
    check(status in ('draft','pending_approval','approved','ordered','partially_received','received','cancelled','disputed')),
  source_currency char(3),
  source_total_minor bigint,
  estimated_usd_minor bigint,
  approved_by text,
  approved_at timestamptz,
  supplier_order_reference text,
  supplier_shipping_reference text,
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_orders_order_idx on public.purchase_orders(order_id);
create index if not exists purchase_orders_supplier_status_idx on public.purchase_orders(supplier_id,status);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  offer_id uuid references public.offers(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  supplier_sku text,
  variant_snapshot jsonb not null default '{}'::jsonb,
  qty integer not null check(qty > 0),
  source_unit_price_minor bigint not null check(source_unit_price_minor >= 0),
  source_currency char(3) not null,
  total_usd_minor bigint,
  created_at timestamptz not null default now(),
  unique(purchase_order_id,order_item_id)
);
create index if not exists purchase_order_items_order_idx on public.purchase_order_items(order_item_id);

-- 7. Colis multiples, réception agence et réexpédition vers le client.
create table if not exists public.shipment_packages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid references public.order_items(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  stage text not null check(stage in ('supplier_to_agency','agency_to_customer','supplier_direct','provider_fulfillment','return_to_agency')),
  status text not null default 'pending'
    check(status in ('pending','label_created','in_transit','arrived_at_agency','received','processing','reship_requested','out_for_delivery','delivered','lost','damaged','exception','cancelled')),
  carrier text,
  tracking_number text,
  tracking_url text,
  origin_address jsonb,
  destination_address jsonb,
  weight_grams numeric(12,2),
  volumetric_weight_grams numeric(12,2),
  shipping_cost_minor bigint,
  shipping_currency char(3),
  shipped_at timestamptz,
  received_at timestamptz,
  delivered_at timestamptz,
  last_event_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipment_packages_order_idx on public.shipment_packages(order_id,created_at);
create index if not exists shipment_packages_item_idx on public.shipment_packages(order_item_id);

create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  package_id uuid not null references public.shipment_packages(id) on delete cascade,
  event_code text,
  status text not null,
  description text not null,
  location text,
  event_at timestamptz,
  source text not null default 'manual',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists shipment_events_package_idx on public.shipment_events(package_id,event_at desc);

-- 8. Comptes clients et adresses enregistrées, sans exposer les données à l'IA.
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  preferred_language char(2) not null default 'fr',
  preferred_country char(2),
  preferred_currency char(3) not null default 'USD',
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Adresse',
  recipient_name text not null,
  phone text not null,
  country char(2) not null,
  region text,
  district text,
  city text not null,
  line1 text not null,
  line2 text,
  landmark text,
  postal_code text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id,is_default);

-- 9. Livraison numérique contrôlée et travaux de service.
create table if not exists public.digital_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  version text not null default '1',
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes > 0),
  checksum_sha256 text,
  scan_status text not null default 'pending' check(scan_status in ('pending','clean','infected','failed')),
  distribution_rights text not null default 'unverified'
    check(distribution_rights in ('unverified','owned','licensed','authorized','rejected')),
  access_days integer,
  max_downloads integer,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique(storage_bucket,storage_path)
);
create index if not exists digital_assets_product_idx on public.digital_assets(product_id,active);

create table if not exists public.digital_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  asset_id uuid references public.digital_assets(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  token_hash text unique,
  expires_at timestamptz,
  max_downloads integer,
  download_count integer not null default 0,
  last_downloaded_at timestamptz,
  status text not null default 'pending' check(status in ('pending','available','revoked','expired')),
  created_at timestamptz not null default now()
);
create index if not exists digital_deliveries_order_idx on public.digital_deliveries(order_id);

create table if not exists public.digital_licenses (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  license_reference text not null,
  license_payload_encrypted text,
  issued_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  max_activations integer,
  activation_count integer not null default 0,
  status text not null default 'pending' check(status in ('pending','issued','active','revoked','expired')),
  created_at timestamptz not null default now()
);
create index if not exists digital_licenses_item_idx on public.digital_licenses(order_item_id);

create table if not exists public.service_tasks (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  assigned_supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'awaiting_brief'
    check(status in ('awaiting_brief','ready','assigned','in_progress','review','revision_requested','accepted','completed','cancelled','disputed')),
  brief jsonb not null default '{}'::jsonb,
  scope text not null default '',
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  acceptance_criteria text,
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_tasks_item_idx on public.service_tasks(order_item_id,status);

create table if not exists public.service_milestones (
  id uuid primary key default gen_random_uuid(),
  service_task_id uuid not null references public.service_tasks(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check(status in ('pending','in_progress','submitted','accepted','rejected')),
  due_at timestamptz,
  submitted_at timestamptz,
  accepted_at timestamptz,
  sort_order integer not null default 0
);
create index if not exists service_milestones_task_idx on public.service_milestones(service_task_id,sort_order);

create table if not exists public.service_revisions (
  id uuid primary key default gen_random_uuid(),
  service_task_id uuid not null references public.service_tasks(id) on delete cascade,
  requested_by text not null,
  request text not null,
  status text not null default 'open' check(status in ('open','in_progress','submitted','accepted','rejected')),
  result_path text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists service_revisions_task_idx on public.service_revisions(service_task_id,created_at);

-- 10. IA : configuration, modèles, historique minimisé, outils, approbations et coûts.
create table if not exists public.ai_provider_configs (
  provider text primary key check(provider in ('openrouter','groq','deepseek','manus')),
  enabled boolean not null default false,
  base_url text,
  secret_env_name text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.ai_provider_configs(provider) on delete cascade,
  model_key text not null,
  display_name text not null,
  capabilities text[] not null default '{}',
  input_cost_per_million numeric(14,6),
  output_cost_per_million numeric(14,6),
  max_context_tokens integer,
  enabled boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(provider,model_key)
);
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  scope text not null check(scope in ('customer','admin','workflow')),
  subject text,
  redaction_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check(role in ('system','user','assistant','tool')),
  content_redacted text not null,
  provider text,
  model_key text,
  token_count_input integer,
  token_count_output integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages(conversation_id,created_at);

create table if not exists public.ai_tool_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  tool_name text not null,
  arguments_redacted jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check(status in ('proposed','awaiting_approval','approved','running','succeeded','failed','rejected')),
  idempotency_key text unique,
  result_redacted jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_tool_runs_status_idx on public.ai_tool_runs(status,created_at);

create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  tool_run_id uuid not null references public.ai_tool_runs(id) on delete cascade,
  requested_by text not null,
  required_permission text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','expired')),
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ai_approvals_status_idx on public.ai_approvals(status,created_at);

create table if not exists public.ai_usage_records (
  id bigint generated always as identity primary key,
  provider text not null,
  model_key text not null,
  task text not null,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  cost_usd_micro bigint not null default 0,
  latency_ms integer,
  succeeded boolean not null,
  fallback_from text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage_records(created_at desc);
create index if not exists ai_usage_provider_idx on public.ai_usage_records(provider,created_at desc);

-- 11. Workflows déterministes, contrôlés et auditables.
create table if not exists public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  autonomy_mode text not null default 'suggest'
    check(autonomy_mode in ('suggest','draft','approval_required','automatic_reversible')),
  enabled boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workflow_definitions_enabled_idx on public.workflow_definitions(enabled,trigger_type);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references public.workflow_definitions(id) on delete set null,
  trigger_event text not null,
  trigger_payload_redacted jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check(status in ('queued','running','awaiting_approval','succeeded','failed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists workflow_runs_status_idx on public.workflow_runs(status,created_at);

create table if not exists public.workflow_run_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_index integer not null,
  action_type text not null,
  status text not null default 'pending' check(status in ('pending','running','awaiting_approval','succeeded','failed','skipped')),
  input_redacted jsonb not null default '{}'::jsonb,
  output_redacted jsonb,
  requires_approval boolean not null default false,
  completed_at timestamptz,
  unique(run_id,step_index)
);
create index if not exists workflow_run_steps_run_idx on public.workflow_run_steps(run_id,step_index);

-- 12. Trésorerie / règlements : ne pas confondre transaction réussie et fonds réglés.
create table if not exists public.payment_settlements (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack',
  provider_settlement_id text unique,
  currency char(3) not null,
  gross_amount_minor bigint not null,
  fees_minor bigint not null default 0,
  net_amount_minor bigint not null,
  status text not null default 'pending' check(status in ('pending','processing','paid','failed','reversed')),
  expected_at timestamptz,
  settled_at timestamptz,
  bank_account_label text,
  source_payload jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.payment_settlement_items (
  settlement_id uuid not null references public.payment_settlements(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  transaction_reference text not null,
  amount_minor bigint not null,
  fee_minor bigint not null default 0,
  currency char(3) not null,
  primary key(settlement_id,transaction_reference)
);
create index if not exists payment_settlement_items_payment_idx on public.payment_settlement_items(payment_id);

create table if not exists public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('supplier_cost','agency_cost','payment_fee','fx_fee','refund','chargeback','reserve','other')),
  reference text,
  order_id uuid references public.orders(id) on delete set null,
  amount_minor bigint not null,
  currency char(3) not null,
  amount_usd_minor bigint,
  fx_snapshot jsonb,
  description text not null,
  incurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists finance_adjustments_order_idx on public.finance_adjustments(order_id,incurred_at);

-- 13. Expérience client / suivi / marketing fondés sur des événements vérifiables.
create table if not exists public.customer_wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id,product_id)
);
create index if not exists customer_wishlists_user_idx on public.customer_wishlists(user_id);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  subject text not null,
  category text not null default 'other',
  status text not null default 'open' check(status in ('open','waiting_customer','waiting_internal','resolved','closed')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_status_idx on public.support_tickets(status,priority,created_at);

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_type text not null check(sender_type in ('customer','admin','system')),
  sender_id text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id,created_at);

-- 14. Idempotence email et tâches admin.
alter table public.email_outbox
  add column if not exists idempotency_key text,
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists email_outbox_idempotency_idx
  on public.email_outbox(idempotency_key);

