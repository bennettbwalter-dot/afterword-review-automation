begin;

-- The three auth-only commands expose no table access or execution path to
-- runtime, ingress, worker, ops, or PUBLIC.
select pg_catalog.has_function_privilege(
  'afterword_auth',
  'app_private.create_signup_email_request(text,text,text,bytea,bytea,timestamptz,timestamptz)',
  'execute'
) and pg_catalog.has_function_privilege(
  'afterword_auth',
  'app_private.record_signup_email_delivery(uuid,text,bytea,text)',
  'execute'
) and pg_catalog.has_function_privilege(
  'afterword_auth',
  'app_private.claim_signup_email_resend(bytea,bytea,timestamptz,timestamptz)',
  'execute'
) as auth_can_execute_signup_email_commands;
\assert

with protected_functions(signature) as (
  values
    ('app_private.create_signup_email_request(text,text,text,bytea,bytea,timestamptz,timestamptz)'),
    ('app_private.record_signup_email_delivery(uuid,text,bytea,text)'),
    ('app_private.claim_signup_email_resend(bytea,bytea,timestamptz,timestamptz)')
),
blocked_roles(role_name) as (
  values
    ('afterword_runtime'),
    ('afterword_ingress'),
    ('afterword_worker'),
    ('afterword_ops')
)
select pg_catalog.bool_and(
  not pg_catalog.has_function_privilege(role_name, signature, 'execute')
) as application_roles_cannot_execute_auth_functions
from protected_functions
cross join blocked_roles;
\assert

select not exists (
  select 1
  from (
    values
      ('app_private.create_signup_email_request(text,text,text,bytea,bytea,timestamptz,timestamptz)'::regprocedure),
      ('app_private.record_signup_email_delivery(uuid,text,bytea,text)'::regprocedure),
      ('app_private.claim_signup_email_resend(bytea,bytea,timestamptz,timestamptz)'::regprocedure)
  ) protected_function(oid)
  join pg_catalog.pg_proc procedure on procedure.oid = protected_function.oid
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )
  ) privilege
  where privilege.grantee = 0
    and privilege.privilege_type = 'EXECUTE'
) as public_cannot_execute_auth_functions;
\assert

set role afterword_migration_owner;

insert into public.users (id, auth_subject, email, display_name)
values (
  '80000000-0000-4000-8000-000000000001',
  'first-party:known-signup-email',
  'known-signup@example.test',
  'Known Signup'
);

reset role;
set role afterword_auth;

select *
from app_private.create_signup_email_request(
  'new-signup@example.test',
  'New Signup',
  'business',
  decode(repeat('81', 32), 'hex'),
  decode(repeat('82', 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
)
\gset new_

select *
from app_private.create_signup_email_request(
  'known-signup@example.test',
  'Known Signup',
  'business',
  decode(repeat('83', 32), 'hex'),
  decode(repeat('84', 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
)
\gset known_

select
  :'new_signup_intent_id'::uuid is not null
  and :'known_signup_intent_id'::uuid is not null
  and :'new_should_send_email'::boolean
  and not :'known_should_send_email'::boolean
  as public_return_values_hide_suppression_reason;
\assert

select pg_catalog.pg_get_function_result(
  'app_private.create_signup_email_request(text,text,text,bytea,bytea,timestamptz,timestamptz)'::regprocedure
) = 'TABLE(signup_intent_id uuid, should_send_email boolean)'
as public_return_columns_are_identical;
\assert

reset role;
set role afterword_migration_owner;

select
  (select delivery_state = 'pending'
     and delivery_attempt_count = 1
     and last_delivery_attempt_at is not null
     and next_delivery_attempt_at >= last_delivery_attempt_at + interval '60 seconds'
   from app_private.signup_intents
   where id = :'new_signup_intent_id'::uuid)
  and
  (select delivery_state = 'suppressed'
     and delivery_attempt_count = 0
     and last_delivery_attempt_at is null
     and next_delivery_attempt_at is null
   from app_private.signup_intents
   where id = :'known_signup_intent_id'::uuid)
  as new_address_is_pending_and_existing_address_is_suppressed;
\assert

select pg_catalog.set_config('app.test_new_signup_intent_id', :'new_signup_intent_id', true);

reset role;
set role afterword_auth;

select
  pg_catalog.count(*) filter (where signup_request.should_send_email) = 4
  and pg_catalog.count(*) filter (where not signup_request.should_send_email) = 1
  as fifth_recent_request_is_rate_limited_without_a_public_reason
from pg_catalog.generate_series(1, 5) request(request_index)
cross join lateral app_private.create_signup_email_request(
  'rate-limited-signup@example.test',
  'Rate Limited Signup',
  'business',
  decode(repeat(lpad(to_hex(request.request_index), 2, '0'), 32), 'hex'),
  decode(repeat(lpad(to_hex(request.request_index + 16), 2, '0'), 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
) signup_request;
\assert

do $$
begin
  begin
    perform app_private.record_signup_email_delivery(
      current_setting('app.test_new_signup_intent_id')::uuid,
      'accepted',
      pg_catalog.convert_to('raw-provider-id', 'UTF8'),
      null
    );
    raise exception 'assertion failed: raw provider reference was retained';
  exception when others then
    if sqlerrm = 'assertion failed: raw provider reference was retained' then
      raise;
    end if;
    if position('invalid signup email delivery result' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end
$$;

select app_private.record_signup_email_delivery(
  :'new_signup_intent_id'::uuid,
  'accepted',
  decode(repeat('85', 32), 'hex'),
  null
);

select *
from app_private.create_signup_email_request(
  'failed-signup@example.test',
  'Failed Signup',
  'agency',
  decode(repeat('86', 32), 'hex'),
  decode(repeat('87', 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
)
\gset failed_

select app_private.record_signup_email_delivery(
  :'failed_signup_intent_id'::uuid,
  'failed',
  null,
  'rejected'
);

reset role;
set role afterword_migration_owner;

select
  (select delivery_state = 'accepted'
     and pg_catalog.length(provider_message_reference_hash) = 32
     and provider_message_reference_hash = decode(repeat('85', 32), 'hex')
     and last_failure_class is null
   from app_private.signup_intents
   where id = :'new_signup_intent_id'::uuid)
  and
  (select delivery_state = 'failed'
     and provider_message_reference_hash is null
     and last_failure_class = 'rejected'
   from app_private.signup_intents
   where id = :'failed_signup_intent_id'::uuid)
  as accepted_and_failed_transitions_retain_only_bounded_values;
\assert

reset role;
set role afterword_auth;

select pg_catalog.count(*) = 0 as resend_before_cooldown_returns_no_row
from app_private.claim_signup_email_resend(
  decode(repeat('82', 32), 'hex'),
  decode(repeat('88', 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
);
\assert

reset role;
set role afterword_migration_owner;
update app_private.signup_intents
set next_delivery_attempt_at = statement_timestamp() - interval '1 second'
where id = :'new_signup_intent_id'::uuid;

reset role;
set role afterword_auth;

select *
from app_private.claim_signup_email_resend(
  decode(repeat('82', 32), 'hex'),
  decode(repeat('88', 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
)
\gset resend_

select :'resend_signup_intent_id'::uuid = :'new_signup_intent_id'::uuid
as resend_after_cooldown_returns_the_server_delivery_claim;
\assert

select pg_catalog.count(*) = 0 as old_verification_hash_cannot_be_consumed
from app_private.consume_signup_intent(decode(repeat('81', 32), 'hex'));
\assert

reset role;
set role afterword_migration_owner;

select token_hash = decode(repeat('88', 32), 'hex')
  and delivery_state = 'pending'
  and delivery_attempt_count = 2
  and provider_message_reference_hash is null
  and last_failure_class is null
  as resend_rotates_the_hash_and_clears_stale_delivery_state
from app_private.signup_intents
where id = :'new_signup_intent_id'::uuid;
\assert

reset role;
set role afterword_auth;

select app_private.record_signup_email_delivery(
  :'new_signup_intent_id'::uuid,
  'accepted',
  decode(repeat('89', 32), 'hex'),
  null
);

reset role;
set role afterword_migration_owner;
update app_private.signup_intents
set delivery_attempt_count = 3,
    next_delivery_attempt_at = statement_timestamp() - interval '1 second'
where id = :'new_signup_intent_id'::uuid;

reset role;
set role afterword_auth;

select pg_catalog.count(*) = 0 as attempt_four_is_refused
from app_private.claim_signup_email_resend(
  decode(repeat('82', 32), 'hex'),
  decode(repeat('8a', 32), 'hex'),
  statement_timestamp() + interval '15 minutes',
  statement_timestamp() + interval '60 seconds'
);
\assert

-- The two-session runner exercises this same receipt concurrently. This source
-- assertion makes the lock requirement visible in the SQL behavior contract.
select pg_catalog.pg_get_functiondef(
  'app_private.claim_signup_email_resend(bytea,bytea,timestamptz,timestamptz)'::regprocedure
) ilike '%FOR UPDATE%'
as concurrent_claims_are_row_locked;
\assert

rollback;
