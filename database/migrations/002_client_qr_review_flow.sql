-- Afterword client QR review flow
-- Apply after 001_multi_tenant_foundation.sql as afterword_migration_owner.
-- The public HTTP edge resolves and records scans through afterword_ingress;
-- browsers never receive direct database credentials.

begin;

create type public.qr_code_status as enum ('active', 'paused', 'retired');
create type public.qr_attribution_method as enum ('direct_session', 'time_window', 'manual');

create table public.review_destinations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  provider text not null default 'google' check (provider = 'google'),
  destination_url text not null check (destination_url ~ '^https://'),
  verified_at timestamptz,
  verified_by uuid references public.users(id),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  unique (business_id, id),
  unique (business_id, location_id, id)
);

create unique index review_destinations_one_active_per_location
  on public.review_destinations (business_id, location_id, provider)
  where active;

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  review_destination_id uuid not null,
  public_token text not null unique check (public_token ~ '^[a-z0-9-]{16,80}$'),
  status public.qr_code_status not null default 'active',
  artwork_revision integer not null default 1 check (artwork_revision > 0),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  artwork_generated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, location_id, review_destination_id) references public.review_destinations(business_id, location_id, id),
  unique (business_id, id),
  unique (business_id, location_id, id)
);

create unique index qr_codes_one_active_per_location
  on public.qr_codes (business_id, location_id)
  where status = 'active';

create table public.qr_scan_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  qr_code_id uuid not null,
  scanned_at timestamptz not null default clock_timestamp(),
  anonymous_visitor_hash bytea not null,
  placement_key text,
  referrer_host text,
  device_family text,
  country_code text check (country_code is null or length(country_code) = 2),
  continued_to_provider_at timestamptz,
  foreign key (business_id, qr_code_id) references public.qr_codes(business_id, id),
  unique (business_id, qr_code_id, id)
);

create index qr_scan_events_business_time
  on public.qr_scan_events (business_id, scanned_at desc);
create index qr_scan_events_qr_time
  on public.qr_scan_events (qr_code_id, scanned_at desc);
create index qr_scan_events_unique_window
  on public.qr_scan_events (qr_code_id, anonymous_visitor_hash, scanned_at desc);

create table public.qr_review_conversions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  qr_code_id uuid not null,
  scan_event_id uuid,
  provider_review_id text not null,
  attribution_method public.qr_attribution_method not null,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  detected_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, qr_code_id) references public.qr_codes(business_id, id),
  foreign key (business_id, qr_code_id, scan_event_id) references public.qr_scan_events(business_id, qr_code_id, id),
  unique (business_id, provider_review_id)
);

create index qr_review_conversions_business_time
  on public.qr_review_conversions (business_id, detected_at desc);

alter table public.review_destinations enable row level security;
alter table public.review_destinations force row level security;
alter table public.qr_codes enable row level security;
alter table public.qr_codes force row level security;
alter table public.qr_scan_events enable row level security;
alter table public.qr_scan_events force row level security;
alter table public.qr_review_conversions enable row level security;
alter table public.qr_review_conversions force row level security;

create policy migration_owner_all on public.review_destinations
for all to afterword_migration_owner using (true) with check (true);
create policy migration_owner_all on public.qr_codes
for all to afterword_migration_owner using (true) with check (true);
create policy migration_owner_all on public.qr_scan_events
for all to afterword_migration_owner using (true) with check (true);
create policy migration_owner_all on public.qr_review_conversions
for all to afterword_migration_owner using (true) with check (true);

create policy review_destinations_read on public.review_destinations
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

create policy qr_codes_read on public.qr_codes
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, location_id));

create policy qr_scan_events_read on public.qr_scan_events
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, null));

create policy qr_review_conversions_read on public.qr_review_conversions
for select to afterword_runtime
using (app_private.can_read_tenant_data(business_id, null));

create policy qr_codes_ingress_read on public.qr_codes
for select to afterword_ingress
using (status = 'active');

create policy review_destinations_ingress_read on public.review_destinations
for select to afterword_ingress
using (active and verified_at is not null);

create policy qr_scan_events_ingress_insert on public.qr_scan_events
for insert to afterword_ingress
with check (
  exists (
    select 1
    from public.qr_codes code
    where code.id = qr_scan_events.qr_code_id
      and code.business_id = qr_scan_events.business_id
      and code.status = 'active'
  )
);

create policy qr_scan_events_ingress_update on public.qr_scan_events
for update to afterword_ingress
using (true)
with check (true);

create policy qr_review_conversions_worker_insert on public.qr_review_conversions
for insert to afterword_worker
with check (true);

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

  if p_destination_url !~* '^https://(g\.page/r/.+/review/?|search\.google\.com/local/writereview\?.*placeid=|([a-z0-9-]+\.)?google\.[a-z.]+/maps/place/)' then
    raise exception 'a direct HTTPS Google review destination is required';
  end if;

  if not exists (
    select 1 from public.locations location
    where location.business_id = p_business_id and location.id = p_location_id
  ) then
    raise exception 'location does not belong to business';
  end if;

  update public.review_destinations
  set active = false,
      updated_at = statement_timestamp()
  where business_id = p_business_id
    and location_id = p_location_id
    and provider = 'google'
    and active;

  insert into public.review_destinations (
    business_id, location_id, destination_url, verified_at, verified_by
  ) values (
    p_business_id, p_location_id, p_destination_url, statement_timestamp(), v_actor
  ) returning * into v_destination;

  update public.qr_codes
  set review_destination_id = v_destination.id
  where business_id = p_business_id
    and location_id = p_location_id
    and status = 'active';

  return v_destination;
end
$$;

create or replace function app_private.regenerate_qr_artwork(p_qr_code_id uuid)
returns table (public_token text, artwork_revision integer, artwork_generated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_business_id uuid;
begin
  select code.business_id into strict v_business_id
  from public.qr_codes code
  where code.id = p_qr_code_id
  for update;

  if not app_private.can_manage_business(v_business_id) then
    raise exception 'business configuration permission required';
  end if;

  return query
  update public.qr_codes
  set artwork_revision = qr_codes.artwork_revision + 1,
      artwork_generated_at = statement_timestamp()
  where id = p_qr_code_id
  returning qr_codes.public_token, qr_codes.artwork_revision, qr_codes.artwork_generated_at;
end
$$;

create or replace function app_private.ensure_client_qr_code(
  p_business_id uuid,
  p_location_id uuid
)
returns public.qr_codes
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_destination_id uuid;
  v_code public.qr_codes%rowtype;
begin
  if not app_private.can_manage_business(p_business_id) then
    raise exception 'business configuration permission required';
  end if;

  perform 1
  from public.locations location
  where location.business_id = p_business_id
    and location.id = p_location_id
  for update;
  if not found then
    raise exception 'location does not belong to business';
  end if;

  select code.* into v_code
  from public.qr_codes code
  where code.business_id = p_business_id
    and code.location_id = p_location_id
    and code.status = 'active';
  if found then
    return v_code;
  end if;

  select destination.id into strict v_destination_id
  from public.review_destinations destination
  where destination.business_id = p_business_id
    and destination.location_id = p_location_id
    and destination.provider = 'google'
    and destination.active
    and destination.verified_at is not null;

  insert into public.qr_codes (
    business_id, location_id, review_destination_id, public_token, created_by
  ) values (
    p_business_id,
    p_location_id,
    v_destination_id,
    'qr-' || replace(gen_random_uuid()::text, '-', ''),
    app_private.current_user_id()
  ) returning * into v_code;

  return v_code;
end
$$;

create or replace function app_private.resolve_qr_review_flow(p_public_token text)
returns table (
  qr_code_id uuid,
  business_id uuid,
  location_id uuid,
  destination_url text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select code.id, code.business_id, code.location_id, destination.destination_url
  from public.qr_codes code
  join public.review_destinations destination
    on destination.business_id = code.business_id
   and destination.id = code.review_destination_id
  where code.public_token = p_public_token
    and code.status = 'active'
    and destination.active
    and destination.verified_at is not null
$$;

create or replace function app_private.record_qr_scan(
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
declare
  v_flow record;
  v_scan_id uuid;
begin
  if p_anonymous_visitor_hash is null or length(p_anonymous_visitor_hash) < 16 then
    raise exception 'privacy-safe visitor hash required';
  end if;

  select * into strict v_flow
  from app_private.resolve_qr_review_flow(p_public_token);

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

create or replace function app_private.mark_qr_provider_continue(p_scan_event_id uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog
as $$
  update public.qr_scan_events
  set continued_to_provider_at = coalesce(continued_to_provider_at, statement_timestamp())
  where id = p_scan_event_id
$$;

create or replace function app_private.record_qr_review_conversion(
  p_business_id uuid,
  p_qr_code_id uuid,
  p_scan_event_id uuid,
  p_provider_review_id text,
  p_attribution_method public.qr_attribution_method,
  p_confidence numeric
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_id uuid;
begin
  insert into public.qr_review_conversions (
    business_id, qr_code_id, scan_event_id, provider_review_id,
    attribution_method, confidence
  ) values (
    p_business_id, p_qr_code_id, p_scan_event_id, p_provider_review_id,
    p_attribution_method, p_confidence
  )
  on conflict (business_id, provider_review_id) do update
    set detected_at = public.qr_review_conversions.detected_at
  returning id into v_id;
  return v_id;
end
$$;

revoke all on table public.review_destinations, public.qr_codes,
  public.qr_scan_events, public.qr_review_conversions
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

grant select (
  id, business_id, location_id, provider, destination_url, verified_at,
  active, created_at, updated_at
) on public.review_destinations to afterword_runtime;

grant select (
  id, business_id, location_id, review_destination_id, public_token,
  status, artwork_revision, created_at, artwork_generated_at, retired_at
) on public.qr_codes to afterword_runtime;

grant select (
  id, business_id, qr_code_id, scanned_at, placement_key, referrer_host,
  device_family, country_code, continued_to_provider_at
) on public.qr_scan_events to afterword_runtime;

grant select (
  id, business_id, qr_code_id, scan_event_id, provider_review_id,
  attribution_method, confidence, detected_at
) on public.qr_review_conversions to afterword_runtime;

revoke all on function app_private.save_google_review_destination(uuid, uuid, text) from public;
revoke all on function app_private.regenerate_qr_artwork(uuid) from public;
revoke all on function app_private.ensure_client_qr_code(uuid, uuid) from public;
revoke all on function app_private.resolve_qr_review_flow(text) from public;
revoke all on function app_private.record_qr_scan(text, bytea, text, text, text, text) from public;
revoke all on function app_private.mark_qr_provider_continue(uuid) from public;
revoke all on function app_private.record_qr_review_conversion(uuid, uuid, uuid, text, public.qr_attribution_method, numeric) from public;

grant execute on function app_private.save_google_review_destination(uuid, uuid, text) to afterword_runtime;
grant execute on function app_private.regenerate_qr_artwork(uuid) to afterword_runtime;
grant execute on function app_private.ensure_client_qr_code(uuid, uuid) to afterword_runtime;
grant execute on function app_private.resolve_qr_review_flow(text) to afterword_ingress;
grant execute on function app_private.record_qr_scan(text, bytea, text, text, text, text) to afterword_ingress;
grant execute on function app_private.mark_qr_provider_continue(uuid) to afterword_ingress;
grant execute on function app_private.record_qr_review_conversion(uuid, uuid, uuid, text, public.qr_attribution_method, numeric) to afterword_worker;

comment on column public.qr_scan_events.anonymous_visitor_hash is
  'Rotating, server-side keyed hash used for approximate unique scan counts. Never store raw IP addresses.';
comment on column public.qr_codes.public_token is
  'Stable public identifier embedded in artwork. Regeneration must never rotate this token.';
comment on column public.qr_review_conversions.confidence is
  'Attribution confidence only. Google review sync does not guarantee deterministic scan-to-review identity.';

commit;
