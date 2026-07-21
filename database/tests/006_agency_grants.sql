begin;

-- Contract probe: support-session permission denial is evaluated inside the
-- SQL command, not delegated to HTTP routing.
select pg_catalog.has_function_privilege('afterword_runtime', 'app_private.has_agency_client_permission(uuid,uuid,text,uuid)', 'execute') as runtime_can_check_grant_permission;
\assert
select pg_catalog.has_table_privilege('afterword_runtime', 'public.agency_client_grants', 'select') = false as runtime_cannot_read_grant_rows_directly;
\assert
select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.agency_client_grants'::regclass;
\assert

-- A sibling location is not in scope: all permission checks require both the
-- business and location identifiers and the active grant's exact location.
select pg_catalog.pg_get_functiondef('app_private.has_agency_client_permission(uuid,uuid,text,uuid)'::regprocedure) like '%grant.location_id = p_location_id%' as sibling_location_is_denied;
\assert
select pg_catalog.pg_get_functiondef('app_private.has_agency_client_permission(uuid,uuid,text,uuid)'::regprocedure) like '%current_support_session_id() is null%' as support_session_permission_denial;
\assert
select pg_catalog.pg_get_functiondef('app_private.consume_agency_client_grant_claim(bytea)'::regprocedure) like '%claim.consumed_at is null%' as claim_is_single_use;
\assert
select pg_catalog.pg_get_functiondef('app_private.expire_stale_agency_client_grants(integer)'::regprocedure) like '%for update skip locked%' as stale_open_grants_expire_atomically;
\assert
rollback;

-- Actor-behaviour probe: exercise the deployed commands as separate agency
-- and client sessions.  This deliberately does not rely on source text.
begin;
set role afterword_migration_owner;

insert into public.users (id, auth_subject, email, display_name) values
  ('60000000-0000-4000-8000-000000000001', 'first-party:grant-agency-owner', 'grant-agency-owner@example.test', 'Grant Agency Owner'),
  ('60000000-0000-4000-8000-000000000002', 'first-party:grant-client-owner', 'grant-client-owner@example.test', 'Grant Client Owner');
insert into public.agencies (id, name) values
  ('60000000-0000-4000-8000-000000000010', 'Grant Test Agency');
insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code) values
  ('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000010', 'Grant Test Business', 'grant-test-business', 'UTC', 'GB'),
  ('60000000-0000-4000-8000-000000000021', '60000000-0000-4000-8000-000000000010', 'Other Grant Business', 'other-grant-business', 'UTC', 'GB');
insert into public.locations (id, business_id, name, timezone) values
  ('60000000-0000-4000-8000-000000000030', '60000000-0000-4000-8000-000000000020', 'Authorised location', 'UTC'),
  ('60000000-0000-4000-8000-000000000031', '60000000-0000-4000-8000-000000000020', 'Sibling location', 'UTC');
insert into public.agency_memberships (agency_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000001', 'owner');
insert into public.business_memberships (business_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000002', 'owner');
insert into app_private.auth_sessions (id, user_id, token_hash, idle_expires_at, absolute_expires_at) values
  ('60000000-0000-4000-8000-000000000040', '60000000-0000-4000-8000-000000000001', decode(repeat('61', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day'),
  ('60000000-0000-4000-8000-000000000041', '60000000-0000-4000-8000-000000000002', decode(repeat('62', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day');

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select * from app_private.request_agency_client_grant(
  '60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000020',
  '60000000-0000-4000-8000-000000000030', array['content.create']::text[], null, null, null,
  statement_timestamp() + interval '1 day', '60000000-0000-4000-8000-000000000050'
) \gset grant_

select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
select * from app_private.accept_agency_client_grant(:'grant_id', '60000000-0000-4000-8000-000000000051') \gset accepted_
select :'accepted_status' = 'active' as client_activated_requested_scope;
\assert

select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select
  app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null)
  and not app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000031', 'content.create', null)
  as active_grant_cannot_reach_sibling_location;
\assert

select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
do $$ begin
  begin
    perform app_private.revoke_current_client_agency_grant(
      :'grant_id'::uuid, '60000000-0000-4000-8000-000000000021', '60000000-0000-4000-8000-000000000052'
    );
    raise exception 'assertion failed: client revoked a grant outside its business';
  exception when others then
    if sqlerrm = 'assertion failed: client revoked a grant outside its business' then raise; end if;
    if position('current client owner or admin revocation is required' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
select * from app_private.revoke_current_client_agency_grant(
  :'grant_id'::uuid, '60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000053'
) \gset revoked_
select :'revoked_status' = 'revoked' as client_can_revoke_only_its_own_active_grant;
\assert

select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select not app_private.has_agency_client_permission(
  '60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null
) as revoked_grant_loses_permission_immediately;
\assert
rollback;
