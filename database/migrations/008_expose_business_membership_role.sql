begin;

create or replace function app_private.resolve_auth_session_with_role(p_token_hash bytea)
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  display_name text,
  agency_id uuid,
  business_id uuid,
  business_role public.business_role,
  platform_role text,
  mfa_verified_at timestamptz,
  step_up_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_session app_private.auth_sessions%rowtype;
begin
  select session.* into v_session
  from app_private.auth_sessions session
  join public.users users on users.id = session.user_id and users.disabled_at is null
  where session.token_hash = p_token_hash
    and session.revoked_at is null
    and session.idle_expires_at > statement_timestamp()
    and session.absolute_expires_at > statement_timestamp()
  for update of session;
  if not found then return; end if;

  if v_session.last_seen_at < statement_timestamp() - interval '5 minutes' then
    update app_private.auth_sessions
    set last_seen_at = statement_timestamp(),
        idle_expires_at = least(absolute_expires_at, statement_timestamp() + interval '12 hours')
    where id = v_session.id;
  end if;

  return query
  select v_session.id, users.id, users.email, users.display_name,
    agency_membership.agency_id,
    business_membership.business_id,
    business_membership.role,
    case when agency_membership.user_id is not null then 'agency_admin' else 'business_owner' end,
    v_session.mfa_verified_at, v_session.step_up_verified_at
  from public.users users
  left join lateral (
    select membership.agency_id, membership.user_id
    from public.agency_memberships membership
    where membership.user_id = users.id and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by membership.created_at limit 1
  ) agency_membership on true
  left join lateral (
    select membership.business_id, membership.role
    from public.business_memberships membership
    where membership.user_id = users.id and membership.status = 'active'
      and not exists (
        select 1
        from public.business_memberships other_membership
        where other_membership.user_id = users.id
          and other_membership.status = 'active'
          and other_membership.business_id <> membership.business_id
      )
    order by membership.created_at, membership.business_id limit 1
  ) business_membership on true
  where users.id = v_session.user_id;
end
$$;

revoke all on function app_private.resolve_auth_session_with_role(bytea)
from public, afterword_auth, afterword_runtime, afterword_ingress, afterword_worker, afterword_ops;
grant execute on function app_private.resolve_auth_session_with_role(bytea) to afterword_auth;

comment on function app_private.resolve_auth_session_with_role(bytea) is
  'Resolves an opaque login session and exposes an initial tenant role only when one active business membership exists. The workspace response projects the role for its selected tenant.';

commit;
