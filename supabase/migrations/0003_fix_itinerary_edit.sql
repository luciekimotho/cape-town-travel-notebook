-- Qualify the constraint without changing the function's restricted search path,
-- permissions, or any trip records. Safe to run again.
begin;
do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.mutate_notebook_v1(uuid,text,jsonb)'::regprocedure);
  if strpos(definition, 'set constraints itinerary_parent_guard deferred;') > 0 then
    execute replace(
      definition,
      'set constraints itinerary_parent_guard deferred;',
      'set constraints public.itinerary_parent_guard deferred;'
    );
  elsif strpos(definition, 'set constraints public.itinerary_parent_guard deferred;') = 0 then
    raise exception 'Unexpected mutate_notebook_v1 definition; review the installed function before applying this fix';
  end if;
end $$;
commit;
