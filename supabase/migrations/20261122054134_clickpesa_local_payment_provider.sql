alter table public.payments
  add column if not exists provider text not null default 'paystack',
  add column if not exists provider_payment_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_provider_check'
  ) then
    alter table public.payments
      add constraint payments_provider_check
      check (provider in ('paystack', 'clickpesa'));
  end if;
end $$;

create unique index if not exists payments_provider_payment_id_uidx
  on public.payments(provider, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists payments_provider_status_created_idx
  on public.payments(provider, status, created_at desc);
