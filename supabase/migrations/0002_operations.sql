-- Assavendo Digital : opérations (livraison, achats, retours, factures, e-mails).

alter table categories add column if not exists active boolean not null default true;
alter table webhook_events add column if not exists processed_at timestamptz;

-- Commandes : jeton public de suivi, expédition, TVA, facture, anonymisation
alter table orders add column if not exists public_token text not null default encode(gen_random_bytes(16), 'hex');
alter table orders add column if not exists shipping_usd_minor bigint not null default 0;
alter table orders add column if not exists vat_usd_minor bigint not null default 0;
alter table orders add column if not exists invoice_number text unique;
alter table orders add column if not exists paid_at timestamptz;
alter table orders add column if not exists anonymized_at timestamptz;
create unique index if not exists orders_public_token_idx on orders(public_token);

alter table order_items add column if not exists product_name text not null default '';
alter table order_items add column if not exists supplier_order_ref text;
alter table order_items add column if not exists carrier text;
alter table order_items add column if not exists tracking_number text;
alter table order_items add column if not exists agency_id uuid;
alter table order_items add column if not exists duty_mode text;

create table if not exists order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  kind text not null,
  message text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on order_events(order_id);

-- Matrice produit x pays : coût de livraison, mode DDP/DAP, délais.
create table if not exists delivery_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  country char(2) not null,
  duty_mode text not null default 'DAP' check (duty_mode in ('DDP','DAP')),
  shipping_usd_minor bigint not null default 0 check (shipping_usd_minor >= 0),
  days_min int,
  days_max int,
  unique (product_id, country)
);

-- Annuaire d'agences / entrepôts de réexpédition (adresses locales et latines).
create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null default '',
  country char(2) not null default 'CN',
  address_local text not null default '',
  address_latin text not null default '',
  contact text not null default '',
  notes text not null default '',
  active boolean not null default true
);
alter table order_items drop constraint if exists order_items_agency_fk;
alter table order_items add constraint order_items_agency_fk foreign key (agency_id) references agencies(id);

create table if not exists rma_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  order_item_id uuid references order_items(id),
  kind text not null check (kind in ('return','exchange','damaged','lost')),
  reason text not null,
  status text not null default 'requested'
    check (status in ('requested','approved','rejected','received','refunded','closed')),
  refund_usd_minor bigint,
  refund_reference text,
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamp with time zone
);

create sequence if not exists invoice_seq;

-- Numéro de facture continu, attribué une seule fois.
create or replace function assign_invoice_number(p_order uuid) returns text
language sql security definer set search_path = public as $$
  update orders
     set invoice_number = 'ASV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0')
   where id = p_order and invoice_number is null
  returning invoice_number;
$$;
revoke all on function assign_invoice_number(uuid) from public, anon, authenticated;

insert into settings (key, value) values
  ('vat_registered', 'false'),
  ('vat_pct', '0'),
  ('legal_name', ''),
  ('legal_address', ''),
  ('support_email', ''),
  ('tax_id', ''),
  ('retention_days', '1095'),
  ('min_profit_usd', '0.50'),
  ('payment_fee_fixed_usd', '0')
on conflict (key) do nothing;

alter table order_events enable row level security;
alter table delivery_rules enable row level security;
alter table agencies enable row level security;
alter table rma_requests enable row level security;
alter table email_outbox enable row level security;
-- Aucune policy publique : accès serveur (service_role) uniquement.
