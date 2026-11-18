begin;

alter table public.trading_accounts
  add column if not exists execution_mode text not null default 'simulated';

do $execution_mode_preconditions$
begin
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.trading_accounts'::regclass
      and attname = 'execution_mode'
      and atttypid = 'text'::regtype
      and attnotnull
      and not attisdropped
  ) then
    raise exception 'trading_accounts.execution_mode must be a non-null text column';
  end if;
  if exists (
    select 1 from public.trading_accounts
    where execution_mode is distinct from 'simulated'
  ) then
    raise exception 'Existing trading accounts must use simulated execution mode';
  end if;
end;
$execution_mode_preconditions$;

do $$
declare
  function_definition text;
  old_provider_requirement text := $old$
  select b.* into binding_row from public.trading_account_broker_connections b
    where b.trading_account_id = account_row.id and b.is_active is true limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'BROKER_BINDING_MISSING', 'message', 'No active broker binding is configured for this account'));
  end if;
  select c.* into connection_row from public.broker_connections c
    where c.id = binding_row.broker_connection_id
      and c.is_active is true and c.is_connected is true and c.connection_status = 'connected'
      and c.broker_id in ('dhan', 'zerodha') and c.broker_id = account_row.broker_provider;
  if not found then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'BROKER_CONNECTION_UNAVAILABLE', 'message', 'The account broker connection is not active'));
  end if;
$old$;
  execution_mode_requirement text := $new$
  if account_row.execution_mode <> 'simulated' then
    return jsonb_build_object('ok', false, 'replayed', false, 'error', jsonb_build_object('code', 'EXECUTION_MODE_UNSUPPORTED', 'message', 'Customer orders require simulated execution'));
  end if;
$new$;
begin
  select pg_get_functiondef('public.create_order_command(jsonb)'::regprocedure)
  into function_definition;

  if function_definition is null then
    raise exception 'create_order_command(jsonb) is not installed';
  end if;

  if position(old_provider_requirement in function_definition) > 0 then
    function_definition := replace(function_definition, old_provider_requirement, execution_mode_requirement);
  elsif position(execution_mode_requirement in function_definition) = 0 then
    raise exception 'create_order_command execution mode contract differs from the expected contract';
  end if;

  execute function_definition;
end;
$$;

commit;
