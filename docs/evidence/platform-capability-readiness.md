# Platform capability readiness gate

- **Decision:** Keep every social/publication adapter capability-disabled until its own approval, scopes, destination enumeration, quota, retry/reconciliation, and controlled live pilot pass. Do not advertise an adapter from OAuth availability alone.
- **Date:** 2026-07-21
- **Immutable revision:** Not applicable: platform developer approvals and OAuth configurations have not been supplied. This evidence records external capability state, not a source release.
- **Owner:** Product owner and platform-integration operator.
- **State:** blocked

Google, Meta, LinkedIn, and YouTube developer approvals, credentials, scopes, test destinations, and pilots are absent.

## Google capability matrix

Each Google capability needs separate evidence; none is currently verified for release:

| Capability | State | Required evidence |
| --- | --- | --- |
| Profile fields | blocked | Approved scope, exact location enumeration, immutable proposal/apply pilot |
| Services | blocked | Approved scope and controlled write/read reconciliation |
| Attributes | blocked | Approved scope and controlled write/read reconciliation |
| Review replies | blocked | Approved scope, explicit approval flow, and reconciliation pilot |
| Local posts | blocked | Approved scope, target enumeration, retry and live pilot |
| Location images | blocked | Approved scope, upload/poll/reconcile and live pilot |
| Location videos | blocked | Approved scope, upload/poll/reconcile and live pilot |

## Other platforms

Meta, LinkedIn, and YouTube remain blocked pending their own developer review, OAuth credentials and approved redirect URIs/scopes, test accounts, destination enumeration, quota behavior, retry/reconciliation design, and controlled live-pilot evidence. A missing approval disables only that adapter; it does not justify a fake, temporary, or provider-double production implementation.

## Release consequence

Only capabilities with a passed row and preserved pilot evidence can be enabled later. Publication UI and workers must present unavailable adapters as unavailable, while manual content and independently-ready paths continue without claiming publication support.

## Agency-grant integrity gate (before migration 012)

Migration 012 remains paused. On the migration database, after migration 011 is present and before any follow-on change is approved, run the query below as the migration owner. It must return **zero rows**, and its output must be retained with the migration evidence.

Before deploying the current source revision, first check whether migration 011 has ever been recorded in the target environment. This revision removes a function from migration 011 itself. If 011 is already applied, do **not** alter its recorded checksum or rerun it: create a new forward-only migration that revokes and drops the retired generic function instead.

```sql
select migration_id, checksum_sha256, applied_at
from public.schema_migrations
where migration_id = '011_agency_client_grants.sql';
```

No row means the revised 011 can be applied through the normal migrator. One row means it must remain immutable and the forward-only cleanup path is required. Treat an unavailable ledger or an unexpected result as a stop condition.

Direct customer containers (`direct_container`) are deliberately excluded from this agency-grant coverage gate. They are first-party customer boundaries, not agency identities that can receive agency-client grants.

```sql
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
```

The local suite includes an actor-behaviour probe for the same boundaries, but it cannot establish this live database result without `MIGRATION_DATABASE_URL` and the ability to assume `afterword_migration_owner`.
