-- Task 11: serialize and harden the existing server-authoritative risk gate.
-- This wraps the Task 5/Task 4 implementation; it does not create a second authority.

alter function public.evaluate_pre_trade_risk(jsonb) rename to evaluate_pre_trade_risk_unlocked;

create or replace function public.evaluate_pre_trade_risk(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_account_id uuid := nullif(request->>'account_id', '')::uuid;
  challenge_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Transaction-scoped advisory locking prevents two requests for one account
  -- from evaluating the same exposure and daily-trade state concurrently.
  perform pg_advisory_xact_lock(hashtextextended(requested_account_id::text, 0));

  -- Task 4 remains authoritative for challenge lifecycle transitions. Its
  -- configuration error is reported by the Task 5 gate as a deterministic
  -- RULE_CONFIGURATION_MISSING decision.
  begin
    challenge_result := public.evaluate_account_challenge(requested_account_id);
  exception when others then
    challenge_result := null;
  end;

  return public.evaluate_pre_trade_risk_unlocked(request);
end;
$$;

revoke all on function public.evaluate_pre_trade_risk(jsonb) from public;
grant execute on function public.evaluate_pre_trade_risk(jsonb) to authenticated;
