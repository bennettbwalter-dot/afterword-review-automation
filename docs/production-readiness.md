# Review Anchor production readiness

Last verified: 18 July 2026, against the live Supabase database
(`yyvnchfcpljibhpdtecx`) and the live Stripe test-mode account
(`acct_1TuBZu3legZQZqX7`).

**This application is not yet ready to serve real paying customers.** The
security foundation, tenancy model and billing data model are in good shape and
have been tested. Customer-facing message delivery, Google connectivity and
self-service signup are not available because they depend on provider
credentials and approvals that this deployment does not have. The detail below
separates what has been proven from what has not.

## Verified working

Evidence: `npm run check` (53/53 unit tests, clean typecheck, clean build) and
`npm run verify:journeys` (26/26 checks) executed against the running API.

| Area | Result |
| --- | --- |
| Database migrations | All 7 applied; forward-only; checksums enforced |
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
| Stripe connectivity | API key valid; all six Prices exist and match the server-owned GBP amounts |
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
| Stripe Checkout | `STRIPE_WEBHOOK_SECRET` absent; `STRIPE_CHECKOUT_ENABLED=false` | Create a webhook endpoint against the deployed public URL, store the `whsec_` secret in the ingress process, then enable checkout |
| Stripe billing portal | Works with the API key; no portal configuration pinned | Optionally set `STRIPE_PORTAL_CONFIGURATION_ID` |

The three setup-fee Prices were present in the Stripe account but were not
referenced by the server, because `scripts/setup-stripe-test-catalog.mjs` wrote
them under `STRIPE_PRICE_SETUP_149/249/349` while `server/config.ts` reads
`STRIPE_PRICE_SETUP_PRO`, `STRIPE_PRICE_SETUP_MULTI_2_3` and
`STRIPE_PRICE_SETUP_MULTI_4_5`. The script has been corrected and the correct
keys added to the local environment. With those in place the application
process now passes configuration validation with checkout enabled; only the
ingress webhook secret is still missing.

## Not implemented

These are absent from the codebase. They are not configuration problems and
cannot be enabled with a credential.

| Feature | Status |
| --- | --- |
| Self-service registration and onboarding | **No signup endpoint exists.** Accounts are provisioned by `npm run db:bootstrap`. Public signup also needs verified email delivery before it can be exposed safely. |
| Multi-factor authentication | No enrolment or challenge path. Accounts with `mfa_required` fail closed. Agency support sessions must stay disabled until this exists. |
| WhatsApp review requests | Not implemented. Supported channels are SMS, email and QR codes. |
| AI-assisted review replies | Not implemented; no model provider is configured. |
| Automation template save, pause controls, QR regeneration | The interface renders these, but the audited server endpoints do not exist yet. The UI states this rather than pretending to save. |
| Subscription trials, upgrades and downgrades | The billing schema models plan state and the webhook path is written, but plan-change journeys have not been exercised against Stripe. |
| Growth suite (rank tracking, citations, churn, Sam, video) | Design preview on sample data. Needs a rank-tracking provider, a citation distributor and a lead provider before any of it can be live. |

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
3. Create the Stripe webhook endpoint against the public URL; store `whsec_` in
   the ingress process only; set `STRIPE_CHECKOUT_ENABLED=true`.
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
10. Run the one-business pilot described in `docs/pilot-runbook.md` before
    enabling paid signup.

## Verification commands

```bash
npm run check              # secrets scan, typecheck, unit tests, production build
npm run verify:journeys    # critical journeys against a running API
npm run db:test:isolation  # SQL tenant-isolation suite (needs psql)
```

`verify:journeys` accepts `API_BASE`, `VERIFY_EMAIL` and `VERIFY_PASSWORD` so it
can be pointed at a deployed environment. It creates one clearly-labelled
completed job, which the consent rules are expected to block while no Google
destination is connected.
