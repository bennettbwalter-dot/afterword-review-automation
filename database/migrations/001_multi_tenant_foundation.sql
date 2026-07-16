-- Afterword multi-tenant foundation DESIGN DRAFT (PostgreSQL 15.9+).
--
-- This file is intentionally stricter than the browser prototype, but it is not a
-- production deployment by itself. Run it only in a dedicated Afterword database.
-- A DBA must create these NOLOGIN group roles before running the migration:
--
--   create role afterword_migration_owner nologin nobypassrls;
--   create role afterword_runtime         nologin nobypassrls;
--   create role afterword_ingress         nologin nobypassrls;
--   create role afterword_worker          nologin nobypassrls;
--   create role afterword_ops             nologin nobypassrls;
--
-- The DBA must then create the dedicated database for the migration owner, for
-- example: create database afterword owner afterword_migration_owner; For a
-- pre-existing empty database, also run `alter schema public owner to
-- pg_database_owner` as the DBA after transferring database ownership. This
-- migration revokes PUBLIC schema creation, so a mere CREATE grant is insufficient.
--
-- Run this migration with SET ROLE afterword_migration_owner. API, webhook,
-- delivery-worker and operations login roles may inherit only their matching
-- afterword_runtime, afterword_ingress, afterword_worker or afterword_ops group.
-- None may own tables, inherit afterword_migration_owner, or receive BYPASSRLS.
-- Browser clients never connect to PostgreSQL directly. The API sets
-- app.user_id, app.mfa_verified_at,
-- app.step_up_verified_at and app.support_session_id with SET LOCAL after
-- validating the authenticated request.
--
-- PostgreSQL integration tests against these exact roles remain a launch blocker.

-- Keep bootstrap, object creation and the final privilege boundary atomic. A
-- failed direct psql run must not leave partially-created SECURITY DEFINER
-- functions or intermediate PUBLIC privileges behind.
begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'afterword_migration_owner')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'afterword_runtime')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'afterword_ingress')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'afterword_worker')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'afterword_ops') then
    raise exception 'Create the Afterword database roles before applying this migration';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in (
      'afterword_migration_owner', 'afterword_runtime', 'afterword_ingress',
      'afterword_worker', 'afterword_ops'
    )
      and (rolcanlogin or rolbypassrls)
  ) then
    raise exception 'Afterword group roles must be NOLOGIN and NOBYPASSRLS';
  end if;

  if current_user <> 'afterword_migration_owner' then
    raise exception 'Run this migration with SET ROLE afterword_migration_owner';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_database database_record
    join pg_catalog.pg_roles owner_role on owner_role.oid = database_record.datdba
    where database_record.datname = current_database()
      and owner_role.rolname = 'afterword_migration_owner'
  ) then
    raise exception 'Run only in a dedicated database owned by afterword_migration_owner';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_namespace namespace_record
    join pg_catalog.pg_roles owner_role on owner_role.oid = namespace_record.nspowner
    where namespace_record.nspname = 'public'
      and owner_role.rolname in ('afterword_migration_owner', 'pg_database_owner')
  ) then
    raise exception 'The public schema must be owned by afterword_migration_owner or pg_database_owner';
  end if;
end
$$;

create schema if not exists app_private;

revoke create on schema public from public;
revoke all on schema app_private from public;
alter default privileges for role afterword_migration_owner
  in schema app_private revoke execute on functions from public;

create type public.agency_role as enum ('owner', 'admin', 'support');
create type public.business_role as enum ('owner', 'admin', 'operator', 'viewer', 'billing');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'revoked');
create type public.support_scope as enum ('view', 'configuration');
create type public.integration_health as enum ('connected', 'healthy', 'delayed', 'authentication_required', 'permission_revoked', 'rate_limited', 'provider_unavailable', 'failing', 'disabled');
create type public.channel_kind as enum ('sms', 'email');
create type public.consent_status as enum ('granted', 'withdrawn', 'expired', 'unknown');
create type public.processing_status as enum ('received', 'duplicate', 'validated', 'enrolled', 'rejected', 'failed');
create type public.job_status as enum ('scheduled', 'leased', 'completed', 'retry', 'reconciliation_required', 'dead_letter', 'cancelled');
create type public.outbox_status as enum ('pending', 'sending', 'accepted', 'unknown', 'failed', 'cancelled');
create type public.attempt_status as enum ('started', 'accepted', 'unknown', 'failed');
create type public.audit_outcome as enum ('allowed', 'blocked', 'completed', 'failed');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  email text not null,
  display_name text not null,
  mfa_required boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz
);

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz
);

create table public.agency_memberships (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  user_id uuid not null references public.users(id),
  role public.agency_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  unique (agency_id, user_id)
);
create index agency_memberships_user_agency_status_idx on public.agency_memberships(user_id, agency_id, status);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null,
  slug text not null,
  default_timezone text not null,
  country_code text not null check (length(country_code) = 2),
  lifecycle_status text not null default 'active' check (lifecycle_status in ('onboarding', 'active', 'paused', 'archived')),
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (agency_id, slug),
  unique (agency_id, id)
);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references public.users(id),
  role public.business_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  unique (business_id, user_id),
  unique (business_id, id)
);
create index business_memberships_user_business_status_idx on public.business_memberships(user_id, business_id, status);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  name text not null,
  timezone text not null,
  status text not null default 'active' check (status in ('onboarding', 'active', 'paused', 'archived')),
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (business_id, id)
);
create index locations_business_status_idx on public.locations(business_id, status);

create table public.membership_location_grants (
  business_membership_id uuid not null,
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (business_id, business_membership_id, location_id),
  foreign key (business_id, business_membership_id) references public.business_memberships(business_id, id) on delete cascade,
  foreign key (business_id, location_id) references public.locations(business_id, id)
);
create index membership_location_grants_location_idx on public.membership_location_grants(business_id, location_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  agency_id uuid references public.agencies(id),
  invited_email text not null,
  token_hash bytea not null unique,
  requested_business_role public.business_role,
  requested_agency_role public.agency_role,
  created_by uuid not null references public.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (
    (business_id is not null and agency_id is null and requested_business_role is not null and requested_agency_role is null)
    or
    (business_id is null and agency_id is not null and requested_business_role is null and requested_agency_role is not null)
  )
);
create index invitations_business_idx on public.invitations(business_id) where business_id is not null;
create index invitations_agency_idx on public.invitations(agency_id) where agency_id is not null;

create table public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  business_id uuid not null references public.businesses(id),
  actor_user_id uuid not null references public.users(id),
  scope public.support_scope not null default 'view',
  reason text not null check (length(trim(reason)) >= 12),
  mfa_verified_at timestamptz not null,
  step_up_verified_at timestamptz,
  started_at timestamptz not null default clock_timestamp(),
  last_activity_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > started_at),
  check (expires_at <= started_at + interval '30 minutes'),
  check (mfa_verified_at <= started_at + interval '5 minutes'),
  check (scope = 'view' or step_up_verified_at is not null),
  check (last_activity_at >= started_at),
  check (ended_at is null or ended_at >= started_at),
  check (revoked_at is null or revoked_at >= started_at),
  unique (business_id, id),
  unique (business_id, id, actor_user_id),
  foreign key (agency_id, business_id) references public.businesses(agency_id, id),
  foreign key (agency_id, actor_user_id) references public.agency_memberships(agency_id, user_id)
);
create index support_sessions_actor_business_expiry_idx on public.support_sessions(actor_user_id, business_id, expires_at);
create index support_sessions_agency_business_idx on public.support_sessions(agency_id, business_id);
create index support_sessions_agency_actor_idx on public.support_sessions(agency_id, actor_user_id);

create table public.tenant_pauses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid,
  channel public.channel_kind,
  automation_key text,
  reason text not null check (length(trim(reason)) >= 8),
  created_by uuid not null references public.users(id),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid references public.users(id),
  client_notified_at timestamptz,
  check (expires_at is null or expires_at > started_at),
  check (lifted_at is null or lifted_at >= started_at),
  check ((lifted_at is null) = (lifted_by is null)),
  foreign key (business_id, location_id) references public.locations(business_id, id)
);
create index tenant_pauses_active_idx on public.tenant_pauses(business_id, location_id, channel) where lifted_at is null;
create index tenant_pauses_location_fk_idx on public.tenant_pauses(business_id, location_id);

-- A null agency_id means a platform-wide emergency stop. Runtime users cannot
-- create or lift those rows; only the restricted worker control function can.
create table public.system_pauses (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id),
  channel public.channel_kind,
  provider text,
  reason text not null check (length(trim(reason)) >= 8),
  created_by uuid references public.users(id),
  actor_type text not null check (actor_type in ('user', 'system', 'worker')),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid references public.users(id),
  check ((actor_type = 'user') = (created_by is not null)),
  check (expires_at is null or expires_at > started_at),
  check (lifted_at is null or lifted_at >= started_at)
);
create index system_pauses_active_idx on public.system_pauses(agency_id, channel, provider) where lifted_at is null;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid references public.users(id),
  actor_type text not null check (actor_type in ('user', 'system', 'worker')),
  effective_agency_id uuid references public.agencies(id),
  effective_business_id uuid references public.businesses(id),
  effective_location_id uuid,
  support_session_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  outcome public.audit_outcome not null,
  reason text,
  correlation_id uuid not null,
  request_id text,
  ip_hash bytea,
  user_agent_family text,
  changed_fields text[] not null default '{}',
  redacted_metadata jsonb not null default '{}'::jsonb,
  check ((actor_type = 'user') = (actor_user_id is not null)),
  check (effective_business_id is null or effective_agency_id is not null),
  check (effective_location_id is null or effective_business_id is not null),
  check (
    support_session_id is null
    or (actor_type = 'user' and effective_business_id is not null and actor_user_id is not null)
  ),
  foreign key (effective_agency_id, effective_business_id) references public.businesses(agency_id, id),
  foreign key (effective_business_id, effective_location_id) references public.locations(business_id, id),
  foreign key (effective_business_id, support_session_id, actor_user_id)
    references public.support_sessions(business_id, id, actor_user_id)
);
create index audit_events_business_time_idx on public.audit_events(effective_business_id, occurred_at desc);
create index audit_events_actor_time_idx on public.audit_events(actor_user_id, occurred_at desc);
create index audit_events_agency_business_idx on public.audit_events(effective_agency_id, effective_business_id);
create index audit_events_location_fk_idx on public.audit_events(effective_business_id, effective_location_id);
create index audit_events_support_fk_idx on public.audit_events(effective_business_id, support_session_id, actor_user_id);
create unique index audit_events_operation_once_idx
on public.audit_events(correlation_id, action, target_type, coalesce(target_id, ''), outcome);

-- Phase 2 tables are included now so every workflow inherits the tenant boundary.
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid,
  provider text not null,
  health public.integration_health not null default 'connected',
  secret_reference text not null, -- reference to a secret manager; never the secret itself
  token_expires_at timestamptz,
  last_event_at timestamptz,
  last_sync_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (business_id, id),
  foreign key (business_id, location_id) references public.locations(business_id, id)
);
create index integration_connections_location_fk_idx on public.integration_connections(business_id, location_id);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  customer_reference text not null,
  channel public.channel_kind not null,
  status public.consent_status not null,
  wording text not null,
  wording_version text not null,
  purpose text not null,
  captured_at timestamptz not null,
  source text not null,
  transaction_reference text,
  evidence_reference text,
  ip_hash bytea,
  withdrawn_at timestamptz,
  withdrawal_source text,
  created_at timestamptz not null default clock_timestamp(),
  check (withdrawn_at is null or withdrawn_at >= captured_at),
  foreign key (business_id, location_id) references public.locations(business_id, id)
);
create index consent_records_evidence_idx on public.consent_records(business_id, customer_reference, channel, captured_at desc);
create index consent_records_location_fk_idx on public.consent_records(business_id, location_id);

create table public.channel_suppressions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  channel public.channel_kind not null,
  destination_hash bytea not null,
  reason text not null,
  source text not null,
  suppressed_at timestamptz not null default clock_timestamp(),
  lifted_at timestamptz,
  check (lifted_at is null or lifted_at >= suppressed_at)
);
create unique index channel_suppressions_active_unique_idx
on public.channel_suppressions(business_id, channel, destination_hash)
where lifted_at is null;

create table public.ingress_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  integration_id uuid not null,
  event_type text not null,
  provider_event_id text,
  external_job_id text not null,
  payload_hash bytea not null,
  encrypted_payload bytea not null,
  first_received_at timestamptz not null default clock_timestamp(),
  last_received_at timestamptz not null default clock_timestamp(),
  processing_status public.processing_status not null default 'received',
  delivery_attempts integer not null default 1 check (delivery_attempts > 0),
  unique (business_id, id),
  unique (business_id, location_id, id),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, integration_id) references public.integration_connections(business_id, id),
  unique (business_id, integration_id, external_job_id, event_type)
);
create unique index ingress_events_provider_event_unique_idx
on public.ingress_events(business_id, integration_id, provider_event_id)
where provider_event_id is not null;
create index ingress_events_integration_fk_idx on public.ingress_events(business_id, integration_id);

create table public.ingress_nonces (
  business_id uuid not null references public.businesses(id),
  integration_id uuid not null,
  nonce_hash bytea not null,
  accepted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key (business_id, integration_id, nonce_hash),
  foreign key (business_id, integration_id) references public.integration_connections(business_id, id),
  check (expires_at > accepted_at)
);

create table public.message_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  ingress_event_id uuid,
  channel public.channel_kind not null,
  provider text not null,
  automation_key text not null,
  deduplication_key text not null,
  status public.job_status not null default 'scheduled',
  priority smallint not null default 100,
  run_at timestamptz not null,
  leased_until timestamptz,
  lease_owner text,
  lease_token uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 6 check (max_attempts > 0),
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (business_id, id),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, location_id, ingress_event_id)
    references public.ingress_events(business_id, location_id, id),
  check (
    (status = 'leased' and leased_until is not null and lease_owner is not null and lease_token is not null)
    or
    (status <> 'leased' and leased_until is null and lease_owner is null and lease_token is null)
  ),
  unique (business_id, deduplication_key)
);
create index message_jobs_claim_idx on public.message_jobs(priority, run_at, id) where status in ('scheduled', 'retry');
create index message_jobs_expired_lease_idx on public.message_jobs(leased_until, id) where status = 'leased';
create index message_jobs_ingress_fk_idx on public.message_jobs(business_id, location_id, ingress_event_id);

-- One outbox row represents one logical provider side effect. Every retry uses
-- the same provider_idempotency_key. An 'unknown' result is reconciled rather
-- than blindly resent.
create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  message_job_id uuid not null,
  provider text not null,
  provider_idempotency_key text not null,
  status public.outbox_status not null default 'pending',
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_id, message_job_id),
  unique (business_id, id),
  unique (provider, provider_idempotency_key),
  foreign key (business_id, message_job_id) references public.message_jobs(business_id, id)
);

create table public.message_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  outbox_id uuid not null,
  message_job_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status public.attempt_status not null default 'started',
  worker_id text not null,
  lease_token uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  provider_message_id text,
  response_code text,
  error_code text,
  redacted_metadata jsonb not null default '{}'::jsonb,
  unique (business_id, outbox_id, attempt_number),
  unique (business_id, message_job_id, lease_token),
  foreign key (business_id, outbox_id) references public.message_outbox(business_id, id),
  foreign key (business_id, message_job_id) references public.message_jobs(business_id, id)
);
create index message_attempts_job_idx on public.message_attempts(business_id, message_job_id, attempt_number desc);

create or replace function app_private.current_user_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_private.current_support_session_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.support_session_id', true), '')::uuid
$$;

create or replace function app_private.current_mfa_verified_at()
returns timestamptz
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.mfa_verified_at', true), '')::timestamptz
$$;

create or replace function app_private.current_step_up_verified_at()
returns timestamptz
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.step_up_verified_at', true), '')::timestamptz
$$;

create or replace function app_private.current_user_enabled()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = app_private.current_user_id()
      and app_user.disabled_at is null
  )
$$;

create or replace function app_private.current_agency_role(target_agency uuid)
returns public.agency_role
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select membership.role
  from public.agency_memberships membership
  join public.users app_user on app_user.id = membership.user_id and app_user.disabled_at is null
  join public.agencies agency on agency.id = membership.agency_id and agency.archived_at is null
  where membership.user_id = app_private.current_user_id()
    and membership.agency_id = target_agency
    and membership.status = 'active'
  limit 1
$$;

create or replace function app_private.has_agency_role(target_agency uuid, accepted_roles public.agency_role[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(app_private.current_agency_role(target_agency) = any(accepted_roles), false)
$$;

create or replace function app_private.current_business_role(target_business uuid)
returns public.business_role
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select membership.role
  from public.business_memberships membership
  join public.users app_user on app_user.id = membership.user_id and app_user.disabled_at is null
  join public.businesses business on business.id = membership.business_id and business.archived_at is null
  where membership.user_id = app_private.current_user_id()
    and membership.business_id = target_business
    and membership.status = 'active'
  limit 1
$$;

create or replace function app_private.has_business_role(target_business uuid, accepted_roles public.business_role[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(app_private.current_business_role(target_business) = any(accepted_roles), false)
$$;

create or replace function app_private.has_location_access(target_business uuid, target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    app_private.has_business_role(target_business, array['owner', 'admin']::public.business_role[])
    or exists (
      select 1
      from public.business_memberships membership
      join public.membership_location_grants location_grant
        on location_grant.business_id = membership.business_id
       and location_grant.business_membership_id = membership.id
      where membership.user_id = app_private.current_user_id()
        and membership.business_id = target_business
        and membership.status = 'active'
        and membership.role in ('operator', 'viewer')
        and location_grant.location_id = target_location
    )
$$;

create or replace function app_private.has_active_support_session(
  target_business uuid,
  required_scope public.support_scope default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.support_sessions support_session
    join public.businesses business on business.id = support_session.business_id and business.archived_at is null
    join public.agency_memberships membership
      on membership.agency_id = support_session.agency_id
     and membership.user_id = support_session.actor_user_id
     and membership.status = 'active'
    join public.users app_user on app_user.id = support_session.actor_user_id and app_user.disabled_at is null
    where support_session.id = app_private.current_support_session_id()
      and support_session.actor_user_id = app_private.current_user_id()
      and support_session.business_id = target_business
      and support_session.ended_at is null
      and support_session.revoked_at is null
      and support_session.started_at <= statement_timestamp()
      and support_session.expires_at > statement_timestamp()
      and support_session.last_activity_at > statement_timestamp() - interval '15 minutes'
      and support_session.last_activity_at <= statement_timestamp() + interval '1 minute'
      and support_session.mfa_verified_at > statement_timestamp() - interval '12 hours'
      and support_session.mfa_verified_at <= statement_timestamp() + interval '5 minutes'
      and (
        required_scope = 'view'
        or (
          support_session.scope = 'configuration'
          and support_session.step_up_verified_at > statement_timestamp() - interval '15 minutes'
          and support_session.step_up_verified_at <= statement_timestamp() + interval '5 minutes'
        )
      )
      and (
        membership.role in ('owner', 'admin')
        or (membership.role = 'support' and required_scope = 'view' and support_session.scope = 'view')
      )
  )
$$;

create or replace function app_private.can_read_business_summary(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      app_private.current_business_role(target_business) is not null
      or exists (
        select 1
        from public.businesses business
        where business.id = target_business
          and app_private.current_agency_role(business.agency_id) is not null
      )
    )
$$;

create or replace function app_private.can_read_tenant_data(target_business uuid, target_location uuid default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      app_private.has_business_role(target_business, array['owner', 'admin']::public.business_role[])
      or (target_location is not null and app_private.has_location_access(target_business, target_location))
      or app_private.has_active_support_session(target_business, 'view')
    )
$$;

create or replace function app_private.can_manage_business(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      app_private.has_business_role(target_business, array['owner', 'admin']::public.business_role[])
      or app_private.has_active_support_session(target_business, 'configuration')
    )
$$;

create or replace function app_private.can_pause_business(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      app_private.has_business_role(target_business, array['owner', 'admin']::public.business_role[])
      or exists (
        select 1
        from public.businesses business
        where business.id = target_business
          and app_private.has_agency_role(business.agency_id, array['owner', 'admin']::public.agency_role[])
      )
    )
$$;

create or replace function app_private.can_read_agency(target_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      app_private.current_agency_role(target_agency) is not null
      or exists (
        select 1
        from public.business_memberships membership
        join public.businesses business on business.id = membership.business_id
        where membership.user_id = app_private.current_user_id()
          and membership.status = 'active'
          and business.agency_id = target_agency
      )
    )
$$;

create or replace function app_private.can_read_user_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      target_user = app_private.current_user_id()
      or exists (
        select 1
        from public.business_memberships actor_membership
        join public.business_memberships target_membership
          on target_membership.business_id = actor_membership.business_id
         and target_membership.user_id = target_user
        where actor_membership.user_id = app_private.current_user_id()
          and actor_membership.status = 'active'
          and actor_membership.role in ('owner', 'admin')
      )
      or exists (
        select 1
        from public.agency_memberships actor_membership
        join public.agency_memberships target_membership
          on target_membership.agency_id = actor_membership.agency_id
         and target_membership.user_id = target_user
        where actor_membership.user_id = app_private.current_user_id()
          and actor_membership.status = 'active'
          and actor_membership.role in ('owner', 'admin')
      )
    )
$$;

create or replace function app_private.can_read_audit(target_agency uuid, target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select app_private.current_user_enabled()
    and (
      (
        target_business is not null
        and (
          app_private.has_business_role(target_business, array['owner', 'admin']::public.business_role[])
          or app_private.has_active_support_session(target_business, 'view')
        )
      )
      or (
        target_business is null
        and target_agency is not null
        and app_private.has_agency_role(target_agency, array['owner', 'admin']::public.agency_role[])
      )
    )
$$;

create or replace function app_private.reject_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'audit_events are append-only';
end
$$;

create or replace function app_private.reject_business_id_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'business_id is immutable';
  end if;
  return new;
end
$$;

create or replace function app_private.reject_support_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.agency_id is distinct from old.agency_id
     or new.business_id is distinct from old.business_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.scope is distinct from old.scope
     or new.reason is distinct from old.reason
     or new.mfa_verified_at is distinct from old.mfa_verified_at
     or new.step_up_verified_at is distinct from old.step_up_verified_at
     or new.started_at is distinct from old.started_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'support-session identity, evidence and scope are immutable';
  end if;

  if new.last_activity_at < old.last_activity_at
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'support-session lifecycle cannot move backwards';
  end if;
  return new;
end
$$;

create or replace function app_private.enforce_integration_location()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  connection_location uuid;
begin
  select connection.location_id
  into connection_location
  from public.integration_connections connection
  where connection.business_id = new.business_id
    and connection.id = new.integration_id;

  if not found then
    raise exception 'integration does not belong to the event tenant';
  end if;

  if connection_location is not null and connection_location <> new.location_id then
    raise exception 'location-scoped integration cannot ingest another location';
  end if;

  return new;
end
$$;

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function app_private.reject_audit_mutation();

create trigger support_sessions_identity_immutable
before update on public.support_sessions
for each row execute function app_private.reject_support_identity_change();

create trigger ingress_events_integration_location
before insert or update of business_id, location_id, integration_id on public.ingress_events
for each row execute function app_private.enforce_integration_location();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_memberships', 'locations', 'membership_location_grants', 'tenant_pauses',
    'integration_connections', 'consent_records', 'channel_suppressions', 'ingress_events',
    'ingress_nonces', 'message_jobs', 'message_outbox', 'message_attempts'
  ] loop
    execute format(
      'create trigger %I_business_id_immutable before update on public.%I for each row execute function app_private.reject_business_id_change()',
      table_name,
      table_name
    );
  end loop;
end
$$;

-- Default deny is deliberate. The migration-owner policy prevents recursive
-- authorization lookups under FORCE RLS; runtime policies are separately scoped.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users', 'agencies', 'agency_memberships', 'businesses', 'business_memberships',
    'locations', 'membership_location_grants', 'invitations', 'support_sessions',
    'tenant_pauses', 'system_pauses', 'audit_events', 'integration_connections',
    'consent_records', 'channel_suppressions', 'ingress_events', 'ingress_nonces',
    'message_jobs', 'message_outbox', 'message_attempts'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy migration_owner_all on public.%I for all to afterword_migration_owner using (true) with check (true)',
      table_name
    );
  end loop;
end
$$;

create policy users_read on public.users
for select to afterword_runtime
using (app_private.can_read_user_profile(id));

create policy agencies_read on public.agencies
for select to afterword_runtime
using (app_private.can_read_agency(id));

create policy agency_memberships_read on public.agency_memberships
for select to afterword_runtime
using (
  app_private.current_user_enabled()
  and (
    user_id = app_private.current_user_id()
    or app_private.has_agency_role(agency_id, array['owner', 'admin']::public.agency_role[])
  )
);

create policy businesses_read on public.businesses
for select to afterword_runtime
using (app_private.can_read_business_summary(id));

create policy locations_read on public.locations
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, id));

create policy business_memberships_read on public.business_memberships
for select to afterword_runtime
using (
  app_private.current_user_enabled()
  and (
    user_id = app_private.current_user_id()
    or app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
    or app_private.has_active_support_session(business_id, 'view')
  )
);

create policy membership_location_grants_read on public.membership_location_grants
for select to afterword_runtime
using (
  app_private.current_user_enabled()
  and (
    exists (
      select 1
      from public.business_memberships membership
      where membership.business_id = membership_location_grants.business_id
        and membership.id = membership_location_grants.business_membership_id
        and membership.user_id = app_private.current_user_id()
        and membership.status = 'active'
    )
    or app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
    or app_private.has_active_support_session(business_id, 'view')
  )
);

create policy invitations_read on public.invitations
for select to afterword_runtime
using (
  (business_id is not null and app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[]))
  or (agency_id is not null and app_private.has_agency_role(agency_id, array['owner', 'admin']::public.agency_role[]))
);

create policy support_sessions_read on public.support_sessions
for select to afterword_runtime
using (
  app_private.current_user_enabled()
  and (
    actor_user_id = app_private.current_user_id()
    or app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
    or app_private.has_agency_role(agency_id, array['owner', 'admin']::public.agency_role[])
  )
);

create policy tenant_pauses_read on public.tenant_pauses
for select to afterword_runtime
using (
  app_private.can_read_tenant_data(business_id, location_id)
  or app_private.can_pause_business(business_id)
);

create policy system_pauses_read on public.system_pauses
for select to afterword_runtime
using (
  app_private.current_user_enabled()
  and (
    agency_id is null
    or app_private.can_read_agency(agency_id)
  )
);

create policy audit_events_read on public.audit_events
for select to afterword_runtime
using (app_private.can_read_audit(effective_agency_id, effective_business_id));

create policy integration_connections_read on public.integration_connections
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

create policy consent_records_read on public.consent_records
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

create policy channel_suppressions_read on public.channel_suppressions
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create policy ingress_events_read on public.ingress_events
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

create policy message_jobs_read on public.message_jobs
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

create policy message_outbox_read on public.message_outbox
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create policy message_attempts_read on public.message_attempts
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create view public.integration_connection_status
with (security_invoker = true)
as
select
  id,
  business_id,
  location_id,
  provider,
  health,
  token_expires_at,
  last_event_at,
  last_sync_at,
  consecutive_failures,
  disabled_at,
  created_at
from public.integration_connections;

create view public.ingress_event_status
with (security_invoker = true)
as
select
  id,
  business_id,
  location_id,
  integration_id,
  event_type,
  provider_event_id,
  external_job_id,
  first_received_at,
  last_received_at,
  processing_status,
  delivery_attempts
from public.ingress_events;

-- RLS protects rows, not columns. Runtime users receive these security-invoker
-- views plus only the underlying safe columns; token digests, support reasons,
-- consent evidence, IP hashes and encrypted webhook bodies stay private.
create view public.invitation_status
with (security_invoker = true)
as
select
  id,
  business_id,
  agency_id,
  invited_email,
  requested_business_role,
  requested_agency_role,
  created_by,
  expires_at,
  accepted_at,
  revoked_at
from public.invitations;

create view public.support_session_status
with (security_invoker = true)
as
select
  id,
  agency_id,
  business_id,
  actor_user_id,
  scope,
  started_at,
  last_activity_at,
  expires_at,
  ended_at,
  revoked_at
from public.support_sessions;

create view public.audit_event_status
with (security_invoker = true)
as
select
  id,
  occurred_at,
  actor_user_id,
  actor_type,
  effective_agency_id,
  effective_business_id,
  effective_location_id,
  support_session_id,
  action,
  target_type,
  target_id,
  outcome,
  correlation_id,
  request_id,
  changed_fields
from public.audit_events;

create view public.consent_record_status
with (security_invoker = true)
as
select
  id,
  business_id,
  location_id,
  channel,
  status,
  wording_version,
  purpose,
  captured_at,
  source,
  withdrawn_at,
  withdrawal_source,
  created_at
from public.consent_records;

create view public.channel_suppression_status
with (security_invoker = true)
as
select
  id,
  business_id,
  channel,
  reason,
  source,
  suppressed_at,
  lifted_at
from public.channel_suppressions;

create view public.message_attempt_status
with (security_invoker = true)
as
select
  id,
  business_id,
  outbox_id,
  message_job_id,
  attempt_number,
  status,
  started_at,
  finished_at,
  provider_message_id,
  response_code,
  error_code
from public.message_attempts;

create view public.system_pause_status
with (security_invoker = true)
as
select
  id,
  agency_id,
  channel,
  provider,
  started_at,
  expires_at,
  lifted_at
from public.system_pauses;

create or replace function app_private.write_audit_event(
  p_actor_type text,
  p_agency_id uuid,
  p_business_id uuid,
  p_location_id uuid,
  p_support_session_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_outcome public.audit_outcome,
  p_reason text,
  p_correlation_id uuid,
  p_changed_fields text[],
  p_redacted_metadata jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_event_id uuid;
  v_agency_id uuid := p_agency_id;
  v_business_agency_id uuid;
begin
  if p_correlation_id is null then
    raise exception 'correlation_id is required';
  end if;

  if length(trim(p_action)) = 0 or length(trim(p_target_type)) = 0 then
    raise exception 'audit action and target_type are required';
  end if;

  if p_business_id is not null then
    select business.agency_id
    into strict v_business_agency_id
    from public.businesses business
    where business.id = p_business_id;

    if v_agency_id is null then
      v_agency_id := v_business_agency_id;
    elsif v_agency_id <> v_business_agency_id then
      raise exception 'audit agency and business do not match';
    end if;
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_type,
    effective_agency_id,
    effective_business_id,
    effective_location_id,
    support_session_id,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    correlation_id,
    changed_fields,
    redacted_metadata
  ) values (
    case when p_actor_type = 'user' then app_private.current_user_id() else null end,
    p_actor_type,
    v_agency_id,
    p_business_id,
    p_location_id,
    p_support_session_id,
    trim(p_action),
    trim(p_target_type),
    p_target_id,
    p_outcome,
    p_reason,
    p_correlation_id,
    coalesce(p_changed_fields, '{}'::text[]),
    coalesce(p_redacted_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end
$$;

-- Expected authorization denials cannot be raised and durably audited in the
-- same PostgreSQL transaction because RAISE rolls the audit insert back. The API
-- calls this function in a separate transaction after rolling back a denied
-- command, then maps the denial to HTTP 403.
create or replace function app_private.record_blocked_admin_action(
  p_agency_id uuid,
  p_business_id uuid,
  p_location_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if not app_private.current_user_enabled() then
    raise exception 'enabled authenticated user context is required';
  end if;

  if p_business_id is not null and not app_private.can_read_business_summary(p_business_id) then
    raise exception 'blocked action cannot be attributed to an inaccessible business';
  end if;

  if p_business_id is null
     and p_agency_id is not null
     and not app_private.can_read_agency(p_agency_id) then
    raise exception 'blocked action cannot be attributed to an inaccessible agency';
  end if;

  return app_private.write_audit_event(
    'user',
    p_agency_id,
    p_business_id,
    p_location_id,
    app_private.current_support_session_id(),
    p_action,
    p_target_type,
    p_target_id,
    'blocked',
    p_reason,
    p_correlation_id,
    '{}'::text[],
    '{}'::jsonb
  );
end
$$;

create or replace function app_private.create_business(
  p_agency_id uuid,
  p_name text,
  p_slug text,
  p_default_timezone text,
  p_country_code text,
  p_initial_owner_user_id uuid,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_business_id uuid;
begin
  if not app_private.has_agency_role(p_agency_id, array['owner', 'admin']::public.agency_role[]) then
    raise exception 'agency owner or admin role is required';
  end if;

  if not exists (
    select 1 from public.users app_user
    where app_user.id = p_initial_owner_user_id and app_user.disabled_at is null
  ) then
    raise exception 'initial owner must be an enabled user';
  end if;

  insert into public.businesses (
    agency_id,
    name,
    slug,
    default_timezone,
    country_code,
    lifecycle_status
  ) values (
    p_agency_id,
    trim(p_name),
    lower(trim(p_slug)),
    p_default_timezone,
    upper(p_country_code),
    'onboarding'
  )
  returning id into v_business_id;

  insert into public.business_memberships (business_id, user_id, role, status)
  values (v_business_id, p_initial_owner_user_id, 'owner', 'active');

  perform app_private.write_audit_event(
    'user', p_agency_id, v_business_id, null, null,
    'business.create', 'business', v_business_id::text, 'completed', null,
    p_correlation_id,
    array['agency_id', 'name', 'slug', 'default_timezone', 'country_code', 'lifecycle_status'],
    jsonb_build_object('initial_owner_user_id', p_initial_owner_user_id)
  );

  return v_business_id;
end
$$;

create or replace function app_private.create_location(
  p_business_id uuid,
  p_name text,
  p_timezone text,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_location_id uuid;
begin
  if not app_private.can_manage_business(p_business_id) then
    raise exception 'business management permission is required';
  end if;

  insert into public.locations (business_id, name, timezone, status)
  values (p_business_id, trim(p_name), p_timezone, 'onboarding')
  returning id into v_location_id;

  perform app_private.write_audit_event(
    'user', null, p_business_id, v_location_id, app_private.current_support_session_id(),
    'location.create', 'location', v_location_id::text, 'completed', null,
    p_correlation_id,
    array['name', 'timezone', 'status'],
    '{}'::jsonb
  );

  return v_location_id;
end
$$;

create or replace function app_private.set_business_membership(
  p_business_id uuid,
  p_target_user_id uuid,
  p_role public.business_role,
  p_status public.membership_status,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_role public.business_role;
  v_existing_role public.business_role;
  v_existing_status public.membership_status;
  v_membership_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  v_actor_role := app_private.current_business_role(p_business_id);

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'business owner or admin role is required';
  end if;

  if p_status = 'invited' then
    raise exception 'use an invitation for invited members';
  end if;

  if p_status = 'active' and not exists (
    select 1 from public.users app_user
    where app_user.id = p_target_user_id and app_user.disabled_at is null
  ) then
    raise exception 'active membership requires an enabled user';
  end if;

  select membership.role, membership.status
  into v_existing_role, v_existing_status
  from public.business_memberships membership
  where membership.business_id = p_business_id
    and membership.user_id = p_target_user_id
  for update;

  if v_actor_role = 'admin' and (
    p_role in ('owner', 'admin')
    or v_existing_role in ('owner', 'admin')
  ) then
    raise exception 'business admins cannot manage owner or admin memberships';
  end if;

  if v_existing_role = 'owner'
     and v_existing_status = 'active'
     and (p_role <> 'owner' or p_status <> 'active')
     and not exists (
       select 1
       from public.business_memberships other_owner
       where other_owner.business_id = p_business_id
         and other_owner.user_id <> p_target_user_id
         and other_owner.role = 'owner'
         and other_owner.status = 'active'
     ) then
    raise exception 'the last active business owner cannot be removed or demoted';
  end if;

  insert into public.business_memberships (
    business_id,
    user_id,
    role,
    status,
    revoked_at
  ) values (
    p_business_id,
    p_target_user_id,
    p_role,
    p_status,
    case when p_status = 'revoked' then statement_timestamp() else null end
  )
  on conflict (business_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      revoked_at = excluded.revoked_at
  returning id into v_membership_id;

  perform app_private.write_audit_event(
    'user', null, p_business_id, null, null,
    'business.membership.set', 'business_membership', v_membership_id::text, 'completed', null,
    p_correlation_id,
    array['role', 'status'],
    jsonb_build_object('target_user_id', p_target_user_id)
  );

  return v_membership_id;
end
$$;

create or replace function app_private.set_location_grant(
  p_business_id uuid,
  p_business_membership_id uuid,
  p_location_id uuid,
  p_enabled boolean,
  p_correlation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if not app_private.has_business_role(p_business_id, array['owner', 'admin']::public.business_role[]) then
    raise exception 'business owner or admin role is required';
  end if;

  if p_enabled is null then
    raise exception 'location grant state is required';
  end if;

  if p_enabled then
    insert into public.membership_location_grants (
      business_membership_id,
      business_id,
      location_id
    ) values (
      p_business_membership_id,
      p_business_id,
      p_location_id
    )
    on conflict (business_id, business_membership_id, location_id) do nothing;
  else
    delete from public.membership_location_grants location_grant
    where location_grant.business_id = p_business_id
      and location_grant.business_membership_id = p_business_membership_id
      and location_grant.location_id = p_location_id;
  end if;

  perform app_private.write_audit_event(
    'user', null, p_business_id, p_location_id, null,
    case when p_enabled then 'location.grant.add' else 'location.grant.remove' end,
    'business_membership', p_business_membership_id::text, 'completed', null,
    p_correlation_id,
    array['location_access'],
    '{}'::jsonb
  );

  return p_enabled;
end
$$;

create or replace function app_private.start_support_session(
  p_business_id uuid,
  p_scope public.support_scope,
  p_reason text,
  p_duration_minutes integer,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_user_id uuid := app_private.current_user_id();
  v_agency_id uuid;
  v_agency_role public.agency_role;
  v_mfa_verified_at timestamptz := app_private.current_mfa_verified_at();
  v_step_up_verified_at timestamptz := app_private.current_step_up_verified_at();
  v_session_id uuid;
begin
  if not app_private.current_user_enabled() then
    raise exception 'enabled user context is required';
  end if;

  select business.agency_id
  into strict v_agency_id
  from public.businesses business
  where business.id = p_business_id and business.archived_at is null;

  perform pg_advisory_xact_lock(hashtextextended(v_actor_user_id::text, 1));

  v_agency_role := app_private.current_agency_role(v_agency_id);
  if v_agency_role is null then
    raise exception 'active agency membership is required';
  end if;

  if p_scope = 'configuration' and v_agency_role not in ('owner', 'admin') then
    raise exception 'agency support role is limited to view sessions';
  end if;

  if p_duration_minutes is null or p_duration_minutes not in (15, 30) then
    raise exception 'support session duration must be 15 or 30 minutes';
  end if;

  if length(trim(p_reason)) < 12 then
    raise exception 'a support reason or ticket reference is required';
  end if;

  if v_mfa_verified_at is null
     or v_mfa_verified_at < statement_timestamp() - interval '12 hours'
     or v_mfa_verified_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'fresh agency MFA evidence is required';
  end if;

  if p_scope = 'configuration' and (
    v_step_up_verified_at is null
    or v_step_up_verified_at < statement_timestamp() - interval '10 minutes'
    or v_step_up_verified_at > statement_timestamp() + interval '5 minutes'
  ) then
    raise exception 'fresh step-up evidence is required for configuration support';
  end if;

  if exists (
    select 1
    from public.support_sessions active_session
    where active_session.actor_user_id = v_actor_user_id
      and active_session.ended_at is null
      and active_session.revoked_at is null
      and active_session.expires_at > statement_timestamp()
  ) then
    raise exception 'exit the active support session before starting another';
  end if;

  insert into public.support_sessions (
    agency_id,
    business_id,
    actor_user_id,
    scope,
    reason,
    mfa_verified_at,
    step_up_verified_at,
    started_at,
    last_activity_at,
    expires_at
  ) values (
    v_agency_id,
    p_business_id,
    v_actor_user_id,
    p_scope,
    trim(p_reason),
    v_mfa_verified_at,
    case when p_scope = 'configuration' then v_step_up_verified_at else null end,
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp() + make_interval(mins => p_duration_minutes)
  )
  returning id into v_session_id;

  perform app_private.write_audit_event(
    'user', v_agency_id, p_business_id, null, v_session_id,
    'support.session.start', 'support_session', v_session_id::text, 'completed', trim(p_reason),
    p_correlation_id,
    array['scope', 'expires_at'],
    jsonb_build_object('duration_minutes', p_duration_minutes)
  );

  return v_session_id;
end
$$;

create or replace function app_private.touch_support_session(p_support_session_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if app_private.current_support_session_id() is distinct from p_support_session_id then
    raise exception 'request support-session context does not match';
  end if;

  update public.support_sessions support_session
  set last_activity_at = statement_timestamp()
  where support_session.id = p_support_session_id
    and support_session.actor_user_id = app_private.current_user_id()
    and support_session.ended_at is null
    and support_session.revoked_at is null
    and support_session.expires_at > statement_timestamp()
    and support_session.last_activity_at > statement_timestamp() - interval '15 minutes';

  if not found then
    raise exception 'support session is inactive or expired';
  end if;

  return true;
end
$$;

create or replace function app_private.end_support_session(
  p_support_session_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_session public.support_sessions%rowtype;
begin
  select support_session.*
  into strict v_session
  from public.support_sessions support_session
  where support_session.id = p_support_session_id
    and support_session.actor_user_id = app_private.current_user_id()
  for update;

  if v_session.ended_at is not null or v_session.revoked_at is not null then
    return false;
  end if;

  update public.support_sessions
  set ended_at = statement_timestamp()
  where id = p_support_session_id;

  perform app_private.write_audit_event(
    'user', v_session.agency_id, v_session.business_id, null, v_session.id,
    'support.session.end', 'support_session', v_session.id::text, 'completed', p_reason,
    p_correlation_id,
    array['ended_at'],
    '{}'::jsonb
  );

  return true;
end
$$;

create or replace function app_private.create_tenant_pause(
  p_business_id uuid,
  p_location_id uuid,
  p_channel public.channel_kind,
  p_automation_key text,
  p_reason text,
  p_expires_at timestamptz,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_pause_id uuid;
begin
  if not app_private.can_pause_business(p_business_id) then
    raise exception 'automation pause permission is required';
  end if;

  insert into public.tenant_pauses (
    business_id,
    location_id,
    channel,
    automation_key,
    reason,
    created_by,
    expires_at
  ) values (
    p_business_id,
    p_location_id,
    p_channel,
    p_automation_key,
    trim(p_reason),
    app_private.current_user_id(),
    p_expires_at
  )
  returning id into v_pause_id;

  perform app_private.write_audit_event(
    'user', null, p_business_id, p_location_id, app_private.current_support_session_id(),
    'automation.pause', 'tenant_pause', v_pause_id::text, 'completed', trim(p_reason),
    p_correlation_id,
    array['channel', 'automation_key', 'expires_at'],
    '{}'::jsonb
  );

  return v_pause_id;
end
$$;

create or replace function app_private.lift_tenant_pause(
  p_pause_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_pause public.tenant_pauses%rowtype;
begin
  select tenant_pause.*
  into strict v_pause
  from public.tenant_pauses tenant_pause
  where tenant_pause.id = p_pause_id
  for update;

  if not app_private.can_pause_business(v_pause.business_id) then
    raise exception 'automation pause permission is required';
  end if;

  if v_pause.lifted_at is not null then
    return false;
  end if;

  update public.tenant_pauses
  set lifted_at = statement_timestamp(),
      lifted_by = app_private.current_user_id()
  where id = p_pause_id;

  perform app_private.write_audit_event(
    'user', null, v_pause.business_id, v_pause.location_id, app_private.current_support_session_id(),
    'automation.pause.lift', 'tenant_pause', p_pause_id::text, 'completed', p_reason,
    p_correlation_id,
    array['lifted_at'],
    '{}'::jsonb
  );

  return true;
end
$$;

create or replace function app_private.create_agency_system_pause(
  p_agency_id uuid,
  p_channel public.channel_kind,
  p_provider text,
  p_reason text,
  p_expires_at timestamptz,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_pause_id uuid;
begin
  if not app_private.has_agency_role(p_agency_id, array['owner', 'admin']::public.agency_role[]) then
    raise exception 'agency owner or admin role is required';
  end if;

  insert into public.system_pauses (
    agency_id,
    channel,
    provider,
    reason,
    created_by,
    actor_type,
    expires_at
  ) values (
    p_agency_id,
    p_channel,
    p_provider,
    trim(p_reason),
    app_private.current_user_id(),
    'user',
    p_expires_at
  )
  returning id into v_pause_id;

  perform app_private.write_audit_event(
    'user', p_agency_id, null, null, null,
    'system.pause', 'system_pause', v_pause_id::text, 'completed', trim(p_reason),
    p_correlation_id,
    array['channel', 'provider', 'expires_at'],
    '{}'::jsonb
  );

  return v_pause_id;
end
$$;

create or replace function app_private.lift_agency_system_pause(
  p_pause_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_pause public.system_pauses%rowtype;
begin
  select system_pause.*
  into strict v_pause
  from public.system_pauses system_pause
  where system_pause.id = p_pause_id and system_pause.agency_id is not null
  for update;

  if not app_private.has_agency_role(v_pause.agency_id, array['owner', 'admin']::public.agency_role[]) then
    raise exception 'agency owner or admin role is required';
  end if;

  if v_pause.lifted_at is not null then
    return false;
  end if;

  update public.system_pauses
  set lifted_at = statement_timestamp(),
      lifted_by = app_private.current_user_id()
  where id = p_pause_id;

  perform app_private.write_audit_event(
    'user', v_pause.agency_id, null, null, null,
    'system.pause.lift', 'system_pause', p_pause_id::text, 'completed', p_reason,
    p_correlation_id,
    array['lifted_at'],
    '{}'::jsonb
  );

  return true;
end
$$;

create or replace function app_private.create_global_system_pause(
  p_channel public.channel_kind,
  p_provider text,
  p_reason text,
  p_expires_at timestamptz,
  p_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_pause_id uuid;
begin
  insert into public.system_pauses (
    agency_id,
    channel,
    provider,
    reason,
    created_by,
    actor_type,
    expires_at
  ) values (
    null,
    p_channel,
    p_provider,
    trim(p_reason),
    null,
    'worker',
    p_expires_at
  )
  returning id into v_pause_id;

  perform app_private.write_audit_event(
    'worker', null, null, null, null,
    'system.global_pause', 'system_pause', v_pause_id::text, 'completed', trim(p_reason),
    p_correlation_id,
    array['channel', 'provider', 'expires_at'],
    '{}'::jsonb
  );

  return v_pause_id;
end
$$;

create or replace function app_private.lift_global_system_pause(
  p_pause_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_pause public.system_pauses%rowtype;
begin
  select system_pause.*
  into strict v_pause
  from public.system_pauses system_pause
  where system_pause.id = p_pause_id
    and system_pause.agency_id is null
  for update;

  if v_pause.lifted_at is not null then
    return false;
  end if;

  update public.system_pauses
  set lifted_at = statement_timestamp()
  where id = p_pause_id;

  perform app_private.write_audit_event(
    'worker', null, null, null, null,
    'system.global_pause.lift', 'system_pause', p_pause_id::text, 'completed', p_reason,
    p_correlation_id,
    array['lifted_at'],
    '{}'::jsonb
  );

  return true;
end
$$;

create or replace function app_private.accept_ingress_nonce(
  p_business_id uuid,
  p_integration_id uuid,
  p_nonce_hash bytea,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.ingress_nonces (
    business_id,
    integration_id,
    nonce_hash,
    expires_at
  ) values (
    p_business_id,
    p_integration_id,
    p_nonce_hash,
    p_expires_at
  )
  on conflict (business_id, integration_id, nonce_hash) do nothing;

  return found;
end
$$;

create or replace function app_private.record_ingress_event(
  p_business_id uuid,
  p_location_id uuid,
  p_integration_id uuid,
  p_event_type text,
  p_provider_event_id text,
  p_external_job_id text,
  p_payload_hash bytea,
  p_encrypted_payload bytea,
  p_received_at timestamptz
)
returns table (ingress_event_id uuid, is_duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_event_id uuid;
  v_try integer;
begin
  for v_try in 1..3 loop
    select ingress_event.id
    into v_event_id
    from public.ingress_events ingress_event
    where (
      p_provider_event_id is not null
      and ingress_event.business_id = p_business_id
      and ingress_event.integration_id = p_integration_id
      and ingress_event.provider_event_id = p_provider_event_id
    ) or (
      ingress_event.business_id = p_business_id
      and ingress_event.integration_id = p_integration_id
      and ingress_event.external_job_id = p_external_job_id
      and ingress_event.event_type = p_event_type
    )
    order by ingress_event.first_received_at
    limit 1
    for update;

    if found then
      update public.ingress_events
      set last_received_at = greatest(last_received_at, p_received_at),
          delivery_attempts = delivery_attempts + 1
      where id = v_event_id;

      return query select v_event_id, true;
      return;
    end if;

    begin
      insert into public.ingress_events (
        business_id,
        location_id,
        integration_id,
        event_type,
        provider_event_id,
        external_job_id,
        payload_hash,
        encrypted_payload,
        first_received_at,
        last_received_at
      ) values (
        p_business_id,
        p_location_id,
        p_integration_id,
        p_event_type,
        p_provider_event_id,
        p_external_job_id,
        p_payload_hash,
        p_encrypted_payload,
        p_received_at,
        p_received_at
      )
      returning id into v_event_id;

      return query select v_event_id, false;
      return;
    exception when unique_violation then
      -- A simultaneous delivery won. Loop and update that durable receipt.
    end;
  end loop;

  raise exception 'could not resolve concurrent ingress-event deduplication';
end
$$;

-- Both claim and pre-dispatch paths call the same pause predicate. A database
-- pause still has a very small race before the external network call, so the
-- production provider layer also needs an emergency credential/traffic kill
-- switch.
create or replace function app_private.is_delivery_paused(
  p_business_id uuid,
  p_location_id uuid,
  p_channel public.channel_kind,
  p_provider text,
  p_automation_key text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.businesses business
    join public.system_pauses system_pause
      on system_pause.agency_id is null
      or system_pause.agency_id = business.agency_id
    where business.id = p_business_id
      and system_pause.lifted_at is null
      and (system_pause.expires_at is null or system_pause.expires_at > statement_timestamp())
      and (system_pause.channel is null or system_pause.channel = p_channel)
      and (system_pause.provider is null or system_pause.provider = p_provider)
  ) or exists (
    select 1
    from public.tenant_pauses tenant_pause
    where tenant_pause.business_id = p_business_id
      and tenant_pause.lifted_at is null
      and (tenant_pause.expires_at is null or tenant_pause.expires_at > statement_timestamp())
      and (tenant_pause.location_id is null or tenant_pause.location_id = p_location_id)
      and (tenant_pause.channel is null or tenant_pause.channel = p_channel)
      and (tenant_pause.automation_key is null or tenant_pause.automation_key = p_automation_key)
  )
$$;

create or replace function app_private.claim_message_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.message_jobs
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_expired_job record;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'claim limit must be between 1 and 100';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'lease must be between 15 and 900 seconds';
  end if;

  -- A lease that expired after an attempt entered `sending` is ambiguous: the
  -- provider may have accepted it before the worker died. Quarantine it for
  -- reconciliation instead of allowing another worker to send it again.
  for v_expired_job in
    with expired_sending as (
      select message_job.id
      from public.message_jobs message_job
      join public.message_outbox outbox
        on outbox.business_id = message_job.business_id
       and outbox.message_job_id = message_job.id
       and outbox.status = 'sending'
      where message_job.status = 'leased'
        and message_job.leased_until <= statement_timestamp()
      order by message_job.leased_until, message_job.id
      for update of message_job skip locked
      limit p_limit
    )
    update public.message_jobs message_job
    set status = 'reconciliation_required',
        leased_until = null,
        lease_owner = null,
        lease_token = null,
        last_error_code = 'worker_lease_expired_while_sending'
    from expired_sending
    where message_job.id = expired_sending.id
    returning message_job.business_id, message_job.id
  loop
    update public.message_outbox outbox
    set status = 'unknown',
        updated_at = statement_timestamp()
    where outbox.business_id = v_expired_job.business_id
      and outbox.message_job_id = v_expired_job.id
      and outbox.status = 'sending';

    update public.message_attempts attempt
    set status = 'unknown',
        finished_at = statement_timestamp(),
        error_code = coalesce(attempt.error_code, 'worker_lease_expired_while_sending')
    where attempt.business_id = v_expired_job.business_id
      and attempt.message_job_id = v_expired_job.id
      and attempt.status = 'started';
  end loop;

  return query
  with candidates as (
    select message_job.id
    from public.message_jobs message_job
    where (
      (message_job.status in ('scheduled', 'retry') and message_job.run_at <= statement_timestamp())
      or (message_job.status = 'leased' and message_job.leased_until <= statement_timestamp())
    )
      and message_job.attempt_count < message_job.max_attempts
      and not exists (
        select 1
        from public.message_outbox outbox
        where outbox.business_id = message_job.business_id
          and outbox.message_job_id = message_job.id
          and outbox.status in ('sending', 'accepted', 'unknown', 'cancelled')
      )
      and not app_private.is_delivery_paused(
        message_job.business_id,
        message_job.location_id,
        message_job.channel,
        message_job.provider,
        message_job.automation_key
      )
    order by message_job.priority asc, message_job.run_at asc, message_job.id asc
    for update of message_job skip locked
    limit p_limit
  )
  update public.message_jobs message_job
  set status = 'leased',
      leased_until = statement_timestamp() + make_interval(secs => p_lease_seconds),
      lease_owner = trim(p_worker_id),
      lease_token = gen_random_uuid()
  from candidates
  where message_job.id = candidates.id
  returning message_job.*;
end
$$;

create or replace function app_private.renew_message_job_lease(
  p_message_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_leased_until timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'lease must be between 15 and 900 seconds';
  end if;

  update public.message_jobs message_job
  set leased_until = statement_timestamp() + make_interval(secs => p_lease_seconds)
  where message_job.id = p_message_job_id
    and message_job.status = 'leased'
    and message_job.lease_owner = p_worker_id
    and message_job.lease_token = p_lease_token
    and message_job.leased_until > statement_timestamp()
  returning leased_until into v_leased_until;

  if not found then
    raise exception 'worker does not hold an active matching lease';
  end if;

  return v_leased_until;
end
$$;

create or replace function app_private.ensure_message_outbox(
  p_message_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns public.message_outbox
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.message_jobs%rowtype;
  v_outbox public.message_outbox%rowtype;
begin
  select message_job.*
  into strict v_job
  from public.message_jobs message_job
  where message_job.id = p_message_job_id
  for update;

  if v_job.status <> 'leased'
     or v_job.lease_owner <> p_worker_id
     or v_job.lease_token is distinct from p_lease_token
     or v_job.leased_until <= statement_timestamp() then
    raise exception 'worker does not hold an active lease for this job';
  end if;

  insert into public.message_outbox (
    business_id,
    message_job_id,
    provider,
    provider_idempotency_key
  ) values (
    v_job.business_id,
    v_job.id,
    v_job.provider,
    'afterword:' || v_job.id::text
  )
  on conflict (business_id, message_job_id) do update
  set updated_at = public.message_outbox.updated_at
  returning * into v_outbox;

  return v_outbox;
end
$$;

create or replace function app_private.start_message_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns table (
  message_attempt_id uuid,
  provider_idempotency_key text,
  attempt_number integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_outbox public.message_outbox%rowtype;
  v_job public.message_jobs%rowtype;
  v_attempt_id uuid;
  v_attempt_number integer;
begin
  select outbox.*
  into strict v_outbox
  from public.message_outbox outbox
  where outbox.id = p_outbox_id;

  select message_job.*
  into strict v_job
  from public.message_jobs message_job
  where message_job.business_id = v_outbox.business_id
    and message_job.id = v_outbox.message_job_id
  for update;

  select outbox.*
  into strict v_outbox
  from public.message_outbox outbox
  where outbox.business_id = v_job.business_id
    and outbox.id = p_outbox_id
    and outbox.message_job_id = v_job.id
  for update;

  if v_job.status <> 'leased'
     or v_job.lease_owner <> p_worker_id
     or v_job.lease_token is distinct from p_lease_token
     or v_job.leased_until <= statement_timestamp() then
    raise exception 'worker does not hold an active lease for this job';
  end if;

  select attempt.id, attempt.attempt_number
  into v_attempt_id, v_attempt_number
  from public.message_attempts attempt
  where attempt.business_id = v_job.business_id
    and attempt.message_job_id = v_job.id
    and attempt.lease_token = p_lease_token;

  if found then
    return query
    select v_attempt_id, v_outbox.provider_idempotency_key, v_attempt_number;
    return;
  end if;

  if v_outbox.status in ('sending', 'accepted', 'unknown', 'cancelled') then
    raise exception 'outbox status % cannot be sent', v_outbox.status;
  end if;

  if v_job.attempt_count >= v_job.max_attempts then
    raise exception 'message job has exhausted its attempt budget';
  end if;

  -- This is the final database authorization immediately before the worker may
  -- call the provider. It catches pauses created after the original claim.
  if app_private.is_delivery_paused(
    v_job.business_id,
    v_job.location_id,
    v_job.channel,
    v_job.provider,
    v_job.automation_key
  ) then
    raise exception 'delivery is paused';
  end if;

  v_attempt_number := v_job.attempt_count + 1;

  update public.message_jobs
  set attempt_count = v_attempt_number
  where id = v_job.id;

  update public.message_outbox
  set status = 'sending',
      attempt_count = v_attempt_number,
      last_attempt_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = v_outbox.id
  returning attempt_count into v_attempt_number;

  insert into public.message_attempts (
    business_id,
    outbox_id,
    message_job_id,
    attempt_number,
    worker_id,
    lease_token
  ) values (
    v_outbox.business_id,
    v_outbox.id,
    v_job.id,
    v_attempt_number,
    p_worker_id,
    p_lease_token
  )
  returning id into v_attempt_id;

  return query
  select v_attempt_id, v_outbox.provider_idempotency_key, v_attempt_number;
end
$$;

create or replace function app_private.finish_message_attempt(
  p_message_attempt_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_result public.attempt_status,
  p_provider_message_id text,
  p_response_code text,
  p_error_code text
)
returns public.job_status
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_attempt public.message_attempts%rowtype;
  v_outbox public.message_outbox%rowtype;
  v_job public.message_jobs%rowtype;
  v_next_status public.job_status;
begin
  if p_result is null or p_result = 'started' then
    raise exception 'attempt result must be accepted, unknown or failed';
  end if;

  select attempt.*
  into strict v_attempt
  from public.message_attempts attempt
  where attempt.id = p_message_attempt_id;

  select message_job.*
  into strict v_job
  from public.message_jobs message_job
  where message_job.business_id = v_attempt.business_id
    and message_job.id = v_attempt.message_job_id
  for update;

  select outbox.*
  into strict v_outbox
  from public.message_outbox outbox
  where outbox.business_id = v_job.business_id
    and outbox.id = v_attempt.outbox_id
    and outbox.message_job_id = v_job.id
  for update;

  select attempt.*
  into strict v_attempt
  from public.message_attempts attempt
  where attempt.business_id = v_job.business_id
    and attempt.id = p_message_attempt_id
    and attempt.outbox_id = v_outbox.id
    and attempt.message_job_id = v_job.id
  for update;

  if v_attempt.worker_id <> p_worker_id
     or v_attempt.lease_token is distinct from p_lease_token
     or v_job.status <> 'leased'
     or v_job.lease_owner <> p_worker_id
     or v_job.lease_token is distinct from p_lease_token then
    raise exception 'worker does not hold this message job';
  end if;

  if v_attempt.status <> 'started' then
    return v_job.status;
  end if;

  update public.message_attempts
  set status = p_result,
      finished_at = statement_timestamp(),
      provider_message_id = p_provider_message_id,
      response_code = p_response_code,
      error_code = p_error_code
  where id = v_attempt.id;

  if p_result = 'accepted' then
    update public.message_outbox
    set status = 'accepted',
        provider_message_id = p_provider_message_id,
        accepted_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where id = v_outbox.id;

    update public.message_jobs
    set status = 'completed',
        completed_at = statement_timestamp(),
        leased_until = null,
        lease_owner = null,
        lease_token = null
    where id = v_job.id;

    return 'completed';
  end if;

  if p_result = 'unknown' then
    update public.message_outbox
    set status = 'unknown',
        updated_at = statement_timestamp()
    where id = v_outbox.id;

    update public.message_jobs
    set status = 'reconciliation_required',
        leased_until = null,
        lease_owner = null,
        lease_token = null,
        last_error_code = coalesce(p_error_code, 'provider_result_unknown')
    where id = v_job.id;

    return 'reconciliation_required';
  end if;

  v_next_status := case
    when v_job.attempt_count >= v_job.max_attempts then 'dead_letter'::public.job_status
    else 'retry'::public.job_status
  end;

  update public.message_outbox
  set status = 'failed',
      updated_at = statement_timestamp()
  where id = v_outbox.id;

  update public.message_jobs
  set status = v_next_status,
      run_at = case
        when v_next_status = 'retry'
          then statement_timestamp() + make_interval(secs => least(21600, (60 * power(2, least(v_job.attempt_count, 8)))::integer))
        else run_at
      end,
      leased_until = null,
      lease_owner = null,
      lease_token = null,
      last_error_code = p_error_code
  where id = v_job.id;

  return v_next_status;
end
$$;

create or replace function app_private.resolve_unknown_message(
  p_outbox_id uuid,
  p_provider_result public.attempt_status,
  p_provider_message_id text,
  p_reason text,
  p_correlation_id uuid
)
returns public.job_status
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_outbox public.message_outbox%rowtype;
  v_job public.message_jobs%rowtype;
  v_return_status public.job_status;
begin
  if p_provider_result is null or p_provider_result not in ('accepted', 'failed') then
    raise exception 'reconciliation result must be accepted or failed';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'reconciliation reason or evidence reference is required';
  end if;

  select outbox.*
  into strict v_outbox
  from public.message_outbox outbox
  where outbox.id = p_outbox_id;

  select message_job.*
  into strict v_job
  from public.message_jobs message_job
  where message_job.business_id = v_outbox.business_id
    and message_job.id = v_outbox.message_job_id
  for update;

  select outbox.*
  into strict v_outbox
  from public.message_outbox outbox
  where outbox.business_id = v_job.business_id
    and outbox.id = p_outbox_id
    and outbox.message_job_id = v_job.id
  for update;

  if v_outbox.status <> 'unknown' or v_job.status <> 'reconciliation_required' then
    return v_job.status;
  end if;

  if p_provider_result = 'accepted' then
    update public.message_outbox
    set status = 'accepted',
        provider_message_id = p_provider_message_id,
        accepted_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where id = v_outbox.id;

    update public.message_jobs
    set status = 'completed',
        completed_at = statement_timestamp(),
        last_error_code = null
    where id = v_job.id;

    perform app_private.write_audit_event(
      'worker', null, v_job.business_id, v_job.location_id, null,
      'message.reconciliation.resolve', 'message_outbox', v_outbox.id::text,
      'completed', p_reason, p_correlation_id,
      array['status', 'provider_message_id'],
      jsonb_build_object('provider_result', p_provider_result)
    );

    return 'completed';
  end if;

  update public.message_outbox
  set status = 'failed',
      updated_at = statement_timestamp()
  where id = v_outbox.id;

  update public.message_jobs
  set status = case
        when attempt_count >= max_attempts then 'dead_letter'::public.job_status
        else 'retry'::public.job_status
      end,
      run_at = case
        when attempt_count >= max_attempts then run_at
        else statement_timestamp() + make_interval(secs => least(21600, (60 * power(2, least(attempt_count, 8)))::integer))
      end,
      last_error_code = 'reconciled_not_accepted'
  where id = v_job.id
  returning status into v_return_status;

  perform app_private.write_audit_event(
    'worker', null, v_job.business_id, v_job.location_id, null,
    'message.reconciliation.resolve', 'message_outbox', v_outbox.id::text,
    'completed', p_reason, p_correlation_id,
    array['status', 'last_error_code'],
    jsonb_build_object('provider_result', p_provider_result, 'job_status', v_return_status)
  );

  return v_return_status;
end
$$;

-- Privilege boundary. RLS is not a grant system, so permissions are made
-- explicit after every function exists. Repeating the PUBLIC revoke here also
-- protects functions created before the default-privilege rule in an upgraded
-- database.
revoke all on schema app_private from public;
grant usage on schema app_private to afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

revoke all on all functions in schema app_private
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users', 'agencies', 'agency_memberships', 'businesses', 'business_memberships',
    'locations', 'membership_location_grants', 'invitations', 'support_sessions',
    'tenant_pauses', 'system_pauses', 'audit_events', 'integration_connections',
    'consent_records', 'channel_suppressions', 'ingress_events', 'ingress_nonces',
    'message_jobs', 'message_outbox', 'message_attempts',
    'integration_connection_status', 'ingress_event_status', 'invitation_status',
    'support_session_status', 'audit_event_status', 'consent_record_status',
    'channel_suppression_status', 'message_attempt_status', 'system_pause_status'
  ] loop
    execute format(
      'revoke all on table public.%I from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops',
      table_name
    );
  end loop;
end
$$;

grant select (id, email, display_name, mfa_required, created_at, disabled_at)
  on public.users to afterword_runtime;
grant select on public.agencies, public.agency_memberships, public.businesses,
  public.business_memberships, public.locations, public.membership_location_grants,
  public.tenant_pauses
  to afterword_runtime;

-- Worker fencing and provider idempotency values are capabilities, not tenant
-- dashboard data. Keep them off the runtime read surface even when RLS permits
-- the row.
grant select (
  id, business_id, location_id, ingress_event_id, channel, provider,
  automation_key, status, priority, run_at, leased_until, attempt_count,
  max_attempts, last_error_code, completed_at, created_at
) on public.message_jobs to afterword_runtime;
grant select (
  id, business_id, message_job_id, provider, status, provider_message_id,
  attempt_count, last_attempt_at, accepted_at, created_at, updated_at
) on public.message_outbox to afterword_runtime;

grant select (
  id, business_id, location_id, provider, health, token_expires_at, last_event_at,
  last_sync_at, consecutive_failures, disabled_at, created_at
) on public.integration_connections to afterword_runtime;
grant select (
  id, business_id, location_id, integration_id, event_type, provider_event_id,
  external_job_id, first_received_at, last_received_at, processing_status,
  delivery_attempts
) on public.ingress_events to afterword_runtime;
grant select (
  id, business_id, agency_id, invited_email, requested_business_role,
  requested_agency_role, created_by, expires_at, accepted_at, revoked_at
) on public.invitations to afterword_runtime;
grant select (
  id, agency_id, business_id, actor_user_id, scope, started_at,
  last_activity_at, expires_at, ended_at, revoked_at
) on public.support_sessions to afterword_runtime;
grant select (
  id, occurred_at, actor_user_id, actor_type, effective_agency_id,
  effective_business_id, effective_location_id, support_session_id, action,
  target_type, target_id, outcome, correlation_id, request_id, changed_fields
) on public.audit_events to afterword_runtime;
grant select (
  id, business_id, location_id, channel, status, wording_version, purpose,
  captured_at, source, withdrawn_at, withdrawal_source, created_at
) on public.consent_records to afterword_runtime;
grant select (
  id, business_id, channel, reason, source, suppressed_at, lifted_at
) on public.channel_suppressions to afterword_runtime;
grant select (
  id, business_id, outbox_id, message_job_id, attempt_number, status, started_at,
  finished_at, provider_message_id, response_code, error_code
) on public.message_attempts to afterword_runtime;
grant select (id, agency_id, channel, provider, started_at, expires_at, lifted_at)
  on public.system_pauses to afterword_runtime;

grant select on public.integration_connection_status, public.ingress_event_status,
  public.invitation_status, public.support_session_status, public.audit_event_status,
  public.consent_record_status, public.channel_suppression_status,
  public.message_attempt_status, public.system_pause_status
  to afterword_runtime;

grant execute on function app_private.current_user_id() to afterword_runtime;
grant execute on function app_private.current_support_session_id() to afterword_runtime;
grant execute on function app_private.current_user_enabled() to afterword_runtime;
grant execute on function app_private.has_agency_role(uuid, public.agency_role[]) to afterword_runtime;
grant execute on function app_private.has_business_role(uuid, public.business_role[]) to afterword_runtime;
grant execute on function app_private.has_active_support_session(uuid, public.support_scope) to afterword_runtime;
grant execute on function app_private.can_read_business_summary(uuid) to afterword_runtime;
grant execute on function app_private.can_read_tenant_data(uuid, uuid) to afterword_runtime;
grant execute on function app_private.can_manage_business(uuid) to afterword_runtime;
grant execute on function app_private.can_pause_business(uuid) to afterword_runtime;
grant execute on function app_private.can_read_agency(uuid) to afterword_runtime;
grant execute on function app_private.can_read_user_profile(uuid) to afterword_runtime;
grant execute on function app_private.can_read_audit(uuid, uuid) to afterword_runtime;

grant execute on function app_private.record_blocked_admin_action(
  uuid, uuid, uuid, text, text, text, text, uuid
) to afterword_runtime;
grant execute on function app_private.create_business(
  uuid, text, text, text, text, uuid, uuid
) to afterword_runtime;
grant execute on function app_private.create_location(uuid, text, text, uuid) to afterword_runtime;
grant execute on function app_private.set_business_membership(
  uuid, uuid, public.business_role, public.membership_status, uuid
) to afterword_runtime;
grant execute on function app_private.set_location_grant(uuid, uuid, uuid, boolean, uuid) to afterword_runtime;
grant execute on function app_private.start_support_session(
  uuid, public.support_scope, text, integer, uuid
) to afterword_runtime;
grant execute on function app_private.touch_support_session(uuid) to afterword_runtime;
grant execute on function app_private.end_support_session(uuid, text, uuid) to afterword_runtime;
grant execute on function app_private.create_tenant_pause(
  uuid, uuid, public.channel_kind, text, text, timestamptz, uuid
) to afterword_runtime;
grant execute on function app_private.lift_tenant_pause(uuid, text, uuid) to afterword_runtime;
grant execute on function app_private.create_agency_system_pause(
  uuid, public.channel_kind, text, text, timestamptz, uuid
) to afterword_runtime;
grant execute on function app_private.lift_agency_system_pause(uuid, text, uuid) to afterword_runtime;

grant execute on function app_private.create_global_system_pause(
  public.channel_kind, text, text, timestamptz, uuid
) to afterword_ops;
grant execute on function app_private.lift_global_system_pause(uuid, text, uuid) to afterword_ops;
grant execute on function app_private.accept_ingress_nonce(uuid, uuid, bytea, timestamptz) to afterword_ingress;
grant execute on function app_private.record_ingress_event(
  uuid, uuid, uuid, text, text, text, bytea, bytea, timestamptz
) to afterword_ingress;
grant execute on function app_private.claim_message_jobs(text, integer, integer) to afterword_worker;
grant execute on function app_private.renew_message_job_lease(uuid, text, uuid, integer) to afterword_worker;
grant execute on function app_private.ensure_message_outbox(uuid, text, uuid) to afterword_worker;
grant execute on function app_private.start_message_attempt(uuid, text, uuid) to afterword_worker;
grant execute on function app_private.finish_message_attempt(
  uuid, text, uuid, public.attempt_status, text, text, text
) to afterword_worker;
grant execute on function app_private.resolve_unknown_message(
  uuid, public.attempt_status, text, text, uuid
) to afterword_ops;

comment on schema app_private is
  'Afterword trusted authorization and command surface. Never expose directly to browser clients.';

commit;
