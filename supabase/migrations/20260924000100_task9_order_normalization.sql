-- Task 9: complete the existing canonical orders contract.
-- This extends public.orders; it does not create a second order authority.

alter table public.orders
  add column if not exists client_order_id text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists time_in_force text,
  add column if not exists parent_order_id uuid,
  add column if not exists replaces_order_id uuid,
  add column if not exists cancel_requested_at timestamptz;

alter table public.orders
  drop constraint if exists orders_order_type_check,
  drop constraint if exists orders_quantity_check,
  drop constraint if exists orders_filled_quantity_check,
  drop constraint if exists orders_price_check,
  drop constraint if exists orders_trigger_price_check,
  drop constraint if exists orders_status_check,
  drop constraint if exists orders_time_in_force_check,
  add constraint orders_order_type_check check (upper(order_type) in ('MARKET', 'LIMIT', 'SL', 'SL-M', 'STOP', 'STOP_LIMIT')),
  add constraint orders_quantity_check check (quantity > 0),
  add constraint orders_filled_quantity_check check (filled_quantity >= 0 and filled_quantity <= quantity),
  add constraint orders_price_check check (price is null or price > 0),
  add constraint orders_trigger_price_check check (trigger_price is null or trigger_price > 0),
  add constraint orders_status_check check (lower(status) in ('requested', 'pending', 'open', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'failed')),
  add constraint orders_time_in_force_check check (time_in_force is null or upper(time_in_force) in ('DAY', 'IOC', 'GTC'));

alter table public.orders
  drop constraint if exists orders_parent_order_fk,
  drop constraint if exists orders_replaces_order_fk,
  add constraint orders_parent_order_fk foreign key (parent_order_id) references public.orders(id) on delete set null,
  add constraint orders_replaces_order_fk foreign key (replaces_order_id) references public.orders(id) on delete set null;

create unique index if not exists orders_account_client_order_uidx
  on public.orders(account_id, client_order_id)
  where client_order_id is not null;

comment on column public.orders.id is 'Canonical platform order identifier; never replaced by a broker order id.';
comment on column public.orders.client_order_id is 'Platform client/idempotency identifier, unique within an account.';
comment on column public.orders.external_order_id is 'External broker order identifier; not the canonical platform order id.';