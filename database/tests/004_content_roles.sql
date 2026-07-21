\set ON_ERROR_STOP on
begin;

set role afterword_migration_owner;

do $$
begin
  if not exists (select 1 from pg_enum where enumtypid = 'public.agency_role'::regtype and enumlabel = 'operator') then
    raise exception 'agency operator enum value is missing';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.business_role'::regtype and enumlabel = 'approver') then
    raise exception 'business approver enum value is missing';
  end if;
end
$$;

insert into public.users (id, auth_subject, email, display_name) values
  ('33333333-3333-4333-8333-333333333333', 'first-party:content-agency-operator', 'agency-operator@example.test', 'Agency Operator'),
  ('44444444-4444-4444-8444-444444444444', 'first-party:content-approver', 'approver@example.test', 'Business Approver'),
  ('55555555-5555-4555-8555-555555555555', 'first-party:content-billing', 'billing@example.test', 'Business Billing');
insert into public.agencies (id, name) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Content Roles Agency');
insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code) values
  ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Content Roles Business', 'content-roles-business', 'UTC', 'GB');
insert into public.agency_memberships (agency_id, user_id, role) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', 'operator');
insert into public.business_memberships (business_id, user_id, role) values
  ('cccccccc-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'approver'),
  ('cccccccc-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'billing');
insert into app_private.auth_sessions (id, user_id, token_hash, idle_expires_at, absolute_expires_at) values
  ('33333333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', decode(repeat('33', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day'),
  ('44444444-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', decode(repeat('44', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day'),
  ('55555555-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', decode(repeat('55', 32), 'hex'), statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 day');

reset role;
set role afterword_auth;
select * from app_private.resolve_auth_session_with_role(decode(repeat('33', 32), 'hex')) \gset agency_operator_
select 1 / (case when :'agency_operator_platform_role' = 'agency_user' and :'agency_operator_product_role' = 'staff' then 1 else 0 end);
select * from app_private.resolve_auth_session_with_role(decode(repeat('44', 32), 'hex')) \gset business_approver_
select 1 / (case when :'business_approver_platform_role' = 'business_owner' and :'business_approver_product_role' = 'client_approver' then 1 else 0 end);
select * from app_private.resolve_auth_session_with_role(decode(repeat('55', 32), 'hex')) \gset business_billing_
select 1 / (case when :'business_billing_product_role' = '' then 1 else 0 end);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('33', 32), 'hex'), null);
do $$
begin
  begin
    perform app_private.start_support_session(
      'cccccccc-0000-4000-8000-000000000001', 'view', 'SUP-009 agency operator attempt', 15, gen_random_uuid()
    );
    raise exception 'agency operator unexpectedly started support';
  exception when others then
    if sqlerrm = 'agency operator unexpectedly started support' then raise; end if;
    if position('operator role cannot start' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

select app_private.set_request_context_from_session(decode(repeat('55', 32), 'hex'), null);
do $$
begin
  if app_private.can_read_tenant_data('cccccccc-0000-4000-8000-000000000001', null) then
    raise exception 'billing role unexpectedly read tenant data';
  end if;
  if app_private.can_manage_business('cccccccc-0000-4000-8000-000000000001') then
    raise exception 'billing role unexpectedly managed tenant data';
  end if;
end
$$;

rollback;
