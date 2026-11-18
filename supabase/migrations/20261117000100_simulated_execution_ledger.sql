begin;

create table if not exists public.account_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_user_id uuid not null,
  order_id uuid not null,
  external_execution_id text not null,
  entry_type text not null check (entry_type = 'execution'),
  amount numeric(20, 8) not null,
  balance_after numeric(20, 8) not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint account_ledger_entries_account_owner_fk
    foreign key (account_id, owner_user_id) references public.trading_accounts(id, owner_user_id) on delete cascade,
  constraint account_ledger_entries_order_account_owner_fk
    foreign key (order_id, account_id, owner_user_id) references public.orders(id, account_id, owner_user_id) on delete cascade,
  constraint account_ledger_entries_account_execution_key unique (account_id, external_execution_id)
);

alter table public.account_ledger_entries enable row level security;
revoke all on public.account_ledger_entries from public, anon, authenticated;
grant select, insert on public.account_ledger_entries to service_role;

create policy account_ledger_entries_customer_read
  on public.account_ledger_entries
  for select
  to authenticated
  using (owner_user_id = auth.uid());
grant select on public.account_ledger_entries to authenticated;

create or replace function public.record_execution_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.trading_accounts%rowtype;
  position_row public.positions%rowtype;
  realized_delta numeric := 0;
  close_quantity numeric;
  amount_value numeric;
begin
  if new.external_execution_id is null or trim(new.external_execution_id) = ''
     or new.order_id is null or new.account_id is null or new.owner_user_id is null
     or new.quantity is null or new.quantity <= 0 or new.execution_price is null or new.execution_price <= 0
     or new.side not in ('buy', 'sell') then
    raise exception 'INVALID_EXECUTION_LEDGER_SOURCE' using errcode = '22023';
  end if;

  select * into account_row
  from public.trading_accounts
  where id = new.account_id and owner_user_id = new.owner_user_id
  for update;
  if not found then
    raise exception 'EXECUTION_LEDGER_ACCOUNT_MISMATCH' using errcode = '42501';
  end if;

  if new.instrument_id is not null then
    select * into position_row from public.positions
    where account_id = new.account_id and instrument_id = new.instrument_id
      and position_status = 'open' and quantity > 0
    order by id limit 1 for update;
  else
    select * into position_row from public.positions
    where account_id = new.account_id and instrument_id is null
      and symbol = upper(new.symbol) and position_status = 'open' and quantity > 0
    order by id limit 1 for update;
  end if;

  if found and position_row.side <> (case when new.side = 'buy' then 'long' else 'short' end) then
    close_quantity := least(position_row.quantity, new.quantity);
    realized_delta := (new.execution_price - position_row.average_price) * close_quantity
      * case when position_row.side = 'long' then 1 else -1 end;
  end if;

  amount_value := realized_delta - coalesce(new.fees, 0) - coalesce(new.taxes, 0);
  insert into public.account_ledger_entries (
    account_id, owner_user_id, order_id, external_execution_id, entry_type, amount, balance_after
  ) values (
    new.account_id,
    new.owner_user_id,
    new.order_id,
    upper(trim(new.external_execution_id)),
    'execution',
    amount_value,
    coalesce(account_row.current_balance, account_row.starting_balance) + amount_value
  ) on conflict (account_id, external_execution_id) do nothing;

  return new;
end;
$$;

revoke all on function public.record_execution_ledger_entry() from public, anon, authenticated;
drop trigger if exists executions_record_account_ledger_entry on public.executions;
create trigger executions_record_account_ledger_entry
  before insert on public.executions
  for each row execute function public.record_execution_ledger_entry();

commit;
