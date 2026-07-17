-- Afterword authenticated review-automation foundation
-- Apply after 001 and 002 with SET ROLE afterword_migration_owner.
-- DBA prerequisite:
--   create role afterword_auth nologin nobypassrls;

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'afterword_auth') then
    raise exception 'required role afterword_auth does not exist';
  end if;
  if exists (
    select 1 from pg_roles where rolname = 'afterword_auth' and (rolcanlogin or rolbypassrls)
  ) then
    raise exception 'afterword_auth must be NOLOGIN and NOBYPASSRLS';
  end if;
  if exists (
    select lower(btrim(email)) from public.users
    group by lower(btrim(email)) having count(*) > 1
  ) then
    raise exception 'canonical user email duplicates must be resolved before migration 003';
  end if;
end
$$;

create unique index users_email_canonical_uidx on public.users (lower(btrim(email)));

create type public.review_request_status as enum (
  'scheduled', 'active', 'converted', 'stopped', 'blocked', 'failed'
);
create type public.completed_job_status as enum (
  'received', 'eligible', 'blocked', 'enrolled', 'cancelled'
);
create type public.dispatch_decision as enum ('allow', 'reschedule', 'block');

create table app_private.auth_credentials (
  user_id uuid primary key references public.users(id) on delete cascade,
  password_hash text not null check (password_hash like 'scrypt$%'),
  password_version integer not null default 1 check (password_version > 0),
  email_verified_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table app_private.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash bytea not null unique check (length(token_hash) = 32),
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  mfa_verified_at timestamptz,
  step_up_verified_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  ip_hash bytea,
  user_agent_family text,
  check (idle_expires_at > created_at),
  check (absolute_expires_at >= idle_expires_at),
  check ((revoked_at is null) = (revoke_reason is null)),
  unique (id, user_id)
);
create index auth_sessions_user_active_idx on app_private.auth_sessions(user_id, absolute_expires_at) where revoked_at is null;
create index auth_sessions_expiry_idx on app_private.auth_sessions(idle_expires_at, absolute_expires_at) where revoked_at is null;

alter table public.audit_events add column auth_session_id uuid references app_private.auth_sessions(id);
alter table public.audit_events
  add foreign key (auth_session_id, actor_user_id)
  references app_private.auth_sessions(id, user_id);
create index audit_events_auth_session_idx on public.audit_events(auth_session_id);

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  customer_reference text not null,
  first_name_ciphertext bytea not null,
  first_name_nonce bytea not null check (length(first_name_nonce) = 12),
  first_name_tag bytea not null check (length(first_name_tag) = 16),
  phone_ciphertext bytea,
  phone_nonce bytea,
  phone_tag bytea,
  phone_hash bytea,
  email_ciphertext bytea,
  email_nonce bytea,
  email_tag bytea,
  email_hash bytea,
  hash_version smallint not null default 1,
  key_version smallint not null default 1,
  retention_until timestamptz not null,
  anonymized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  unique (business_id, customer_reference),
  unique (business_id, id),
  unique (business_id, location_id, id),
  check (
    (phone_ciphertext is null and phone_nonce is null and phone_tag is null and phone_hash is null)
    or
    (phone_ciphertext is not null and length(phone_nonce) = 12 and length(phone_tag) = 16 and phone_hash is not null)
  ),
  check (
    (email_ciphertext is null and email_nonce is null and email_tag is null and email_hash is null)
    or
    (email_ciphertext is not null and length(email_nonce) = 12 and length(email_tag) = 16 and email_hash is not null)
  )
);
create index customer_contacts_location_idx on public.customer_contacts(business_id, location_id);

create table public.completed_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  customer_id uuid not null,
  ingress_event_id uuid,
  source text not null,
  external_job_id text not null,
  service_label text not null,
  completed_at timestamptz not null,
  status public.completed_job_status not null default 'received',
  block_reason_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, location_id, customer_id) references public.customer_contacts(business_id, location_id, id),
  foreign key (business_id, location_id, ingress_event_id) references public.ingress_events(business_id, location_id, id),
  unique (business_id, source, external_job_id),
  unique (business_id, id),
  unique (business_id, location_id, id),
  check ((status = 'blocked') = (block_reason_code is not null))
);
create index completed_jobs_location_time_idx on public.completed_jobs(business_id, location_id, completed_at desc);
create index completed_jobs_customer_fk_idx on public.completed_jobs(business_id, location_id, customer_id);
create index completed_jobs_ingress_fk_idx on public.completed_jobs(business_id, location_id, ingress_event_id)
  where ingress_event_id is not null;

create table public.message_template_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  template_key text not null,
  version integer not null check (version > 0),
  channel public.channel_kind not null,
  body text not null,
  subject text,
  includes_business_identity boolean not null,
  includes_unsubscribe boolean not null,
  approved_by uuid not null references public.users(id),
  approved_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  foreign key (business_id, location_id) references public.locations(business_id, id),
  unique (business_id, template_key, version),
  unique (business_id, id),
  unique (business_id, location_id, id)
);

create table public.location_messaging_policies (
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  channel public.channel_kind not null,
  enabled boolean not null default false,
  timezone text not null,
  allowed_weekdays smallint[] not null default array[1,2,3,4,5,6],
  send_window_start time not null default time '09:00',
  send_window_end time not null default time '18:00',
  max_messages_per_request smallint not null default 2 check (max_messages_per_request between 1 and 3),
  minimum_gap interval not null default interval '48 hours' check (minimum_gap >= interval '1 hour'),
  destination_frequency_window interval not null default interval '30 days',
  destination_frequency_max smallint not null default 1 check (destination_frequency_max > 0),
  hourly_limit integer not null default 50 check (hourly_limit > 0),
  rule_version text not null,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id),
  primary key (business_id, location_id, channel),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  check (send_window_end > send_window_start)
);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  completed_job_id uuid not null,
  customer_id uuid not null,
  consent_record_id uuid not null,
  template_version_id uuid,
  channel public.channel_kind not null,
  destination_hash bytea not null,
  destination_hash_version smallint not null default 1,
  automation_key text not null,
  status public.review_request_status not null default 'scheduled',
  max_messages smallint not null check (max_messages between 1 and 3),
  sent_count smallint not null default 0 check (sent_count >= 0 and sent_count <= max_messages),
  next_send_at timestamptz,
  started_at timestamptz,
  stopped_at timestamptz,
  converted_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, location_id, completed_job_id) references public.completed_jobs(business_id, location_id, id),
  foreign key (business_id, location_id, customer_id) references public.customer_contacts(business_id, location_id, id),
  foreign key (business_id, location_id, template_version_id) references public.message_template_versions(business_id, location_id, id),
  unique (business_id, completed_job_id, automation_key, channel),
  unique (business_id, id),
  unique (business_id, location_id, id)
);
create index review_requests_location_status_idx on public.review_requests(business_id, location_id, status, next_send_at);
create index review_requests_destination_idx on public.review_requests(business_id, channel, destination_hash, created_at desc);
create index review_requests_customer_fk_idx on public.review_requests(business_id, location_id, customer_id);
create index review_requests_consent_fk_idx on public.review_requests(business_id, location_id, consent_record_id);
create index review_requests_template_fk_idx on public.review_requests(business_id, location_id, template_version_id)
  where template_version_id is not null;

create table app_private.message_dispatch_payloads (
  business_id uuid not null references public.businesses(id),
  message_job_id uuid not null,
  destination_ciphertext bytea not null,
  destination_nonce bytea not null check (length(destination_nonce) = 12),
  destination_tag bytea not null check (length(destination_tag) = 16),
  body_ciphertext bytea not null,
  body_nonce bytea not null check (length(body_nonce) = 12),
  body_tag bytea not null check (length(body_tag) = 16),
  subject_ciphertext bytea,
  subject_nonce bytea,
  subject_tag bytea,
  key_version smallint not null default 1,
  expires_at timestamptz not null,
  primary key (business_id, message_job_id),
  foreign key (business_id, message_job_id) references public.message_jobs(business_id, id),
  check (
    (subject_ciphertext is null and subject_nonce is null and subject_tag is null)
    or
    (subject_ciphertext is not null and length(subject_nonce) = 12 and length(subject_tag) = 16)
  )
);

create table app_private.integration_secrets (
  business_id uuid not null references public.businesses(id),
  integration_id uuid not null,
  access_token_ciphertext bytea not null,
  access_token_nonce bytea not null,
  access_token_tag bytea not null,
  refresh_token_ciphertext bytea,
  refresh_token_nonce bytea,
  refresh_token_tag bytea,
  key_version smallint not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, integration_id),
  foreign key (business_id, integration_id)
    references public.integration_connections(business_id, id) on delete cascade,
  check (
    (refresh_token_ciphertext is null and refresh_token_nonce is null and refresh_token_tag is null)
    or
    (refresh_token_ciphertext is not null and length(refresh_token_nonce) = 12 and length(refresh_token_tag) = 16)
  ),
  check (length(access_token_nonce) = 12 and length(access_token_tag) = 16)
);

create table app_private.oauth_authorization_states (
  state_hash bytea primary key check (length(state_hash) = 32),
  actor_user_id uuid not null references public.users(id),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  verifier_ciphertext bytea not null,
  verifier_nonce bytea not null,
  verifier_tag bytea not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  check (length(verifier_nonce) = 12 and length(verifier_tag) = 16),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index oauth_authorization_states_actor_recent_idx
  on app_private.oauth_authorization_states(actor_user_id, business_id, location_id, consumed_at desc)
  where consumed_at is not null;
create index oauth_authorization_states_expiry_idx on app_private.oauth_authorization_states(expires_at);

create table app_private.google_profile_selection_states (
  token_hash bytea primary key check (length(token_hash) = 32),
  actor_user_id uuid not null references public.users(id),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  candidates_ciphertext bytea not null,
  candidates_nonce bytea not null check (length(candidates_nonce) = 12),
  candidates_tag bytea not null check (length(candidates_tag) = 16),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index google_profile_selection_states_actor_recent_idx
  on app_private.google_profile_selection_states(actor_user_id, business_id, location_id, consumed_at desc);
create index google_profile_selection_states_expiry_idx on app_private.google_profile_selection_states(expires_at);

create table app_private.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google', 'twilio', 'sendgrid')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 500),
  event_type text not null check (length(event_type) between 1 and 120),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  integration_id uuid,
  message_job_id uuid,
  payload_hash bytea not null check (length(payload_hash) = 32),
  encrypted_payload bytea not null,
  signature_verified_at timestamptz not null default clock_timestamp(),
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  result_code text,
  expires_at timestamptz not null,
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, integration_id) references public.integration_connections(business_id, id),
  foreign key (business_id, message_job_id) references public.message_jobs(business_id, id),
  unique (provider, provider_event_id),
  check (expires_at <= received_at + interval '30 days')
);
create index provider_webhook_events_expiry_idx on app_private.provider_webhook_events(expires_at);
create index provider_webhook_events_tenant_time_idx on app_private.provider_webhook_events(business_id, location_id, received_at desc);
create index provider_webhook_events_integration_fk_idx
  on app_private.provider_webhook_events(business_id, integration_id) where integration_id is not null;
create index provider_webhook_events_message_job_fk_idx
  on app_private.provider_webhook_events(business_id, message_job_id) where message_job_id is not null;

create table app_private.oauth_token_revocations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'google'),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  integration_id uuid not null,
  token_kind text not null check (token_kind in ('access', 'refresh')),
  token_ciphertext bytea not null,
  token_nonce bytea not null check (length(token_nonce) = 12),
  token_tag bytea not null check (length(token_tag) = 16),
  key_version smallint not null default 1,
  status text not null default 'pending' check (status in ('pending', 'leased', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_owner text,
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, integration_id) references public.integration_connections(business_id, id),
  check (
    (status = 'leased' and lease_owner is not null and lease_token is not null and leased_until is not null)
    or
    (status <> 'leased' and lease_owner is null and lease_token is null and leased_until is null)
  ),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
create index oauth_token_revocations_due_idx
  on app_private.oauth_token_revocations(next_attempt_at, id) where status = 'pending';
create index oauth_token_revocations_integration_fk_idx
  on app_private.oauth_token_revocations(business_id, integration_id);

create table public.google_profile_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  integration_id uuid not null,
  account_resource_name text not null,
  location_resource_name text not null,
  review_uri text,
  granted_scopes text[] not null,
  token_expires_at timestamptz not null,
  next_sync_at timestamptz not null default clock_timestamp(),
  sync_lease_owner text,
  sync_lease_token uuid,
  sync_leased_until timestamptz,
  consecutive_failures integer not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, integration_id) references public.integration_connections(business_id, id),
  unique (business_id, location_resource_name),
  unique (location_resource_name),
  unique (business_id, id),
  unique (business_id, location_id, integration_id),
  check (
    review_uri is null
    or review_uri ~* '^https://(g\.page|search\.google\.com|www\.google\.com|maps\.app\.goo\.gl)([/:?]|$)'
  ),
  check (
    (sync_lease_owner is null and sync_lease_token is null and sync_leased_until is null)
    or
    (sync_lease_owner is not null and sync_lease_token is not null and sync_leased_until is not null)
  )
);
create index google_profile_sync_due_idx on public.google_profile_locations(next_sync_at) where sync_leased_until is null;

create table public.review_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  integration_id uuid not null,
  provider text not null check (provider = 'google'),
  provider_review_id text not null,
  reviewer_display_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  reply_body text,
  provider_created_at timestamptz not null,
  provider_updated_at timestamptz not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  cache_expires_at timestamptz not null check (cache_expires_at <= last_seen_at + interval '30 days'),
  removed_at timestamptz,
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, integration_id) references public.integration_connections(business_id, id),
  foreign key (business_id, location_id, integration_id)
    references public.google_profile_locations(business_id, location_id, integration_id),
  unique (business_id, provider, provider_review_id),
  unique (business_id, id)
);
create index review_records_cache_expiry_idx on public.review_records(cache_expires_at);
create index review_records_location_time_idx on public.review_records(business_id, location_id, provider_created_at desc);
create index review_records_integration_fk_idx on public.review_records(business_id, location_id, integration_id);

alter table public.message_jobs
  add column review_request_id uuid,
  add column sequence_number smallint,
  add column destination_hash bytea,
  add column destination_hash_version smallint,
  add column template_version_id uuid;

alter table public.message_jobs
  add foreign key (business_id, location_id, review_request_id) references public.review_requests(business_id, location_id, id),
  add foreign key (business_id, location_id, template_version_id) references public.message_template_versions(business_id, location_id, id),
  add constraint message_jobs_sequence_check check (sequence_number is null or sequence_number between 1 and 3);
create unique index message_jobs_request_sequence_uidx
  on public.message_jobs(business_id, review_request_id, sequence_number)
  where review_request_id is not null;
create index message_jobs_template_fk_idx on public.message_jobs(business_id, location_id, template_version_id)
  where template_version_id is not null;

alter table public.channel_suppressions add column hash_version smallint not null default 1;
drop index public.channel_suppressions_active_unique_idx;
create unique index channel_suppressions_active_unique_idx
  on public.channel_suppressions(business_id, channel, hash_version, destination_hash)
  where lifted_at is null;
alter table public.consent_records add constraint consent_records_business_id_id_key unique (business_id, id);
alter table public.consent_records add constraint consent_records_business_location_id_key unique (business_id, location_id, id);
alter table public.review_requests
  add foreign key (business_id, location_id, consent_record_id) references public.consent_records(business_id, location_id, id);
alter table public.integration_connections
  add constraint integration_connections_business_location_provider_key
  unique (business_id, location_id, provider);
create unique index message_outbox_provider_message_uidx
  on public.message_outbox(provider, provider_message_id)
  where provider_message_id is not null;

-- Tenant RLS. Private auth/secrets/payload tables are reachable only through
-- narrowly granted SECURITY DEFINER functions.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customer_contacts', 'completed_jobs', 'message_template_versions',
    'location_messaging_policies', 'review_requests', 'google_profile_locations',
    'review_records'
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

create policy customer_contacts_read on public.customer_contacts for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));
create policy completed_jobs_read on public.completed_jobs for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));
create policy message_template_versions_read on public.message_template_versions for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));
create policy location_messaging_policies_read on public.location_messaging_policies for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));
create policy review_requests_read on public.review_requests for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));
create policy google_profile_locations_read on public.google_profile_locations for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));
create policy review_records_read on public.review_records for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

-- Never trust request-supplied identity GUCs.  A runtime request is a tenant
-- principal only when both values identify the same live, server-issued
-- session.  The browser holds the opaque token, not its database hash.
create or replace function app_private.current_auth_session_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth_session.id
  from app_private.auth_sessions auth_session
  join public.users app_user on app_user.id = auth_session.user_id
  where auth_session.id::text = nullif(current_setting('app.auth_session_id', true), '')
    and encode(auth_session.token_hash, 'hex') = lower(nullif(current_setting('app.auth_session_token_hash', true), ''))
    and auth_session.revoked_at is null
    and auth_session.idle_expires_at > statement_timestamp()
    and auth_session.absolute_expires_at > statement_timestamp()
    and app_user.disabled_at is null
  limit 1
$$;

create or replace function app_private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth_session.user_id
  from app_private.auth_sessions auth_session
  join public.users app_user on app_user.id = auth_session.user_id
  where auth_session.id = app_private.current_auth_session_id()
    and app_user.disabled_at is null
$$;

create or replace function app_private.current_mfa_verified_at()
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth_session.mfa_verified_at
  from app_private.auth_sessions auth_session
  where auth_session.id = app_private.current_auth_session_id()
$$;

create or replace function app_private.current_step_up_verified_at()
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth_session.step_up_verified_at
  from app_private.auth_sessions auth_session
  where auth_session.id = app_private.current_auth_session_id()
$$;

create or replace function app_private.is_allowed_google_review_url(p_url text)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~* '^https://g\.page/r/[a-z0-9_-]+/review/?([?#].*)?$'
    or p_url ~* '^https://search\.google\.com/local/writereview\?[^#]*placeid=[^&#]+'
    or p_url ~* '^https://www\.google\.com/maps/place/[^?#]+'
    or p_url ~* '^https://maps\.app\.goo\.gl/[a-z0-9_-]+([?#].*)?$',
    false
  )
$$;

alter table public.review_destinations
  drop constraint review_destinations_destination_url_check;
alter table public.review_destinations
  add constraint review_destinations_destination_url_check
  check (app_private.is_allowed_google_review_url(destination_url));

create or replace function app_private.save_google_review_destination(
  p_business_id uuid,
  p_location_id uuid,
  p_destination_url text
)
returns public.review_destinations
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_destination public.review_destinations%rowtype;
  v_actor uuid := app_private.current_user_id();
begin
  if not app_private.can_manage_business(p_business_id) then
    raise exception 'business configuration permission required';
  end if;
  if not app_private.is_allowed_google_review_url(p_destination_url) then
    raise exception 'an allow-listed direct Google review destination is required';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.business_id = p_business_id and location.id = p_location_id
      and location.status <> 'archived'
  ) then
    raise exception 'location does not belong to business';
  end if;

  update public.review_destinations
  set active = false, updated_at = statement_timestamp()
  where business_id = p_business_id and location_id = p_location_id
    and provider = 'google' and active;

  insert into public.review_destinations (
    business_id, location_id, destination_url, verified_at, verified_by
  ) values (
    p_business_id, p_location_id, p_destination_url, statement_timestamp(), v_actor
  ) returning * into v_destination;

  update public.qr_codes
  set review_destination_id = v_destination.id
  where business_id = p_business_id and location_id = p_location_id and status = 'active';
  return v_destination;
end
$$;

-- PostgreSQL cannot change a function's TABLE return type in place. Recreate
-- the public-flow resolver and its dependent recorder so the live QR page can
-- render verified tenant identity without exposing another read surface.
drop function app_private.record_qr_scan(text, bytea, text, text, text, text);
drop function app_private.resolve_qr_review_flow(text);

create function app_private.resolve_qr_review_flow(p_public_token text)
returns table (
  qr_code_id uuid,
  business_id uuid,
  location_id uuid,
  destination_url text,
  business_name text,
  location_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select code.id, code.business_id, code.location_id, destination.destination_url,
    business.name, location.name
  from public.qr_codes code
  join public.review_destinations destination
    on destination.business_id = code.business_id and destination.id = code.review_destination_id
  join public.businesses business on business.id = code.business_id and business.archived_at is null
  join public.locations location
    on location.business_id = code.business_id and location.id = code.location_id
   and location.status <> 'archived'
  where code.public_token = p_public_token and code.status = 'active'
    and destination.active and destination.verified_at is not null
$$;

create function app_private.record_qr_scan(
  p_public_token text,
  p_anonymous_visitor_hash bytea,
  p_placement_key text,
  p_referrer_host text,
  p_device_family text,
  p_country_code text
)
returns table (scan_event_id uuid, destination_url text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_flow record; v_scan_id uuid;
begin
  if p_anonymous_visitor_hash is null or length(p_anonymous_visitor_hash) < 16 then
    raise exception 'privacy-safe visitor hash required';
  end if;
  select * into strict v_flow from app_private.resolve_qr_review_flow(p_public_token);
  insert into public.qr_scan_events (
    business_id, qr_code_id, anonymous_visitor_hash, placement_key,
    referrer_host, device_family, country_code
  ) values (
    v_flow.business_id, v_flow.qr_code_id, p_anonymous_visitor_hash,
    nullif(left(p_placement_key, 80), ''), nullif(left(p_referrer_host, 255), ''),
    nullif(left(p_device_family, 80), ''), upper(nullif(p_country_code, ''))
  ) returning id into v_scan_id;
  return query select v_scan_id, v_flow.destination_url;
end
$$;

create or replace function app_private.lookup_login_credential(p_email text)
returns table (
  user_id uuid, email text, display_name text, password_hash text,
  mfa_required boolean, disabled boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select users.id, users.email, users.display_name, credentials.password_hash,
    users.mfa_required, users.disabled_at is not null
  from public.users users
  join app_private.auth_credentials credentials on credentials.user_id = users.id
  where lower(btrim(users.email)) = lower(btrim(p_email))
    and (credentials.locked_until is null or credentials.locked_until <= statement_timestamp())
$$;

create or replace function app_private.record_login_result(p_email text, p_succeeded boolean)
returns void
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  update app_private.auth_credentials credentials
  set failed_attempts = case when p_succeeded then 0 else credentials.failed_attempts + 1 end,
      locked_until = case
        when p_succeeded then null
        when credentials.failed_attempts + 1 < 5 then credentials.locked_until
        else statement_timestamp() + make_interval(
          secs => least(3600, 300 * power(2, least(credentials.failed_attempts + 1 - 5, 4)))
        )
      end,
      updated_at = statement_timestamp()
  from public.users app_user
  where credentials.user_id = app_user.id
    and lower(btrim(app_user.email)) = lower(btrim(p_email))
$$;

create or replace function app_private.issue_auth_session(
  p_user_id uuid, p_token_hash bytea, p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz, p_ip_hash bytea, p_user_agent_family text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_id uuid;
begin
  if p_token_hash is null or length(p_token_hash) <> 32 then
    raise exception 'session token hash must be 32 bytes';
  end if;
  if p_idle_expires_at <= statement_timestamp()
     or p_absolute_expires_at <= statement_timestamp()
     or p_idle_expires_at > p_absolute_expires_at
     or p_absolute_expires_at > statement_timestamp() + interval '30 days' then
    raise exception 'invalid session expiry bounds';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and disabled_at is null) then
    raise exception 'user unavailable';
  end if;
  insert into app_private.auth_sessions (
    user_id, token_hash, idle_expires_at, absolute_expires_at, ip_hash, user_agent_family
  ) values (
    p_user_id, p_token_hash, p_idle_expires_at, p_absolute_expires_at, p_ip_hash, left(p_user_agent_family, 80)
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function app_private.resolve_auth_session(p_token_hash bytea)
returns table (
  session_id uuid, user_id uuid, email text, display_name text,
  agency_id uuid, business_id uuid, platform_role text,
  mfa_verified_at timestamptz, step_up_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_session app_private.auth_sessions%rowtype;
begin
  select session.* into v_session
  from app_private.auth_sessions session
  join public.users users on users.id = session.user_id and users.disabled_at is null
  where session.token_hash = p_token_hash
    and session.revoked_at is null
    and session.idle_expires_at > statement_timestamp()
    and session.absolute_expires_at > statement_timestamp()
  for update of session;
  if not found then return; end if;

  if v_session.last_seen_at < statement_timestamp() - interval '5 minutes' then
    update app_private.auth_sessions
    set last_seen_at = statement_timestamp(),
        idle_expires_at = least(absolute_expires_at, statement_timestamp() + interval '12 hours')
    where id = v_session.id;
  end if;

  return query
  select v_session.id, users.id, users.email, users.display_name,
    agency_membership.agency_id,
    business_membership.business_id,
    case when agency_membership.user_id is not null then 'agency_admin' else 'business_owner' end,
    v_session.mfa_verified_at, v_session.step_up_verified_at
  from public.users users
  left join lateral (
    select membership.agency_id, membership.user_id
    from public.agency_memberships membership
    where membership.user_id = users.id and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by membership.created_at limit 1
  ) agency_membership on true
  left join lateral (
    select membership.business_id
    from public.business_memberships membership
    where membership.user_id = users.id and membership.status = 'active'
    order by membership.created_at limit 1
  ) business_membership on true
  where users.id = v_session.user_id;
end
$$;

create or replace function app_private.revoke_auth_session(
  p_session_id uuid, p_token_hash bytea, p_reason text
)
returns void
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  update app_private.auth_sessions
  set revoked_at = coalesce(revoked_at, statement_timestamp()),
      revoke_reason = coalesce(revoke_reason, left(p_reason, 200))
  where id = p_session_id and token_hash = p_token_hash
$$;

create or replace function app_private.set_request_context_from_session(
  p_token_hash bytea, p_support_session_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_session record;
begin
  select * into strict v_session from app_private.resolve_auth_session(p_token_hash);
  perform set_config('app.auth_session_id', v_session.session_id::text, true);
  perform set_config('app.auth_session_token_hash', encode(p_token_hash, 'hex'), true);
  -- Legacy identity settings are deliberately blanked. Authorization helpers
  -- derive these values from the authenticated session row above.
  perform set_config('app.user_id', '', true);
  perform set_config('app.mfa_verified_at', '', true);
  perform set_config('app.step_up_verified_at', '', true);
  perform set_config('app.support_session_id', coalesce(p_support_session_id::text, ''), true);
  if app_private.current_user_id() is distinct from v_session.user_id then
    raise exception 'failed to bind authenticated database context';
  end if;
  if p_support_session_id is not null
     and not exists (
       select 1 from public.support_sessions support_session
       where support_session.id = p_support_session_id
         and support_session.actor_user_id = v_session.user_id
         and support_session.ended_at is null
         and support_session.revoked_at is null
         and support_session.expires_at > statement_timestamp()
     ) then
    raise exception 'support session is not active for authenticated actor';
  end if;
  return v_session.user_id;
end
$$;

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
  v_actor_id uuid := case when p_actor_type = 'user' then app_private.current_user_id() end;
  v_auth_session_id uuid := case when p_actor_type = 'user' then app_private.current_auth_session_id() end;
begin
  if p_correlation_id is null then raise exception 'correlation_id is required'; end if;
  if length(trim(p_action)) = 0 or length(trim(p_target_type)) = 0 then
    raise exception 'audit action and target_type are required';
  end if;
  if p_actor_type = 'user' and (v_actor_id is null or v_auth_session_id is null) then
    raise exception 'authenticated session required for user audit event';
  end if;

  if p_business_id is not null then
    select business.agency_id into strict v_business_agency_id
    from public.businesses business where business.id = p_business_id;
    if v_agency_id is null then
      v_agency_id := v_business_agency_id;
    elsif v_agency_id <> v_business_agency_id then
      raise exception 'audit agency and business do not match';
    end if;
  end if;

  insert into public.audit_events (
    actor_user_id, auth_session_id, actor_type, effective_agency_id,
    effective_business_id, effective_location_id, support_session_id,
    action, target_type, target_id, outcome, reason, correlation_id,
    changed_fields, redacted_metadata
  ) values (
    v_actor_id, v_auth_session_id, p_actor_type, v_agency_id,
    p_business_id, p_location_id, p_support_session_id,
    trim(p_action), trim(p_target_type), p_target_id, p_outcome, p_reason,
    p_correlation_id, coalesce(p_changed_fields, '{}'::text[]),
    coalesce(p_redacted_metadata, '{}'::jsonb)
  ) returning id into v_event_id;
  return v_event_id;
end
$$;

create or replace function app_private.next_permitted_send_at(
  p_business_id uuid, p_location_id uuid, p_channel public.channel_kind, p_after timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_policy public.location_messaging_policies%rowtype;
  v_candidate timestamptz := greatest(p_after, statement_timestamp());
  v_local timestamp;
  v_day integer;
  v_try integer;
begin
  select * into strict v_policy from public.location_messaging_policies
  where business_id = p_business_id and location_id = p_location_id and channel = p_channel and enabled;
  for v_try in 1..8 loop
    v_local := v_candidate at time zone v_policy.timezone;
    v_day := extract(isodow from v_local)::integer;
    if v_day = any(v_policy.allowed_weekdays)
       and v_local::time >= v_policy.send_window_start
       and v_local::time < v_policy.send_window_end then
      return v_candidate;
    end if;
    if v_day = any(v_policy.allowed_weekdays) and v_local::time < v_policy.send_window_start then
      v_candidate := (v_local::date + v_policy.send_window_start) at time zone v_policy.timezone;
    else
      v_candidate := ((v_local::date + 1) + v_policy.send_window_start) at time zone v_policy.timezone;
    end if;
  end loop;
  raise exception 'no permitted send window found';
end
$$;

create or replace function app_private.create_manual_completed_job(
  p_business_id uuid,
  p_location_id uuid,
  p_external_job_id text,
  p_service_label text,
  p_completed_at timestamptz,
  p_customer_reference text,
  p_first_name_ciphertext bytea,
  p_first_name_nonce bytea,
  p_first_name_tag bytea,
  p_phone_ciphertext bytea,
  p_phone_nonce bytea,
  p_phone_tag bytea,
  p_phone_hash bytea,
  p_email_ciphertext bytea,
  p_email_nonce bytea,
  p_email_tag bytea,
  p_email_hash bytea,
  p_channel public.channel_kind,
  p_destination_hash bytea,
  p_template_version_id uuid,
  p_consent_status public.consent_status,
  p_consent_wording text,
  p_consent_wording_version text,
  p_consent_purpose text,
  p_consent_captured_at timestamptz,
  p_consent_source text,
  p_transaction_reference text,
  p_evidence_reference text,
  p_payload_destination_ciphertext bytea,
  p_payload_destination_nonce bytea,
  p_payload_destination_tag bytea,
  p_payload_body_ciphertext bytea,
  p_payload_body_nonce bytea,
  p_payload_body_tag bytea,
  p_payload_subject_ciphertext bytea,
  p_payload_subject_nonce bytea,
  p_payload_subject_tag bytea,
  p_correlation_id uuid
)
returns table (review_request_id uuid, request_status public.review_request_status, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_customer_id uuid;
  v_job_id uuid;
  v_consent_id uuid;
  v_template public.message_template_versions%rowtype;
  v_policy public.location_messaging_policies%rowtype;
  v_request_id uuid;
  v_request_status public.review_request_status;
  v_message_job_id uuid;
  v_existing record;
  v_agency_id uuid;
  v_block_reason text;
begin
  if not app_private.can_manage_business(p_business_id) then
    raise exception 'business management permission required';
  end if;
  if p_correlation_id is null then raise exception 'correlation id required'; end if;
  if not exists (
    select 1 from public.locations location
    where location.business_id = p_business_id and location.id = p_location_id and location.status = 'active'
  ) then raise exception 'active tenant location required'; end if;

  select request.id, request.status into v_existing
  from public.completed_jobs job
  left join public.review_requests request
    on request.business_id = job.business_id and request.completed_job_id = job.id
  where job.business_id = p_business_id and job.source = 'manual' and job.external_job_id = p_external_job_id;
  if found then
    return query select v_existing.id, coalesce(v_existing.status, 'blocked'::public.review_request_status), true;
    return;
  end if;

  insert into public.customer_contacts (
    business_id, location_id, customer_reference,
    first_name_ciphertext, first_name_nonce, first_name_tag,
    phone_ciphertext, phone_nonce, phone_tag, phone_hash,
    email_ciphertext, email_nonce, email_tag, email_hash,
    retention_until
  ) values (
    p_business_id, p_location_id, p_customer_reference,
    p_first_name_ciphertext, p_first_name_nonce, p_first_name_tag,
    p_phone_ciphertext, p_phone_nonce, p_phone_tag, p_phone_hash,
    p_email_ciphertext, p_email_nonce, p_email_tag, p_email_hash,
    statement_timestamp() + interval '24 months'
  )
  on conflict (business_id, customer_reference) do update
  set updated_at = statement_timestamp()
  returning id into v_customer_id;

  insert into public.consent_records (
    business_id, location_id, customer_reference, channel, status,
    wording, wording_version, purpose, captured_at, source,
    transaction_reference, evidence_reference
  ) values (
    p_business_id, p_location_id, p_customer_reference, p_channel, p_consent_status,
    p_consent_wording, p_consent_wording_version, p_consent_purpose,
    p_consent_captured_at, p_consent_source, p_transaction_reference, p_evidence_reference
  ) returning id into v_consent_id;

  insert into public.completed_jobs (
    business_id, location_id, customer_id, source, external_job_id,
    service_label, completed_at, status, block_reason_code
  ) values (
    p_business_id, p_location_id, v_customer_id, 'manual', p_external_job_id,
    p_service_label, p_completed_at,
    case when p_consent_status = 'granted'
      then 'eligible'::public.completed_job_status
      else 'blocked'::public.completed_job_status
    end,
    case when p_consent_status = 'granted' then null else 'consent_not_granted' end
  ) returning id into v_job_id;

  if p_template_version_id is not null then
    select * into v_template
    from public.message_template_versions template
    where template.business_id = p_business_id and template.location_id = p_location_id
      and template.id = p_template_version_id and template.channel = p_channel;
    if v_template.id is null then
      raise exception 'template version does not belong to tenant location and channel';
    end if;
  end if;

  select * into v_policy
  from public.location_messaging_policies policy
  where policy.business_id = p_business_id and policy.location_id = p_location_id
    and policy.channel = p_channel;

  if p_consent_status <> 'granted' then
    v_block_reason := 'consent_not_granted';
  elsif v_template.id is null then
    v_block_reason := 'approved_template_missing';
  elsif v_template.retired_at is not null
        or not v_template.includes_business_identity
        or not v_template.includes_unsubscribe then
    v_block_reason := 'approved_template_unavailable';
  elsif v_policy.location_id is null then
    v_block_reason := 'messaging_policy_missing';
  elsif not v_policy.enabled then
    v_block_reason := 'messaging_policy_disabled';
  elsif not exists (
    select 1 from public.google_profile_locations google_location
    join public.integration_connections integration
      on integration.business_id = google_location.business_id
     and integration.id = google_location.integration_id
    where google_location.business_id = p_business_id
      and google_location.location_id = p_location_id
      and google_location.review_uri is not null
      and app_private.is_allowed_google_review_url(google_location.review_uri)
      and integration.disabled_at is null
      and integration.health not in ('authentication_required', 'permission_revoked', 'disabled')
  ) then
    v_block_reason := 'google_review_destination_unavailable';
  end if;
  v_request_status := case when v_block_reason is null
    then 'scheduled'::public.review_request_status
    else 'blocked'::public.review_request_status
  end;

  update public.completed_jobs
  set status = case when v_request_status = 'scheduled'
        then 'eligible'::public.completed_job_status
        else 'blocked'::public.completed_job_status
      end,
      block_reason_code = v_block_reason,
      updated_at = statement_timestamp()
  where business_id = p_business_id and id = v_job_id;

  insert into public.review_requests (
    business_id, location_id, completed_job_id, customer_id, consent_record_id,
    template_version_id, channel, destination_hash, automation_key, status,
    max_messages, next_send_at, started_at, stop_reason
  ) values (
    p_business_id, p_location_id, v_job_id, v_customer_id, v_consent_id,
    v_template.id, p_channel, p_destination_hash, 'google-review-v1', v_request_status,
    coalesce(v_policy.max_messages_per_request, 1),
    case when v_request_status = 'scheduled' then app_private.next_permitted_send_at(p_business_id, p_location_id, p_channel, statement_timestamp()) end,
    case when v_request_status = 'scheduled' then statement_timestamp() end,
    v_block_reason
  ) returning id into v_request_id;

  if v_request_status = 'scheduled' then
    update public.completed_jobs set status = 'enrolled', updated_at = statement_timestamp() where id = v_job_id;
    insert into public.message_jobs (
      business_id, location_id, channel, provider, automation_key,
      deduplication_key, run_at, review_request_id, sequence_number,
      destination_hash, destination_hash_version, template_version_id
    ) values (
      p_business_id, p_location_id, p_channel,
      case when p_channel = 'sms' then 'twilio' else 'sendgrid' end,
      'google-review-v1', 'review:' || v_request_id::text || ':1',
      app_private.next_permitted_send_at(p_business_id, p_location_id, p_channel, statement_timestamp()),
      v_request_id, 1, p_destination_hash, 1, v_template.id
    ) returning id into v_message_job_id;

    insert into app_private.message_dispatch_payloads (
      business_id, message_job_id,
      destination_ciphertext, destination_nonce, destination_tag,
      body_ciphertext, body_nonce, body_tag,
      subject_ciphertext, subject_nonce, subject_tag, expires_at
    ) values (
      p_business_id, v_message_job_id,
      p_payload_destination_ciphertext, p_payload_destination_nonce, p_payload_destination_tag,
      p_payload_body_ciphertext, p_payload_body_nonce, p_payload_body_tag,
      p_payload_subject_ciphertext, p_payload_subject_nonce, p_payload_subject_tag,
      statement_timestamp() + interval '90 days'
    );
  end if;

  select agency_id into v_agency_id from public.businesses where id = p_business_id;
  perform app_private.write_audit_event(
    'user', v_agency_id, p_business_id, p_location_id,
    app_private.current_support_session_id(),
    case when v_request_status = 'blocked' then 'campaign.enrolment.blocked' else 'completed_job.create' end,
    'review_request', v_request_id::text,
    case when v_request_status = 'blocked' then 'blocked'::public.audit_outcome else 'completed'::public.audit_outcome end,
    case when v_request_status = 'blocked' then 'Review request blocked: ' || v_block_reason else 'Eligible completed job enrolled' end,
    p_correlation_id, array['status'], jsonb_build_object('channel', p_channel)
  );

  return query select v_request_id, v_request_status, false;
end
$$;

create or replace function app_private.store_google_oauth_state(
  p_business_id uuid,
  p_location_id uuid,
  p_state_hash bytea,
  p_verifier_ciphertext bytea,
  p_verifier_nonce bytea,
  p_verifier_tag bytea,
  p_expires_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_actor uuid := app_private.current_user_id();
begin
  if v_actor is null or not app_private.can_manage_business(p_business_id) then
    raise exception 'business configuration permission required';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.business_id = p_business_id and location.id = p_location_id
      and location.status <> 'archived'
  ) then raise exception 'location does not belong to business'; end if;
  if length(p_state_hash) <> 32 or length(p_verifier_nonce) <> 12 or length(p_verifier_tag) <> 16 then
    raise exception 'invalid OAuth state cryptographic material';
  end if;
  if p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '10 minutes' then
    raise exception 'OAuth state expiry must be within 10 minutes';
  end if;

  delete from app_private.oauth_authorization_states
  where expires_at <= statement_timestamp();
  insert into app_private.oauth_authorization_states (
    state_hash, actor_user_id, business_id, location_id,
    verifier_ciphertext, verifier_nonce, verifier_tag, expires_at
  ) values (
    p_state_hash, v_actor, p_business_id, p_location_id,
    p_verifier_ciphertext, p_verifier_nonce, p_verifier_tag, p_expires_at
  );
end
$$;

create or replace function app_private.consume_google_oauth_state(p_state_hash bytea)
returns table (
  actor_user_id uuid, business_id uuid, location_id uuid,
  verifier_ciphertext bytea, verifier_nonce bytea, verifier_tag bytea
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if length(p_state_hash) <> 32 then return; end if;
  return query
  update app_private.oauth_authorization_states oauth_state
  set consumed_at = statement_timestamp()
  where oauth_state.state_hash = p_state_hash
    and oauth_state.consumed_at is null
    and oauth_state.expires_at > statement_timestamp()
  returning oauth_state.actor_user_id, oauth_state.business_id, oauth_state.location_id,
    oauth_state.verifier_ciphertext, oauth_state.verifier_nonce, oauth_state.verifier_tag;
end
$$;

create or replace function app_private.store_google_profile_selection_state_for_actor(
  p_actor_user_id uuid,
  p_business_id uuid,
  p_location_id uuid,
  p_token_hash bytea,
  p_candidates_ciphertext bytea,
  p_candidates_nonce bytea,
  p_candidates_tag bytea,
  p_expires_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1
    from app_private.oauth_authorization_states oauth_state
    where oauth_state.actor_user_id = p_actor_user_id
      and oauth_state.business_id = p_business_id
      and oauth_state.location_id = p_location_id
      and oauth_state.consumed_at > statement_timestamp() - interval '10 minutes'
  ) then
    raise exception 'recent exact-actor Google authorization required';
  end if;
  if length(p_token_hash) <> 32 or length(p_candidates_nonce) <> 12 or length(p_candidates_tag) <> 16 then
    raise exception 'invalid profile-selection cryptographic material';
  end if;
  if p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '10 minutes' then
    raise exception 'profile-selection state expiry must be within 10 minutes';
  end if;
  insert into app_private.google_profile_selection_states (
    token_hash, actor_user_id, business_id, location_id,
    candidates_ciphertext, candidates_nonce, candidates_tag, expires_at
  ) values (
    p_token_hash, p_actor_user_id, p_business_id, p_location_id,
    p_candidates_ciphertext, p_candidates_nonce, p_candidates_tag, p_expires_at
  );
end
$$;

-- Compatibility-only inference wrapper. No application role receives EXECUTE;
-- concurrent OAuth callbacks must use the exact-actor function above.
create or replace function app_private.store_google_profile_selection_state(
  p_business_id uuid,
  p_location_id uuid,
  p_token_hash bytea,
  p_candidates_ciphertext bytea,
  p_candidates_nonce bytea,
  p_candidates_tag bytea,
  p_expires_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_actor uuid;
begin
  select oauth_state.actor_user_id into strict v_actor
  from app_private.oauth_authorization_states oauth_state
  where oauth_state.business_id = p_business_id and oauth_state.location_id = p_location_id
    and oauth_state.consumed_at > statement_timestamp() - interval '10 minutes'
  order by oauth_state.consumed_at desc limit 1 for update;
  perform app_private.store_google_profile_selection_state_for_actor(
    v_actor, p_business_id, p_location_id, p_token_hash,
    p_candidates_ciphertext, p_candidates_nonce, p_candidates_tag, p_expires_at
  );
end
$$;

create or replace function app_private.peek_google_profile_selection_state(p_token_hash bytea)
returns table (
  business_id uuid, location_id uuid,
  candidates_ciphertext bytea, candidates_nonce bytea, candidates_tag bytea
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select selection_state.business_id, selection_state.location_id,
    selection_state.candidates_ciphertext, selection_state.candidates_nonce, selection_state.candidates_tag
  from app_private.google_profile_selection_states selection_state
  where length(p_token_hash) = 32
    and selection_state.token_hash = p_token_hash
    and selection_state.actor_user_id = app_private.current_user_id()
    and selection_state.consumed_at is null
    and selection_state.expires_at > statement_timestamp()
$$;

create or replace function app_private.consume_google_profile_selection_state(p_token_hash bytea)
returns table (
  business_id uuid, location_id uuid,
  candidates_ciphertext bytea, candidates_nonce bytea, candidates_tag bytea
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if length(p_token_hash) <> 32 or app_private.current_user_id() is null then return; end if;
  return query
  update app_private.google_profile_selection_states selection_state
  set consumed_at = statement_timestamp()
  where selection_state.token_hash = p_token_hash
    and selection_state.actor_user_id = app_private.current_user_id()
    and selection_state.consumed_at is null
    and selection_state.expires_at > statement_timestamp()
  returning selection_state.business_id, selection_state.location_id,
    selection_state.candidates_ciphertext, selection_state.candidates_nonce, selection_state.candidates_tag;
end
$$;

create or replace function app_private.save_google_connection_for_actor(
  p_actor_user_id uuid,
  p_business_id uuid,
  p_location_id uuid,
  p_account_resource_name text,
  p_location_resource_name text,
  p_review_uri text,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_access_token_tag bytea,
  p_refresh_token_ciphertext bytea,
  p_refresh_token_nonce bytea,
  p_refresh_token_tag bytea,
  p_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := p_actor_user_id;
  v_agency_id uuid;
  v_integration_id uuid := gen_random_uuid();
  v_existing public.google_profile_locations%rowtype;
  v_destination_id uuid;
begin
  if v_actor is null or not exists (
    select 1
    from app_private.oauth_authorization_states oauth_state
    where oauth_state.actor_user_id = v_actor
      and oauth_state.business_id = p_business_id and oauth_state.location_id = p_location_id
      and oauth_state.consumed_at > statement_timestamp() - interval '10 minutes'
    union all
    select 1
    from app_private.google_profile_selection_states selection_state
    where selection_state.actor_user_id = v_actor
      and selection_state.business_id = p_business_id and selection_state.location_id = p_location_id
      and selection_state.consumed_at > statement_timestamp() - interval '10 minutes'
  ) then
    raise exception 'recent exact-actor Google authorization required';
  end if;

  select business.agency_id into strict v_agency_id from public.businesses business
  where business.id = p_business_id and business.archived_at is null;
  if not exists (
    select 1 from public.business_memberships membership
    where membership.business_id = p_business_id and membership.user_id = v_actor
      and membership.status = 'active' and membership.role in ('owner', 'admin')
    union all
    select 1 from public.agency_memberships membership
    where membership.agency_id = v_agency_id and membership.user_id = v_actor
      and membership.status = 'active' and membership.role in ('owner', 'admin')
  ) then raise exception 'Google authorization actor no longer manages business'; end if;

  if not exists (
    select 1 from public.locations location
    where location.business_id = p_business_id and location.id = p_location_id
      and location.status <> 'archived'
  ) then raise exception 'active tenant location required'; end if;
  if p_account_resource_name !~ '^accounts/[A-Za-z0-9_-]+$'
     or p_location_resource_name !~ '^(locations/[A-Za-z0-9_-]+|accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+)$' then
    raise exception 'invalid Google resource name';
  end if;
  if not app_private.is_allowed_google_review_url(p_review_uri) then
    raise exception 'validated Google metadata.newReviewUri is required';
  end if;
  if not ('https://www.googleapis.com/auth/business.manage' = any(coalesce(p_granted_scopes, '{}'::text[]))) then
    raise exception 'required Google Business Profile scope was not granted';
  end if;
  if p_token_expires_at <= statement_timestamp()
     or length(p_access_token_nonce) <> 12 or length(p_access_token_tag) <> 16
     or ((p_refresh_token_ciphertext is null) <> (p_refresh_token_nonce is null))
     or ((p_refresh_token_ciphertext is null) <> (p_refresh_token_tag is null))
     or (p_refresh_token_ciphertext is not null and (length(p_refresh_token_nonce) <> 12 or length(p_refresh_token_tag) <> 16)) then
    raise exception 'invalid encrypted Google token set';
  end if;

  insert into public.integration_connections (
    id, business_id, location_id, provider, health, secret_reference, token_expires_at
  ) values (
    v_integration_id, p_business_id, p_location_id, 'google', 'connected',
    'db:app_private.integration_secrets/' || v_integration_id::text, p_token_expires_at
  )
  on conflict (business_id, location_id, provider) do update
  set health = 'connected', disabled_at = null,
      secret_reference = 'db:app_private.integration_secrets/' || public.integration_connections.id::text,
      token_expires_at = excluded.token_expires_at,
      consecutive_failures = 0
  returning id into v_integration_id;

  insert into app_private.integration_secrets (
    business_id, integration_id,
    access_token_ciphertext, access_token_nonce, access_token_tag,
    refresh_token_ciphertext, refresh_token_nonce, refresh_token_tag
  ) values (
    p_business_id, v_integration_id,
    p_access_token_ciphertext, p_access_token_nonce, p_access_token_tag,
    p_refresh_token_ciphertext, p_refresh_token_nonce, p_refresh_token_tag
  )
  on conflict (business_id, integration_id) do update
  set access_token_ciphertext = excluded.access_token_ciphertext,
      access_token_nonce = excluded.access_token_nonce,
      access_token_tag = excluded.access_token_tag,
      refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, integration_secrets.refresh_token_ciphertext),
      refresh_token_nonce = coalesce(excluded.refresh_token_nonce, integration_secrets.refresh_token_nonce),
      refresh_token_tag = coalesce(excluded.refresh_token_tag, integration_secrets.refresh_token_tag),
      updated_at = statement_timestamp();

  select * into v_existing from public.google_profile_locations google_location
  where google_location.location_resource_name = p_location_resource_name for update;
  if v_existing.id is not null
     and (v_existing.business_id <> p_business_id or v_existing.location_id <> p_location_id
          or v_existing.integration_id <> v_integration_id) then
    raise exception 'Google profile is already bound to another tenant location';
  end if;
  if v_existing.id is null then
    select * into v_existing from public.google_profile_locations google_location
    where google_location.business_id = p_business_id
      and google_location.location_id = p_location_id
      and google_location.integration_id = v_integration_id
    for update;
  end if;
  if v_existing.id is null then
    insert into public.google_profile_locations (
      business_id, location_id, integration_id, account_resource_name,
      location_resource_name, review_uri, granted_scopes, token_expires_at
    ) values (
      p_business_id, p_location_id, v_integration_id, p_account_resource_name,
      p_location_resource_name, p_review_uri, p_granted_scopes, p_token_expires_at
    );
  else
    update public.google_profile_locations
    set account_resource_name = p_account_resource_name,
        location_resource_name = p_location_resource_name, review_uri = p_review_uri,
        granted_scopes = p_granted_scopes, token_expires_at = p_token_expires_at,
        sync_lease_owner = null, sync_lease_token = null, sync_leased_until = null,
        next_sync_at = statement_timestamp(), updated_at = statement_timestamp()
    where id = v_existing.id;
  end if;

  update public.review_destinations
  set active = false, updated_at = statement_timestamp()
  where business_id = p_business_id and location_id = p_location_id
    and provider = 'google' and active;
  insert into public.review_destinations (
    business_id, location_id, provider, destination_url, verified_at, verified_by
  ) values (
    p_business_id, p_location_id, 'google', p_review_uri, statement_timestamp(), v_actor
  ) returning id into v_destination_id;
  update public.qr_codes set review_destination_id = v_destination_id
  where business_id = p_business_id and location_id = p_location_id and status = 'active';

  delete from app_private.oauth_authorization_states
  where business_id = p_business_id and location_id = p_location_id and actor_user_id = v_actor;
  delete from app_private.google_profile_selection_states
  where business_id = p_business_id and location_id = p_location_id and actor_user_id = v_actor;
  perform app_private.write_audit_event(
    'system', v_agency_id, p_business_id, p_location_id, null,
    'integration.google.connected', 'integration_connection', v_integration_id::text,
    'completed', 'Google Business Profile authorization completed', gen_random_uuid(),
    array['health', 'token_expires_at'], jsonb_build_object('initiating_user_id', v_actor)
  );
  return v_integration_id;
end
$$;

-- Compatibility-only inference wrapper. No application role receives EXECUTE;
-- concurrent OAuth callbacks must pass the actor recovered from encrypted state.
create or replace function app_private.save_google_connection(
  p_business_id uuid,
  p_location_id uuid,
  p_account_resource_name text,
  p_location_resource_name text,
  p_review_uri text,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_access_token_tag bytea,
  p_refresh_token_ciphertext bytea,
  p_refresh_token_nonce bytea,
  p_refresh_token_tag bytea,
  p_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_actor uuid;
begin
  select recent_authorization.actor_user_id into v_actor
  from (
    select oauth_state.actor_user_id, oauth_state.consumed_at
    from app_private.oauth_authorization_states oauth_state
    where oauth_state.business_id = p_business_id and oauth_state.location_id = p_location_id
      and oauth_state.consumed_at > statement_timestamp() - interval '10 minutes'
    union all
    select selection_state.actor_user_id, selection_state.consumed_at
    from app_private.google_profile_selection_states selection_state
    where selection_state.business_id = p_business_id and selection_state.location_id = p_location_id
      and selection_state.consumed_at > statement_timestamp() - interval '10 minutes'
  ) recent_authorization
  order by recent_authorization.consumed_at desc limit 1;
  if v_actor is null then raise exception 'recent Google authorization required'; end if;
  return app_private.save_google_connection_for_actor(
    v_actor, p_business_id, p_location_id, p_account_resource_name,
    p_location_resource_name, p_review_uri,
    p_access_token_ciphertext, p_access_token_nonce, p_access_token_tag,
    p_refresh_token_ciphertext, p_refresh_token_nonce, p_refresh_token_tag,
    p_token_expires_at, p_granted_scopes
  );
end
$$;

create or replace function app_private.claim_google_review_sync(p_worker_id text, p_limit integer)
returns table (
  integration_id uuid, business_id uuid, location_id uuid,
  account_resource_name text, location_resource_name text, review_uri text,
  access_token_ciphertext bytea, access_token_nonce bytea, access_token_tag bytea,
  refresh_token_ciphertext bytea, refresh_token_nonce bytea, refresh_token_tag bytea,
  token_expires_at timestamptz, granted_scopes text[],
  sync_worker_id text, sync_lease_token uuid
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if p_worker_id is null or length(btrim(p_worker_id)) = 0 then raise exception 'worker id required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'claim limit must be between 1 and 100'; end if;
  return query
  with candidates as (
    select google_location.id
    from public.google_profile_locations google_location
    join public.integration_connections integration
      on integration.business_id = google_location.business_id
     and integration.id = google_location.integration_id
    where google_location.next_sync_at <= statement_timestamp()
      and (google_location.sync_leased_until is null or google_location.sync_leased_until <= statement_timestamp())
      and integration.disabled_at is null
      and integration.health not in ('permission_revoked', 'disabled')
    order by google_location.next_sync_at, google_location.id
    for update of google_location skip locked limit p_limit
  ), leased as (
    update public.google_profile_locations google_location
    set sync_lease_owner = btrim(p_worker_id),
        sync_lease_token = gen_random_uuid(),
        sync_leased_until = statement_timestamp() + interval '5 minutes',
        next_sync_at = statement_timestamp() + interval '15 minutes',
        updated_at = statement_timestamp()
    from candidates where google_location.id = candidates.id
    returning google_location.*
  )
  select leased.integration_id, leased.business_id, leased.location_id,
    leased.account_resource_name, leased.location_resource_name, leased.review_uri,
    secret.access_token_ciphertext, secret.access_token_nonce, secret.access_token_tag,
    secret.refresh_token_ciphertext, secret.refresh_token_nonce, secret.refresh_token_tag,
    leased.token_expires_at, leased.granted_scopes,
    leased.sync_lease_owner, leased.sync_lease_token
  from leased
  join app_private.integration_secrets secret
    on secret.business_id = leased.business_id and secret.integration_id = leased.integration_id;
end
$$;

create or replace function app_private.upsert_google_review(
  p_business_id uuid, p_location_id uuid, p_integration_id uuid,
  p_provider_review_id text, p_reviewer_display_name text, p_rating integer,
  p_body text, p_provider_created_at timestamptz, p_provider_updated_at timestamptz,
  p_reply_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_id uuid; v_existing public.review_records%rowtype;
begin
  if p_rating not between 1 and 5 or p_provider_review_id is null or length(p_provider_review_id) > 500 then
    raise exception 'invalid Google review identity or rating';
  end if;
  if p_provider_created_at > statement_timestamp() + interval '5 minutes'
     or p_provider_updated_at < p_provider_created_at
     or p_provider_updated_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'invalid Google review timestamps';
  end if;
  if not exists (
    select 1 from public.google_profile_locations google_location
    where google_location.business_id = p_business_id and google_location.location_id = p_location_id
      and google_location.integration_id = p_integration_id
      and google_location.sync_leased_until > statement_timestamp()
      and google_location.sync_lease_token is not null
  ) then raise exception 'Google review tenant mapping is not registered'; end if;

  select * into v_existing from public.review_records review
  where review.business_id = p_business_id and review.provider = 'google'
    and review.provider_review_id = p_provider_review_id for update;
  if v_existing.id is not null
     and (v_existing.location_id <> p_location_id or v_existing.integration_id <> p_integration_id) then
    raise exception 'Google review identity is already bound to another tenant location';
  end if;

  insert into public.review_records (
    business_id, location_id, integration_id, provider, provider_review_id,
    reviewer_display_name, rating, body, reply_body,
    provider_created_at, provider_updated_at, cache_expires_at
  ) values (
    p_business_id, p_location_id, p_integration_id, 'google', p_provider_review_id,
    coalesce(nullif(p_reviewer_display_name, ''), 'Google user'), p_rating, coalesce(p_body, ''), p_reply_body,
    p_provider_created_at, p_provider_updated_at, statement_timestamp() + interval '30 days'
  )
  on conflict (business_id, provider, provider_review_id) do update
  set reviewer_display_name = excluded.reviewer_display_name,
      rating = excluded.rating, body = excluded.body, reply_body = excluded.reply_body,
      provider_created_at = excluded.provider_created_at,
      provider_updated_at = excluded.provider_updated_at,
      last_seen_at = statement_timestamp(),
      cache_expires_at = statement_timestamp() + interval '30 days',
      removed_at = null
  returning id into v_id;

  return v_id;
end
$$;

create or replace function app_private.save_refreshed_google_token(
  p_integration_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_access_token_tag bytea,
  p_refresh_token_ciphertext bytea,
  p_refresh_token_nonce bytea,
  p_refresh_token_tag bytea,
  p_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_location public.google_profile_locations%rowtype;
begin
  select google_location.* into strict v_location
  from public.google_profile_locations google_location
  join public.integration_connections integration
    on integration.business_id = google_location.business_id
   and integration.id = google_location.integration_id
   and integration.disabled_at is null
  where google_location.integration_id = p_integration_id
    and google_location.sync_lease_owner = p_worker_id
    and google_location.sync_lease_token = p_lease_token
    and google_location.sync_leased_until > statement_timestamp()
    and google_location.sync_lease_owner is not null
  for update of google_location;
  if p_token_expires_at <= statement_timestamp()
     or length(p_access_token_nonce) <> 12 or length(p_access_token_tag) <> 16
     or ((p_refresh_token_ciphertext is null) <> (p_refresh_token_nonce is null))
     or ((p_refresh_token_ciphertext is null) <> (p_refresh_token_tag is null))
     or (p_refresh_token_ciphertext is not null and (length(p_refresh_token_nonce) <> 12 or length(p_refresh_token_tag) <> 16)) then
    raise exception 'invalid encrypted refreshed Google token set';
  end if;
  if not ('https://www.googleapis.com/auth/business.manage' = any(coalesce(p_granted_scopes, '{}'::text[]))) then
    raise exception 'required Google Business Profile scope was not granted';
  end if;
  update app_private.integration_secrets
  set access_token_ciphertext = p_access_token_ciphertext,
      access_token_nonce = p_access_token_nonce,
      access_token_tag = p_access_token_tag,
      refresh_token_ciphertext = coalesce(p_refresh_token_ciphertext, refresh_token_ciphertext),
      refresh_token_nonce = coalesce(p_refresh_token_nonce, refresh_token_nonce),
      refresh_token_tag = coalesce(p_refresh_token_tag, refresh_token_tag),
      updated_at = statement_timestamp()
  where business_id = v_location.business_id and integration_id = p_integration_id;
  if not found then raise exception 'Google integration secret is unavailable'; end if;
  update public.google_profile_locations
  set token_expires_at = p_token_expires_at, granted_scopes = p_granted_scopes,
      updated_at = statement_timestamp()
  where id = v_location.id;
  update public.integration_connections
  set token_expires_at = p_token_expires_at, health = 'healthy', consecutive_failures = 0
  where business_id = v_location.business_id and id = p_integration_id;
end
$$;

create or replace function app_private.finish_google_review_sync(
  p_integration_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text,
  p_seen_review_ids text[]
)
returns public.integration_health
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_location public.google_profile_locations%rowtype;
  v_failures integer;
  v_health public.integration_health;
begin
  select google_location.* into strict v_location
  from public.google_profile_locations google_location
  where google_location.integration_id = p_integration_id
  for update;
  if v_location.sync_lease_owner is null
     or v_location.sync_lease_owner is distinct from p_worker_id
     or v_location.sync_lease_token is distinct from p_lease_token
     or v_location.sync_leased_until is null
     or v_location.sync_leased_until <= statement_timestamp() then
    raise exception 'worker does not hold Google sync lease';
  end if;

  if p_succeeded then
    if p_seen_review_ids is null or cardinality(p_seen_review_ids) > 10000 then
      raise exception 'successful canonical sync requires a bounded review id set';
    end if;
    delete from public.review_records review
    where review.business_id = v_location.business_id
      and review.location_id = v_location.location_id
      and review.integration_id = v_location.integration_id
      and not (review.provider_review_id = any(p_seen_review_ids));
    update public.google_profile_locations
    set last_synced_at = statement_timestamp(), consecutive_failures = 0,
        sync_lease_owner = null, sync_lease_token = null, sync_leased_until = null,
        next_sync_at = case
          when next_sync_at <= statement_timestamp() then statement_timestamp()
          else statement_timestamp() + interval '15 minutes'
        end,
        updated_at = statement_timestamp()
    where id = v_location.id;
    update public.integration_connections
    set health = 'healthy', last_sync_at = statement_timestamp(),
        consecutive_failures = 0
    where business_id = v_location.business_id and id = p_integration_id;
    return 'healthy'::public.integration_health;
  end if;

  v_failures := v_location.consecutive_failures + 1;
  v_health := case
    when coalesce(p_error, '') ~* '(invalid_grant|unauthori[sz]ed|permission)' then 'authentication_required'::public.integration_health
    when coalesce(p_error, '') ~* '(rate|quota|429)' then 'rate_limited'::public.integration_health
    when v_failures >= 3 then 'failing'::public.integration_health
    else 'delayed'::public.integration_health
  end;
  update public.google_profile_locations
  set consecutive_failures = v_failures,
      sync_lease_owner = null, sync_lease_token = null, sync_leased_until = null,
      next_sync_at = statement_timestamp() + make_interval(
        secs => least(21600, 60 * power(2, least(v_failures, 8)))
      ),
      updated_at = statement_timestamp()
  where id = v_location.id;
  update public.integration_connections
  set health = v_health, consecutive_failures = v_failures
  where business_id = v_location.business_id and id = p_integration_id;
  return v_health;
end
$$;

create or replace function app_private.request_google_review_sync(
  p_business_id uuid,
  p_correlation_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_count integer; v_agency_id uuid;
begin
  if p_correlation_id is null then raise exception 'correlation id required'; end if;
  if not app_private.can_manage_business(p_business_id) then
    raise exception 'business configuration permission required';
  end if;
  update public.google_profile_locations google_location
  set next_sync_at = least(google_location.next_sync_at, statement_timestamp()),
      updated_at = statement_timestamp()
  from public.integration_connections integration
  where google_location.business_id = p_business_id
    and integration.business_id = google_location.business_id
    and integration.id = google_location.integration_id
    and integration.disabled_at is null;
  get diagnostics v_count = row_count;
  select agency_id into strict v_agency_id from public.businesses where id = p_business_id;
  perform app_private.write_audit_event(
    'user', v_agency_id, p_business_id, null, app_private.current_support_session_id(),
    'integration.google.sync.request', 'business', p_business_id::text,
    'completed', 'Authorized Google review sync requested', p_correlation_id,
    array['next_sync_at'], jsonb_build_object('connection_count', v_count)
  );
  return v_count;
end
$$;

create or replace function app_private.disconnect_google_connection(
  p_business_id uuid,
  p_location_id uuid,
  p_correlation_id uuid
)
returns table (
  revocation_id uuid,
  integration_id uuid,
  token_kind text,
  token_ciphertext bytea,
  token_nonce bytea,
  token_tag bytea,
  key_version smallint
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_integration public.integration_connections%rowtype;
  v_secret app_private.integration_secrets%rowtype;
  v_revocation app_private.oauth_token_revocations%rowtype;
  v_agency_id uuid;
begin
  if p_correlation_id is null then raise exception 'correlation id required'; end if;
  if not app_private.can_manage_business(p_business_id) then
    raise exception 'business configuration permission required';
  end if;
  select integration.* into strict v_integration
  from public.integration_connections integration
  where integration.business_id = p_business_id and integration.location_id = p_location_id
    and integration.provider = 'google'
  for update;

  if v_integration.disabled_at is not null then
    select revocation.* into v_revocation
    from app_private.oauth_token_revocations revocation
    where revocation.integration_id = v_integration.id and revocation.status in ('pending', 'leased')
    order by revocation.created_at desc limit 1;
  else
    select secret.* into strict v_secret from app_private.integration_secrets secret
    where secret.business_id = p_business_id and secret.integration_id = v_integration.id
    for update;
    insert into app_private.oauth_token_revocations (
      provider, business_id, location_id, integration_id, token_kind,
      token_ciphertext, token_nonce, token_tag, key_version, expires_at
    ) values (
      'google', p_business_id, p_location_id, v_integration.id,
      case when v_secret.refresh_token_ciphertext is not null then 'refresh' else 'access' end,
      coalesce(v_secret.refresh_token_ciphertext, v_secret.access_token_ciphertext),
      coalesce(v_secret.refresh_token_nonce, v_secret.access_token_nonce),
      coalesce(v_secret.refresh_token_tag, v_secret.access_token_tag),
      v_secret.key_version, statement_timestamp() + interval '7 days'
    ) returning * into v_revocation;
  end if;

  update public.integration_connections
  set health = 'disabled', disabled_at = coalesce(disabled_at, statement_timestamp())
  where business_id = p_business_id and id = v_integration.id;
  update public.message_jobs message_job
  set status = 'cancelled', last_error_code = 'google_connection_disconnected'
  from public.review_requests request
  where request.business_id = p_business_id and request.location_id = p_location_id
    and message_job.business_id = request.business_id
    and message_job.review_request_id = request.id
    and message_job.status in ('scheduled', 'retry');
  update public.review_requests
  set status = 'blocked', stopped_at = statement_timestamp(), next_send_at = null,
      stop_reason = 'google_connection_disconnected', updated_at = statement_timestamp()
  where business_id = p_business_id and location_id = p_location_id
    and status in ('scheduled', 'active');
  delete from public.review_records cached_review
  where cached_review.business_id = p_business_id and cached_review.location_id = p_location_id
    and cached_review.integration_id = v_integration.id;
  delete from public.google_profile_locations google_location
  where google_location.business_id = p_business_id and google_location.location_id = p_location_id
    and google_location.integration_id = v_integration.id;
  update public.review_destinations
  set active = false, updated_at = statement_timestamp()
  where business_id = p_business_id and location_id = p_location_id and provider = 'google' and active;
  delete from app_private.integration_secrets secret
  where secret.business_id = p_business_id and secret.integration_id = v_integration.id;
  delete from app_private.oauth_authorization_states
  where business_id = p_business_id and location_id = p_location_id;
  delete from app_private.google_profile_selection_states
  where business_id = p_business_id and location_id = p_location_id;

  select agency_id into strict v_agency_id from public.businesses where id = p_business_id;
  perform app_private.write_audit_event(
    'user', v_agency_id, p_business_id, p_location_id, app_private.current_support_session_id(),
    'integration.google.disconnect', 'integration_connection', v_integration.id::text,
    'completed', 'Google connection disabled and cached API Content removed', p_correlation_id,
    array['health', 'disabled_at'], jsonb_build_object('revocation_queued', v_revocation.id is not null)
  );
  return query select v_revocation.id, v_integration.id, v_revocation.token_kind,
    v_revocation.token_ciphertext, v_revocation.token_nonce, v_revocation.token_tag, v_revocation.key_version;
end
$$;

create or replace function app_private.claim_google_token_revocations(
  p_worker_id text, p_limit integer, p_lease_seconds integer
)
returns table (
  revocation_id uuid, integration_id uuid, business_id uuid, token_kind text,
  token_ciphertext bytea, token_nonce bytea, token_tag bytea,
  key_version smallint, lease_token uuid
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then raise exception 'worker id required'; end if;
  if p_limit not between 1 and 100 or p_lease_seconds not between 15 and 900 then
    raise exception 'invalid revocation claim bounds';
  end if;
  update app_private.oauth_token_revocations
  set status = 'pending', lease_owner = null, lease_token = null, leased_until = null,
      next_attempt_at = statement_timestamp(), last_error = 'worker_lease_expired'
  where status = 'leased' and leased_until <= statement_timestamp();
  return query
  with candidates as (
    select revocation.id from app_private.oauth_token_revocations revocation
    where revocation.status = 'pending' and revocation.next_attempt_at <= statement_timestamp()
      and revocation.expires_at > statement_timestamp()
      and revocation.attempt_count < revocation.max_attempts
    order by revocation.next_attempt_at, revocation.id
    for update skip locked limit p_limit
  ), leased as (
    update app_private.oauth_token_revocations revocation
    set status = 'leased', lease_owner = btrim(p_worker_id), lease_token = gen_random_uuid(),
        leased_until = statement_timestamp() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1
    from candidates where revocation.id = candidates.id
    returning revocation.*
  )
  select leased.id, leased.integration_id, leased.business_id, leased.token_kind, leased.token_ciphertext,
    leased.token_nonce, leased.token_tag, leased.key_version, leased.lease_token
  from leased;
end
$$;

create or replace function app_private.finish_google_token_revocation(
  p_revocation_id uuid, p_worker_id text, p_lease_token uuid,
  p_succeeded boolean, p_error text
)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_revocation app_private.oauth_token_revocations%rowtype; v_status text;
begin
  select * into strict v_revocation from app_private.oauth_token_revocations revocation
  where revocation.id = p_revocation_id for update;
  if v_revocation.status <> 'leased' or v_revocation.lease_owner <> p_worker_id
     or v_revocation.lease_token is distinct from p_lease_token
     or v_revocation.leased_until is null
     or v_revocation.leased_until <= statement_timestamp() then
    raise exception 'worker does not hold token-revocation lease';
  end if;
  if p_succeeded then
    delete from app_private.oauth_token_revocations where id = p_revocation_id;
    return 'completed';
  end if;
  v_status := case when v_revocation.attempt_count >= v_revocation.max_attempts then 'dead' else 'pending' end;
  update app_private.oauth_token_revocations
  set status = v_status, lease_owner = null, lease_token = null, leased_until = null,
      next_attempt_at = statement_timestamp() + make_interval(secs => least(21600, 60 * (2 ^ least(v_revocation.attempt_count, 8)))),
      last_error = left(coalesce(p_error, 'google_token_revocation_failed'), 500)
  where id = p_revocation_id;
  return v_status;
end
$$;

-- Remove the pre-lease draft helper if an earlier development database created
-- it. Token revocations must only complete through the worker's fenced lease.
drop function if exists app_private.complete_google_token_revocation(uuid);

create or replace function app_private.record_message_provider_webhook(
  p_provider text,
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (webhook_event_id uuid, business_id uuid, location_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_outbox public.message_outbox%rowtype;
  v_job public.message_jobs%rowtype;
  v_event app_private.provider_webhook_events%rowtype;
begin
  if p_provider not in ('twilio', 'sendgrid') or length(p_payload_hash) <> 32
     or nullif(btrim(p_provider_event_id), '') is null then
    raise exception 'invalid verified provider event';
  end if;
  select outbox.* into strict v_outbox from public.message_outbox outbox
  where outbox.provider = p_provider and outbox.provider_message_id = p_provider_message_id;
  select message_job.* into strict v_job from public.message_jobs message_job
  where message_job.business_id = v_outbox.business_id and message_job.id = v_outbox.message_job_id;

  insert into app_private.provider_webhook_events (
    provider, provider_event_id, event_type, business_id, location_id,
    message_job_id, payload_hash, encrypted_payload,
    processed_at, processing_status, result_code, expires_at
  ) values (
    p_provider, btrim(p_provider_event_id), left(p_event_type, 120),
    v_job.business_id, v_job.location_id, v_job.id,
    p_payload_hash, p_encrypted_payload,
    statement_timestamp(), 'processed', 'status_recorded', statement_timestamp() + interval '30 days'
  ) on conflict (provider, provider_event_id) do nothing
  returning * into v_event;
  if v_event.id is null then
    select * into strict v_event from app_private.provider_webhook_events event
    where event.provider = p_provider and event.provider_event_id = btrim(p_provider_event_id);
    if v_event.payload_hash <> p_payload_hash then
      raise exception 'provider event id reused with different payload';
    end if;
    return query select v_event.id, v_event.business_id, v_event.location_id, true;
    return;
  end if;
  return query select v_event.id, v_event.business_id, v_event.location_id, false;
end
$$;

create or replace function app_private.record_message_suppression_webhook(
  p_provider text,
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_action text,
  p_reason text,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (webhook_event_id uuid, business_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_outbox public.message_outbox%rowtype;
  v_job public.message_jobs%rowtype;
  v_event app_private.provider_webhook_events%rowtype;
begin
  if p_provider not in ('twilio', 'sendgrid') or p_action not in ('suppress', 'lift')
     or length(p_payload_hash) <> 32 or nullif(btrim(p_provider_event_id), '') is null then
    raise exception 'invalid verified suppression event';
  end if;
  select outbox.* into strict v_outbox from public.message_outbox outbox
  where outbox.provider = p_provider and outbox.provider_message_id = p_provider_message_id;
  select message_job.* into strict v_job from public.message_jobs message_job
  where message_job.business_id = v_outbox.business_id and message_job.id = v_outbox.message_job_id;
  if v_job.destination_hash is null or v_job.destination_hash_version is null then
    raise exception 'message has no suppression-safe destination identity';
  end if;

  insert into app_private.provider_webhook_events (
    provider, provider_event_id, event_type, business_id, location_id,
    message_job_id, payload_hash, encrypted_payload, expires_at
  ) values (
    p_provider, btrim(p_provider_event_id), left(p_event_type, 120),
    v_job.business_id, v_job.location_id, v_job.id,
    p_payload_hash, p_encrypted_payload, statement_timestamp() + interval '30 days'
  ) on conflict (provider, provider_event_id) do nothing returning * into v_event;
  if v_event.id is null then
    select * into strict v_event from app_private.provider_webhook_events event
    where event.provider = p_provider and event.provider_event_id = btrim(p_provider_event_id);
    if v_event.payload_hash <> p_payload_hash then raise exception 'provider event id reused with different payload'; end if;
    return query select v_event.id, v_event.business_id, true; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_job.business_id::text || ':' || v_job.channel::text || ':' || encode(v_job.destination_hash, 'hex'), 0
  ));
  if p_action = 'suppress' then
    if not exists (
      select 1 from public.channel_suppressions suppression
      where suppression.business_id = v_job.business_id and suppression.channel = v_job.channel
        and suppression.hash_version = v_job.destination_hash_version
        and suppression.destination_hash = v_job.destination_hash and suppression.lifted_at is null
    ) then
      insert into public.channel_suppressions (
        business_id, channel, destination_hash, hash_version, reason, source
      ) values (
        v_job.business_id, v_job.channel, v_job.destination_hash, v_job.destination_hash_version,
        left(coalesce(nullif(p_reason, ''), p_event_type), 200), p_provider || ':signed_webhook'
      );
    end if;
  else
    update public.channel_suppressions set lifted_at = statement_timestamp()
    where business_id = v_job.business_id and channel = v_job.channel
      and hash_version = v_job.destination_hash_version
      and destination_hash = v_job.destination_hash and lifted_at is null;
  end if;
  update app_private.provider_webhook_events
  set processed_at = statement_timestamp(), processing_status = 'processed', result_code = p_action
  where id = v_event.id;
  return query select v_event.id, v_job.business_id, false;
end
$$;

create or replace function app_private.record_message_provider_webhook_by_attempt(
  p_provider text,
  p_provider_event_id text,
  p_message_attempt_id uuid,
  p_event_type text,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (webhook_event_id uuid, business_id uuid, location_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_provider_message_id text;
begin
  select outbox.provider_message_id into strict v_provider_message_id
  from public.message_attempts attempt
  join public.message_outbox outbox
    on outbox.business_id = attempt.business_id and outbox.id = attempt.outbox_id
  where attempt.id = p_message_attempt_id and outbox.provider = p_provider;
  if v_provider_message_id is null then raise exception 'attempt has no accepted provider identity'; end if;
  return query select * from app_private.record_message_provider_webhook(
    p_provider, p_provider_event_id, v_provider_message_id, p_event_type,
    p_payload_hash, p_encrypted_payload
  );
end
$$;

create or replace function app_private.record_message_suppression_webhook_by_attempt(
  p_provider text,
  p_provider_event_id text,
  p_message_attempt_id uuid,
  p_event_type text,
  p_action text,
  p_reason text,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (webhook_event_id uuid, business_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_provider_message_id text;
begin
  select outbox.provider_message_id into strict v_provider_message_id
  from public.message_attempts attempt
  join public.message_outbox outbox
    on outbox.business_id = attempt.business_id and outbox.id = attempt.outbox_id
  where attempt.id = p_message_attempt_id and outbox.provider = p_provider;
  if v_provider_message_id is null then raise exception 'attempt has no accepted provider identity'; end if;
  return query select * from app_private.record_message_suppression_webhook(
    p_provider, p_provider_event_id, v_provider_message_id, p_event_type,
    p_action, p_reason, p_payload_hash, p_encrypted_payload
  );
end
$$;

create or replace function app_private.record_integration_suppression_webhook(
  p_provider text,
  p_provider_event_id text,
  p_integration_id uuid,
  p_channel public.channel_kind,
  p_destination_hash bytea,
  p_hash_version smallint,
  p_event_type text,
  p_action text,
  p_reason text,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (webhook_event_id uuid, business_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_integration public.integration_connections%rowtype;
  v_event app_private.provider_webhook_events%rowtype;
begin
  if p_provider not in ('twilio', 'sendgrid') or p_action not in ('suppress', 'lift')
     or length(p_destination_hash) <> 32 or length(p_payload_hash) <> 32 or p_hash_version < 1 then
    raise exception 'invalid verified suppression event';
  end if;
  select integration.* into strict v_integration from public.integration_connections integration
  where integration.id = p_integration_id and integration.provider = p_provider
    and integration.location_id is not null and integration.disabled_at is null;
  insert into app_private.provider_webhook_events (
    provider, provider_event_id, event_type, business_id, location_id, integration_id,
    payload_hash, encrypted_payload, expires_at
  ) values (
    p_provider, btrim(p_provider_event_id), left(p_event_type, 120),
    v_integration.business_id, v_integration.location_id, v_integration.id,
    p_payload_hash, p_encrypted_payload, statement_timestamp() + interval '30 days'
  ) on conflict (provider, provider_event_id) do nothing returning * into v_event;
  if v_event.id is null then
    select * into strict v_event from app_private.provider_webhook_events event
    where event.provider = p_provider and event.provider_event_id = btrim(p_provider_event_id);
    if v_event.payload_hash <> p_payload_hash then raise exception 'provider event id reused with different payload'; end if;
    return query select v_event.id, v_event.business_id, true; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_integration.business_id::text || ':' || p_channel::text || ':' || encode(p_destination_hash, 'hex'), 0
  ));
  if p_action = 'suppress' then
    if not exists (
      select 1 from public.channel_suppressions suppression
      where suppression.business_id = v_integration.business_id and suppression.channel = p_channel
        and suppression.hash_version = p_hash_version and suppression.destination_hash = p_destination_hash
        and suppression.lifted_at is null
    ) then
      insert into public.channel_suppressions (
        business_id, channel, destination_hash, hash_version, reason, source
      ) values (
        v_integration.business_id, p_channel, p_destination_hash, p_hash_version,
        left(coalesce(nullif(p_reason, ''), p_event_type), 200), p_provider || ':signed_webhook'
      );
    end if;
  else
    update public.channel_suppressions set lifted_at = statement_timestamp()
    where business_id = v_integration.business_id and channel = p_channel
      and hash_version = p_hash_version and destination_hash = p_destination_hash and lifted_at is null;
  end if;
  update app_private.provider_webhook_events
  set processed_at = statement_timestamp(), processing_status = 'processed', result_code = p_action
  where id = v_event.id;
  return query select v_event.id, v_integration.business_id, false;
end
$$;

create or replace function app_private.record_google_pubsub_event(
  p_provider_event_id text,
  p_location_resource_name text,
  p_event_type text,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (webhook_event_id uuid, business_id uuid, location_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_location public.google_profile_locations%rowtype;
  v_event app_private.provider_webhook_events%rowtype;
begin
  if p_event_type not in ('NEW_REVIEW', 'UPDATED_REVIEW') or length(p_payload_hash) <> 32
     or nullif(btrim(p_provider_event_id), '') is null then
    raise exception 'invalid verified Google Pub/Sub event';
  end if;
  select google_location.* into strict v_location
  from public.google_profile_locations google_location
  join public.integration_connections integration
    on integration.business_id = google_location.business_id
   and integration.id = google_location.integration_id
   and integration.disabled_at is null
  where google_location.location_resource_name = p_location_resource_name
  for update of google_location;
  insert into app_private.provider_webhook_events (
    provider, provider_event_id, event_type, business_id, location_id, integration_id,
    payload_hash, encrypted_payload, expires_at
  ) values (
    'google', btrim(p_provider_event_id), p_event_type,
    v_location.business_id, v_location.location_id, v_location.integration_id,
    p_payload_hash, p_encrypted_payload, statement_timestamp() + interval '30 days'
  ) on conflict (provider, provider_event_id) do nothing returning * into v_event;
  if v_event.id is null then
    select * into strict v_event from app_private.provider_webhook_events event
    where event.provider = 'google' and event.provider_event_id = btrim(p_provider_event_id);
    if v_event.payload_hash <> p_payload_hash then raise exception 'provider event id reused with different payload'; end if;
    return query select v_event.id, v_event.business_id, v_event.location_id, true; return;
  end if;
  update public.google_profile_locations
  set next_sync_at = least(next_sync_at, statement_timestamp()), updated_at = statement_timestamp()
  where id = v_location.id;
  update app_private.provider_webhook_events
  set processed_at = statement_timestamp(), processing_status = 'processed', result_code = 'sync_scheduled'
  where id = v_event.id;
  return query select v_event.id, v_location.business_id, v_location.location_id, false;
end
$$;

create or replace function app_private.purge_expired_provider_webhooks(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_count integer;
begin
  with expired as (
    select id from app_private.provider_webhook_events
    where expires_at <= statement_timestamp()
    order by expires_at limit least(greatest(p_limit, 1), 5000)
    for update skip locked
  )
  delete from app_private.provider_webhook_events event using expired where event.id = expired.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function app_private.cancel_blocked_message_job(
  p_message_job_id uuid, p_worker_id text, p_lease_token uuid, p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_request_id uuid; v_business_id uuid;
begin
  update public.message_jobs
  set status = 'cancelled', leased_until = null, lease_owner = null, lease_token = null,
      last_error_code = left(p_reason, 120)
  where id = p_message_job_id and status = 'leased'
    and lease_owner = p_worker_id and lease_token = p_lease_token
  returning business_id, review_request_id into v_business_id, v_request_id;
  if not found then raise exception 'worker does not hold this message job'; end if;
  if v_request_id is not null then
    update public.review_requests
    set status = 'blocked', stopped_at = statement_timestamp(),
        next_send_at = null, stop_reason = left(p_reason, 200), updated_at = statement_timestamp()
    where business_id = v_business_id and id = v_request_id and status in ('scheduled', 'active');
  end if;
end
$$;

create or replace function app_private.evaluate_message_dispatch(
  p_message_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns table (decision public.dispatch_decision, reason text, next_allowed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.message_jobs%rowtype;
  v_request public.review_requests%rowtype;
  v_consent public.consent_records%rowtype;
  v_policy public.location_messaging_policies%rowtype;
  v_template public.message_template_versions%rowtype;
  v_next timestamptz;
  v_last_sent timestamptz;
  v_recent_count integer;
begin
  select * into strict v_job from public.message_jobs where id = p_message_job_id for update;
  if v_job.status <> 'leased'
     or v_job.lease_owner <> p_worker_id
     or v_job.lease_token is distinct from p_lease_token
     or v_job.leased_until <= statement_timestamp() then
    raise exception 'worker does not hold an active matching lease';
  end if;
  if v_job.review_request_id is null then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'unlinked_review_request');
    return query select 'block'::public.dispatch_decision, 'unlinked_review_request', null::timestamptz; return;
  end if;
  select * into strict v_request from public.review_requests
    where business_id = v_job.business_id and location_id = v_job.location_id
      and id = v_job.review_request_id for update;
  select * into strict v_consent from public.consent_records
    where business_id = v_request.business_id and location_id = v_request.location_id
      and id = v_request.consent_record_id;

  if v_job.channel <> v_request.channel
     or v_job.destination_hash is distinct from v_request.destination_hash
     or v_job.destination_hash_version is distinct from v_request.destination_hash_version
     or v_job.template_version_id is distinct from v_request.template_version_id then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'request_job_binding_invalid');
    return query select 'block'::public.dispatch_decision, 'request_job_binding_invalid', null::timestamptz; return;
  end if;

  if v_request.status not in ('scheduled', 'active') or v_request.sent_count >= v_request.max_messages then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'request_not_sendable');
    return query select 'block'::public.dispatch_decision, 'request_not_sendable', null::timestamptz; return;
  end if;
  if v_consent.status <> 'granted' or v_consent.withdrawn_at is not null then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'consent_not_active');
    return query select 'block'::public.dispatch_decision, 'consent_not_active', null::timestamptz; return;
  end if;
  if exists (
    select 1 from public.channel_suppressions suppression
    where suppression.business_id = v_request.business_id
      and suppression.channel = v_request.channel
      and suppression.destination_hash = v_request.destination_hash
      and suppression.hash_version = v_request.destination_hash_version
      and suppression.lifted_at is null
  ) then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'destination_suppressed');
    return query select 'block'::public.dispatch_decision, 'destination_suppressed', null::timestamptz; return;
  end if;
  if not exists (
    select 1 from app_private.message_dispatch_payloads payload
    where payload.business_id = v_job.business_id and payload.message_job_id = v_job.id
      and payload.expires_at > statement_timestamp()
  ) then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'dispatch_payload_unavailable');
    return query select 'block'::public.dispatch_decision, 'dispatch_payload_unavailable', null::timestamptz; return;
  end if;
  if not exists (
    select 1
    from public.google_profile_locations google_location
    join public.integration_connections integration
      on integration.business_id = google_location.business_id
     and integration.id = google_location.integration_id
    where google_location.business_id = v_job.business_id
      and google_location.location_id = v_job.location_id
      and google_location.review_uri is not null
      and app_private.is_allowed_google_review_url(google_location.review_uri)
      and integration.disabled_at is null
      and integration.health not in ('authentication_required', 'permission_revoked', 'disabled')
  ) then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'google_review_destination_unavailable');
    return query select 'block'::public.dispatch_decision, 'google_review_destination_unavailable', null::timestamptz; return;
  end if;

  select * into v_policy from public.location_messaging_policies policy
  where policy.business_id = v_job.business_id and policy.location_id = v_job.location_id
    and policy.channel = v_job.channel;
  if v_policy.location_id is null or not v_policy.enabled then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'messaging_policy_disabled');
    return query select 'block'::public.dispatch_decision, 'messaging_policy_disabled', null::timestamptz; return;
  end if;

  select * into v_template from public.message_template_versions template
  where template.business_id = v_job.business_id and template.location_id = v_job.location_id
    and template.id = v_job.template_version_id;
  if v_template.id is null or v_template.retired_at is not null
     or not v_template.includes_business_identity or not v_template.includes_unsubscribe then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'template_not_sendable');
    return query select 'block'::public.dispatch_decision, 'template_not_sendable', null::timestamptz; return;
  end if;

  if (v_job.channel = 'sms' and v_job.provider <> 'twilio')
     or (v_job.channel = 'email' and v_job.provider <> 'sendgrid') then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'channel_provider_mismatch');
    return query select 'block'::public.dispatch_decision, 'channel_provider_mismatch', null::timestamptz; return;
  end if;
  if app_private.is_delivery_paused(v_job.business_id, v_job.location_id, v_job.channel, v_job.provider, v_job.automation_key) then
    return query select 'reschedule'::public.dispatch_decision, 'delivery_paused', statement_timestamp() + interval '15 minutes'; return;
  end if;

  -- Serialize the final rate-limit decision through outbox creation.  The
  -- companion payload function calls this again in the same statement before
  -- marking an attempt as sending.
  perform pg_advisory_xact_lock(hashtextextended(
    v_job.business_id::text || ':' || v_job.location_id::text || ':' || v_job.channel::text,
    0
  ));

  select count(*) into v_recent_count
  from public.message_outbox outbox
  join public.message_jobs prior_job
    on prior_job.business_id = outbox.business_id and prior_job.id = outbox.message_job_id
  where prior_job.business_id = v_job.business_id
    and prior_job.channel = v_job.channel
    and prior_job.destination_hash = v_job.destination_hash
    and prior_job.destination_hash_version = v_job.destination_hash_version
    and prior_job.review_request_id is distinct from v_request.id
    and outbox.status in ('sending', 'accepted')
    and outbox.last_attempt_at >= statement_timestamp() - v_policy.destination_frequency_window;
  if v_recent_count >= v_policy.destination_frequency_max then
    perform app_private.cancel_blocked_message_job(v_job.id, p_worker_id, p_lease_token, 'destination_frequency_cap');
    return query select 'block'::public.dispatch_decision, 'destination_frequency_cap', null::timestamptz; return;
  end if;

  select count(*) into v_recent_count
  from public.message_outbox outbox
  join public.message_jobs prior_job
    on prior_job.business_id = outbox.business_id and prior_job.id = outbox.message_job_id
  where prior_job.business_id = v_job.business_id
    and prior_job.location_id = v_job.location_id
    and prior_job.channel = v_job.channel
    and outbox.status in ('sending', 'accepted')
    and outbox.last_attempt_at >= statement_timestamp() - interval '1 hour';
  if v_recent_count >= v_policy.hourly_limit then
    return query select 'reschedule'::public.dispatch_decision, 'location_hourly_cap', statement_timestamp() + interval '15 minutes'; return;
  end if;

  select max(prior_job.completed_at) into v_last_sent
  from public.message_jobs prior_job
  where prior_job.business_id = v_job.business_id
    and prior_job.review_request_id = v_request.id
    and prior_job.status = 'completed';
  if v_last_sent is not null and v_last_sent + v_policy.minimum_gap > statement_timestamp() then
    return query select 'reschedule'::public.dispatch_decision, 'minimum_gap', v_last_sent + v_policy.minimum_gap; return;
  end if;

  if v_request.next_send_at is not null and v_request.next_send_at > statement_timestamp() + interval '1 second' then
    return query select 'reschedule'::public.dispatch_decision, 'request_not_due', v_request.next_send_at; return;
  end if;

  v_next := app_private.next_permitted_send_at(v_job.business_id, v_job.location_id, v_job.channel, statement_timestamp());
  if v_next > statement_timestamp() + interval '1 second' then
    return query select 'reschedule'::public.dispatch_decision, 'quiet_hours', v_next; return;
  end if;
  return query select 'allow'::public.dispatch_decision, 'authorized', v_next;
end
$$;

create or replace function app_private.get_message_dispatch_payload(
  p_message_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns table (
  business_id uuid,
  channel public.channel_kind,
  destination_ciphertext bytea,
  destination_nonce bytea,
  destination_tag bytea,
  subject_ciphertext bytea,
  subject_nonce bytea,
  subject_tag bytea,
  body_ciphertext bytea,
  body_nonce bytea,
  body_tag bytea,
  review_uri text,
  provider_idempotency_key text,
  message_attempt_id uuid
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_authorization record;
  v_outbox public.message_outbox%rowtype;
  v_attempt record;
  v_payload app_private.message_dispatch_payloads%rowtype;
begin
  select * into strict v_authorization
  from app_private.evaluate_message_dispatch(p_message_job_id, p_worker_id, p_lease_token);
  if v_authorization.decision <> 'allow' then
    raise exception 'message dispatch denied: %', v_authorization.reason;
  end if;

  v_outbox := app_private.ensure_message_outbox(p_message_job_id, p_worker_id, p_lease_token);
  select * into strict v_attempt
  from app_private.start_message_attempt(v_outbox.id, p_worker_id, p_lease_token);
  select payload.* into strict v_payload
  from app_private.message_dispatch_payloads payload
  where payload.business_id = v_outbox.business_id
    and payload.message_job_id = p_message_job_id
    and payload.expires_at > statement_timestamp()
  for update;

  return query select
    v_payload.business_id,
    message_job.channel,
    v_payload.destination_ciphertext, v_payload.destination_nonce, v_payload.destination_tag,
    v_payload.subject_ciphertext, v_payload.subject_nonce, v_payload.subject_tag,
    v_payload.body_ciphertext, v_payload.body_nonce, v_payload.body_tag,
    google_location.review_uri,
    v_attempt.provider_idempotency_key, v_attempt.message_attempt_id
  from public.message_jobs message_job
  join public.google_profile_locations google_location
    on google_location.business_id = message_job.business_id
   and google_location.location_id = message_job.location_id
  join public.integration_connections integration
    on integration.business_id = google_location.business_id
   and integration.id = google_location.integration_id
   and integration.disabled_at is null
   and integration.health not in ('authentication_required', 'permission_revoked', 'disabled')
  where message_job.business_id = v_payload.business_id
    and message_job.id = p_message_job_id
    and google_location.review_uri is not null
    and app_private.is_allowed_google_review_url(google_location.review_uri);
  if not found then
    raise exception 'active Google review destination unavailable';
  end if;
end
$$;

create or replace function app_private.defer_message_job(
  p_message_job_id uuid, p_worker_id text, p_lease_token uuid,
  p_run_at timestamptz, p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if p_run_at <= statement_timestamp() or p_run_at > statement_timestamp() + interval '30 days' then
    raise exception 'deferred run time must be within 30 days';
  end if;
  update public.message_jobs
  set status = 'retry', run_at = p_run_at, leased_until = null,
      lease_owner = null, lease_token = null, last_error_code = left(p_reason, 120)
  where id = p_message_job_id and status = 'leased'
    and lease_owner = p_worker_id and lease_token = p_lease_token
    and leased_until > statement_timestamp();
  if not found then raise exception 'worker does not hold this message job'; end if;
end
$$;

create or replace function app_private.advance_review_request_after_delivery()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_request public.review_requests%rowtype;
  v_policy public.location_messaging_policies%rowtype;
  v_next_sequence smallint;
  v_next_run_at timestamptz;
  v_next_job_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' or new.review_request_id is null then
    return new;
  end if;
  select * into strict v_request from public.review_requests request
  where request.business_id = new.business_id and request.location_id = new.location_id
    and request.id = new.review_request_id for update;
  update public.review_requests
  set sent_count = least(max_messages, sent_count + 1),
      status = case when status = 'scheduled' then 'active' else status end,
      next_send_at = null,
      updated_at = statement_timestamp()
  where business_id = v_request.business_id and id = v_request.id
  returning * into v_request;

  if v_request.status not in ('scheduled', 'active')
     or v_request.sent_count >= v_request.max_messages
     or new.sequence_number is null then
    return new;
  end if;
  select * into v_policy from public.location_messaging_policies policy
  where policy.business_id = new.business_id and policy.location_id = new.location_id
    and policy.channel = new.channel and policy.enabled;
  if v_policy.location_id is null then return new; end if;

  v_next_sequence := new.sequence_number + 1;
  v_next_run_at := app_private.next_permitted_send_at(
    new.business_id, new.location_id, new.channel,
    statement_timestamp() + v_policy.minimum_gap
  );
  insert into public.message_jobs (
    business_id, location_id, channel, provider, automation_key,
    deduplication_key, run_at, review_request_id, sequence_number,
    destination_hash, destination_hash_version, template_version_id
  ) values (
    new.business_id, new.location_id, new.channel, new.provider, new.automation_key,
    'review:' || new.review_request_id::text || ':' || v_next_sequence::text,
    v_next_run_at, new.review_request_id, v_next_sequence,
    new.destination_hash, new.destination_hash_version, new.template_version_id
  ) returning id into v_next_job_id;

  insert into app_private.message_dispatch_payloads (
    business_id, message_job_id,
    destination_ciphertext, destination_nonce, destination_tag,
    body_ciphertext, body_nonce, body_tag,
    subject_ciphertext, subject_nonce, subject_tag,
    key_version, expires_at
  )
  select payload.business_id, v_next_job_id,
    payload.destination_ciphertext, payload.destination_nonce, payload.destination_tag,
    payload.body_ciphertext, payload.body_nonce, payload.body_tag,
    payload.subject_ciphertext, payload.subject_nonce, payload.subject_tag,
    payload.key_version, payload.expires_at
  from app_private.message_dispatch_payloads payload
  where payload.business_id = new.business_id and payload.message_job_id = new.id
    and payload.expires_at > v_next_run_at;
  if not found then
    delete from public.message_jobs where business_id = new.business_id and id = v_next_job_id;
    return new;
  end if;
  update public.review_requests
  set next_send_at = v_next_run_at, updated_at = statement_timestamp()
  where business_id = v_request.business_id and id = v_request.id;
  return new;
end
$$;

create trigger message_job_delivery_advances_review_request
after update of status on public.message_jobs
for each row execute function app_private.advance_review_request_after_delivery();

create or replace function app_private.purge_expired_google_review_cache(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_count integer;
begin
  with expired as (
    select id from public.review_records
    where cache_expires_at <= statement_timestamp()
    order by cache_expires_at limit least(greatest(p_limit, 1), 5000)
    for update skip locked
  )
  delete from public.review_records review using expired
  where review.id = expired.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on table app_private.auth_credentials, app_private.auth_sessions,
  app_private.message_dispatch_payloads, app_private.integration_secrets,
  app_private.oauth_authorization_states, app_private.google_profile_selection_states,
  app_private.provider_webhook_events, app_private.oauth_token_revocations
from public, afterword_runtime, afterword_auth, afterword_ingress, afterword_worker, afterword_ops;

grant usage on schema app_private to afterword_auth;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customer_contacts', 'completed_jobs', 'message_template_versions',
    'location_messaging_policies', 'review_requests', 'google_profile_locations',
    'review_records'
  ] loop
    execute format('revoke all on table public.%I from public, afterword_runtime, afterword_auth, afterword_ingress, afterword_worker, afterword_ops', table_name);
  end loop;
end
$$;

grant select (id, business_id, location_id, customer_reference, retention_until, anonymized_at, created_at, updated_at)
  on public.customer_contacts to afterword_runtime;
grant select on public.completed_jobs, public.message_template_versions,
  public.location_messaging_policies, public.review_records to afterword_runtime;
grant select (
  id, business_id, location_id, completed_job_id, customer_id, consent_record_id,
  template_version_id, channel, automation_key, status, max_messages, sent_count,
  next_send_at, started_at, stopped_at, converted_at, stop_reason, created_at, updated_at
) on public.review_requests to afterword_runtime;
grant select (
  id, business_id, location_id, integration_id, account_resource_name,
  location_resource_name, review_uri, granted_scopes, token_expires_at,
  next_sync_at, consecutive_failures, last_synced_at, created_at, updated_at
) on public.google_profile_locations to afterword_runtime;
grant select (review_request_id, sequence_number, template_version_id)
  on public.message_jobs to afterword_runtime;

revoke all on function app_private.lookup_login_credential(text) from public;
revoke all on function app_private.record_login_result(text, boolean) from public;
revoke all on function app_private.issue_auth_session(uuid, bytea, timestamptz, timestamptz, bytea, text) from public;
revoke all on function app_private.resolve_auth_session(bytea) from public;
revoke all on function app_private.revoke_auth_session(uuid, bytea, text) from public;
revoke all on function app_private.set_request_context_from_session(bytea, uuid) from public;
revoke all on function app_private.current_auth_session_id() from public;
revoke all on function app_private.is_allowed_google_review_url(text) from public;
revoke all on function app_private.resolve_qr_review_flow(text) from public;
revoke all on function app_private.record_qr_scan(text, bytea, text, text, text, text) from public;
revoke all on function app_private.next_permitted_send_at(uuid, uuid, public.channel_kind, timestamptz) from public;
revoke all on function app_private.create_manual_completed_job(
  uuid, uuid, text, text, timestamptz, text,
  bytea, bytea, bytea, bytea, bytea, bytea, bytea,
  bytea, bytea, bytea, bytea, public.channel_kind, bytea, uuid,
  public.consent_status, text, text, text, timestamptz, text, text, text,
  bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, uuid
) from public;
revoke all on function app_private.store_google_oauth_state(uuid, uuid, bytea, bytea, bytea, bytea, timestamptz) from public;
revoke all on function app_private.consume_google_oauth_state(bytea) from public;
revoke all on function app_private.store_google_profile_selection_state(uuid, uuid, bytea, bytea, bytea, bytea, timestamptz) from public;
revoke all on function app_private.store_google_profile_selection_state_for_actor(uuid, uuid, uuid, bytea, bytea, bytea, bytea, timestamptz) from public;
revoke all on function app_private.peek_google_profile_selection_state(bytea) from public;
revoke all on function app_private.consume_google_profile_selection_state(bytea) from public;
revoke all on function app_private.save_google_connection(uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, timestamptz, text[]) from public;
revoke all on function app_private.save_google_connection_for_actor(uuid, uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, timestamptz, text[]) from public;
revoke all on function app_private.claim_google_review_sync(text, integer) from public;
revoke all on function app_private.upsert_google_review(uuid, uuid, uuid, text, text, integer, text, timestamptz, timestamptz, text) from public;
revoke all on function app_private.save_refreshed_google_token(uuid, text, uuid, bytea, bytea, bytea, bytea, bytea, bytea, timestamptz, text[]) from public;
revoke all on function app_private.finish_google_review_sync(uuid, text, uuid, boolean, text, text[]) from public;
revoke all on function app_private.request_google_review_sync(uuid, uuid) from public;
revoke all on function app_private.disconnect_google_connection(uuid, uuid, uuid) from public;
revoke all on function app_private.claim_google_token_revocations(text, integer, integer) from public;
revoke all on function app_private.finish_google_token_revocation(uuid, text, uuid, boolean, text) from public;
revoke all on function app_private.record_message_provider_webhook(text, text, text, text, bytea, bytea) from public;
revoke all on function app_private.record_message_suppression_webhook(text, text, text, text, text, text, bytea, bytea) from public;
revoke all on function app_private.record_message_provider_webhook_by_attempt(text, text, uuid, text, bytea, bytea) from public;
revoke all on function app_private.record_message_suppression_webhook_by_attempt(text, text, uuid, text, text, text, bytea, bytea) from public;
revoke all on function app_private.record_integration_suppression_webhook(text, text, uuid, public.channel_kind, bytea, smallint, text, text, text, bytea, bytea) from public;
revoke all on function app_private.record_google_pubsub_event(text, text, text, bytea, bytea) from public;
revoke all on function app_private.purge_expired_provider_webhooks(integer) from public;
revoke all on function app_private.cancel_blocked_message_job(uuid, text, uuid, text) from public;
revoke all on function app_private.evaluate_message_dispatch(uuid, text, uuid) from public;
revoke all on function app_private.get_message_dispatch_payload(uuid, text, uuid) from public;
revoke all on function app_private.defer_message_job(uuid, text, uuid, timestamptz, text) from public;
revoke all on function app_private.purge_expired_google_review_cache(integer) from public;

grant execute on function app_private.lookup_login_credential(text) to afterword_auth;
grant execute on function app_private.record_login_result(text, boolean) to afterword_auth;
grant execute on function app_private.issue_auth_session(uuid, bytea, timestamptz, timestamptz, bytea, text) to afterword_auth;
grant execute on function app_private.resolve_auth_session(bytea) to afterword_auth;
grant execute on function app_private.revoke_auth_session(uuid, bytea, text) to afterword_auth;
grant execute on function app_private.set_request_context_from_session(bytea, uuid) to afterword_runtime;
grant execute on function app_private.resolve_qr_review_flow(text) to afterword_ingress;
grant execute on function app_private.record_qr_scan(text, bytea, text, text, text, text) to afterword_ingress;
grant execute on function app_private.next_permitted_send_at(uuid, uuid, public.channel_kind, timestamptz) to afterword_worker;
grant execute on function app_private.create_manual_completed_job(
  uuid, uuid, text, text, timestamptz, text,
  bytea, bytea, bytea, bytea, bytea, bytea, bytea,
  bytea, bytea, bytea, bytea, public.channel_kind, bytea, uuid,
  public.consent_status, text, text, text, timestamptz, text, text, text,
  bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, uuid
) to afterword_runtime;
grant execute on function app_private.store_google_oauth_state(uuid, uuid, bytea, bytea, bytea, bytea, timestamptz) to afterword_runtime;
grant execute on function app_private.consume_google_oauth_state(bytea) to afterword_auth;
grant execute on function app_private.store_google_profile_selection_state_for_actor(uuid, uuid, uuid, bytea, bytea, bytea, bytea, timestamptz) to afterword_auth;
grant execute on function app_private.peek_google_profile_selection_state(bytea) to afterword_runtime;
grant execute on function app_private.consume_google_profile_selection_state(bytea) to afterword_runtime;
grant execute on function app_private.save_google_connection_for_actor(uuid, uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, timestamptz, text[]) to afterword_auth;
grant execute on function app_private.request_google_review_sync(uuid, uuid) to afterword_runtime;
grant execute on function app_private.disconnect_google_connection(uuid, uuid, uuid) to afterword_runtime;
grant execute on function app_private.claim_google_review_sync(text, integer) to afterword_worker;
grant execute on function app_private.upsert_google_review(uuid, uuid, uuid, text, text, integer, text, timestamptz, timestamptz, text) to afterword_worker;
grant execute on function app_private.save_refreshed_google_token(uuid, text, uuid, bytea, bytea, bytea, bytea, bytea, bytea, timestamptz, text[]) to afterword_worker;
grant execute on function app_private.finish_google_review_sync(uuid, text, uuid, boolean, text, text[]) to afterword_worker;
grant execute on function app_private.claim_google_token_revocations(text, integer, integer) to afterword_worker;
grant execute on function app_private.finish_google_token_revocation(uuid, text, uuid, boolean, text) to afterword_worker;
grant execute on function app_private.record_message_provider_webhook(text, text, text, text, bytea, bytea) to afterword_ingress;
grant execute on function app_private.record_message_suppression_webhook(text, text, text, text, text, text, bytea, bytea) to afterword_ingress;
grant execute on function app_private.record_message_provider_webhook_by_attempt(text, text, uuid, text, bytea, bytea) to afterword_ingress;
grant execute on function app_private.record_message_suppression_webhook_by_attempt(text, text, uuid, text, text, text, bytea, bytea) to afterword_ingress;
grant execute on function app_private.record_integration_suppression_webhook(text, text, uuid, public.channel_kind, bytea, smallint, text, text, text, bytea, bytea) to afterword_ingress;
grant execute on function app_private.record_google_pubsub_event(text, text, text, bytea, bytea) to afterword_ingress;
grant execute on function app_private.purge_expired_provider_webhooks(integer) to afterword_worker, afterword_ops;
grant execute on function app_private.evaluate_message_dispatch(uuid, text, uuid) to afterword_worker;
grant execute on function app_private.get_message_dispatch_payload(uuid, text, uuid) to afterword_worker;
grant execute on function app_private.defer_message_job(uuid, text, uuid, timestamptz, text) to afterword_worker;
grant execute on function app_private.purge_expired_google_review_cache(integer) to afterword_worker, afterword_ops;

comment on table public.review_records is
  'Temporary Google API Content cache. purge_expired_google_review_cache enforces the 30-day maximum retention window.';
comment on table app_private.provider_webhook_events is
  'Encrypted, signature-verified provider event inbox with provider-level deduplication and tenant bindings resolved from stored capabilities.';
comment on function app_private.evaluate_message_dispatch(uuid, text, uuid) is
  'Final database authorization immediately before a worker may call a messaging provider.';
comment on function app_private.get_message_dispatch_payload(uuid, text, uuid) is
  'Re-authorizes the exact active lease, starts one fenced outbox attempt, and only then releases encrypted payload plus an allow-listed review URI.';

commit;
