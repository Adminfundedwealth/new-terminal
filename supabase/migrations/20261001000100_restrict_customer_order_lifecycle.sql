-- Customer order commands may be submitted and read, but trusted lifecycle
-- transitions must only be executed by the server/execution service.
revoke all on function public.transition_order_status(uuid, uuid, text, text) from authenticated;
grant execute on function public.transition_order_status(uuid, uuid, text, text) to service_role;
