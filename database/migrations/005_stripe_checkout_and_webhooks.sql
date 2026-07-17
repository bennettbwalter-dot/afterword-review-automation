begin;

alter table public.billing_accounts
  add column stripe_livemode boolean,
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  add column stripe_subscription_state text
    check (stripe_subscription_state in ('inactive', 'active', 'past_due', 'cancelled')),
  add column stripe_state_updated_at timestamptz,
  add column setup_fee_paid_at timestamptz,
  add constraint billing_accounts_stripe_customer_format
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  add constraint billing_accounts_stripe_subscription_format
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  add constraint billing_accounts_stripe_identity_complete
    check (
      stripe_subscription_state is null
      or (stripe_subscription_id is not null and stripe_customer_id is not null)
    );

create unique index billing_accounts_stripe_customer_idx
  on public.billing_accounts(stripe_customer_id)
  where stripe_customer_id is not null;
create unique index billing_accounts_stripe_subscription_idx
  on public.billing_accounts(stripe_subscription_id)
  where stripe_subscription_id is not null;

create table app_private.stripe_checkout_attempts (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  actor_user_id uuid not null references public.users(id),
  plan_key text not null check (plan_key in ('pro_monthly', 'pro_annual', 'multi_monthly')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  subscription_price_pence integer not null check (subscription_price_pence > 0),
  setup_fee_pence integer not null check (setup_fee_pence > 0),
  stripe_checkout_session_id text,
  stripe_customer_id text,
  livemode boolean,
  status text not null default 'prepared'
    check (status in ('prepared', 'created', 'completed', 'failed', 'expired')),
  correlation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'),
  check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  check ((status = 'prepared') or stripe_checkout_session_id is not null),
  check ((status = 'completed') = (completed_at is not null))
);
create unique index stripe_checkout_attempts_session_idx
  on app_private.stripe_checkout_attempts(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index stripe_checkout_attempts_business_created_idx
  on app_private.stripe_checkout_attempts(business_id, created_at desc);

create table app_private.stripe_billing_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (length(event_type) between 1 and 160),
  event_created_at timestamptz not null,
  api_version text,
  livemode boolean not null,
  business_id uuid not null references public.businesses(id),
  checkout_attempt_id uuid references app_private.stripe_checkout_attempts(id),
  payload_hash bytea not null check (length(payload_hash) = 32),
  encrypted_payload bytea,
  signature_verified_at timestamptz not null default clock_timestamp(),
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  result_code text,
  payload_expires_at timestamptz not null default (clock_timestamp() + interval '30 days')
);
create index stripe_billing_events_business_time_idx
  on app_private.stripe_billing_events(business_id, event_created_at desc);
create index stripe_billing_events_payload_expiry_idx
  on app_private.stripe_billing_events(payload_expires_at);

create or replace function app_private.prepare_stripe_checkout(
  p_business_id uuid,
  p_attempt_id uuid,
  p_correlation_id uuid
)
returns table (
  allowed boolean,
  reason text,
  plan_key text,
  billing_cycle text,
  subscription_price_pence integer,
  setup_fee_pence integer,
  stripe_customer_id text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_attempt app_private.stripe_checkout_attempts%rowtype;
  v_actor_id uuid := app_private.current_user_id();
begin
  if p_business_id is null or p_attempt_id is null or p_correlation_id is null then
    raise exception 'Stripe checkout identifiers are required';
  end if;
  if not app_private.current_user_enabled()
     or app_private.current_support_session_id() is not null
     or not app_private.has_business_role(
       p_business_id,
       array['owner', 'admin', 'billing']::public.business_role[]
     ) then
    perform app_private.write_audit_event(
      'user', null, p_business_id, null, app_private.current_support_session_id(),
      'billing.stripe.checkout.prepare', 'billing_account', p_business_id::text,
      'blocked', 'billing_checkout_access_denied', p_correlation_id,
      '{}'::text[], '{}'::jsonb
    );
    return query select false, 'access_denied', null::text, null::text,
      null::integer, null::integer, null::text;
    return;
  end if;

  select * into v_account from public.billing_accounts
  where business_id = p_business_id for update;
  if v_account.business_id is null then
    return query select false, 'billing_unavailable', null::text, null::text,
      null::integer, null::integer, null::text;
    return;
  end if;
  if v_account.subscription_status = 'active' then
    return query select false, 'subscription_active', null::text, null::text,
      null::integer, null::integer, v_account.stripe_customer_id;
    return;
  end if;
  if v_account.subscription_status = 'past_due' then
    return query select false, 'subscription_past_due', null::text, null::text,
      null::integer, null::integer, v_account.stripe_customer_id;
    return;
  end if;

  insert into app_private.stripe_checkout_attempts (
    id, business_id, actor_user_id, plan_key, billing_cycle,
    subscription_price_pence, setup_fee_pence, correlation_id
  ) values (
    p_attempt_id, p_business_id, v_actor_id, v_account.plan_key, v_account.billing_cycle,
    v_account.subscription_price_pence, v_account.setup_fee_pence, p_correlation_id
  ) on conflict (id) do nothing;

  select * into strict v_attempt from app_private.stripe_checkout_attempts
  where id = p_attempt_id for update;
  if v_attempt.business_id <> p_business_id or v_attempt.actor_user_id <> v_actor_id then
    raise exception 'Stripe checkout attempt identity does not match';
  end if;
  if v_attempt.plan_key <> v_account.plan_key
     or v_attempt.subscription_price_pence <> v_account.subscription_price_pence
     or v_attempt.setup_fee_pence <> v_account.setup_fee_pence then
    raise exception 'Stripe checkout attempt pricing no longer matches the billing account';
  end if;

  perform app_private.write_audit_event(
    'user', null, p_business_id, null, null,
    'billing.stripe.checkout.prepare', 'stripe_checkout_attempt', p_attempt_id::text,
    'allowed', null, p_correlation_id,
    array['plan_key'], jsonb_build_object('plan_key', v_account.plan_key)
  );
  return query select true, 'ready', v_account.plan_key, v_account.billing_cycle,
    v_account.subscription_price_pence, v_account.setup_fee_pence,
    v_account.stripe_customer_id;
end
$$;

create or replace function app_private.bind_stripe_checkout_session(
  p_business_id uuid,
  p_attempt_id uuid,
  p_session_id text,
  p_customer_id text,
  p_livemode boolean,
  p_correlation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_attempt app_private.stripe_checkout_attempts%rowtype;
begin
  if p_correlation_id is null
     or p_session_id !~ '^cs_(test|live)_[A-Za-z0-9]+$'
     or (p_customer_id is not null and p_customer_id !~ '^cus_[A-Za-z0-9]+$') then
    raise exception 'invalid Stripe Checkout binding';
  end if;
  if p_livemode <> (p_session_id like 'cs_live_%') then
    raise exception 'Stripe Checkout mode does not match its identifier';
  end if;
  if not app_private.current_user_enabled()
     or app_private.current_support_session_id() is not null
     or not app_private.has_business_role(
       p_business_id,
       array['owner', 'admin', 'billing']::public.business_role[]
     ) then
    raise exception 'billing management permission required';
  end if;
  select * into strict v_attempt from app_private.stripe_checkout_attempts
  where id = p_attempt_id for update;
  if v_attempt.business_id <> p_business_id
     or v_attempt.actor_user_id <> app_private.current_user_id()
     or (v_attempt.stripe_checkout_session_id is not null and v_attempt.stripe_checkout_session_id <> p_session_id)
     or (v_attempt.livemode is not null and v_attempt.livemode <> p_livemode) then
    raise exception 'Stripe Checkout binding does not match its prepared attempt';
  end if;
  update app_private.stripe_checkout_attempts
  set stripe_checkout_session_id = p_session_id,
      stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
      livemode = p_livemode,
      status = case when status = 'prepared' then 'created' else status end,
      updated_at = statement_timestamp()
  where id = p_attempt_id;
  perform app_private.write_audit_event(
    'user', null, p_business_id, null, null,
    'billing.stripe.checkout.create', 'stripe_checkout_attempt', p_attempt_id::text,
    'completed', null, p_correlation_id,
    array['checkout_session'], jsonb_build_object('livemode', p_livemode)
  );
end
$$;

create or replace function app_private.get_stripe_billing_customer(
  p_business_id uuid,
  p_correlation_id uuid
)
returns table (allowed boolean, reason text, stripe_customer_id text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_account public.billing_accounts%rowtype;
begin
  if p_correlation_id is null then raise exception 'correlation_id is required'; end if;
  if not app_private.current_user_enabled()
     or app_private.current_support_session_id() is not null
     or not app_private.has_business_role(
       p_business_id,
       array['owner', 'admin', 'billing']::public.business_role[]
     ) then
    return query select false, 'access_denied', null::text;
    return;
  end if;
  select * into v_account from public.billing_accounts where business_id = p_business_id;
  if v_account.business_id is null then
    return query select false, 'billing_unavailable', null::text;
    return;
  end if;
  return query select true,
    case when v_account.stripe_customer_id is null then 'customer_missing' else 'ready' end,
    v_account.stripe_customer_id;
end
$$;

create or replace function app_private.apply_stripe_billing_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_api_version text,
  p_livemode boolean,
  p_business_id uuid,
  p_attempt_id uuid,
  p_checkout_session_id text,
  p_customer_id text,
  p_subscription_id text,
  p_checkout_state text,
  p_setup_paid boolean,
  p_subscription_state text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_payload_hash bytea,
  p_encrypted_payload bytea
)
returns table (duplicate boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_existing app_private.stripe_billing_events%rowtype;
  v_inserted_event_id text;
  v_attempt app_private.stripe_checkout_attempts%rowtype;
  v_account public.billing_accounts%rowtype;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_event_type not in (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed',
       'checkout.session.expired',
       'customer.subscription.created',
       'customer.subscription.updated',
       'customer.subscription.deleted'
     )
     or p_event_created_at is null
     or p_business_id is null
     or length(p_payload_hash) <> 32
     or p_encrypted_payload is null then
    raise exception 'invalid verified Stripe billing event';
  end if;
  if p_customer_id is not null and p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'invalid Stripe customer identifier';
  end if;
  if p_subscription_id is not null and p_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'invalid Stripe subscription identifier';
  end if;

  insert into app_private.stripe_billing_events (
    event_id, event_type, event_created_at, api_version, livemode,
    business_id, checkout_attempt_id, payload_hash, encrypted_payload
  ) values (
    p_event_id, p_event_type, p_event_created_at, p_api_version, p_livemode,
    p_business_id, p_attempt_id, p_payload_hash, p_encrypted_payload
  ) on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;
  if v_inserted_event_id is null then
    select * into strict v_existing from app_private.stripe_billing_events
    where event_id = p_event_id;
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'Stripe event ID was reused with a different payload';
    end if;
    return query select true;
    return;
  end if;

  select * into v_account from public.billing_accounts
  where business_id = p_business_id for update;
  if v_account.business_id is null then raise exception 'Stripe billing account is unavailable'; end if;

  if p_checkout_state is not null then
    if p_checkout_state not in ('completed', 'failed', 'expired')
       or p_attempt_id is null
       or p_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9]+$' then
      raise exception 'invalid Stripe Checkout event state';
    end if;
    select * into strict v_attempt from app_private.stripe_checkout_attempts
    where id = p_attempt_id for update;
    if v_attempt.business_id <> p_business_id
       or v_attempt.stripe_checkout_session_id <> p_checkout_session_id
       or v_attempt.livemode is distinct from p_livemode then
      raise exception 'Stripe Checkout event does not match its prepared attempt';
    end if;
    update app_private.stripe_checkout_attempts
    set status = p_checkout_state,
        stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
        completed_at = case when p_checkout_state = 'completed' then statement_timestamp() else null end,
        updated_at = statement_timestamp()
    where id = p_attempt_id;

    if p_checkout_state <> 'expired' then
      if v_account.stripe_livemode is not null and v_account.stripe_livemode <> p_livemode then
        raise exception 'Stripe account mode does not match the billing event';
      end if;
      if v_account.stripe_customer_id is not null
         and p_customer_id is not null
         and v_account.stripe_customer_id <> p_customer_id then
        raise exception 'Stripe customer does not match the billing account';
      end if;
      if v_account.stripe_subscription_id is not null
         and p_subscription_id is not null
         and v_account.stripe_subscription_id <> p_subscription_id then
        raise exception 'Stripe subscription does not match the billing account';
      end if;
      update public.billing_accounts
      set stripe_livemode = p_livemode,
          stripe_customer_id = coalesce(stripe_customer_id, p_customer_id),
          stripe_subscription_id = coalesce(stripe_subscription_id, p_subscription_id),
          setup_fee_paid_at = case
            when p_setup_paid then coalesce(setup_fee_paid_at, p_event_created_at)
            else setup_fee_paid_at
          end,
          updated_at = statement_timestamp()
      where business_id = p_business_id;
    end if;
  elsif p_subscription_state is not null then
    if p_subscription_state not in ('inactive', 'active', 'past_due', 'cancelled')
       or p_customer_id is null
       or p_subscription_id is null then
      raise exception 'invalid Stripe subscription event state';
    end if;
    if (p_period_start is null) <> (p_period_end is null)
       or (p_period_start is not null and p_period_end <= p_period_start) then
      raise exception 'invalid Stripe subscription billing period';
    end if;
    if p_attempt_id is not null then
      select * into strict v_attempt from app_private.stripe_checkout_attempts
      where id = p_attempt_id;
      if v_attempt.business_id <> p_business_id
         or v_attempt.livemode is distinct from p_livemode then
        raise exception 'Stripe subscription event does not match its Checkout attempt';
      end if;
    elsif v_account.stripe_subscription_id is distinct from p_subscription_id then
      raise exception 'Stripe subscription event has no trusted tenant binding';
    end if;
    if v_account.stripe_livemode is not null and v_account.stripe_livemode <> p_livemode then
      raise exception 'Stripe subscription mode does not match the billing account';
    end if;
    if v_account.stripe_customer_id is not null and v_account.stripe_customer_id <> p_customer_id then
      raise exception 'Stripe subscription customer does not match the billing account';
    end if;
    if v_account.stripe_subscription_id is not null and v_account.stripe_subscription_id <> p_subscription_id then
      raise exception 'Stripe subscription does not match the billing account';
    end if;
    if v_account.stripe_state_updated_at is null
       or p_event_created_at > v_account.stripe_state_updated_at
       or (
         p_event_created_at = v_account.stripe_state_updated_at
         and case p_subscription_state
           when 'cancelled' then 3 when 'past_due' then 2 when 'inactive' then 1 else 0
         end >= case v_account.stripe_subscription_state
           when 'cancelled' then 3 when 'past_due' then 2 when 'inactive' then 1 else 0
         end
       ) then
      update public.billing_accounts
      set stripe_livemode = p_livemode,
          stripe_customer_id = p_customer_id,
          stripe_subscription_id = p_subscription_id,
          stripe_subscription_state = p_subscription_state,
          stripe_state_updated_at = p_event_created_at,
          current_period_start = coalesce(p_period_start, current_period_start),
          current_period_end = coalesce(p_period_end, current_period_end),
          updated_at = statement_timestamp()
      where business_id = p_business_id;
    end if;
  else
    raise exception 'Stripe event has no supported billing state';
  end if;

  update public.billing_accounts
  set subscription_status = case stripe_subscription_state
        when 'active' then case when setup_fee_paid_at is not null then 'active' else 'inactive' end
        when 'past_due' then 'past_due'
        when 'cancelled' then 'cancelled'
        else 'inactive'
      end,
      updated_at = statement_timestamp()
  where business_id = p_business_id and stripe_subscription_state is not null;

  update app_private.stripe_billing_events
  set processed_at = statement_timestamp(),
      processing_status = 'processed',
      result_code = case when p_checkout_state is not null then 'checkout_recorded' else 'subscription_recorded' end
  where event_id = p_event_id;

  perform app_private.write_audit_event(
    'system', null, p_business_id, null, null,
    'billing.stripe.webhook', 'stripe_event', p_event_id,
    'completed', null, gen_random_uuid(),
    array['subscription_status', 'setup_fee_paid'],
    jsonb_build_object('event_type', p_event_type, 'livemode', p_livemode)
  );
  return query select false;
end
$$;

create or replace function app_private.purge_expired_stripe_webhook_payloads(
  p_limit integer default 1000
)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer;
begin
  if p_limit < 1 or p_limit > 10000 then raise exception 'invalid Stripe payload purge limit'; end if;
  with expired as (
    select event_id from app_private.stripe_billing_events
    where payload_expires_at <= statement_timestamp() and encrypted_payload is not null
    order by payload_expires_at
    for update skip locked
    limit p_limit
  )
  update app_private.stripe_billing_events event
  set encrypted_payload = null
  from expired
  where event.event_id = expired.event_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace view public.billing_account_status
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
  account.updated_at,
  account.stripe_customer_id is not null as stripe_customer_ready,
  account.stripe_subscription_id is not null as stripe_subscription_ready,
  account.setup_fee_paid_at is not null as setup_fee_paid
from public.billing_accounts account;

revoke all on table app_private.stripe_checkout_attempts, app_private.stripe_billing_events
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

revoke all on function app_private.prepare_stripe_checkout(uuid, uuid, uuid)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.bind_stripe_checkout_session(uuid, uuid, text, text, boolean, uuid)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.get_stripe_billing_customer(uuid, uuid)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.apply_stripe_billing_event(
  text, text, timestamptz, text, boolean, uuid, uuid, text, text, text,
  text, boolean, text, timestamptz, timestamptz, bytea, bytea
)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.purge_expired_stripe_webhook_payloads(integer)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

grant execute on function app_private.prepare_stripe_checkout(uuid, uuid, uuid) to afterword_runtime;
grant execute on function app_private.bind_stripe_checkout_session(uuid, uuid, text, text, boolean, uuid) to afterword_runtime;
grant execute on function app_private.get_stripe_billing_customer(uuid, uuid) to afterword_runtime;
grant execute on function app_private.apply_stripe_billing_event(
  text, text, timestamptz, text, boolean, uuid, uuid, text, text, text,
  text, boolean, text, timestamptz, timestamptz, bytea, bytea
) to afterword_ingress;
grant execute on function app_private.purge_expired_stripe_webhook_payloads(integer)
to afterword_worker, afterword_ops;

comment on table app_private.stripe_checkout_attempts is
  'Tenant-bound idempotency records for server-created Stripe Checkout Sessions.';
comment on table app_private.stripe_billing_events is
  'Signature-verified, replay-safe Stripe billing events with encrypted short-retention evidence.';
comment on function app_private.apply_stripe_billing_event(
  text, text, timestamptz, text, boolean, uuid, uuid, text, text, text,
  text, boolean, text, timestamptz, timestamptz, bytea, bytea
) is
  'Applies trusted Stripe state idempotently; account activation requires both an active subscription and paid setup fee.';
comment on function app_private.purge_expired_stripe_webhook_payloads(integer) is
  'Deletes encrypted Stripe payload evidence after 30 days while retaining event IDs and hashes for durable replay detection.';

commit;
