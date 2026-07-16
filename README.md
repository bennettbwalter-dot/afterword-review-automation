# Afterword

An interactive front-end prototype for a focused reputation-automation product:

> Connect your Google Business Profile and automatically turn completed jobs into genuine customer review requests.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:4173`.

## What works

- Scroll-led marketing story with a live review journey
- One responsive, role-aware workspace for business owners and agency administrators
- Tenant-keyed seeded data with executable owner/agency permission checks
- Agency portfolio, client health, exceptions, scoped pause controls, and audit history
- Explicit, time-limited support sessions with view-only and configuration scopes
- Persistent support-access banner and disabled mutations in view-only sessions
- Add-completed-job flow with contact validation and consent-evidence capture; missing evidence creates a blocked record
- Linear, non-gated automation editor with live copy checks for rating prompts, incentives, sentiment screening and required merge fields
- Neutral SMS template editing and preview
- Review feed, request list, report preview, and print action
- Client-specific QR review workspace with a stable public token, destination verification, scan/conversion reporting, artwork regeneration, and PNG, SVG, and print-ready PDF downloads
- Public `/r/:token` review flow with neutral copy and a direct hand-off to the client’s Google destination
- Simulated Google onboarding and integration health

Use **Demo role preview** at the bottom of the workspace navigation to switch between the owner and agency paths.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run test:security
npm.cmd run build
```

`test:security` exercises the in-memory role and support-session rules. It is not a replacement for database integration tests.

## Architecture artifacts

- [`docs/architecture.md`](docs/architecture.md) — tenant, role, queue, support-access, and integration boundaries
- [`docs/security-launch-checklist.md`](docs/security-launch-checklist.md) — explicit pre-launch gates
- [`database/migrations/001_multi_tenant_foundation.sql`](database/migrations/001_multi_tenant_foundation.sql) — PostgreSQL design draft with row-level security foundations

The QR database extension is documented in `database/migrations/002_client_qr_review_flow.sql`.

## Integration boundary

This prototype does not send messages or connect to Google. The role switch and tenant records are seeded front-end demonstrations. Live production work still needs a server-side authentication boundary, deployed and integration-tested PostgreSQL policies, secure OAuth token storage, Business Profile API access, a messaging provider, consent/suppression enforcement, durable workers, billing, and persistent reporting data.

QR exports use `VITE_PUBLIC_REVIEW_BASE_URL` as their permanent redirect origin. Set it to an owned, long-lived HTTPS domain before artwork goes to print. Seeded Google destinations are search links for demo use and remain visibly unverified until the client’s real Google “Ask for reviews” URL is saved.
