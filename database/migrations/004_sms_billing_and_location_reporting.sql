begin;

-- Stripe remains deliberately disconnected. These tables establish the
-- server-owned commercial state, SMS allowance boundary and future paid-bundle
-- seam without accepting a payment or trusting browser-supplied totals.
create table public.billing_accounts (
  business_id uuid primary key references public.businesses(id),
  plan_key text not null check (plan_key in ('pro_monthly', 'pro_annual', 'multi_monthly')),
  subscription_status text not null default 'inactive'
    check (subscription_status in ('inactive', 'pilot', 'active', 'past_due', 'cancelled')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  subscription_price_pence integer not null check (subscription_price_pence > 0),
  setup_fee_pence integer not null check (setup_fee_pence > 0),
  sms_base_allowance integer not null check (sms_base_allowance > 0),
  sms_overage_policy text not null default 'pause_sms'
    check (sms_overage_policy in ('pause_sms', 'auto_top_up')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (current_period_end > current_period_start),
  check (
    (plan_key = 'pro_monthly' and billing_cycle = 'monthly'
      and subscription_price_pence = 3900 and setup_fee_pence = 14900 and sms_base_allowance = 100)
    or (plan_key = 'pro_annual' and billing_cycle = 'annual'
      and subscription_price_pence = 39000 and setup_fee_pence = 14900 and sms_base_allowance = 100)
    or (plan_key = 'multi_monthly' and billing_cycle = 'monthly'
      and subscription_price_pence = 7900 and setup_fee_pence in (24900, 34900) and sms_base_allowance = 300)
  )
);

-- Existing tenants are safe by default. They receive the documented Pro
-- pricing but cannot send metered SMS until explicitly placed into pilot or
-- activated later by the Stripe webhook integration.
insert into public.billing_accounts (
  business_id, plan_key, subscription_status, billing_cycle,
  subscription_price_pence, setup_fee_pence, sms_base_allowance,
  current_period_start, current_period_end
)
select business.id, 'pro_monthly', 'inactive', 'monthly',
  3900, 14900, 100,
  date_trunc('month', statement_timestamp()),
  date_trunc('month', statement_timestamp()) + interval '1 month'
from public.businesses business
on conflict (business_id) do nothing;

create table public.sms_allowance_bundles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  segments integer not null default 100 check (segments = 100),
  amount_pence integer not null default 1000 check (amount_pence = 1000),
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  provider_reference text,
  created_at timestamptz not null default clock_timestamp(),
  paid_at timestamptz,
  voided_at timestamptz,
  check (period_end > period_start),
  check ((status = 'paid') = (paid_at is not null)),
  check ((status = 'void') = (voided_at is not null)),
  unique (business_id, id)
);
create unique index sms_allowance_bundles_provider_reference_idx
  on public.sms_allowance_bundles(provider_reference)
  where provider_reference is not null;
create index sms_allowance_bundles_business_period_idx
  on public.sms_allowance_bundles(business_id, period_start, period_end, status);

create table public.sms_usage_reservations (
  message_attempt_id uuid primary key references public.message_attempts(id),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  message_job_id uuid not null,
  outbox_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  segments smallint not null check (segments between 1 and 20),
  status text not null default 'reserved'
    check (status in ('reserved', 'accepted', 'unknown', 'released')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (period_end > period_start),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  foreign key (business_id, message_job_id) references public.message_jobs(business_id, id),
  foreign key (business_id, outbox_id) references public.message_outbox(business_id, id),
  unique (business_id, message_attempt_id)
);
create index sms_usage_reservations_business_period_idx
  on public.sms_usage_reservations(business_id, period_start, status);
create index sms_usage_reservations_location_period_idx
  on public.sms_usage_reservations(business_id, location_id, period_start, status);
create index sms_usage_reservations_outbox_idx
  on public.sms_usage_reservations(business_id, outbox_id);

create table public.sms_usage_alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  period_start timestamptz not null,
  threshold smallint not null check (threshold in (75, 90, 100)),
  usage_segments integer not null check (usage_segments >= 0),
  allowance_segments integer not null check (allowance_segments > 0),
  reached_at timestamptz not null default clock_timestamp(),
  unique (business_id, period_start, threshold)
);

alter table public.billing_accounts enable row level security;
alter table public.billing_accounts force row level security;
alter table public.sms_allowance_bundles enable row level security;
alter table public.sms_allowance_bundles force row level security;
alter table public.sms_usage_reservations enable row level security;
alter table public.sms_usage_reservations force row level security;
alter table public.sms_usage_alerts enable row level security;
alter table public.sms_usage_alerts force row level security;

create policy migration_owner_all on public.billing_accounts
for all to afterword_migration_owner using (true) with check (true);
create policy migration_owner_all on public.sms_allowance_bundles
for all to afterword_migration_owner using (true) with check (true);
create policy migration_owner_all on public.sms_usage_reservations
for all to afterword_migration_owner using (true) with check (true);
create policy migration_owner_all on public.sms_usage_alerts
for all to afterword_migration_owner using (true) with check (true);

create trigger billing_accounts_business_id_immutable
before update on public.billing_accounts
for each row execute function app_private.reject_business_id_change();
create trigger sms_allowance_bundles_business_id_immutable
before update on public.sms_allowance_bundles
for each row execute function app_private.reject_business_id_change();
create trigger sms_usage_reservations_business_id_immutable
before update on public.sms_usage_reservations
for each row execute function app_private.reject_business_id_change();
create trigger sms_usage_alerts_business_id_immutable
before update on public.sms_usage_alerts
for each row execute function app_private.reject_business_id_change();

create policy billing_accounts_read on public.billing_accounts
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin', 'billing']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create policy sms_allowance_bundles_read on public.sms_allowance_bundles
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin', 'billing']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create policy sms_usage_reservations_read on public.sms_usage_reservations
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin', 'billing']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create policy sms_usage_alerts_read on public.sms_usage_alerts
for select to afterword_runtime
using (
  app_private.has_business_role(business_id, array['owner', 'admin', 'billing']::public.business_role[])
  or app_private.has_active_support_session(business_id, 'view')
);

create view public.billing_account_status
with (security_invoker = true)
as
select
  account.business_id,
  account.plan_key,
  account.subscription_status,
  account.billing_cycle,
  account.subscription_price_pence,
  account.setup_fee_pence,
  account.sms_base_allowance,
  account.sms_overage_policy,
  account.current_period_start,
  account.current_period_end,
  account.updated_at
from public.billing_accounts account;

create view public.sms_usage_status
with (security_invoker = true)
as
select
  reservation.business_id,
  reservation.location_id,
  reservation.period_start,
  reservation.period_end,
  sum(reservation.segments) filter (where reservation.status in ('accepted', 'unknown'))::integer as used_segments,
  sum(reservation.segments) filter (where reservation.status = 'reserved')::integer as pending_segments
from public.sms_usage_reservations reservation
group by reservation.business_id, reservation.location_id,
  reservation.period_start, reservation.period_end;

create or replace function app_private.set_sms_overage_policy(
  p_business_id uuid,
  p_policy text,
  p_correlation_id uuid
)
returns table (updated boolean, policy text, reason text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_allowed boolean;
begin
  if p_policy not in ('pause_sms', 'auto_top_up') then
    raise exception 'unsupported SMS overage policy';
  end if;
  if p_correlation_id is null then raise exception 'correlation_id is required'; end if;

  v_allowed := app_private.current_user_enabled() and (
    app_private.has_business_role(p_business_id, array['owner', 'admin', 'billing']::public.business_role[])
    or app_private.has_active_support_session(p_business_id, 'configuration')
  );
  if not v_allowed then
    perform app_private.write_audit_event(
      'user', null, p_business_id, null, app_private.current_support_session_id(),
      'billing.sms_policy.update', 'billing_account', p_business_id::text,
      'blocked', 'billing_policy_access_denied', p_correlation_id,
      '{}'::text[], '{}'::jsonb
    );
    return query select false, null::text, 'access_denied';
    return;
  end if;

  select * into v_account from public.billing_accounts
  where business_id = p_business_id for update;
  if v_account.business_id is null then
    perform app_private.write_audit_event(
      'user', null, p_business_id, null, app_private.current_support_session_id(),
      'billing.sms_policy.update', 'billing_account', p_business_id::text,
      'blocked', 'billing_account_missing', p_correlation_id,
      '{}'::text[], '{}'::jsonb
    );
    return query select false, null::text, 'billing_unavailable';
    return;
  end if;

  if v_account.sms_overage_policy <> p_policy then
    update public.billing_accounts
    set sms_overage_policy = p_policy,
        updated_by = app_private.current_user_id(),
        updated_at = statement_timestamp()
    where business_id = p_business_id;
    perform app_private.write_audit_event(
      'user', null, p_business_id, null, app_private.current_support_session_id(),
      'billing.sms_policy.update', 'billing_account', p_business_id::text,
      'completed', null, p_correlation_id,
      array['sms_overage_policy'], jsonb_build_object('policy', p_policy)
    );
  end if;
  return query select true, p_policy, 'saved';
end
$$;

create or replace function app_private.reserve_sms_segments(
  p_message_attempt_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_segments integer
)
returns table (allowed boolean, reason text, retry_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_attempt public.message_attempts%rowtype;
  v_job public.message_jobs%rowtype;
  v_outbox public.message_outbox%rowtype;
  v_account public.billing_accounts%rowtype;
  v_existing public.sms_usage_reservations%rowtype;
  v_allowance integer;
  v_committed integer;
begin
  if p_segments is null or p_segments < 1 or p_segments > 20 then
    raise exception 'SMS segment count must be between 1 and 20';
  end if;

  select * into strict v_attempt from public.message_attempts
  where id = p_message_attempt_id for update;
  select * into strict v_job from public.message_jobs
  where business_id = v_attempt.business_id and id = v_attempt.message_job_id for update;
  select * into strict v_outbox from public.message_outbox
  where business_id = v_attempt.business_id and id = v_attempt.outbox_id
    and message_job_id = v_job.id for update;

  if v_job.channel <> 'sms' or v_attempt.status <> 'started'
     or v_job.status <> 'leased' or v_job.lease_owner <> p_worker_id
     or v_job.lease_token is distinct from p_lease_token
     or v_attempt.worker_id <> p_worker_id
     or v_attempt.lease_token is distinct from p_lease_token
     or v_job.leased_until <= statement_timestamp() then
    raise exception 'worker does not hold an active SMS attempt';
  end if;

  select * into v_existing from public.sms_usage_reservations
  where message_attempt_id = p_message_attempt_id for update;
  if v_existing.message_attempt_id is not null then
    if v_existing.segments <> p_segments
       or v_existing.business_id <> v_job.business_id
       or v_existing.location_id <> v_job.location_id then
      raise exception 'SMS reservation identity mismatch';
    end if;
    return query select v_existing.status <> 'released',
      case when v_existing.status = 'released' then 'reservation_released' else 'reserved' end,
      null::timestamptz;
    return;
  end if;

  select * into v_account from public.billing_accounts
  where business_id = v_job.business_id for update;
  if v_account.business_id is null then
    return query select false, 'sms_billing_missing', statement_timestamp() + interval '1 day';
    return;
  end if;
  if v_account.subscription_status not in ('pilot', 'active') then
    return query select false, 'sms_billing_inactive', greatest(v_account.current_period_end, statement_timestamp() + interval '1 day');
    return;
  end if;

  select v_account.sms_base_allowance + coalesce(sum(bundle.segments), 0)::integer
  into v_allowance
  from public.sms_allowance_bundles bundle
  where bundle.business_id = v_account.business_id
    and bundle.period_start = v_account.current_period_start
    and bundle.period_end = v_account.current_period_end
    and bundle.status = 'paid';

  select coalesce(sum(reservation.segments), 0)::integer into v_committed
  from public.sms_usage_reservations reservation
  where reservation.business_id = v_account.business_id
    and reservation.period_start = v_account.current_period_start
    and reservation.period_end = v_account.current_period_end
    and reservation.status in ('reserved', 'accepted', 'unknown');

  if v_committed + p_segments > v_allowance then
    return query select false,
      case when v_account.sms_overage_policy = 'auto_top_up'
        then 'sms_top_up_required' else 'sms_allowance_exhausted' end,
      v_account.current_period_end;
    return;
  end if;

  insert into public.sms_usage_reservations (
    message_attempt_id, business_id, location_id, message_job_id, outbox_id,
    period_start, period_end, segments
  ) values (
    p_message_attempt_id, v_job.business_id, v_job.location_id, v_job.id, v_outbox.id,
    v_account.current_period_start, v_account.current_period_end, p_segments
  );
  return query select true, 'reserved', null::timestamptz;
end
$$;

create or replace function app_private.hold_message_for_sms_allowance(
  p_message_attempt_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_reason text,
  p_retry_at timestamptz,
  p_correlation_id uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_attempt public.message_attempts%rowtype;
  v_job public.message_jobs%rowtype;
  v_outbox public.message_outbox%rowtype;
  v_retry_at timestamptz := greatest(
    coalesce(p_retry_at, statement_timestamp() + interval '1 day'),
    statement_timestamp() + interval '15 minutes'
  );
begin
  if p_reason not in ('sms_billing_missing', 'sms_billing_inactive', 'sms_allowance_exhausted', 'sms_top_up_required') then
    raise exception 'unsupported SMS allowance hold reason';
  end if;
  if p_correlation_id is null then raise exception 'correlation_id is required'; end if;

  select * into strict v_attempt from public.message_attempts
  where id = p_message_attempt_id for update;
  select * into strict v_job from public.message_jobs
  where business_id = v_attempt.business_id and id = v_attempt.message_job_id for update;
  select * into strict v_outbox from public.message_outbox
  where business_id = v_attempt.business_id and id = v_attempt.outbox_id
    and message_job_id = v_job.id for update;

  if v_job.channel <> 'sms' or v_attempt.status <> 'started'
     or v_job.status <> 'leased' or v_job.lease_owner <> p_worker_id
     or v_job.lease_token is distinct from p_lease_token
     or v_attempt.worker_id <> p_worker_id
     or v_attempt.lease_token is distinct from p_lease_token then
    raise exception 'worker does not hold this SMS attempt';
  end if;

  update public.message_attempts
  set status = 'failed', finished_at = statement_timestamp(), error_code = p_reason
  where id = v_attempt.id;
  update public.message_outbox
  set status = 'failed', updated_at = statement_timestamp()
  where id = v_outbox.id;
  update public.message_jobs
  set status = 'retry', run_at = v_retry_at,
      leased_until = null, lease_owner = null, lease_token = null,
      last_error_code = p_reason
  where id = v_job.id;

  perform app_private.write_audit_event(
    'worker', null, v_job.business_id, v_job.location_id, null,
    'message.sms_allowance.hold', 'message_job', v_job.id::text,
    'completed', p_reason, p_correlation_id,
    array['status', 'run_at', 'last_error_code'],
    jsonb_build_object('retry_at', v_retry_at)
  );
  return v_retry_at;
end
$$;

create or replace function app_private.record_sms_usage_alerts(p_business_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_allowance integer;
  v_usage integer;
  v_threshold integer;
begin
  select * into v_account from public.billing_accounts
  where business_id = p_business_id;
  if v_account.business_id is null then return; end if;

  select v_account.sms_base_allowance + coalesce(sum(bundle.segments), 0)::integer
  into v_allowance
  from public.sms_allowance_bundles bundle
  where bundle.business_id = v_account.business_id
    and bundle.period_start = v_account.current_period_start
    and bundle.period_end = v_account.current_period_end
    and bundle.status = 'paid';
  select coalesce(sum(reservation.segments), 0)::integer into v_usage
  from public.sms_usage_reservations reservation
  where reservation.business_id = v_account.business_id
    and reservation.period_start = v_account.current_period_start
    and reservation.period_end = v_account.current_period_end
    and reservation.status in ('accepted', 'unknown');

  foreach v_threshold in array array[75, 90, 100] loop
    if v_usage * 100 >= v_allowance * v_threshold then
      insert into public.sms_usage_alerts (
        business_id, period_start, threshold, usage_segments, allowance_segments
      ) values (
        v_account.business_id, v_account.current_period_start,
        v_threshold, v_usage, v_allowance
      ) on conflict (business_id, period_start, threshold) do nothing;
    end if;
  end loop;
end
$$;

create or replace function app_private.sync_sms_reservation_from_outbox()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_status text;
begin
  if new.status = old.status then return new; end if;
  v_status := case
    when new.status = 'accepted' then 'accepted'
    when new.status = 'unknown' then 'unknown'
    when new.status = 'failed' then 'released'
    else null
  end;
  if v_status is null then return new; end if;

  update public.sms_usage_reservations
  set status = v_status, updated_at = statement_timestamp()
  where business_id = new.business_id and outbox_id = new.id
    and status in ('reserved', 'unknown');
  if found and v_status in ('accepted', 'unknown') then
    perform app_private.record_sms_usage_alerts(new.business_id);
  end if;
  return new;
end
$$;

create trigger message_outbox_syncs_sms_reservation
after update of status on public.message_outbox
for each row execute function app_private.sync_sms_reservation_from_outbox();

create or replace function app_private.roll_pilot_billing_periods(p_limit integer default 100)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_count integer := 0;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'invalid billing period roll limit'; end if;
  for v_account in
    select * from public.billing_accounts
    where subscription_status = 'pilot' and current_period_end <= statement_timestamp()
    order by current_period_end for update skip locked limit p_limit
  loop
    while v_account.current_period_end <= statement_timestamp() loop
      v_account.current_period_start := v_account.current_period_end;
      v_account.current_period_end := v_account.current_period_end
        + case when v_account.billing_cycle = 'annual' then interval '1 year' else interval '1 month' end;
    end loop;
    update public.billing_accounts
    set current_period_start = v_account.current_period_start,
        current_period_end = v_account.current_period_end,
        updated_at = statement_timestamp()
    where business_id = v_account.business_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke all on table public.billing_accounts, public.sms_allowance_bundles,
  public.sms_usage_reservations, public.sms_usage_alerts,
  public.billing_account_status, public.sms_usage_status
from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

grant select on public.billing_account_status, public.sms_usage_status to afterword_runtime;
grant select (
  business_id, plan_key, subscription_status, billing_cycle,
  subscription_price_pence, setup_fee_pence, sms_base_allowance,
  sms_overage_policy, current_period_start, current_period_end, updated_at
) on public.billing_accounts to afterword_runtime;
grant select (
  id, business_id, period_start, period_end, segments, amount_pence,
  status, created_at, paid_at, voided_at
) on public.sms_allowance_bundles to afterword_runtime;
grant select (
  message_attempt_id, business_id, location_id, period_start, period_end,
  segments, status, created_at, updated_at
) on public.sms_usage_reservations to afterword_runtime;
grant select (
  id, business_id, period_start, threshold, usage_segments,
  allowance_segments, reached_at
) on public.sms_usage_alerts to afterword_runtime;

revoke all on function app_private.set_sms_overage_policy(uuid, text, uuid)
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.reserve_sms_segments(uuid, text, uuid, integer)
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.hold_message_for_sms_allowance(uuid, text, uuid, text, timestamptz, uuid)
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.record_sms_usage_alerts(uuid)
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.sync_sms_reservation_from_outbox()
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.roll_pilot_billing_periods(integer)
  from public, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

grant execute on function app_private.set_sms_overage_policy(uuid, text, uuid) to afterword_runtime;
grant execute on function app_private.reserve_sms_segments(uuid, text, uuid, integer) to afterword_worker;
grant execute on function app_private.hold_message_for_sms_allowance(uuid, text, uuid, text, timestamptz, uuid) to afterword_worker;
grant execute on function app_private.roll_pilot_billing_periods(integer) to afterword_worker, afterword_ops;

comment on table public.billing_accounts is
  'Server-owned commercial plan and SMS allowance state. Stripe identifiers are added only when live billing is connected.';
comment on table public.sms_usage_reservations is
  'Conservative pre-provider SMS segment reservations settled from durable provider outcomes.';
comment on function app_private.reserve_sms_segments(uuid, text, uuid, integer) is
  'Serializes the final pooled SMS allowance decision for an exact leased delivery attempt.';

commit;
