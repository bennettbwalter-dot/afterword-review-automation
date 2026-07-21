begin;

-- Contract probe: support-session permission denial is evaluated inside the
-- SQL command, not delegated to HTTP routing.
select pg_catalog.has_function_privilege('afterword_runtime', 'app_private.has_agency_client_permission(uuid,uuid,text,uuid)', 'execute') as runtime_can_check_grant_permission;
select pg_catalog.has_table_privilege('afterword_runtime', 'public.agency_client_grants', 'select') = false as runtime_cannot_read_grant_rows_directly;
select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.agency_client_grants'::regclass;

-- A sibling location is not in scope: all permission checks require both the
-- business and location identifiers and the active grant's exact location.
select pg_catalog.pg_get_functiondef('app_private.has_agency_client_permission(uuid,uuid,text,uuid)'::regprocedure) like '%grant.location_id = p_location_id%' as sibling_location_is_denied;
select pg_catalog.pg_get_functiondef('app_private.has_agency_client_permission(uuid,uuid,text,uuid)'::regprocedure) like '%current_support_session_id() is null%' as support_session_permission_denial;
select pg_catalog.pg_get_functiondef('app_private.consume_agency_client_grant_claim(bytea)'::regprocedure) like '%claim.consumed_at is null%' as claim_is_single_use;
select pg_catalog.pg_get_functiondef('app_private.expire_stale_agency_client_grants(integer)'::regprocedure) like '%for update skip locked%' as stale_open_grants_expire_atomically;
rollback;
