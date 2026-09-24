-- Task 19: canonical, order-owned executions. Fills are written by the
-- control plane/service role; customer clients remain read-only through RLS.

alter table public.orders
  drop constraint if exists orders_identity_owner_key,
  add constraint orders_identity_owner_key unique (id, account_id, owner_user_id);

alter table public.executions
  drop constraint if exists executions_order_id_fkey,
  add constraint executions_order_owner_fk
    foreign key (order_id, account_id, owner_user_id)
    references public.orders(id, account_id, owner_user_id)
    on delete cascade;

create unique index if not exists executions_account_external_normalized_uidx
  on public.executions(account_id, lower(trim(external_execution_id)))
  where external_execution_id is not null and trim(external_execution_id) <> '';

comment on table public.executions is 'Canonical broker or simulated execution records; never an order acknowledgement.';
comment on column public.executions.external_execution_id is 'Normalized broker execution identifier used for idempotent fill ingestion.';