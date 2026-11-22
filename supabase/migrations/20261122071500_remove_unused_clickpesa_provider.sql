do $$
begin
  if exists (select 1 from public.payments where provider = 'clickpesa') then
    raise exception 'Cannot remove ClickPesa provider while payment rows still reference it';
  end if;
end $$;

alter table public.payments
  drop constraint if exists payments_provider_check;

alter table public.payments
  add constraint payments_provider_check
  check (provider in ('paystack', 'malipopay'));
