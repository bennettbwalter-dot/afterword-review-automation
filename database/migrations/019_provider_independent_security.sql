begin;

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

  if not exists (
    select 1 from public.agencies agency
    where agency.id = v_agency_id
      and agency.customer_kind = 'agency'
  ) then
    raise exception 'agency customer support identity is required';
  end if;

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

commit;
