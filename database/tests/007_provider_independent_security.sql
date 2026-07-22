begin;
set role afterword_migration_owner;

insert into public.users (id, auth_subject, email, display_name) values
  ('70000000-0000-4000-8000-000000000001', 'first-party:direct-support-owner', 'direct-support-owner@example.test', 'Direct Support Owner'),
  ('70000000-0000-4000-8000-000000000002', 'first-party:agency-support-owner', 'agency-support-owner@example.test', 'Agency Support Owner');
insert into public.agencies (id, name, customer_kind) values
  ('70000000-0000-4000-8000-000000000010', 'Direct Support Container', 'direct_container'),
  ('70000000-0000-4000-8000-000000000011', 'Agency Support Customer', 'agency');
insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code) values
  ('70000000-0000-4000-8000-000000000020', '70000000-0000-4000-8000-000000000010', 'Direct Support Business', 'direct-support-business', 'UTC', 'GB'),
  ('70000000-0000-4000-8000-000000000021', '70000000-0000-4000-8000-000000000011', 'Agency Support Business', 'agency-support-business', 'UTC', 'GB');
insert into public.locations (id, business_id, name, timezone) values
  ('70000000-0000-4000-8000-000000000030', '70000000-0000-4000-8000-000000000020', 'Direct Support Location', 'UTC'),
  ('70000000-0000-4000-8000-000000000031', '70000000-0000-4000-8000-000000000021', 'Agency Support Location', 'UTC');
insert into public.agency_memberships (agency_id, user_id, role, status) values
  ('70000000-0000-4000-8000-000000000010', '70000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000002', 'owner', 'active');
insert into app_private.auth_sessions (
  id, user_id, token_hash, idle_expires_at, absolute_expires_at, mfa_verified_at, step_up_verified_at
) values
  (
    '70000000-0000-4000-8000-000000000040', '70000000-0000-4000-8000-000000000001', decode(repeat('71', 32), 'hex'),
    statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day', statement_timestamp(), statement_timestamp()
  ),
  (
    '70000000-0000-4000-8000-000000000041', '70000000-0000-4000-8000-000000000002', decode(repeat('72', 32), 'hex'),
    statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day', statement_timestamp(), statement_timestamp()
  );

reset role;
set role afterword_runtime;

select app_private.set_request_context_from_session(decode(repeat('71', 32), 'hex'), null);
-- direct_container_cannot_start_support_session
do $$ begin
  begin
    perform app_private.start_support_session(
      '70000000-0000-4000-8000-000000000020', 'view', 'Direct customer support denial', 15,
      '70000000-0000-4000-8000-000000000050'
    );
    raise exception 'assertion failed: direct container started a support session';
  exception when others then
    if sqlerrm = 'assertion failed: direct container started a support session' then raise; end if;
    if position('agency customer support identity is required' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

select app_private.set_request_context_from_session(decode(repeat('72', 32), 'hex'), null);
-- agency_customer_can_start_support_session
select app_private.start_support_session(
  '70000000-0000-4000-8000-000000000021', 'view', 'Agency customer support session', 15,
  '70000000-0000-4000-8000-000000000051'
) is not null as agency_customer_can_start_support_session;
\assert

reset role;
set role afterword_migration_owner;

-- direct_container_is_excluded_from_expected_legacy_scopes
with expected_legacy_scopes as (
  select business.agency_id, business.id as business_id, location.id as location_id
  from public.businesses as business
  join public.agencies as agency
    on agency.id = business.agency_id
   and agency.customer_kind = 'agency'
  join public.locations as location
    on location.business_id = business.id
   and location.archived_at is null
  where business.archived_at is null
    and exists (
      select 1 from public.agency_memberships as agency_member
      where agency_member.agency_id = business.agency_id
        and agency_member.status = 'active'
    )
)
select not exists (
  select 1 from expected_legacy_scopes
  where agency_id = '70000000-0000-4000-8000-000000000010'
) as direct_container_is_excluded_from_expected_legacy_scopes;
\assert

-- agency_customer_remains_in_expected_legacy_scopes
with expected_legacy_scopes as (
  select business.agency_id, business.id as business_id, location.id as location_id
  from public.businesses as business
  join public.agencies as agency
    on agency.id = business.agency_id
   and agency.customer_kind = 'agency'
  join public.locations as location
    on location.business_id = business.id
   and location.archived_at is null
  where business.archived_at is null
    and exists (
      select 1 from public.agency_memberships as agency_member
      where agency_member.agency_id = business.agency_id
        and agency_member.status = 'active'
    )
)
select exists (
  select 1 from expected_legacy_scopes
  where agency_id = '70000000-0000-4000-8000-000000000011'
    and business_id = '70000000-0000-4000-8000-000000000021'
    and location_id = '70000000-0000-4000-8000-000000000031'
) as agency_customer_remains_in_expected_legacy_scopes;
\assert

rollback;
