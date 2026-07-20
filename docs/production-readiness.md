# Review Anchor production readiness

Earlier environment evidence was last recorded on 18 July 2026 against the live
Supabase database (`yyvnchfcpljibhpdtecx`) and live Stripe test-mode account
(`acct_1TuBZu3legZQZqX7`). That evidence predates migration 008 and the current
routed UI. No Google, Twilio, SendGrid or current-branch Stripe provider journey,
and no one-business pilot, has been completed for this branch.

**This application is not yet ready to serve real paying customers.** The
security foundation, tenancy model and billing data model have prior live and
current local test evidence. Customer-facing message delivery, Google
connectivity and self-service signup are not available because they depend on
provider credentials and approvals that this deployment does not have. The
detail below separates what has been proven from what has not.

## Verified working

Previous live evidence included migrations 001-007, database isolation checks,
`npm run verify:journeys` (26/26 checks) against one running API base, and Stripe
test-mode API/catalog connectivity. It did not include Stripe Checkout or
webhook journey proof. Current branch evidence is recorded separately below;
do not infer that migration 008, the new routed UI or any provider journey has
been deployed or rerun from the older live result.

## Growth Suite integration (current branch)

- The marketing page is `/`; all product modules live under `/app/*`.
- `/app/growth` is the connected dashboard and `/app/reviews` is Review Anchor's native review feed. Business and location remain in one canonical query context across module navigation.
- Direct routes have server and Cloudflare history fallbacks. Unknown app routes get an explicit not-found state instead of silently opening dashboard home.
- The old nested router, localStorage store, sample-only modules, dead routes, fake workflow mutations, fake QR mutations, and placeholder agency controls were removed.
- Active agency support context is restored from the authenticated backend after refresh; tenant access remains unavailable unless the session contains the required MFA evidence.
- Support permissions now fail closed in the browser when step-up or the locally observed 15-minute activity window expires, while PostgreSQL remains the final authority. Google OAuth and Stripe account changes require a directly signed-in business user rather than a support session.
- Stripe return routes preserve business/location context, refresh verified workspace billing data on a bounded retry, and do not treat a query parameter as proof of payment.
- The review workflow is a read-only projection of the selected location's real messaging policies, current approved templates, compliance evidence and dispatch-eligible Google destination. SMS and email policies remain separately selectable.
- Migration 008 exposes `owner`, `admin`, `operator`, `viewer`, and `billing` membership roles so the UI fails closed before PostgreSQL re-authorises every action. This migration is present locally but has not been applied to the live Supabase project in this review.

Local acceptance on 20 July 2026 passed `npm run check` with 75/75 tests,
the production build, the Cloudflare demo build, the repository secret scan,
`git diff --check`, and a production-dependency audit with zero reported
vulnerabilities. The built Cloudflare artifact contains explicit SPA fallbacks
for `/app/*`, `/workspace`, and `/r/*`.

An earlier browser acceptance pass on this branch covered 146 assertions across
desktop and mobile routes, every Growth dashboard CTA, direct tab links, Back,
Forward, refresh, business-role and agency-role boundaries, support-session
entry and exit, and four-location switching; the browser console contained no
errors. A follow-up in-app browser pass on 20 July covered the connected Growth
route, all tenant workspace routes, the agency Portfolio and Clients routes,
canonical owner/agency role switching, QR preview routing, and audited
view-only support-session entry and exit. That follow-up did not repeat mobile
viewport coverage or capture the browser console, so the earlier 146-assertion
pass remains the evidence for those two checks.
This repository does not currently define a lint command or include a linter,
so no standalone lint task was available to run.

| Area | Result |
| --- | --- |
| Earlier live database migrations | Migrations 001-007 applied; forward-only; checksums enforced. Migration 008 is not applied to that environment. |
| Row Level Security | 35 of 36 public tables have RLS **enabled and forced** |
| Tenant isolation | Deny-by-default with no request context; a bound session sees only its own business; foreign tenant IDs return 403 |
| Runtime write privilege | Direct `INSERT` from the runtime role is rejected; all writes go through audited commands |
| Authentication | Login, opaque session cookie (HttpOnly, SameSite=Strict), session resolution, logout, post-logout invalidation |
| Credential safety | Wrong password returns a generic error; responses contain no password or token hashes |
| CSRF | Cross-origin login and cross-origin writes are both blocked |
| Consent enforcement | A job without a verified Google destination is recorded as **Blocked**, not sent |
| Idempotency | Replaying a completed job returns `duplicate: true` rather than double-enrolling |
| Input validation | SMS without a phone number, and invalid billing policies, are rejected with 400 |
| Billing permissions | SMS overage policy updates are authorised and audited |
| Agency boundary | A business owner cannot open a support session (403) |
| Earlier Stripe test-mode catalog connectivity | API key was valid; all six Prices existed and matched the server-owned GBP amounts. This is not current-branch Checkout, webhook or provider-journey evidence. |
| Responsive layout | No horizontal page overflow at 375 px, 768 px or 1440 px |
| Light and dark mode | Both render across the marketing site, workspace and growth suite |

## Blocked on credentials or approval

Each item is surfaced in the interface through `GET /api/v1/service-status`, so
the workspace states what is unavailable and why instead of failing on click.

| Feature | Blocker | Owner action |
| --- | --- | --- |
| Google Business Profile connection | No `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Create OAuth credentials and obtain Business Profile API approval from Google |
| Google review monitoring | Above, plus no Pub/Sub audience or service account | Configure Pub/Sub push after OAuth approval |
| SMS review requests | No Twilio credentials | Provision a Twilio account and a compliant registered sending number |
| Email review requests | No SendGrid credentials | Provision SendGrid and verify a sender address |
| Stripe Checkout | `STRIPE_WEBHOOK_SECRET` absent; `STRIPE_CHECKOUT_ENABLED=false` | Prepare a webhook endpoint against the deployed public URL, store the `whsec_` secret in the ingress process, keep Checkout disabled through the operational pilot, then enable it in test mode |
| Stripe billing portal | Earlier test-mode API connectivity succeeded; no current-branch Portal journey or configuration is pinned | Optionally set `STRIPE_PORTAL_CONFIGURATION_ID` and exercise the deployed test-mode journey after the operational pilot |

An earlier test-mode inspection found that the three setup-fee Prices were
present in the Stripe account but were not
referenced by the server, because `scripts/setup-stripe-test-catalog.mjs` wrote
them under `STRIPE_PRICE_SETUP_149/249/349` while `server/config.ts` reads
`STRIPE_PRICE_SETUP_PRO`, `STRIPE_PRICE_SETUP_MULTI_2_3` and
`STRIPE_PRICE_SETUP_MULTI_4_5`. The script has been corrected and the correct
keys were added to the environment used for that check. The application process
then passed configuration validation with Checkout enabled, but that historical
configuration check is not current-branch Checkout or webhook evidence. The
current branch still requires a deployed ingress webhook secret and intentional
test-mode journey validation after the operational pilot.

## Not implemented

These are absent from the codebase. They are not configuration problems and
cannot be enabled with a credential.

| Feature | Status |
| --- | --- |
| Self-service registration and onboarding | **No signup endpoint exists.** Accounts are provisioned by `npm run db:bootstrap`. Public signup also needs verified email delivery before it can be exposed safely. |
| Multi-factor authentication | No enrolment or challenge path. Accounts with `mfa_required` fail closed. Agency support sessions must stay disabled until this exists. |
| WhatsApp review requests | Not implemented. Supported channels are SMS, email and QR codes. |
| AI-assisted review replies | Not implemented; no model provider is configured. |
| Automation template save, pause controls, QR regeneration | Audited server endpoints do not exist. Their mutation controls are therefore hidden; workflow remains a read-only backend projection and QR copy/export/test actions remain available. |
| Subscription trials, upgrades and downgrades | The billing schema models plan state and the webhook path is written, but plan-change journeys have not been exercised against Stripe. |
| Rank tracking, citations, churn prediction, sales agent, and video editing | Not implemented and removed from the connected Growth Suite rather than exposed as sample-only modules. |

## Known risks before launch

1. **Message sending has never been executed end to end.** The dispatch
   evaluator, outbox, lease and reconciliation logic are implemented and
   unit-tested, but no real provider call has been made. Treat the first pilot
   send as unproven.
2. **Stripe webhooks have not been received.** Signature verification, replay
   protection and paid-setup fencing are implemented but unexercised against
   real events.
3. **Two-connection race and pooled-connection reuse tests remain outstanding**
   for the request-context binding, as noted in `docs/architecture.md`.
4. **`schema_migrations` has no RLS.** It is migration bookkeeping rather than
   tenant data, and the runtime role is denied by table privilege, but a DBA
   should confirm this on the production instance.
5. **Estimated conversion is not deterministic attribution.** Google review
   objects carry no Review Anchor request identifier; reporting says so.

## Go-live checklist

1. Provision Google OAuth credentials and obtain Business Profile API approval.
2. Provision Twilio and SendGrid; verify a sender and a compliant number.
3. Prepare the Stripe webhook endpoint against the public URL and store `whsec_`
   in the ingress process only; keep `STRIPE_CHECKOUT_ENABLED=false` through the
   operational pilot.
4. Implement MFA enrolment before enabling any agency support access.
5. Implement registration, or continue provisioning tenants with
   `npm run db:bootstrap`.
6. Deploy with four distinct least-privilege database logins (the config
   refuses to start in production without them).
7. Set `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and a real secret manager
   for `SESSION_PEPPER` and `FIELD_ENCRYPTION_KEY`.
8. Set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops, and no
   more.
9. Run `npm run check` and `npm run verify:journeys` against the deployment.
10. Run the one-business operational pilot described in `docs/pilot-runbook.md`.
    After it passes, enable Stripe Checkout in test mode and complete the billing
    journeys before enabling paid signup.

## Verification commands

```bash
npm run check              # secrets scan, typecheck, unit tests, production build
npm run verify:journeys    # critical journeys against a running API
npm run db:test:isolation  # SQL tenant-isolation suite (needs psql)
```

`verify:journeys` accepts `API_BASE`, `VERIFY_EMAIL` and `VERIFY_PASSWORD` so it
can be pointed at a deployed environment. It creates one clearly-labelled
completed job, which the consent rules are expected to block while no Google
destination is connected. It does not create a Stripe Checkout Session unless
`VERIFY_ALLOW_STRIPE_SESSION=true` is explicitly set. The command proves only
the API selected by `API_BASE`; it does not prove the separate ingress or worker
processes, or Cloudflare/static-host deep-link fallback behaviour. Verify those
deployment surfaces independently.
