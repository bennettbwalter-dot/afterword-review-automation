begin;

create table app_private.signup_intents (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email))),
  account_type text not null check (account_type in ('business', 'agency')),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  token_hash bytea not null unique check (length(token_hash) = 32),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  registered_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  request_count integer not null default 1 check (request_count > 0),
  check (expires_at > issued_at and expires_at <= issued_at + interval '30 minutes')
);
create index signup_intents_email_active_idx on app_private.signup_intents(email, expires_at) where consumed_at is null;

alter table public.agencies add column customer_kind text not null default 'agency' check (customer_kind in ('agency', 'direct_container'));
alter table public.locations add column locale text not null default 'en-GB';
alter table public.locations add column website_url text;
alter table public.locations add column contact_phone text;
alter table public.locations add column default_cta text not null default 'leave_review';

create table public.account_onboarding (
  user_id uuid primary key references public.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id),
  business_id uuid references public.businesses(id),
  current_step text not null check (current_step in ('business', 'location', 'google_connection', 'agency_setup', 'complete')),
  completed_steps text[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check ((business_id is not null and current_step in ('business', 'location', 'google_connection', 'complete')) or (business_id is null and current_step in ('agency_setup', 'complete')))
);
alter table public.account_onboarding enable row level security;
alter table public.account_onboarding force row level security;
create policy account_onboarding_owner on public.account_onboarding for select to afterword_runtime using (user_id = app_private.current_user_id());
create policy account_onboarding_owner_update on public.account_onboarding for update to afterword_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id());

create or replace function app_private.create_signup_intent(p_email text, p_display_name text, p_account_type text, p_token_hash bytea, p_expires_at timestamptz)
returns table (accepted boolean, should_send_email boolean)
language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_email text := lower(btrim(p_email)); v_existing boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 10));
  if p_token_hash is null or length(p_token_hash) <> 32 or p_account_type not in ('business','agency') or p_expires_at <= statement_timestamp() or p_expires_at > statement_timestamp() + interval '30 minutes' then raise exception 'invalid signup intent'; end if;
  select exists(select 1 from public.users where lower(email) = v_email) into v_existing;
  if v_existing then return query select true, false; return; end if;
  if (select count(*) from app_private.signup_intents where email = v_email and issued_at > statement_timestamp() - interval '15 minutes') >= 4 then return query select true, false; return; end if;
  insert into app_private.signup_intents(email, display_name, account_type, token_hash, expires_at) values (v_email, btrim(p_display_name), p_account_type, p_token_hash, p_expires_at);
  return query select true, true;
end $$;

drop function app_private.resolve_auth_session_with_role(bytea);
create function app_private.resolve_auth_session_with_role(p_token_hash bytea)
returns table (session_id uuid, user_id uuid, email text, display_name text, agency_id uuid, agency_role public.agency_role, business_id uuid, business_role public.business_role, platform_role text, product_role text, mfa_verified_at timestamptz, step_up_verified_at timestamptz)
language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_session app_private.auth_sessions%rowtype;
begin
  select session.* into v_session from app_private.auth_sessions session join public.users app_user on app_user.id=session.user_id and app_user.disabled_at is null where session.token_hash=p_token_hash and session.revoked_at is null and session.idle_expires_at > statement_timestamp() and session.absolute_expires_at > statement_timestamp() for update of session;
  if not found then return; end if;
  if v_session.last_seen_at < statement_timestamp() - interval '5 minutes' then update app_private.auth_sessions set last_seen_at=statement_timestamp(), idle_expires_at=least(absolute_expires_at,statement_timestamp()+interval '12 hours') where id=v_session.id; end if;
  return query
  select v_session.id, app_user.id, app_user.email, app_user.display_name, agency_membership.agency_id, agency_membership.role, business_membership.business_id, business_membership.role,
    case when agency.customer_kind = 'direct_container' and business_membership.role is not null then 'business_owner'
         when agency_membership.role::text in ('owner','admin') then 'agency_admin'
         when agency_membership.role::text in ('operator','support') then 'agency_user'
         when business_membership.role is not null then 'business_owner' else null end,
    case when agency.customer_kind = 'direct_container' and business_membership.role::text in ('owner','admin') then 'owner'
         when agency.customer_kind = 'direct_container' and business_membership.role::text = 'operator' then 'staff'
         when agency.customer_kind = 'direct_container' and business_membership.role::text = 'approver' then 'client_approver'
         when agency_membership.role::text in ('owner','admin') then 'owner'
         when agency_membership.role::text = 'operator' then 'staff'
         when business_membership.role::text in ('owner','admin') then 'owner'
         when business_membership.role::text = 'operator' then 'staff'
         when business_membership.role::text = 'approver' then 'client_approver' else null end,
    v_session.mfa_verified_at, v_session.step_up_verified_at
  from public.users app_user
  left join lateral (select membership.agency_id,membership.user_id,membership.role from public.agency_memberships membership where membership.user_id=app_user.id and membership.status='active' order by membership.created_at,membership.agency_id limit 1) agency_membership on true
  left join public.agencies agency on agency.id=agency_membership.agency_id
  left join lateral (select membership.business_id,membership.user_id,membership.role from public.business_memberships membership where membership.user_id=app_user.id and membership.status='active' and not exists(select 1 from public.business_memberships other_membership where other_membership.user_id=app_user.id and other_membership.status='active' and other_membership.business_id<>membership.business_id) order by membership.created_at,membership.business_id limit 1) business_membership on true
  where app_user.id=v_session.user_id and (agency_membership.user_id is not null or business_membership.user_id is not null);
end $$;

create or replace function app_private.consume_signup_intent(p_token_hash bytea)
returns table (verified_signup_id uuid, email text, display_name text, account_type text)
language plpgsql volatile security definer set search_path = pg_catalog as $$
begin
  if p_token_hash is null or length(p_token_hash) <> 32 then return; end if;
  return query update app_private.signup_intents intent set consumed_at = statement_timestamp(), attempt_count = attempt_count + 1
    where intent.token_hash = p_token_hash and intent.consumed_at is null and intent.registered_at is null and intent.expires_at > statement_timestamp()
    returning intent.id, intent.email, intent.display_name, intent.account_type;
end $$;

create or replace function app_private.register_verified_signup(p_intent_id uuid, p_password_hash text, p_agency_name text, p_business_name text, p_location_name text, p_country text, p_timezone text, p_direct_container boolean, p_session_hash bytea, p_idle_expires_at timestamptz, p_absolute_expires_at timestamptz, p_ip_hash bytea, p_user_agent text)
returns table (user_id uuid, session_id uuid, agency_id uuid, business_id uuid, location_id uuid, onboarding_step text)
language plpgsql volatile security definer set search_path = pg_catalog as $$
declare i app_private.signup_intents%rowtype; u uuid; a uuid; b uuid; l uuid; s uuid; slug text; is_direct boolean;
begin
  select * into i from app_private.signup_intents where id = p_intent_id for update;
  if not found or i.consumed_at is null or i.registered_at is not null or i.expires_at <= statement_timestamp() then raise exception 'verified signup unavailable'; end if;
  if p_password_hash not like 'scrypt$%' or p_session_hash is null or length(p_session_hash) <> 32 then raise exception 'invalid registration credential'; end if;
  if exists (select 1 from public.users where lower(email) = i.email) then raise exception 'verified email unavailable'; end if;
  is_direct := i.account_type = 'business';
  if is_direct <> p_direct_container then raise exception 'account type mismatch'; end if;
  if is_direct and (coalesce(btrim(p_business_name),'') = '' or coalesce(btrim(p_location_name),'') = '' or p_country not in ('GB','US') or coalesce(btrim(p_timezone),'') = '') then raise exception 'direct business setup is incomplete'; end if;
  if not is_direct and coalesce(btrim(p_agency_name),'') = '' then raise exception 'agency setup is incomplete'; end if;
  insert into public.users(auth_subject,email,display_name) values ('local:' || gen_random_uuid()::text, i.email, i.display_name) returning id into u;
  insert into app_private.auth_credentials(user_id,password_hash,email_verified_at) values (u,p_password_hash,statement_timestamp());
  insert into public.agencies(name,customer_kind) values (case when is_direct then 'Direct account container' else btrim(p_agency_name) end, case when is_direct then 'direct_container' else 'agency' end) returning id into a;
  insert into public.agency_memberships(agency_id,user_id,role,status) values (a,u,'owner','active');
  if is_direct then
    slug := regexp_replace(lower(btrim(p_business_name)), '[^a-z0-9]+', '-', 'g'); slug := trim(both '-' from slug); slug := left(coalesce(nullif(slug,''),'business'), 54) || '-' || left(replace(gen_random_uuid()::text,'-',''),8);
    insert into public.businesses(agency_id,name,slug,default_timezone,country_code,lifecycle_status) values (a,btrim(p_business_name),slug,btrim(p_timezone),p_country,'onboarding') returning id into b;
    insert into public.business_memberships(business_id,user_id,role,status) values (b,u,'owner','active');
    insert into public.locations(business_id,name,timezone,status,locale,default_cta) values (b,btrim(p_location_name),btrim(p_timezone),'onboarding',case when p_country='US' then 'en-US' else 'en-GB' end,'leave_review') returning id into l;
    insert into public.account_onboarding(user_id,agency_id,business_id,current_step,completed_steps) values (u,a,b,'google_connection',array['account','business','location']);
  else
    insert into public.account_onboarding(user_id,agency_id,current_step,completed_steps) values (u,a,'agency_setup',array['account','agency']);
  end if;
  s := app_private.issue_auth_session(u,p_session_hash,p_idle_expires_at,p_absolute_expires_at,p_ip_hash,p_user_agent);
  update app_private.signup_intents set registered_at = statement_timestamp() where id = i.id;
  return query select u,s,a,b,l,case when is_direct then 'google_connection' else 'agency_setup' end;
end $$;

revoke all on table app_private.signup_intents from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker;
revoke all on table public.account_onboarding from public, afterword_auth, afterword_ingress, afterword_worker;
grant select, update on public.account_onboarding to afterword_runtime;
revoke all on function app_private.create_signup_intent(text,text,text,bytea,timestamptz) from public;
revoke all on function app_private.consume_signup_intent(bytea) from public;
revoke all on function app_private.register_verified_signup(uuid,text,text,text,text,text,text,boolean,bytea,timestamptz,timestamptz,bytea,text) from public;
grant execute on function app_private.create_signup_intent(text,text,text,bytea,timestamptz) to afterword_auth;
grant execute on function app_private.consume_signup_intent(bytea) to afterword_auth;
grant execute on function app_private.register_verified_signup(uuid,text,text,text,text,text,text,boolean,bytea,timestamptz,timestamptz,bytea,text) to afterword_auth;
commit;
