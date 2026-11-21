-- V6.1 — Identités nominatives et contrôle d'accès administrateur.
create table if not exists public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null check (role in (
    'owner','administrator','catalog_manager','purchasing_manager',
    'logistics_manager','support_agent','accountant','auditor'
  )),
  active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists admin_members_email_lower_uidx
  on public.admin_members (lower(email));
create index if not exists admin_members_role_active_idx
  on public.admin_members (role,active);

alter table public.admin_members enable row level security;
revoke all on table public.admin_members from public,anon,authenticated;
grant all on table public.admin_members to service_role;
drop policy if exists private_no_client_access on public.admin_members;
create policy private_no_client_access on public.admin_members
  for all to anon,authenticated using (false) with check (false);

alter table public.workflow_runs
  add column if not exists idempotency_key text,
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists next_retry_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

create unique index if not exists workflow_runs_idempotency_uidx
  on public.workflow_runs(idempotency_key) where idempotency_key is not null;
create index if not exists workflow_runs_retry_queue_idx
  on public.workflow_runs(status,next_retry_at,created_at)
  where status in ('queued','failed');
