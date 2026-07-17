\set ON_ERROR_STOP on
begin;

set role afterword_migration_owner;

insert into public.users (id, auth_subject, email, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'first-party:test-user-a', 'owner-a@example.test', 'Owner A'),
  ('22222222-2222-4222-8222-222222222222', 'first-party:test-user-b', 'owner-b@example.test', 'Owner B');
insert into app_private.auth_credentials (user_id, password_hash, email_verified_at) values
  ('11111111-1111-4111-8111-111111111111', 'scrypt$test-user-a', statement_timestamp()),
  ('22222222-2222-4222-8222-222222222222', 'scrypt$test-user-b', statement_timestamp());
insert into public.agencies (id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Agency A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Agency B');
insert into public.agency_memberships (agency_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');
insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Business A', 'business-a', 'UTC', 'GB'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Business B', 'business-b', 'UTC', 'GB');
insert into public.business_memberships (business_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'owner');
insert into public.locations (id, business_id, name, timezone) values
  ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000001', 'Location A', 'UTC'),
  ('aaaaaaaa-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000001', 'Location A Disabled', 'UTC'),
  ('bbbbbbbb-0000-4000-8000-000000000011', 'bbbbbbbb-0000-4000-8000-000000000001', 'Location B', 'UTC');

insert into public.message_template_versions (
  id, business_id, location_id, template_key, version, channel, body,
  includes_business_identity, includes_unsubscribe, approved_by
) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011',
   'review-sms', 1, 'sms', 'Thanks for choosing Business A. Review us: {{review_link}} Reply STOP to opt out.', true, true,
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000012',
   'review-sms', 2, 'sms', 'Thanks for choosing Business A. Review us: {{review_link}} Reply STOP to opt out.', true, true,
   '11111111-1111-4111-8111-111111111111');
insert into public.location_messaging_policies (
  business_id, location_id, channel, enabled, timezone, allowed_weekdays,
  send_window_start, send_window_end, max_messages_per_request, minimum_gap,
  destination_frequency_window, destination_frequency_max, hourly_limit,
  rule_version, updated_by
) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011', 'sms', true, 'UTC',
   array[1,2,3,4,5,6,7], time '00:00', time '23:59:59', 2, interval '1 hour', interval '30 days', 1, 50,
   'test-v1', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000012', 'sms', false, 'UTC',
   array[1,2,3,4,5,6,7], time '00:00', time '23:59:59', 2, interval '1 hour', interval '30 days', 1, 50,
   'test-v1', '11111111-1111-4111-8111-111111111111');

insert into public.integration_connections (
  id, business_id, location_id, provider, health, secret_reference, token_expires_at
) values (
  'aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000011', 'google', 'healthy',
  'db:app_private.integration_secrets/aaaaaaaa-0000-4000-8000-000000000201', statement_timestamp() + interval '1 hour'
);
insert into app_private.integration_secrets (
  business_id, integration_id, access_token_ciphertext, access_token_nonce, access_token_tag,
  refresh_token_ciphertext, refresh_token_nonce, refresh_token_tag
) values (
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000201',
  decode(repeat('11', 32), 'hex'), decode(repeat('12', 12), 'hex'), decode(repeat('13', 16), 'hex'),
  decode(repeat('14', 32), 'hex'), decode(repeat('15', 12), 'hex'), decode(repeat('16', 16), 'hex')
);
insert into public.google_profile_locations (
  id, business_id, location_id, integration_id, account_resource_name,
  location_resource_name, review_uri, granted_scopes, token_expires_at
) values (
  'aaaaaaaa-0000-4000-8000-000000000301', 'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000201',
  'accounts/1001', 'locations/2001', 'https://g.page/r/AfterwordTenantA/review',
  array['https://www.googleapis.com/auth/business.manage'], statement_timestamp() + interval '1 hour'
);
insert into public.review_destinations (
  id, business_id, location_id, destination_url, verified_at, verified_by
) values (
  'aaaaaaaa-0000-4000-8000-000000000401', 'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000011', 'https://g.page/r/AfterwordTenantA/review',
  statement_timestamp(), '11111111-1111-4111-8111-111111111111'
);
insert into public.qr_codes (
  id, business_id, location_id, review_destination_id, public_token, created_by
) values (
  'aaaaaaaa-0000-4000-8000-000000000501', 'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000401',
  'business-a-test-qr', '11111111-1111-4111-8111-111111111111'
);

create function app_private.test_expect_wrong_worker(p_job_id uuid, p_lease_token uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  begin
    perform app_private.evaluate_message_dispatch(p_job_id, 'wrong-worker', p_lease_token);
    raise exception 'assertion failed: wrong worker was accepted';
  exception when others then
    if sqlerrm = 'assertion failed: wrong worker was accepted' then raise; end if;
    if position('active matching lease' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
grant execute on function app_private.test_expect_wrong_worker(uuid, uuid) to afterword_worker;

reset role;
set role afterword_auth;
select app_private.record_login_result('owner-a@example.test', false);
select app_private.record_login_result('owner-a@example.test', false);
select app_private.record_login_result('owner-a@example.test', false);
select app_private.record_login_result('owner-a@example.test', false);
select app_private.record_login_result('owner-a@example.test', false);
select count(*) as locked_login_rows from app_private.lookup_login_credential('owner-a@example.test') \gset
select 1 / (case when :'locked_login_rows' = '0' then 1 else 0 end);
select app_private.record_login_result('owner-a@example.test', true);
select count(*) as unlocked_login_rows from app_private.lookup_login_credential('owner-a@example.test') \gset
select 1 / (case when :'unlocked_login_rows' = '1' then 1 else 0 end);
select app_private.issue_auth_session(
  '11111111-1111-4111-8111-111111111111', decode(repeat('a1', 32), 'hex'),
  statement_timestamp() + interval '12 hours', statement_timestamp() + interval '30 days', null, 'psql-test'
) as session_a \gset
select app_private.issue_auth_session(
  '22222222-2222-4222-8222-222222222222', decode(repeat('b2', 32), 'hex'),
  statement_timestamp() + interval '12 hours', statement_timestamp() + interval '30 days', null, 'psql-test'
) as session_b \gset

reset role;
set role afterword_runtime;
select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if app_private.current_user_id() is not null then
    raise exception 'raw app.user_id spoof created an identity';
  end if;
end $$;

select app_private.set_request_context_from_session(decode(repeat('a1', 32), 'hex'), null);
do $$ begin
  if app_private.current_user_id() <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'session A was not bound';
  end if;
  if (select count(*) from public.businesses) <> 1
     or not exists (select 1 from public.businesses where name = 'Business A') then
    raise exception 'business RLS did not isolate tenant A';
  end if;
  if exists (select 1 from public.locations where business_id = 'bbbbbbbb-0000-4000-8000-000000000001') then
    raise exception 'location RLS exposed tenant B';
  end if;
end $$;

select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if app_private.current_user_id() <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'legacy identity GUC overrode session identity';
  end if;
end $$;
select set_config('app.auth_session_id', :'session_b', true);
do $$ begin
  if app_private.current_user_id() is not null then
    raise exception 'mismatched session id and token hash created an identity';
  end if;
end $$;
select app_private.set_request_context_from_session(decode(repeat('a1', 32), 'hex'), null);

select app_private.store_google_oauth_state(
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011',
  decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 32), 'hex'),
  decode(repeat('c3', 12), 'hex'), decode(repeat('c4', 16), 'hex'),
  statement_timestamp() + interval '10 minutes'
);

reset role;
set role afterword_auth;
select * from app_private.consume_google_oauth_state(decode(repeat('c1', 32), 'hex')) \gset oauth_
select 1 / (case when :'oauth_actor_user_id' = '11111111-1111-4111-8111-111111111111' then 1 else 0 end);
select app_private.store_google_profile_selection_state_for_actor(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011',
  decode(repeat('c5', 32), 'hex'), decode(repeat('c6', 32), 'hex'),
  decode(repeat('c7', 12), 'hex'), decode(repeat('c8', 16), 'hex'),
  statement_timestamp() + interval '10 minutes'
);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('a1', 32), 'hex'), null);
select * from app_private.peek_google_profile_selection_state(decode(repeat('c5', 32), 'hex')) \gset selection_
select 1 / (case when :'selection_business_id' = 'aaaaaaaa-0000-4000-8000-000000000001' then 1 else 0 end);
select * from app_private.consume_google_profile_selection_state(decode(repeat('c5', 32), 'hex')) \gset selected_
select 1 / (case when :'selected_location_id' = 'aaaaaaaa-0000-4000-8000-000000000011' then 1 else 0 end);

reset role;
set role afterword_auth;
select app_private.save_google_connection_for_actor(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011',
  'accounts/1001', 'locations/2001', 'https://g.page/r/AfterwordTenantA/review',
  decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 12), 'hex'), decode(repeat('d3', 16), 'hex'),
  decode(repeat('d4', 32), 'hex'), decode(repeat('d5', 12), 'hex'), decode(repeat('d6', 16), 'hex'),
  statement_timestamp() + interval '1 hour',
  array['https://www.googleapis.com/auth/business.manage']
);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('a1', 32), 'hex'), null);

do $$ begin
  begin
    perform app_private.create_manual_completed_job(
      p_business_id => 'bbbbbbbb-0000-4000-8000-000000000001',
      p_location_id => 'bbbbbbbb-0000-4000-8000-000000000011',
      p_external_job_id => 'cross-tenant-job', p_service_label => 'Cross tenant',
      p_completed_at => statement_timestamp(), p_customer_reference => 'cross-tenant-job',
      p_first_name_ciphertext => decode(repeat('21',16),'hex'), p_first_name_nonce => decode(repeat('22',12),'hex'),
      p_first_name_tag => decode(repeat('23',16),'hex'),
      p_phone_ciphertext => decode(repeat('24',16),'hex'), p_phone_nonce => decode(repeat('25',12),'hex'),
      p_phone_tag => decode(repeat('26',16),'hex'), p_phone_hash => decode(repeat('27',32),'hex'),
      p_email_ciphertext => null, p_email_nonce => null, p_email_tag => null, p_email_hash => null,
      p_channel => 'sms', p_destination_hash => decode(repeat('27',32),'hex'), p_template_version_id => null,
      p_consent_status => 'granted', p_consent_wording => 'Test consent', p_consent_wording_version => 'v1',
      p_consent_purpose => 'review request', p_consent_captured_at => statement_timestamp(),
      p_consent_source => 'test', p_transaction_reference => 'cross-tenant-job', p_evidence_reference => 'test-evidence',
      p_payload_destination_ciphertext => decode(repeat('24',16),'hex'), p_payload_destination_nonce => decode(repeat('25',12),'hex'),
      p_payload_destination_tag => decode(repeat('26',16),'hex'), p_payload_body_ciphertext => decode(repeat('28',32),'hex'),
      p_payload_body_nonce => decode(repeat('29',12),'hex'), p_payload_body_tag => decode(repeat('30',16),'hex'),
      p_payload_subject_ciphertext => null, p_payload_subject_nonce => null, p_payload_subject_tag => null,
      p_correlation_id => '90000000-0000-4000-8000-000000000001'
    );
    raise exception 'assertion failed: cross-tenant command succeeded';
  exception when others then
    if sqlerrm = 'assertion failed: cross-tenant command succeeded' then raise; end if;
    if position('business management permission required' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

select * from app_private.create_manual_completed_job(
  p_business_id => 'aaaaaaaa-0000-4000-8000-000000000001',
  p_location_id => 'aaaaaaaa-0000-4000-8000-000000000012',
  p_external_job_id => 'blocked-job', p_service_label => 'Disabled policy job',
  p_completed_at => statement_timestamp(), p_customer_reference => 'blocked-job',
  p_first_name_ciphertext => decode(repeat('31',16),'hex'), p_first_name_nonce => decode(repeat('32',12),'hex'),
  p_first_name_tag => decode(repeat('33',16),'hex'),
  p_phone_ciphertext => decode(repeat('34',16),'hex'), p_phone_nonce => decode(repeat('35',12),'hex'),
  p_phone_tag => decode(repeat('36',16),'hex'), p_phone_hash => decode(repeat('37',32),'hex'),
  p_email_ciphertext => null, p_email_nonce => null, p_email_tag => null, p_email_hash => null,
  p_channel => 'sms', p_destination_hash => decode(repeat('37',32),'hex'),
  p_template_version_id => 'aaaaaaaa-0000-4000-8000-000000000102',
  p_consent_status => 'granted', p_consent_wording => 'Test consent', p_consent_wording_version => 'v1',
  p_consent_purpose => 'review request', p_consent_captured_at => statement_timestamp(),
  p_consent_source => 'test', p_transaction_reference => 'blocked-job', p_evidence_reference => 'test-evidence',
  p_payload_destination_ciphertext => decode(repeat('34',16),'hex'), p_payload_destination_nonce => decode(repeat('35',12),'hex'),
  p_payload_destination_tag => decode(repeat('36',16),'hex'), p_payload_body_ciphertext => decode(repeat('38',32),'hex'),
  p_payload_body_nonce => decode(repeat('39',12),'hex'), p_payload_body_tag => decode(repeat('40',16),'hex'),
  p_payload_subject_ciphertext => null, p_payload_subject_nonce => null, p_payload_subject_tag => null,
  p_correlation_id => '90000000-0000-4000-8000-000000000002'
) \gset blocked_
select 1 / (case when :'blocked_request_status' = 'blocked' then 1 else 0 end);
select 1 / (case when (select count(*) from public.message_jobs where review_request_id = :'blocked_review_request_id') = 0 then 1 else 0 end);

select * from app_private.create_manual_completed_job(
  p_business_id => 'aaaaaaaa-0000-4000-8000-000000000001',
  p_location_id => 'aaaaaaaa-0000-4000-8000-000000000011',
  p_external_job_id => 'valid-job', p_service_label => 'Valid job',
  p_completed_at => statement_timestamp(), p_customer_reference => 'valid-job',
  p_first_name_ciphertext => decode(repeat('41',16),'hex'), p_first_name_nonce => decode(repeat('42',12),'hex'),
  p_first_name_tag => decode(repeat('43',16),'hex'),
  p_phone_ciphertext => decode(repeat('44',16),'hex'), p_phone_nonce => decode(repeat('45',12),'hex'),
  p_phone_tag => decode(repeat('46',16),'hex'), p_phone_hash => decode(repeat('47',32),'hex'),
  p_email_ciphertext => null, p_email_nonce => null, p_email_tag => null, p_email_hash => null,
  p_channel => 'sms', p_destination_hash => decode(repeat('47',32),'hex'),
  p_template_version_id => 'aaaaaaaa-0000-4000-8000-000000000101',
  p_consent_status => 'granted', p_consent_wording => 'Test consent', p_consent_wording_version => 'v1',
  p_consent_purpose => 'review request', p_consent_captured_at => statement_timestamp(),
  p_consent_source => 'test', p_transaction_reference => 'valid-job', p_evidence_reference => 'test-evidence',
  p_payload_destination_ciphertext => decode(repeat('44',16),'hex'), p_payload_destination_nonce => decode(repeat('45',12),'hex'),
  p_payload_destination_tag => decode(repeat('46',16),'hex'), p_payload_body_ciphertext => decode(repeat('48',32),'hex'),
  p_payload_body_nonce => decode(repeat('49',12),'hex'), p_payload_body_tag => decode(repeat('50',16),'hex'),
  p_payload_subject_ciphertext => null, p_payload_subject_nonce => null, p_payload_subject_tag => null,
  p_correlation_id => '90000000-0000-4000-8000-000000000003'
) \gset valid_
select 1 / (case when :'valid_request_status' = 'scheduled' then 1 else 0 end);

reset role;
set role afterword_worker;
select * from app_private.claim_google_review_sync('google-worker-a', 10) \gset gsync_
select 1 / (case when :'gsync_review_uri' = 'https://g.page/r/AfterwordTenantA/review' and :'gsync_sync_lease_token' <> '' then 1 else 0 end);
select 1 / (case when app_private.finish_google_review_sync(
  :'gsync_integration_id', :'gsync_sync_worker_id', :'gsync_sync_lease_token', true, null, array[]::text[]
) = 'healthy' then 1 else 0 end);
select id as job_id, lease_token as job_lease_token
from app_private.claim_message_jobs('worker-a', 10, 120) \gset claimed_
select app_private.test_expect_wrong_worker(:'claimed_job_id', :'claimed_job_lease_token');
select * from app_private.evaluate_message_dispatch(:'claimed_job_id', 'worker-a', :'claimed_job_lease_token') \gset dispatch_
select 1 / (case when :'dispatch_decision' = 'allow' then 1 else 0 end);
select * from app_private.get_message_dispatch_payload(:'claimed_job_id', 'worker-a', :'claimed_job_lease_token') \gset payload_
select 1 / (case when :'payload_review_uri' = 'https://g.page/r/AfterwordTenantA/review' then 1 else 0 end);
select app_private.finish_message_attempt(
  :'payload_message_attempt_id', 'worker-a', :'claimed_job_lease_token',
  'accepted', 'SM-test-tenant-a-1', '201', null
);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('a1', 32), 'hex'), null);
select 1 / (case when (select sent_count from public.review_requests where id = :'valid_review_request_id') = 1 then 1 else 0 end);
select 1 / (case when (select count(*) from public.message_jobs where review_request_id = :'valid_review_request_id' and sequence_number = 2 and status = 'scheduled') = 1 then 1 else 0 end);
reset role;
set role afterword_migration_owner;
select 1 / (case when (select count(*) from public.message_jobs message_job join app_private.message_dispatch_payloads payload on payload.business_id = message_job.business_id and payload.message_job_id = message_job.id where message_job.review_request_id = :'valid_review_request_id' and message_job.sequence_number = 2) = 1 then 1 else 0 end);

reset role;
set role afterword_ingress;
select * from app_private.resolve_qr_review_flow('business-a-test-qr') \gset qr_
select 1 / (case when :'qr_business_name' = 'Business A' and :'qr_location_name' = 'Location A' then 1 else 0 end);
select * from app_private.record_message_provider_webhook(
  'twilio', 'twilio-status-1', 'SM-test-tenant-a-1', 'delivered',
  decode(repeat('61',32),'hex'), decode(repeat('62',32),'hex')
) \gset hook_first_
select * from app_private.record_message_provider_webhook(
  'twilio', 'twilio-status-1', 'SM-test-tenant-a-1', 'delivered',
  decode(repeat('61',32),'hex'), decode(repeat('62',32),'hex')
) \gset hook_second_
select 1 / (case when not :'hook_first_duplicate'::boolean and :'hook_second_duplicate'::boolean then 1 else 0 end);
select * from app_private.record_message_suppression_webhook(
  'twilio', 'twilio-stop-1', 'SM-test-tenant-a-1', 'STOP', 'suppress', 'customer_stop',
  decode(repeat('63',32),'hex'), decode(repeat('64',32),'hex')
) \gset suppression_
select * from app_private.record_google_pubsub_event(
  'pubsub-message-1', 'locations/2001', 'NEW_REVIEW',
  decode(repeat('65',32),'hex'), decode(repeat('66',32),'hex')
) \gset pubsub_first_
select * from app_private.record_google_pubsub_event(
  'pubsub-message-1', 'locations/2001', 'NEW_REVIEW',
  decode(repeat('65',32),'hex'), decode(repeat('66',32),'hex')
) \gset pubsub_second_
select 1 / (case when not :'pubsub_first_duplicate'::boolean and :'pubsub_second_duplicate'::boolean then 1 else 0 end);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('a1', 32), 'hex'), null);
do $$ begin
  if (select count(*) from public.channel_suppressions where lifted_at is null) <> 1 then
    raise exception 'signed STOP event did not create tenant suppression';
  end if;
end $$;
select app_private.request_google_review_sync(
  'aaaaaaaa-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004'
);
select * from app_private.disconnect_google_connection(
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000005'
) \gset disconnected_
select 1 / (case when :'disconnected_revocation_id' <> '' then 1 else 0 end);

reset role;
set role afterword_worker;
select * from app_private.claim_google_token_revocations('isolation-worker', 10, 120)
where revocation_id = :'disconnected_revocation_id' \gset claimed_revocation_
select 1 / (case when :'claimed_revocation_revocation_id' = :'disconnected_revocation_id' then 1 else 0 end);
select 1 / (case when app_private.finish_google_token_revocation(
  :'claimed_revocation_revocation_id', 'isolation-worker', :'claimed_revocation_lease_token', true, null
) = 'completed' then 1 else 0 end);

reset role;
set role afterword_runtime;
select app_private.set_request_context_from_session(decode(repeat('b2', 32), 'hex'), null);
do $$ begin
  if (select count(*) from public.businesses) <> 1
     or not exists (select 1 from public.businesses where name = 'Business B')
     or exists (select 1 from public.review_requests where business_id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'session B crossed the tenant boundary';
  end if;
end $$;

reset role;
do $$ begin
  if has_table_privilege('afterword_runtime', 'app_private.auth_sessions', 'select')
     or has_table_privilege('afterword_runtime', 'app_private.message_dispatch_payloads', 'select')
     or has_table_privilege('afterword_worker', 'app_private.integration_secrets', 'select')
     or has_table_privilege('afterword_ingress', 'app_private.provider_webhook_events', 'select') then
    raise exception 'private table privilege leaked to an application role';
  end if;
  if to_regprocedure('app_private.complete_google_token_revocation(uuid)') is not null then
    raise exception 'unfenced token-revocation helper must not exist';
  end if;
  if has_function_privilege(
       'afterword_auth',
       'app_private.store_google_profile_selection_state(uuid,uuid,bytea,bytea,bytea,bytea,timestamptz)',
       'execute'
     )
     or has_function_privilege(
       'afterword_auth',
       'app_private.save_google_connection(uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,timestamptz,text[])',
       'execute'
     )
     or not has_function_privilege(
       'afterword_auth',
       'app_private.store_google_profile_selection_state_for_actor(uuid,uuid,uuid,bytea,bytea,bytea,bytea,timestamptz)',
       'execute'
     )
     or not has_function_privilege(
       'afterword_auth',
       'app_private.save_google_connection_for_actor(uuid,uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,timestamptz,text[])',
       'execute'
     )
     or not has_function_privilege(
       'afterword_runtime', 'app_private.peek_google_profile_selection_state(bytea)', 'execute'
     )
     or has_function_privilege(
       'afterword_auth', 'app_private.peek_google_profile_selection_state(bytea)', 'execute'
     ) then
    raise exception 'OAuth function capability boundary is incorrect';
  end if;
end $$;

rollback;
