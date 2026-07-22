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
  ('60000000-0000-4000-8000-000000000002', 'first-party:grant-client-admin', 'grant-client-admin@example.test', 'Grant Client Admin'),
  ('60000000-0000-4000-8000-000000000003', 'first-party:grant-agency-support', 'grant-agency-support@example.test', 'Grant Agency Support');
insert into public.agencies (id, name) values
  ('60000000-0000-4000-8000-000000000010', 'Grant Test Agency');
insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code) values
  ('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000010', 'Grant Test Business', 'grant-test-business', 'UTC', 'GB'),
  ('60000000-0000-4000-8000-000000000021', '60000000-0000-4000-8000-000000000010', 'Other Grant Business', 'other-grant-business', 'UTC', 'GB');
insert into public.locations (id, business_id, name, timezone) values
  ('60000000-0000-4000-8000-000000000030', '60000000-0000-4000-8000-000000000020', 'Authorised location', 'UTC'),
  ('60000000-0000-4000-8000-000000000031', '60000000-0000-4000-8000-000000000020', 'Sibling location', 'UTC');
insert into public.agency_memberships (agency_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000001', 'owner'),
  ('60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000003', 'support');
insert into public.business_memberships (business_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000002', 'admin'),
  ('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000001', 'owner');
insert into app_private.auth_sessions (id, user_id, token_hash, idle_expires_at, absolute_expires_at) values
  ('60000000-0000-4000-8000-000000000040', '60000000-0000-4000-8000-000000000001', decode(repeat('61', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day'),
  ('60000000-0000-4000-8000-000000000041', '60000000-0000-4000-8000-000000000002', decode(repeat('62', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day'),
  ('60000000-0000-4000-8000-000000000043', '60000000-0000-4000-8000-000000000003', decode(repeat('63', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day');
insert into public.support_sessions (
  id, agency_id, business_id, actor_user_id, scope, reason, mfa_verified_at,
  step_up_verified_at, started_at, last_activity_at, expires_at
) values (
  '60000000-0000-4000-8000-000000000042', '60000000-0000-4000-8000-000000000010',
  '60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000001',
  'configuration', 'Agency grant support denial test', statement_timestamp(), statement_timestamp(),
  statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '10 minutes'
);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select not app_private.has_agency_client_permission(
  '60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null
) as agency_membership_alone_exposes_nothing;
\assert
do $$ begin
  begin
    perform app_private.issue_agency_client_access_claim(
      '60000000-0000-4000-8000-000000000010', 'grant-client-admin@example.test',
      array['content.self_approve']::text[], '60000000-0000-4000-8000-000000000003',
      null, null, null, decode(repeat('66', 32), 'hex'),
      statement_timestamp() + interval '1 hour', '60000000-0000-4000-8000-000000000058'
    );
    raise exception 'assertion failed: support role was accepted as a named self approver';
  exception when others then
    if sqlerrm = 'assertion failed: support role was accepted as a named self approver' then raise; end if;
    if position('self approver must be an active content-capable agency user' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
select * from app_private.request_agency_client_grant(
  '60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000020',
  '60000000-0000-4000-8000-000000000030',
  array['content.create','content.submit','content.approve','content.self_approve','content.schedule','content.publish','video.spend']::text[],
  '60000000-0000-4000-8000-000000000001', null, null,
  statement_timestamp() + interval '1 day', '60000000-0000-4000-8000-000000000050'
) \gset grant_
select set_config('app.test_grant_id', :'grant_id', true);

select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
select * from app_private.accept_agency_client_grant(:'grant_id', '60000000-0000-4000-8000-000000000051') \gset accepted_
select :'accepted_status' = 'active' as client_activated_requested_scope;
\assert

select app_private.set_request_context_from_session(decode(repeat('63', 32), 'hex'), null);
select not app_private.has_agency_client_permission(
  '60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null
) as support_role_without_session_denies_all_agency_permissions;
\assert

-- selected_claim_expiry_and_support_session_fail_closed: both selected-claim
-- branches share the same expiry, enabled-user and no-support-session gate.
reset role;
set role afterword_migration_owner;
insert into app_private.agency_client_access_claims (
  token_hash, agency_id, email, permissions, expires_at, issued_by_user_id,
  consumed_by_user_id, consumed_at, selected_grant_id
) values
(
  decode(repeat('64', 32), 'hex'), '60000000-0000-4000-8000-000000000010',
  'grant-client-admin@example.test', array['content.create']::text[], statement_timestamp() + interval '1 hour',
  '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', statement_timestamp(), :'grant_id'::uuid
),
(
  decode(repeat('65', 32), 'hex'), '60000000-0000-4000-8000-000000000010',
  'grant-agency-owner@example.test', array['content.create']::text[], statement_timestamp() + interval '1 hour',
  '60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', statement_timestamp(), :'grant_id'::uuid
);
reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
select count(*) = 1 as selected_claim_is_visible_before_expiry from app_private.list_agency_client_claim_locations(decode(repeat('64', 32), 'hex'));
\assert
select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), '60000000-0000-4000-8000-000000000042');
select count(*) = 0 as selected_claim_is_hidden_during_support from app_private.list_agency_client_claim_locations(decode(repeat('65', 32), 'hex'));
\assert
reset role;
set role afterword_migration_owner;
update app_private.agency_client_access_claims set expires_at=statement_timestamp() - interval '1 minute' where token_hash=decode(repeat('64', 32), 'hex');
reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
select count(*) = 0 as selected_claim_is_hidden_after_expiry from app_private.list_agency_client_claim_locations(decode(repeat('64', 32), 'hex'));
\assert

select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select
  app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null)
  and app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.submit', null)
  and app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.approve', null)
  and app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.schedule', null)
  and app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.publish', null)
  and app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'video.spend', null)
  and app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.self_approve', '60000000-0000-4000-8000-000000000001')
  and not app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.self_approve', '60000000-0000-4000-8000-000000000002')
  and not app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000031', 'content.create', null)
  as permissions_are_independent_named_and_location_bound;
\assert

select * from app_private.request_agency_client_grant(
  '60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000020',
  '60000000-0000-4000-8000-000000000031', array['content.create']::text[], null, null, null,
  statement_timestamp() + interval '1 day', '60000000-0000-4000-8000-000000000055'
) \gset limited_
select set_config('app.test_limited_grant_id', :'limited_id', true);

select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), '60000000-0000-4000-8000-000000000042');
select not (
  app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null)
  or app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.approve', null)
  or app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.schedule', null)
  or app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.publish', null)
  or app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'video.spend', null)
) as support_session_denies_all_agency_permissions;
\assert
do $$ begin
  begin
    perform app_private.accept_agency_client_grant(
      current_setting('app.test_limited_grant_id')::uuid, '60000000-0000-4000-8000-000000000056'
    );
    raise exception 'assertion failed: support session accepted an agency grant';
  exception when others then
    if sqlerrm = 'assertion failed: support session accepted an agency grant' then raise; end if;
    if position('support sessions cannot mutate agency grants' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
do $$ begin
  begin
    perform app_private.request_agency_client_grant(
      '60000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000020',
      '60000000-0000-4000-8000-000000000030', array['content.create']::text[], null, null, null,
      statement_timestamp() + interval '1 day', '60000000-0000-4000-8000-000000000054'
    );
    raise exception 'assertion failed: support session requested an agency grant';
  exception when others then
    if sqlerrm = 'assertion failed: support session requested an agency grant' then raise; end if;
    if position('support sessions cannot mutate agency grants' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);

select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
select * from app_private.accept_agency_client_grant(
  :'limited_id', '60000000-0000-4000-8000-000000000057'
) \gset limited_accepted_
select :'limited_accepted_status' = 'active' as client_admin_can_accept_limited_grant;
\assert
select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select
  app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000031', 'content.create', null)
  and not app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000031', 'content.publish', null)
  and not app_private.has_agency_client_permission('60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000031', 'video.spend', null)
  as limited_grant_cannot_gain_ungranted_permissions;
\assert

reset role;
set role afterword_migration_owner;
update public.agency_client_grants
set expires_at = statement_timestamp() - interval '1 minute'
where id = current_setting('app.test_grant_id')::uuid;
reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('61', 32), 'hex'), null);
select not app_private.has_agency_client_permission(
  '60000000-0000-4000-8000-000000000020', '60000000-0000-4000-8000-000000000030', 'content.create', null
) as expired_active_grant_loses_permission_immediately;
\assert

select app_private.set_request_context_from_session(decode(repeat('62', 32), 'hex'), null);
do $$ begin
  begin
    perform app_private.revoke_current_client_agency_grant(
      current_setting('app.test_grant_id')::uuid, '60000000-0000-4000-8000-000000000021', '60000000-0000-4000-8000-000000000052'
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
