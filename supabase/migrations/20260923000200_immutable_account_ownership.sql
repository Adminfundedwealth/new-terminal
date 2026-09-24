-- Trading-account ownership is canonical and cannot be changed through a normal update.
-- Reassignment is intentionally unsupported until an explicit, authorized workflow exists.

create or replace function public.prevent_trading_account_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'trading account ownership cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trading_accounts_owner_immutable on public.trading_accounts;
create trigger trading_accounts_owner_immutable
before update of owner_user_id on public.trading_accounts
for each row execute function public.prevent_trading_account_owner_change();