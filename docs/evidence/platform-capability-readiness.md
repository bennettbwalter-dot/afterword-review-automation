# Platform capability readiness gate

- **Decision:** Keep every social/publication adapter capability-disabled until its own approval, scopes, destination enumeration, quota, retry/reconciliation, and controlled live pilot pass. Do not advertise an adapter from OAuth availability alone.
- **Date:** 2026-07-21
- **Immutable revision:** Not applicable: platform developer approvals and OAuth configurations have not been supplied. This evidence records external capability state, not a source release.
- **Owner:** Product owner and platform-integration operator.
- **State: blocked.** Google, Meta, LinkedIn, and YouTube developer approvals, credentials, scopes, test destinations, and pilots are absent.

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
