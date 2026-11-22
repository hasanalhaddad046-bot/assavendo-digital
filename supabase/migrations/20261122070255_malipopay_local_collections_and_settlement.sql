alter table public.payments
  drop constraint if exists payments_provider_check;

alter table public.payments
  add constraint payments_provider_check
  check (provider in ('paystack', 'clickpesa', 'malipopay'));

alter table public.payments
  add column if not exists provider_fee_minor bigint,
  add column if not exists provider_net_minor bigint,
  add column if not exists settlement_status text not null default 'unconfirmed';

alter table public.payments
  drop constraint if exists payments_settlement_status_check;

alter table public.payments
  add constraint payments_settlement_status_check
  check (settlement_status in ('unconfirmed', 'wallet_credited', 'bank_settled', 'manual_review'));

create index if not exists payments_provider_pending_reconcile_idx
  on public.payments(provider, status, created_at)
  where status in ('awaiting_payment', 'manual_review');
