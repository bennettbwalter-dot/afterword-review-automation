begin;

create table public.agency_client_grants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  business_id uuid not null references public.businesses(id),
  location_id uuid not null,
  status text not null check (status in ('requested', 'active', 'rejected', 'revoked')),
  permissions text[] not null default '{}' check (permissions <@ array['content.create','content.submit','content.approve','content.self_approve','content.schedule','content.publish','video.spend']::text[]),
  self_approver_user_id uuid references public.users(id),
  video_soft_monthly_cap integer check (video_soft_monthly_cap is null or video_soft_monthly_cap >= 0),
  video_hard_monthly_cap integer check (video_hard_monthly_cap is null or video_hard_monthly_cap >= 0),
  requested_by_user_id uuid not null references public.users(id),
  accepted_by_user_id uuid references public.users(id),
  requested_at timestamptz not null default statement_timestamp(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  check (video_hard_monthly_cap is null or video_soft_monthly_cap is null or video_hard_monthly_cap >= video_soft_monthly_cap),
  foreign key (business_id, location_id) references public.locations(business_id, id),
  check (('content.self_approve' = any(permissions)) = (self_approver_user_id is not null))
);
create unique index agency_client_grants_open_scope_idx on public.agency_client_grants(agency_id, business_id, location_id) where status in ('requested','active');
create index agency_client_grants_active_location_idx on public.agency_client_grants(agency_id, business_id, location_id, expires_at) where status = 'active';
alter table public.agency_client_grants enable row level security;
alter table public.agency_client_grants force row level security;
create policy migration_owner_all on public.agency_client_grants for all to afterword_migration_owner using (true) with check (true);

create table app_private.agency_grant_email_claims (
  token_hash bytea primary key check (length(token_hash) = 32),
  grant_id uuid not null references public.agency_client_grants(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid references public.users(id),
  created_at timestamptz not null default statement_timestamp()
);

create or replace function app_private.reject_agency_grant_support_mutation()
returns void language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if app_private.current_support_session_id() is not null then raise exception 'support sessions cannot mutate agency grants'; end if;
end $$;

create or replace function app_private.has_agency_client_permission(p_business_id uuid, p_location_id uuid, p_permission text, p_self_approver_user_id uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select app_private.current_user_enabled() and app_private.current_support_session_id() is null and exists (
    select 1 from public.agency_client_grants grant
    join public.businesses business on business.id = grant.business_id and business.archived_at is null
    join public.locations location on location.id = grant.location_id and location.business_id = grant.business_id and location.archived_at is null
    where grant.business_id = p_business_id and grant.location_id = p_location_id
      and grant.status = 'active' and (grant.expires_at is null or grant.expires_at > statement_timestamp())
      and p_permission = any(grant.permissions)
      and app_private.current_agency_role(grant.agency_id) is not null
      and (p_permission <> 'content.self_approve' or grant.self_approver_user_id = p_self_approver_user_id and p_self_approver_user_id = app_private.current_user_id())
  )
$$;

create or replace function app_private.expire_stale_agency_client_grants(p_limit integer default 100)
returns integer language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'invalid agency grant expiry limit'; end if;
  if app_private.current_support_session_id() is not null then raise exception 'support sessions cannot mutate agency grants'; end if;
  with candidates as (
    select grant.id from public.agency_client_grants grant
    where grant.status in ('requested','active') and grant.expires_at <= statement_timestamp()
    order by grant.expires_at, grant.id for update skip locked limit p_limit
  ), expired as (
    update public.agency_client_grants grant set status='revoked', revoked_at=statement_timestamp()
    from candidates where grant.id=candidates.id returning grant.id
  ) select count(*)::integer into v_count from expired;
  return v_count;
end $$;

create or replace function app_private.issue_agency_client_grant_claim(p_grant_id uuid, p_email text, p_token_hash bytea, p_expires_at timestamptz, p_correlation_id uuid)
returns void language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_grant public.agency_client_grants%rowtype; v_email text := lower(btrim(p_email));
begin
  perform app_private.reject_agency_grant_support_mutation();
  if p_token_hash is null or length(p_token_hash) <> 32 or v_email = '' or p_expires_at <= statement_timestamp() or p_expires_at > statement_timestamp() + interval '7 days' then raise exception 'invalid agency grant claim'; end if;
  select * into v_grant from public.agency_client_grants where id=p_grant_id for update;
  if not found or v_grant.status not in ('requested','active') or app_private.current_agency_role(v_grant.agency_id)::text not in ('owner','admin','operator') then raise exception 'agency grant claim issuance is not permitted'; end if;
  perform app_private.expire_stale_agency_client_grants(100);
  if v_grant.expires_at is not null and v_grant.expires_at <= statement_timestamp() then raise exception 'agency grant has expired'; end if;
  insert into app_private.agency_grant_email_claims(token_hash,grant_id,email,expires_at) values(p_token_hash,v_grant.id,v_email,p_expires_at);
  perform app_private.write_audit_event('user',v_grant.agency_id,v_grant.business_id,v_grant.location_id,null,'agency.grant.claim.issue','agency_client_grant',v_grant.id::text,'completed',null,p_correlation_id,array['email_claim'],'{}'::jsonb);
end $$;

create or replace function app_private.consume_agency_client_grant_claim(p_token_hash bytea)
returns table (grant_id uuid, business_id uuid, location_id uuid, status text, permissions text[], expires_at timestamptz)
language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_claim app_private.agency_grant_email_claims%rowtype; v_grant public.agency_client_grants%rowtype; v_email text;
begin
  if p_token_hash is null or length(p_token_hash) <> 32 or not app_private.current_user_enabled() or app_private.current_support_session_id() is not null then return; end if;
  select lower(email) into v_email from public.users where id=app_private.current_user_id() and disabled_at is null;
  select * into v_claim from app_private.agency_grant_email_claims claim where claim.token_hash=p_token_hash and claim.consumed_at is null and claim.expires_at > statement_timestamp() for update;
  if not found or v_claim.email <> v_email then return; end if;
  select * into v_grant from public.agency_client_grants where id=v_claim.grant_id for update;
  if not found or v_grant.status not in ('requested','active') or (v_grant.expires_at is not null and v_grant.expires_at <= statement_timestamp()) then return; end if;
  update app_private.agency_grant_email_claims set consumed_at=statement_timestamp(), consumed_by_user_id=app_private.current_user_id() where token_hash=v_claim.token_hash;
  return query select v_grant.id, v_grant.business_id, v_grant.location_id, v_grant.status, v_grant.permissions, v_grant.expires_at;
end $$;

create or replace function app_private.list_agency_client_grant_claim_locations(p_claim_token_hash bytea)
returns table (grant_id uuid, business_id uuid, location_id uuid, status text, permissions text[], expires_at timestamptz)
language sql stable security definer set search_path = pg_catalog as $$
  select grant.id, grant.business_id, grant.location_id, grant.status, grant.permissions, grant.expires_at
  from app_private.agency_grant_email_claims claim
  join public.agency_client_grants grant on grant.id=claim.grant_id
  join public.locations location on location.id=grant.location_id and location.business_id=grant.business_id and location.archived_at is null
  where claim.token_hash=p_claim_token_hash and claim.consumed_by_user_id=app_private.current_user_id()
    and claim.expires_at > statement_timestamp() and grant.status in ('requested','active')
    and (grant.expires_at is null or grant.expires_at > statement_timestamp()) and app_private.current_support_session_id() is null
$$;

create or replace function app_private.request_agency_client_grant(p_agency_id uuid, p_business_id uuid, p_location_id uuid, p_permissions text[], p_self_approver_user_id uuid, p_video_soft_monthly_cap integer, p_video_hard_monthly_cap integer, p_expires_at timestamptz, p_correlation_id uuid)
returns public.agency_client_grants language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_grant public.agency_client_grants%rowtype; v_actor uuid := app_private.current_user_id();
begin
  perform app_private.reject_agency_grant_support_mutation();
  perform app_private.expire_stale_agency_client_grants(100);
  if not app_private.current_user_enabled() or app_private.current_agency_role(p_agency_id)::text not in ('owner','admin','operator') then raise exception 'active agency membership is required'; end if;
  if not exists (select 1 from public.businesses where id = p_business_id and archived_at is null)
     or not exists (select 1 from public.locations where id = p_location_id and business_id = p_business_id and archived_at is null) then raise exception 'business location scope is invalid'; end if;
  if coalesce(array_length(p_permissions, 1), 0) = 0 or p_permissions <@ array['content.create','content.submit','content.approve','content.self_approve','content.schedule','content.publish','video.spend']::text[] is false then raise exception 'invalid agency grant permissions'; end if;
  if ('content.self_approve' = any(p_permissions)) <> (p_self_approver_user_id is not null) then raise exception 'self approval requires a named user'; end if;
  if p_self_approver_user_id is not null and not exists (select 1 from public.agency_memberships where agency_id=p_agency_id and user_id=p_self_approver_user_id and status='active') then raise exception 'self approver must be an active agency user'; end if;
  if p_expires_at is not null and p_expires_at <= statement_timestamp() then raise exception 'grant expiry must be in the future'; end if;
  insert into public.agency_client_grants(agency_id,business_id,location_id,status,permissions,self_approver_user_id,video_soft_monthly_cap,video_hard_monthly_cap,requested_by_user_id,expires_at)
  values(p_agency_id,p_business_id,p_location_id,'requested',p_permissions,p_self_approver_user_id,p_video_soft_monthly_cap,p_video_hard_monthly_cap,v_actor,p_expires_at) returning * into v_grant;
  perform app_private.write_audit_event('user',p_agency_id,p_business_id,p_location_id,null,'agency.grant.request','agency_client_grant',v_grant.id::text,'completed',null,p_correlation_id,array['permissions','location_id'],'{}'::jsonb);
  return v_grant;
end $$;

create or replace function app_private.accept_agency_client_grant(p_grant_id uuid, p_correlation_id uuid)
returns public.agency_client_grants language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_grant public.agency_client_grants%rowtype; v_actor uuid := app_private.current_user_id(); v_found integer;
begin
  perform app_private.reject_agency_grant_support_mutation(); select * into v_grant from public.agency_client_grants where id=p_grant_id for update; get diagnostics v_found = row_count;
  perform app_private.expire_stale_agency_client_grants(100);
  if v_found <> 1 or v_grant.status <> 'requested' then raise exception 'agency grant is not awaiting acceptance'; end if;
  if app_private.current_business_role(v_grant.business_id)::text not in ('owner','admin') then raise exception 'direct client owner or admin acceptance is required'; end if;
  if v_grant.expires_at is not null and v_grant.expires_at <= statement_timestamp() then raise exception 'agency grant has expired'; end if;
  update public.agency_client_grants set status='active',accepted_by_user_id=v_actor,accepted_at=statement_timestamp() where id=v_grant.id returning * into v_grant;
  perform app_private.write_audit_event('user',v_grant.agency_id,v_grant.business_id,v_grant.location_id,null,'agency.grant.accept','agency_client_grant',v_grant.id::text,'completed',null,p_correlation_id,array['status'],'{}'::jsonb); return v_grant;
end $$;

create or replace function app_private.reject_agency_client_grant(p_grant_id uuid, p_correlation_id uuid)
returns public.agency_client_grants language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_grant public.agency_client_grants%rowtype;
begin
  perform app_private.reject_agency_grant_support_mutation(); select * into v_grant from public.agency_client_grants where id=p_grant_id for update;
  if not found or v_grant.status <> 'requested' or app_private.current_business_role(v_grant.business_id)::text not in ('owner','admin') then raise exception 'direct client owner or admin rejection is required'; end if;
  update public.agency_client_grants set status='rejected',rejected_at=statement_timestamp() where id=v_grant.id returning * into v_grant;
  perform app_private.write_audit_event('user',v_grant.agency_id,v_grant.business_id,v_grant.location_id,null,'agency.grant.reject','agency_client_grant',v_grant.id::text,'completed',null,p_correlation_id,array['status'],'{}'::jsonb); return v_grant;
end $$;

create or replace function app_private.revoke_agency_client_grant(p_grant_id uuid, p_correlation_id uuid)
returns public.agency_client_grants language plpgsql volatile security definer set search_path = pg_catalog as $$
declare v_grant public.agency_client_grants%rowtype;
begin
  perform app_private.reject_agency_grant_support_mutation(); select * into v_grant from public.agency_client_grants where id=p_grant_id for update;
  if not found or v_grant.status not in ('requested','active') then raise exception 'agency grant cannot be revoked'; end if;
  if app_private.current_business_role(v_grant.business_id)::text not in ('owner','admin') and app_private.current_agency_role(v_grant.agency_id)::text not in ('owner','admin') then raise exception 'grant revocation is not permitted'; end if;
  update public.agency_client_grants set status='revoked',revoked_at=statement_timestamp() where id=v_grant.id returning * into v_grant;
  perform app_private.write_audit_event('user',v_grant.agency_id,v_grant.business_id,v_grant.location_id,null,'agency.grant.revoke','agency_client_grant',v_grant.id::text,'completed',null,p_correlation_id,array['status'],'{}'::jsonb); return v_grant;
end $$;

create table app_private.agency_client_access_claims (
  id uuid primary key default gen_random_uuid(), token_hash bytea not null unique check (length(token_hash)=32),
  agency_id uuid not null references public.agencies(id), email text not null check (email=lower(btrim(email))),
  permissions text[] not null check (permissions <@ array['content.create','content.submit','content.approve','content.self_approve','content.schedule','content.publish','video.spend']::text[]),
  self_approver_user_id uuid references public.users(id), video_soft_monthly_cap integer, video_hard_monthly_cap integer,
  grant_expires_at timestamptz, expires_at timestamptz not null, consumed_by_user_id uuid references public.users(id), consumed_at timestamptz, selected_grant_id uuid references public.agency_client_grants(id), created_at timestamptz not null default statement_timestamp(),
  check ((('content.self_approve'=any(permissions)))=(self_approver_user_id is not null))
);

create or replace function app_private.issue_agency_client_access_claim(p_email text,p_permissions text[],p_self_approver_user_id uuid,p_video_soft_monthly_cap integer,p_video_hard_monthly_cap integer,p_grant_expires_at timestamptz,p_token_hash bytea,p_expires_at timestamptz,p_correlation_id uuid)
returns void language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_agency uuid; v_email text:=lower(btrim(p_email));
begin
 perform app_private.reject_agency_grant_support_mutation();
 select membership.agency_id into v_agency from public.agency_memberships membership where membership.user_id=app_private.current_user_id() and membership.status='active' and membership.role::text in ('owner','admin','operator') order by membership.created_at limit 1;
 if v_agency is null or p_token_hash is null or length(p_token_hash)<>32 or v_email='' or coalesce(array_length(p_permissions,1),0)=0 or p_expires_at<=statement_timestamp() or p_expires_at>statement_timestamp()+interval '7 days' then raise exception 'invalid agency client claim'; end if;
 if ('content.self_approve'=any(p_permissions))<>(p_self_approver_user_id is not null) then raise exception 'self approval requires a named user'; end if;
 insert into app_private.agency_client_access_claims(token_hash,agency_id,email,permissions,self_approver_user_id,video_soft_monthly_cap,video_hard_monthly_cap,grant_expires_at,expires_at) values(p_token_hash,v_agency,v_email,p_permissions,p_self_approver_user_id,p_video_soft_monthly_cap,p_video_hard_monthly_cap,p_grant_expires_at,p_expires_at);
end $$;

create or replace function app_private.consume_agency_client_access_claim(p_token_hash bytea)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_email text; v_claim app_private.agency_client_access_claims%rowtype;
begin
 if p_token_hash is null or length(p_token_hash)<>32 or app_private.current_support_session_id() is not null or not app_private.current_user_enabled() then return false; end if;
 select lower(btrim(email)) into v_email from public.users where id=app_private.current_user_id() and disabled_at is null;
 select * into v_claim from app_private.agency_client_access_claims claim where claim.token_hash=p_token_hash and claim.expires_at>statement_timestamp() for update;
 if not found or v_claim.email<>v_email then return false; end if;
 if v_claim.consumed_by_user_id is not null and v_claim.consumed_by_user_id<>app_private.current_user_id() then return false; end if;
 update app_private.agency_client_access_claims set consumed_by_user_id=app_private.current_user_id(),consumed_at=coalesce(consumed_at,statement_timestamp()) where id=v_claim.id;
 return true;
end $$;

create or replace function app_private.list_agency_client_claim_locations(p_token_hash bytea)
returns table (business_id uuid,business_name text,location_id uuid,location_name text)
language sql stable security definer set search_path=pg_catalog as $$
 select business.id,business.name,location.id,location.name from app_private.agency_client_access_claims claim
 join public.business_memberships membership on membership.user_id=app_private.current_user_id() and membership.status='active' and membership.role::text in ('owner','admin')
 join public.businesses business on business.id=membership.business_id and business.archived_at is null
 join public.locations location on location.business_id=business.id and location.archived_at is null
 where claim.token_hash=p_token_hash and claim.consumed_by_user_id=app_private.current_user_id() and claim.expires_at>statement_timestamp() and app_private.current_support_session_id() is null
 order by business.name,location.name
$$;

create or replace function app_private.select_agency_client_claim_location(p_token_hash bytea,p_location_id uuid,p_correlation_id uuid)
returns public.agency_client_grants language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_claim app_private.agency_client_access_claims%rowtype; v_grant public.agency_client_grants%rowtype; v_business uuid; v_found integer;
begin
 perform app_private.reject_agency_grant_support_mutation();
 select * into v_claim from app_private.agency_client_access_claims claim where claim.token_hash=p_token_hash and claim.consumed_by_user_id=app_private.current_user_id() and claim.expires_at>statement_timestamp() for update; get diagnostics v_found = row_count;
 if v_found<>1 then raise exception 'client claim is unavailable'; end if;
 if v_claim.selected_grant_id is not null then select * into v_grant from public.agency_client_grants where id=v_claim.selected_grant_id; return v_grant; end if;
 select membership.business_id into v_business from public.business_memberships membership join public.locations location on location.business_id=membership.business_id and location.id=p_location_id and location.archived_at is null where membership.user_id=app_private.current_user_id() and membership.status='active' and membership.role::text in ('owner','admin'); get diagnostics v_found = row_count;
 if v_found<>1 then raise exception 'selected location is not a direct client location'; end if;
 insert into public.agency_client_grants(agency_id,business_id,location_id,status,permissions,self_approver_user_id,video_soft_monthly_cap,video_hard_monthly_cap,requested_by_user_id,expires_at) values(v_claim.agency_id,v_business,p_location_id,'requested',v_claim.permissions,v_claim.self_approver_user_id,v_claim.video_soft_monthly_cap,v_claim.video_hard_monthly_cap,app_private.current_user_id(),v_claim.grant_expires_at) returning * into v_grant;
 update app_private.agency_client_access_claims set selected_grant_id=v_grant.id where id=v_claim.id;
 return v_grant;
end $$;

revoke all on table public.agency_client_grants from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker;
revoke all on table app_private.agency_grant_email_claims from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker;
revoke all on table app_private.agency_client_access_claims from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker;
revoke all on function app_private.reject_agency_grant_support_mutation() from public;
revoke all on function app_private.expire_stale_agency_client_grants(integer) from public;
revoke all on function app_private.issue_agency_client_grant_claim(uuid,text,bytea,timestamptz,uuid) from public;
revoke all on function app_private.consume_agency_client_grant_claim(bytea) from public;
revoke all on function app_private.list_agency_client_grant_claim_locations(bytea) from public;
revoke all on function app_private.has_agency_client_permission(uuid,uuid,text,uuid) from public;
revoke all on function app_private.request_agency_client_grant(uuid,uuid,uuid,text[],uuid,integer,integer,timestamptz,uuid) from public;
revoke all on function app_private.accept_agency_client_grant(uuid,uuid) from public;
revoke all on function app_private.reject_agency_client_grant(uuid,uuid) from public;
revoke all on function app_private.revoke_agency_client_grant(uuid,uuid) from public;
grant execute on function app_private.has_agency_client_permission(uuid,uuid,text,uuid) to afterword_runtime;
grant execute on function app_private.expire_stale_agency_client_grants(integer) to afterword_runtime, afterword_worker;
grant execute on function app_private.issue_agency_client_grant_claim(uuid,text,bytea,timestamptz,uuid) to afterword_runtime;
grant execute on function app_private.consume_agency_client_grant_claim(bytea) to afterword_runtime;
grant execute on function app_private.list_agency_client_grant_claim_locations(bytea) to afterword_runtime;
grant execute on function app_private.request_agency_client_grant(uuid,uuid,uuid,text[],uuid,integer,integer,timestamptz,uuid) to afterword_runtime;
grant execute on function app_private.accept_agency_client_grant(uuid,uuid) to afterword_runtime;
grant execute on function app_private.reject_agency_client_grant(uuid,uuid) to afterword_runtime;
grant execute on function app_private.revoke_agency_client_grant(uuid,uuid) to afterword_runtime;
grant execute on function app_private.issue_agency_client_access_claim(text,text[],uuid,integer,integer,timestamptz,bytea,timestamptz,uuid) to afterword_runtime;
grant execute on function app_private.consume_agency_client_access_claim(bytea) to afterword_runtime;
grant execute on function app_private.list_agency_client_claim_locations(bytea) to afterword_runtime;
grant execute on function app_private.select_agency_client_claim_location(bytea,uuid,uuid) to afterword_runtime;
commit;
