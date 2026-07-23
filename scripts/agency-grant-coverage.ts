export const agencyGrantCoverageLockSql = `
lock table
  public.agencies,
  public.businesses,
  public.locations,
  public.agency_memberships,
  public.agency_client_grants,
  public.business_memberships
in share mode
`;

export const agencyGrantCoverageSql = `
with expected_legacy_scopes as (
  select business.agency_id, business.id as business_id, location.id as location_id
  from public.businesses as business
  join public.agencies as agency
    on agency.id = business.agency_id
   and agency.customer_kind = 'agency'
  join public.locations as location
    on location.business_id = business.id
   and location.archived_at is null
  where business.archived_at is null
    and exists (
      select 1 from public.agency_memberships as agency_member
      where agency_member.agency_id = business.agency_id
        and agency_member.status = 'active'
    )
), valid_active_grants as (
  select agency_grant.agency_id, agency_grant.business_id, agency_grant.location_id
  from public.agency_client_grants as agency_grant
  join public.business_memberships as accepting_member
    on accepting_member.business_id = agency_grant.business_id
   and accepting_member.user_id = agency_grant.accepted_by_user_id
   and accepting_member.status = 'active'
   and accepting_member.role::text in ('owner', 'admin')
  where agency_grant.status = 'active'
    and (agency_grant.expires_at is null or agency_grant.expires_at > statement_timestamp())
)
select expected.agency_id, expected.business_id, expected.location_id
from expected_legacy_scopes as expected
left join valid_active_grants as agency_grant
  on agency_grant.agency_id = expected.agency_id
 and agency_grant.business_id = expected.business_id
 and agency_grant.location_id = expected.location_id
where agency_grant.location_id is null
order by expected.agency_id, expected.business_id, expected.location_id
`;
