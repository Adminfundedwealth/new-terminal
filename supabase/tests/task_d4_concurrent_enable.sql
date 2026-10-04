do $$
begin
  if current_database() <> 'postgres' then
    raise exception 'D4 tests must run against the canonical postgres database';
  end if;
  update public.order_execution_outbox
  set state = 'completed', claimed_by = null, claimed_until = null
  where id = 'd4000000-0000-4000-8000-000000000006'
    and state in ('processing', 'completed');
  if not found then
    raise exception 'D4 first synthetic outbox row is missing';
  end if;

  update public.order_execution_outbox
  set state = 'pending', claimed_by = null, claimed_until = null,
      attempt_count = 0, available_at = timezone('utc', now())
  where id = 'd4000000-0000-4000-8000-000000000007'
    and state in ('processing', 'pending');
  if not found then
    raise exception 'D4 concurrent synthetic outbox row is missing';
  end if;
end;
$$;