-- 15. Permissions: accès serveur uniquement sur les tables privées.
-- RLS reste active ; les clients anon/authenticated ont explicitement une policy de refus.
do $$
declare
  t text;
  private_tables text[] := array[
    'settings','fx_snapshot','fx_rate_history','suppliers','offers','orders','order_items','payments',
    'webhook_events','audit_log','order_events','delivery_rules','agencies','rma_requests','email_outbox',
    'refunds','product_variants','offer_price_tiers','offer_cost_components','agency_rates','purchase_orders',
    'purchase_order_items','shipment_packages','shipment_events','customer_profiles','customer_addresses',
    'digital_assets','digital_deliveries','digital_licenses','service_tasks','service_milestones','service_revisions',
    'ai_provider_configs','ai_models','ai_conversations','ai_messages','ai_tool_runs','ai_approvals','ai_usage_records',
    'workflow_definitions','workflow_runs','workflow_run_steps','payment_settlements','payment_settlement_items',
    'finance_adjustments','customer_wishlists','support_tickets','support_messages'
  ];
begin
  foreach t in array private_tables loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
    execute format('drop policy if exists private_no_client_access on public.%I',t);
    execute format('create policy private_no_client_access on public.%I for all to anon, authenticated using (false) with check (false)',t);
  end loop;
end $$;

-- Only active categories and published products are readable without a privileged server key.
drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories for select to anon, authenticated using (active=true);
drop policy if exists "public read published products" on public.products;
create policy "public read published products" on public.products for select to anon, authenticated using (status='published');
revoke insert,update,delete on public.categories,public.products from anon,authenticated;
grant select on public.categories,public.products to anon,authenticated;

-- Privileged RPCs: never callable from a browser client.
revoke all on function public.claim_webhook_event(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_webhook_event(text,text,jsonb) to service_role;
revoke all on function public.finish_webhook_event(text,text,text) from public,anon,authenticated;
grant execute on function public.finish_webhook_event(text,text,text) to service_role;
revoke all on function public.reserve_refund(text,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.reserve_refund(text,uuid,bigint,text) to service_role;
revoke all on function public.apply_refund_provider_status(text,text,text,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_refund_provider_status(text,text,text,bigint,jsonb,text) to service_role;
revoke all on function public.assign_invoice_number(uuid) from public,anon,authenticated;
grant execute on function public.assign_invoice_number(uuid) to service_role;

-- Cover missing FK indexes found in the database advisor.
create index if not exists categories_parent_id_idx on public.categories(parent_id);
create index if not exists email_outbox_order_id_idx on public.email_outbox(order_id);
create index if not exists offers_supplier_id_idx on public.offers(supplier_id);
create index if not exists order_items_agency_id_idx on public.order_items(agency_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists payments_order_id_idx on public.payments(order_id);
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists rma_requests_order_id_idx on public.rma_requests(order_id);
create index if not exists rma_requests_order_item_id_idx on public.rma_requests(order_item_id);


alter table public.rma_requests
  add column if not exists refund_currency char(3),
  add column if not exists refund_requested_at timestamptz;

alter table public.order_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists offer_id uuid references public.offers(id) on delete set null,
  add column if not exists source_price_minor bigint,
  add column if not exists source_currency char(3),
  add column if not exists source_fx_snapshot jsonb,
  add column if not exists landed_cost_usd_minor bigint,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists order_items_offer_id_idx on public.order_items(offer_id);
create index if not exists order_items_supplier_id_idx on public.order_items(supplier_id);

alter table public.orders
  add column if not exists display_fx_snapshot jsonb,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists risk_reviewed_at timestamptz;


alter table public.order_events add column if not exists event_key text;
create unique index if not exists order_events_event_key_idx
  on public.order_events(event_key);
create unique index if not exists digital_deliveries_order_item_idx
  on public.digital_deliveries(order_item_id);
create unique index if not exists service_tasks_order_item_idx
  on public.service_tasks(order_item_id);
grant usage,select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon,authenticated;

alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check(status in ('pending','sending','sent','failed'));

create table if not exists public.rate_limit_buckets (
  key_hash char(64) primary key,
  window_started_at timestamptz not null,
  request_count integer not null check(request_count >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists rate_limit_buckets_updated_idx on public.rate_limit_buckets(updated_at);

create or replace function public.consume_rate_limit(
  p_key_hash text, p_max_requests integer, p_window_seconds integer
) returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if p_key_hash !~ '^[a-f0-9]{64}$' or p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'rate_limit_arguments_invalid';
  end if;
  insert into public.rate_limit_buckets(key_hash,window_started_at,request_count,updated_at)
  values(p_key_hash,now(),1,now())
  on conflict(key_hash) do update set
    window_started_at=case
      when public.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now() then now()
      else public.rate_limit_buckets.window_started_at end,
    request_count=case
      when public.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now() then 1
      else public.rate_limit_buckets.request_count + 1 end,
    updated_at=now()
  where public.rate_limit_buckets.window_started_at + make_interval(secs => p_window_seconds) <= now()
     or public.rate_limit_buckets.request_count < p_max_requests
  returning request_count into v_count;
  return v_count is not null;
end;
$$;
alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from anon,authenticated;
grant all on table public.rate_limit_buckets to service_role;
create policy private_no_client_access on public.rate_limit_buckets
  for all to anon,authenticated using(false) with check(false);
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

-- FX provenance, offer routing, unit-level supplier costs and price audit snapshots.
alter table public.fx_snapshot
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table public.offers
  add column if not exists agency_id uuid references public.agencies(id) on delete set null,
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists source_listing_title text,
  add column if not exists source_listing_currency char(3),
  add column if not exists dimensions_unit text not null default 'mm',
  add column if not exists quality_notes text,
  add column if not exists risk_flags jsonb not null default '[]'::jsonb;
create index if not exists offers_agency_id_idx on public.offers(agency_id);
create index if not exists offers_variant_id_idx on public.offers(variant_id);

alter table public.offer_cost_components
  add column if not exists per_unit boolean not null default true,
  add column if not exists cost_stage text not null default 'pre_fulfilment';
alter table public.offer_cost_components drop constraint if exists offer_cost_components_cost_stage_check;
alter table public.offer_cost_components add constraint offer_cost_components_cost_stage_check
  check(cost_stage in ('supplier','china_domestic','agency_receiving','inspection','repackaging','export','international','destination','other'));

alter table public.purchase_orders
  add column if not exists delivery_address jsonb,
  add column if not exists supplier_instructions text,
  add column if not exists supplier_language char(2) not null default 'en',
  add column if not exists submitted_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists received_qty integer;

alter table public.purchase_order_items
  add column if not exists fulfilment_mode char(1) not null default 'B',
  add column if not exists agency_id uuid references public.agencies(id) on delete set null,
  add column if not exists supplier_product_url text,
  add column if not exists source_offer_snapshot jsonb not null default '{}'::jsonb;

alter table public.agency_rates
  add column if not exists service_type text not null default 'international_shipping',
  add column if not exists minimum_billable_weight_grams numeric(12,2),
  add column if not exists handling_fee_minor bigint not null default 0 check(handling_fee_minor >= 0);
create index if not exists agency_rates_service_type_idx
  on public.agency_rates(agency_id,service_type,destination_country,active);

alter table public.shipment_packages
  add column if not exists package_reference text unique,
  add column if not exists pieces integer not null default 1 check(pieces > 0),
  add column if not exists customs_reference text,
  add column if not exists estimated_delivery_at timestamptz,
  add column if not exists exception_reason text;

create table if not exists public.price_calculations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  selected_offer_id uuid references public.offers(id) on delete set null,
  selected_quantity integer not null default 1 check(selected_quantity > 0),
  source_unit_price_minor bigint not null check(source_unit_price_minor >= 0),
  source_currency char(3) not null,
  source_fx_snapshot jsonb not null,
  cost_breakdown jsonb not null,
  fixed_cost_usd_minor bigint not null check(fixed_cost_usd_minor >= 0),
  fee_pct numeric(8,4) not null,
  reserve_pct numeric(8,4) not null,
  target_margin_pct numeric(8,4) not null,
  sale_price_usd_minor bigint not null check(sale_price_usd_minor > 0),
  profit_usd_minor bigint not null,
  real_margin_pct numeric(8,4) not null,
  created_at timestamptz not null default now()
);
create index if not exists price_calculations_product_idx
  on public.price_calculations(product_id,created_at desc);
alter table public.products
  add column if not exists landed_cost_usd_minor bigint,
  add column if not exists selected_offer_id uuid references public.offers(id) on delete set null,
  add column if not exists price_calculated_at timestamptz;

alter table public.price_calculations enable row level security;
revoke all on table public.price_calculations from anon,authenticated;
grant all on table public.price_calculations to service_role;
create policy private_no_client_access on public.price_calculations
  for all to anon,authenticated using(false) with check(false);

-- Remove private transient rate-limit digests after their window has elapsed.
create or replace function public.cleanup_rate_limit_buckets()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v_deleted integer;
begin
  delete from public.rate_limit_buckets
  where updated_at < now() - interval '2 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_rate_limit_buckets() from public,anon,authenticated;
grant execute on function public.cleanup_rate_limit_buckets() to service_role;

-- V6 follow-up: variant-level price integrity, Manus task tracking, and purchase QC.
alter table public.product_variants
  add column if not exists price_usd_minor bigint,
  add column if not exists landed_cost_usd_minor bigint,
  add column if not exists selected_offer_id uuid references public.offers(id) on delete set null,
  add column if not exists price_calculated_at timestamptz,
  add column if not exists source_price_minor bigint,
  add column if not exists source_currency char(3),
  add column if not exists source_fx_snapshot jsonb;

alter table public.price_calculations
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

create index if not exists price_calculations_variant_idx
  on public.price_calculations(variant_id,created_at desc);

alter table public.purchase_order_items
  add column if not exists received_qty integer not null default 0,
  add column if not exists received_at timestamptz,
  add column if not exists qc_status text not null default 'pending',
  add column if not exists qc_notes text not null default '',
  add column if not exists damaged_qty integer not null default 0,
  add constraint purchase_order_items_received_qty_check check(received_qty >= 0),
  add constraint purchase_order_items_damaged_qty_check check(damaged_qty >= 0),
  add constraint purchase_order_items_qc_status_check check(qc_status in ('pending','passed','partial','failed','not_required'));

alter table public.suppliers
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists address_local text,
  add column if not exists address_latin text,
  add column if not exists payment_terms text,
  add column if not exists return_terms text,
  add column if not exists product_categories text[] not null default '{}',
  add column if not exists verified_documents jsonb not null default '[]'::jsonb;

alter table public.ai_tool_runs
  add column if not exists provider text not null default 'internal',
  add column if not exists provider_task_id text,
  add column if not exists provider_task_url text,
  add column if not exists provider_request_id text,
  add column if not exists provider_status text,
  add column if not exists last_event_at timestamptz,
  add column if not exists result_text text,
  add column if not exists result_json jsonb;

create unique index if not exists ai_tool_runs_manus_task_idx
  on public.ai_tool_runs(provider_task_id) where provider_task_id is not null;
create index if not exists ai_tool_runs_provider_status_idx
  on public.ai_tool_runs(provider,provider_status,created_at desc);

create table if not exists public.manus_webhook_events (
  event_id text primary key,
  event_type text not null,
  task_id text not null,
  payload jsonb not null,
  status text not null default 'received' check(status in ('received','processed','failed')),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.manus_webhook_events enable row level security;
revoke all on table public.manus_webhook_events from anon,authenticated;
grant all on table public.manus_webhook_events to service_role;
create policy private_no_client_access on public.manus_webhook_events
  for all to anon,authenticated using(false) with check(false);
create index if not exists manus_webhook_task_idx
  on public.manus_webhook_events(task_id,received_at desc);

alter table public.ai_usage_records
  add column if not exists cost_known boolean not null default false,
  add column if not exists request_id text,
  add column if not exists error_code text;

insert into public.settings(key,value)
values
  ('supplier_offer_stale_days','14'),
  ('supplier_quality_penalty_pct','5'),
  ('fx_stale_after_hours','36'),
  ('fx_display_margin_pct','0')
on conflict(key) do nothing;

insert into public.ai_provider_configs(provider,enabled,base_url,secret_env_name)
values
  ('openrouter',true,'https://openrouter.ai/api/v1/chat/completions','ASV_KEY_OPENROUTER'),
  ('groq',true,'https://api.groq.com/openai/v1/chat/completions','ASV_KEY_GROQ'),
  ('deepseek',true,'https://api.deepseek.com/chat/completions','ASV_KEY_DEEPSEEK'),
  ('manus',false,'https://api.manus.ai','MANUS_API_KEY')
on conflict(provider) do nothing;

-- Ensure every new private Manus table remains inaccessible to browser clients.

-- Publish only a narrow projection of active variants for live products.
drop policy if exists private_no_client_access on public.product_variants;
create policy public_read_live_product_variants on public.product_variants
  for select to anon,authenticated
  using (
    active = true
    and exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and p.status = 'published'
    )
  );
revoke all on table public.product_variants from anon,authenticated;
grant select(id,product_id,name,attributes,price_usd_minor,sort_order)
  on table public.product_variants to anon,authenticated;

create or replace view public.public_product_variants
with (security_invoker = true)
as
select id,product_id,name,attributes,price_usd_minor,sort_order
from public.product_variants
where active = true;
grant select on public.public_product_variants to anon,authenticated;

-- Seed the provider registry without storing provider credentials in the database.
update public.ai_provider_configs set enabled=false where provider='manus' and secret_env_name='MANUS_API_KEY';


-- 16. Fichiers numériques : bucket privé et validation de livraison côté serveur.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'digital-assets',
  'digital-assets',
  false,
  52428800,
  array[
    'application/pdf',
    'application/zip',
    'application/epub+zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Download authorization is based on the high-entropy order public token,
-- a verified payment, active digital rights, clean scan, expiry and a locked counter.
create or replace function public.consume_digital_delivery(
  p_order_token text,
  p_delivery_id uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_delivery record;
begin
  if p_order_token is null or p_order_token !~ '^[a-f0-9]{32}$' then
    return null;
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.public_token = p_order_token
    and o.status in ('paid_verified','processing','shipped','delivered')
    and exists (
      select 1
      from public.payments p
      where p.order_id = o.id
        and p.status = 'paid_verified'
        and not exists (
          select 1 from public.refunds r
          where r.payment_id = p.id and r.status = 'processed'
        )
    )
  limit 1;
  if v_order_id is null then return null; end if;

  select
    dd.id, dd.status, dd.expires_at, dd.max_downloads, dd.download_count,
    da.storage_bucket, da.storage_path, da.file_name, da.mime_type,
    da.scan_status, da.distribution_rights, da.active
  into v_delivery
  from public.digital_deliveries dd
  join public.digital_assets da on da.id = dd.asset_id
  where dd.id = p_delivery_id
    and dd.order_id = v_order_id
  for update of dd;

  if not found then return null; end if;
  if v_delivery.status <> 'available'
     or v_delivery.active is not true
     or v_delivery.scan_status <> 'clean'
     or v_delivery.distribution_rights not in ('owned','licensed','authorized')
     or (v_delivery.expires_at is not null and v_delivery.expires_at <= now())
     or (v_delivery.max_downloads is not null and v_delivery.download_count >= v_delivery.max_downloads) then
    return null;
  end if;

  update public.digital_deliveries
  set download_count = download_count + 1,
      last_downloaded_at = now(),
      status = case
        when max_downloads is not null and download_count + 1 >= max_downloads then 'expired'
        else status
      end
  where id = v_delivery.id;

  return jsonb_build_object(
    'bucket',v_delivery.storage_bucket,
    'path',v_delivery.storage_path,
    'file_name',v_delivery.file_name,
    'mime_type',v_delivery.mime_type,
    'download_count',v_delivery.download_count + 1,
    'max_downloads',v_delivery.max_downloads
  );
end;
$$;
revoke all on function public.consume_digital_delivery(text,uuid) from public,anon,authenticated;
grant execute on function public.consume_digital_delivery(text,uuid) to service_role;
