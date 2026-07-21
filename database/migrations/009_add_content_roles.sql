begin;

alter type public.agency_role add value if not exists 'operator';
alter type public.business_role add value if not exists 'approver';

create or replace function app_private.resolve_auth_session_with_role(p_token_hash bytea)
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  display_name text,
  agency_id uuid,
  agency_role public.agency_role,
  business_id uuid,
  business_role public.business_role,
  platform_role text,
  product_role text,
  mfa_verified_at timestamptz,
  step_up_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_session app_private.auth_sessions%rowtype;
begin
  select session.* into v_session
  from app_private.auth_sessions session
  join public.users app_user on app_user.id = session.user_id and app_user.disabled_at is null
  where session.token_hash = p_token_hash
    and session.revoked_at is null
    and session.idle_expires_at > pg_catalog.statement_timestamp()
    and session.absolute_expires_at > pg_catalog.statement_timestamp()
  for update of session;
  if not found then return; end if;

  if v_session.last_seen_at < pg_catalog.statement_timestamp() - interval '5 minutes' then
    update app_private.auth_sessions
    set last_seen_at = pg_catalog.statement_timestamp(),
        idle_expires_at = least(absolute_expires_at, pg_catalog.statement_timestamp() + interval '12 hours')
    where id = v_session.id;
  end if;

  return query
  select v_session.id, app_user.id, app_user.email, app_user.display_name,
    agency_membership.agency_id,
    agency_membership.role,
    business_membership.business_id,
    business_membership.role,
    case
      when agency_membership.role::text in ('owner', 'admin') then 'agency_admin'
      when agency_membership.role::text = 'operator' then 'agency_user'
      when agency_membership.role::text = 'support' then 'agency_user'
      when exists (
        select 1
        from public.business_memberships active_business_membership
        where active_business_membership.user_id = app_user.id
          and active_business_membership.status = 'active'
      ) then 'business_owner'
      else null
    end,
    case
      when agency_membership.role::text in ('owner', 'admin') then 'owner'
      when agency_membership.role::text = 'operator' then 'staff'
      when business_membership.role::text in ('owner', 'admin') then 'owner'
      when business_membership.role::text = 'operator' then 'staff'
      when business_membership.role::text = 'approver' then 'client_approver'
      else null
    end,
    v_session.mfa_verified_at, v_session.step_up_verified_at
  from public.users app_user
  left join lateral (
    select membership.agency_id, membership.user_id, membership.role
    from public.agency_memberships membership
    where membership.user_id = app_user.id
      and membership.status = 'active'
      and membership.role::text in ('owner', 'admin', 'operator', 'support')
    order by membership.created_at, membership.agency_id
    limit 1
  ) agency_membership on true
  left join lateral (
    select membership.business_id, membership.user_id, membership.role
    from public.business_memberships membership
    where membership.user_id = app_user.id
      and membership.status = 'active'
      and not exists (
        select 1
        from public.business_memberships other_membership
        where other_membership.user_id = app_user.id
          and other_membership.status = 'active'
          and other_membership.business_id <> membership.business_id
      )
    order by membership.created_at, membership.business_id
    limit 1
  ) business_membership on true
  where app_user.id = v_session.user_id
    and (
      agency_membership.user_id is not null
      or exists (
        select 1
        from public.business_memberships active_business_membership
        where active_business_membership.user_id = app_user.id
          and active_business_membership.status = 'active'
      )
    );
end
$$;

revoke all on function app_private.resolve_auth_session_with_role(bytea)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
grant execute on function app_private.resolve_auth_session_with_role(bytea) to afterword_auth;

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_user_id::text, 1));

  v_agency_role := app_private.current_agency_role(v_agency_id);
  if v_agency_role is null then
    raise exception 'active agency membership is required';
  end if;
  if v_agency_role::text not in ('owner', 'admin', 'support') then
    raise exception 'agency operator role cannot start support sessions';
  end if;
  if p_scope = 'configuration' and v_agency_role::text not in ('owner', 'admin') then
    raise exception 'agency support role is limited to view sessions';
  end if;
  if p_duration_minutes is null or p_duration_minutes not in (15, 30) then
    raise exception 'support session duration must be 15 or 30 minutes';
  end if;
  if pg_catalog.length(pg_catalog.trim(p_reason)) < 12 then
    raise exception 'a support reason or ticket reference is required';
  end if;
  if v_mfa_verified_at is null
     or v_mfa_verified_at < pg_catalog.statement_timestamp() - interval '12 hours'
     or v_mfa_verified_at > pg_catalog.statement_timestamp() + interval '5 minutes' then
    raise exception 'fresh agency MFA evidence is required';
  end if;
  if p_scope = 'configuration' and (
    v_step_up_verified_at is null
    or v_step_up_verified_at < pg_catalog.statement_timestamp() - interval '10 minutes'
    or v_step_up_verified_at > pg_catalog.statement_timestamp() + interval '5 minutes'
  ) then
    raise exception 'fresh step-up evidence is required for configuration support';
  end if;
  if exists (
    select 1
    from public.support_sessions active_session
    where active_session.actor_user_id = v_actor_user_id
      and active_session.ended_at is null
      and active_session.revoked_at is null
      and active_session.expires_at > pg_catalog.statement_timestamp()
  ) then
    raise exception 'exit the active support session before starting another';
  end if;

  insert into public.support_sessions (
    agency_id, business_id, actor_user_id, scope, reason, mfa_verified_at,
    step_up_verified_at, started_at, last_activity_at, expires_at
  ) values (
    v_agency_id, p_business_id, v_actor_user_id, p_scope, pg_catalog.trim(p_reason), v_mfa_verified_at,
    v_step_up_verified_at, pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + pg_catalog.make_interval(mins => p_duration_minutes)
  ) returning id into v_session_id;

  perform app_private.write_audit_event(
    'user', v_agency_id, p_business_id, null, v_session_id,
    'support.session.start', 'support_session', v_session_id::text, 'completed', pg_catalog.trim(p_reason),
    p_correlation_id, array['scope', 'expires_at'], '{}'::jsonb
  );
  return v_session_id;
end
$$;

revoke all on function app_private.start_support_session(uuid, public.support_scope, text, integer, uuid)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
grant execute on function app_private.start_support_session(uuid, public.support_scope, text, integer, uuid)
to afterword_runtime;

comment on function app_private.resolve_auth_session_with_role(bytea) is
  'Resolves an opaque login session to a narrowly projected platform and product role. Legacy limited memberships project no product role.';

commit;
