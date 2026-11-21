-- A non-partial unique index is required for PostgREST upsert conflict inference.
create unique index if not exists workflow_runs_idempotency_full_uidx
  on public.workflow_runs(idempotency_key);
