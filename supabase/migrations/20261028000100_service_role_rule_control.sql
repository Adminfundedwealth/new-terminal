do $migration$
declare
  function_definition text;
  guard_start integer;
  guard_end integer;
  guard_marker constant text := $guard$if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then$guard$;
  end_marker constant text := 'end if;';
begin
  function_definition := pg_get_functiondef('public.manage_rule_configuration(jsonb)'::regprocedure);
  guard_start := strpos(function_definition, guard_marker);

  if guard_start = 0 then
    if strpos(function_definition, 'rule management requires the trusted Terminal OS service role') > 0 then
      raise exception 'Unexpected rule-management role guard format; no function change was applied.';
    end if;
  else
    guard_end := strpos(substr(function_definition, guard_start), end_marker);
    if guard_end = 0 then
      raise exception 'Rule-management role guard is incomplete; no function change was applied.';
    end if;

    guard_end := guard_start + guard_end + length(end_marker) - 2;
    function_definition := substr(function_definition, 1, guard_start - 1)
      || substr(function_definition, guard_end + 1);
    execute function_definition;
  end if;
end;
$migration$;

revoke all on function public.manage_rule_configuration(jsonb) from public, anon, authenticated;
grant execute on function public.manage_rule_configuration(jsonb) to service_role;
