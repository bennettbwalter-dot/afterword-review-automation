begin;

alter table app_private.signup_intents
  add column delivery_state text not null default 'suppressed'
    check (delivery_state in ('pending', 'accepted', 'failed', 'suppressed')),
  add column delivery_attempt_count integer not null default 0
    check (delivery_attempt_count between 0 and 3),
  add column last_delivery_attempt_at timestamptz,
  add column next_delivery_attempt_at timestamptz,
  add column provider_message_reference_hash bytea
    check (provider_message_reference_hash is null or pg_catalog.length(provider_message_reference_hash) = 32),
  add column resend_receipt_hash bytea unique
    check (resend_receipt_hash is null or pg_catalog.length(resend_receipt_hash) = 32),
  add column last_failure_class text
    check (last_failure_class is null or last_failure_class in ('timeout', 'rejected', 'invalid_response')),
  add constraint signup_intents_delivery_state_shape check (
    (
      delivery_state = 'suppressed'
      and delivery_attempt_count = 0
      and last_delivery_attempt_at is null
      and next_delivery_attempt_at is null
      and provider_message_reference_hash is null
      and last_failure_class is null
    )
    or (
      delivery_state = 'pending'
      and delivery_attempt_count between 1 and 3
      and last_delivery_attempt_at is not null
      and next_delivery_attempt_at is not null
      and provider_message_reference_hash is null
      and last_failure_class is null
    )
    or (
      delivery_state = 'accepted'
      and delivery_attempt_count between 1 and 3
      and last_delivery_attempt_at is not null
      and next_delivery_attempt_at is not null
      and provider_message_reference_hash is not null
      and last_failure_class is null
    )
    or (
      delivery_state = 'failed'
      and delivery_attempt_count between 1 and 3
      and last_delivery_attempt_at is not null
      and next_delivery_attempt_at is not null
      and provider_message_reference_hash is null
      and last_failure_class is not null
    )
  );

drop function app_private.create_signup_intent(text, text, text, bytea, timestamptz);

create or replace function app_private.create_signup_email_request(
  p_email text,
  p_display_name text,
  p_account_type text,
  p_token_hash bytea,
  p_resend_receipt_hash bytea,
  p_expires_at timestamptz,
  p_next_delivery_attempt_at timestamptz
)
returns table (signup_intent_id uuid, should_send_email boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_registered boolean;
  v_rate_limited boolean;
  v_should_send_email boolean;
  v_signup_intent_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 10));

  if v_email is null
     or v_email = ''
     or p_token_hash is null
     or pg_catalog.length(p_token_hash) <> 32
     or p_resend_receipt_hash is null
     or pg_catalog.length(p_resend_receipt_hash) <> 32
     or p_token_hash = p_resend_receipt_hash
     or p_account_type is null
     or p_account_type not in ('business', 'agency')
     or p_expires_at is null
     or p_expires_at <= pg_catalog.statement_timestamp()
     or p_expires_at > pg_catalog.statement_timestamp() + interval '30 minutes'
     or p_next_delivery_attempt_at is null
  then
    raise exception 'invalid signup email request';
  end if;

  select exists(
    select 1
    from public.users
    where pg_catalog.lower(email) = v_email
  )
  into v_registered;

  select pg_catalog.count(*) >= 4
  into v_rate_limited
  from app_private.signup_intents
  where email = v_email
    and issued_at > pg_catalog.statement_timestamp() - interval '15 minutes';

  v_should_send_email := not v_registered and not v_rate_limited;

  insert into app_private.signup_intents (
    email,
    display_name,
    account_type,
    token_hash,
    expires_at,
    delivery_state,
    delivery_attempt_count,
    last_delivery_attempt_at,
    next_delivery_attempt_at,
    resend_receipt_hash
  )
  values (
    v_email,
    pg_catalog.btrim(p_display_name),
    p_account_type,
    p_token_hash,
    p_expires_at,
    case when v_should_send_email then 'pending' else 'suppressed' end,
    case when v_should_send_email then 1 else 0 end,
    case when v_should_send_email then pg_catalog.statement_timestamp() else null end,
    case
      when v_should_send_email
      then greatest(
        p_next_delivery_attempt_at,
        pg_catalog.statement_timestamp() + interval '60 seconds'
      )
      else null
    end,
    p_resend_receipt_hash
  )
  returning id into v_signup_intent_id;

  return query
  select v_signup_intent_id, v_should_send_email;
end
$$;

create or replace function app_private.record_signup_email_delivery(
  p_signup_intent_id uuid,
  p_delivery_state text,
  p_provider_message_reference_hash bytea,
  p_failure_class text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_signup_intent app_private.signup_intents%rowtype;
begin
  if p_delivery_state is null
     or p_delivery_state not in ('accepted', 'failed')
     or (
       p_delivery_state = 'accepted'
       and (
         p_provider_message_reference_hash is null
         or pg_catalog.length(p_provider_message_reference_hash) <> 32
         or p_failure_class is not null
       )
     )
     or (
       p_delivery_state = 'failed'
       and (
         p_provider_message_reference_hash is not null
         or p_failure_class is null
         or p_failure_class not in ('timeout', 'rejected', 'invalid_response')
       )
     )
  then
    raise exception 'invalid signup email delivery result';
  end if;

  select intent.*
  into v_signup_intent
  from app_private.signup_intents intent
  where intent.id = p_signup_intent_id
  for update;

  if not found or v_signup_intent.delivery_state <> 'pending' then
    raise exception 'signup email delivery request unavailable';
  end if;

  update app_private.signup_intents
  set delivery_state = p_delivery_state,
      provider_message_reference_hash = case
        when p_delivery_state = 'accepted' then p_provider_message_reference_hash
        else null
      end,
      last_failure_class = case
        when p_delivery_state = 'failed' then p_failure_class
        else null
      end
  where id = v_signup_intent.id;
end
$$;

create or replace function app_private.claim_signup_email_resend(
  p_resend_receipt_hash bytea,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_next_delivery_attempt_at timestamptz
)
returns table (
  signup_intent_id uuid,
  email text,
  display_name text,
  expires_at timestamptz,
  next_delivery_attempt_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_signup_intent app_private.signup_intents%rowtype;
begin
  if p_resend_receipt_hash is null
     or pg_catalog.length(p_resend_receipt_hash) <> 32
     or p_token_hash is null
     or pg_catalog.length(p_token_hash) <> 32
     or p_token_hash = p_resend_receipt_hash
     or p_expires_at is null
     or p_expires_at <= pg_catalog.statement_timestamp()
     or p_expires_at > pg_catalog.statement_timestamp() + interval '30 minutes'
     or p_next_delivery_attempt_at is null
  then
    return;
  end if;

  select intent.*
  into v_signup_intent
  from app_private.signup_intents intent
  where intent.resend_receipt_hash = p_resend_receipt_hash
  for update;

  if not found
     or v_signup_intent.delivery_state not in ('accepted', 'failed')
     or v_signup_intent.consumed_at is not null
     or v_signup_intent.registered_at is not null
     or v_signup_intent.expires_at <= pg_catalog.statement_timestamp()
     or v_signup_intent.delivery_attempt_count >= 3
     or not (
       v_signup_intent.delivery_attempt_count < 3
       and v_signup_intent.next_delivery_attempt_at <= statement_timestamp()
     )
  then
    return;
  end if;

  return query
  update app_private.signup_intents intent
  set token_hash = p_token_hash,
      expires_at = p_expires_at,
      delivery_state = 'pending',
      delivery_attempt_count = intent.delivery_attempt_count + 1,
      last_delivery_attempt_at = pg_catalog.statement_timestamp(),
      next_delivery_attempt_at = greatest(
        p_next_delivery_attempt_at,
        pg_catalog.statement_timestamp() + interval '60 seconds'
      ),
      provider_message_reference_hash = null,
      last_failure_class = null
  where intent.id = v_signup_intent.id
  returning
    intent.id,
    intent.email,
    intent.display_name,
    intent.expires_at,
    intent.next_delivery_attempt_at;
end
$$;

create or replace function app_private.consume_signup_intent(p_token_hash bytea)
returns table (verified_signup_id uuid, email text, display_name text, account_type text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    return;
  end if;

  return query
  update app_private.signup_intents intent
  set consumed_at = pg_catalog.statement_timestamp(),
      attempt_count = attempt_count + 1
  where intent.token_hash = p_token_hash
    and intent.delivery_state = 'accepted'
    and intent.consumed_at is null
    and intent.registered_at is null
    and intent.expires_at > pg_catalog.statement_timestamp()
  returning intent.id, intent.email, intent.display_name, intent.account_type;
end
$$;

revoke all on function app_private.create_signup_email_request(text, text, text, bytea, bytea, timestamptz, timestamptz)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.record_signup_email_delivery(uuid, text, bytea, text)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
revoke all on function app_private.claim_signup_email_resend(bytea, bytea, timestamptz, timestamptz)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;

grant execute on function app_private.create_signup_email_request(text, text, text, bytea, bytea, timestamptz, timestamptz)
to afterword_auth;
grant execute on function app_private.record_signup_email_delivery(uuid, text, bytea, text)
to afterword_auth;
grant execute on function app_private.claim_signup_email_resend(bytea, bytea, timestamptz, timestamptz)
to afterword_auth;

commit;
