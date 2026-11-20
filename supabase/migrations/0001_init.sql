-- Assavendo Digital : schéma initial.
-- Principe : seule la lecture des produits publiés est publique.
-- Tout le reste n'est accessible qu'avec la clé service_role (serveur).

create extension if not exists pgcrypto;

create table settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('paystack_dropshipping_status', 'not_requested'),
  ('paystack_approval_proof', ''),
  ('paystack_currencies', 'USD,KES'),
  ('paystack_fee_pct', ''),
  ('returns_reserve_pct', '3'),
  ('target_margin_pct', '30'),
  ('fx_stale_after_hours', '36'),
  ('fx_display_margin_pct', '0'),
  ('vpn_policy', 'challenge');

create table fx_snapshot (
  id int primary key default 1 check (id = 1),
  base text not null default 'USD',
  rates jsonb not null,
  sources jsonb not null default '{}',
  fetched_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  kind text not null check (kind in ('physical','digital','service')),
  parent_id uuid references categories(id)
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  platform text not null default '',
  url text,
  country char(2) not null default 'CN',
  billing_currency char(3) not null default 'CNY',
  trust_level text not null default 'in_review'
    check (trust_level in ('in_review','approved','watch','blocked')),
  notes text,
  last_checked timestamptz
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  slug text unique not null,
  name text not null,
  description text not null default '',
  kind text not null check (kind in ('physical','digital','service')),
  category_id uuid references categories(id),
  image_url text,
  price_usd_minor bigint check (price_usd_minor is null or price_usd_minor > 0),
  lead_time_days_min int,
  lead_time_days_max int,
  status text not null default 'draft'
    check (status in ('draft','review','published','suspended','archived')),
  created_at timestamptz not null default now(),
  -- un produit ne peut être publié sans prix
  constraint published_has_price check (status <> 'published' or price_usd_minor is not null)
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  source_url text,
  supplier_sku text not null default '',
  variant text not null default '',
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null,
  moq int not null default 1,
  fulfilment_mode char(1) not null default 'B' check (fulfilment_mode in ('A','B','C')),
  destinations text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','verified','blocked')),
  verified_at timestamptz,
  data_source text not null default 'manual'
);
create index offers_product_idx on offers(product_id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  email text not null,
  ship_country char(2) not null,
  ship_address jsonb,
  status text not null default 'awaiting_payment',
  display_currency char(3) not null default 'USD',
  total_usd_minor bigint not null,
  risk_score int not null default 0,
  risk_reasons jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  qty int not null check (qty > 0),
  unit_usd_minor bigint not null,
  -- instantané de l'offre fournisseur au moment de la vente (§6.6)
  offer_snapshot jsonb,
  purchase_status text not null default 'to_buy'
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  reference text unique not null,
  amount_minor bigint not null,
  currency char(3) not null,
  status text not null default 'awaiting_payment',
  fx_snapshot jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create table webhook_events (
  event_key text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor text,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Row Level Security : tout verrouillé par défaut.
alter table settings enable row level security;
alter table fx_snapshot enable row level security;
alter table categories enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table offers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table webhook_events enable row level security;
alter table audit_log enable row level security;

-- Lecture publique : catégories et produits publiés uniquement.
create policy "public read categories" on categories for select using (true);
create policy "public read published products" on products
  for select using (status = 'published');
-- Aucune autre policy : suppliers, offers (coûts), orders, payments, settings, etc.
-- ne sont lisibles qu'avec la clé service_role, qui contourne la RLS côté serveur.
