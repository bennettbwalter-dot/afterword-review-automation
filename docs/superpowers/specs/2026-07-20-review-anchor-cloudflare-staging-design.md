# Review Anchor Cloudflare-Native Staging Design

Date: 20 July 2026
Status: Approved; implementation planning complete

## Decision

Review Anchor staging will run on Cloudflare, not Render. The staging system will use Cloudflare Workers Static Assets for the React application, Workers for the application and ingress HTTP surfaces, Hyperdrive for PostgreSQL access, and a Queue consumer plus Cron Trigger for bounded background work.

This is a Cloudflare-native adaptation, not a container lift-and-shift. Cloudflare Containers are excluded because they require a Workers Paid plan. The zero-cost requirement is a hard gate: no Workers plan upgrade, paid add-on, or non-zero recurring charge may be accepted without separate user approval.

The staging deployment will use the already-provisioned Supabase project `cwwgvkepocldophqzijf`, where migrations 001-008 are applied and the PostgreSQL tenant-isolation suite has passed. It will deploy the current `feat/review-anchor-growth-suite` code for acceptance before the draft pull request is merged.

## Alternatives considered

1. Keep the authenticated staging API on Render and leave only the demo on Cloudflare. This needs the least runtime adaptation, but it conflicts with the chosen Cloudflare platform direction and leaves the product split across hosts.
2. Run the existing Node processes in Cloudflare Containers. This is the closest lift-and-shift option, but Containers require Workers Paid and therefore fail the zero-cost gate.
3. Expand the existing Pages demo with Pages Functions. Pages Functions use the Workers runtime, but changing the known-good static demo would mix demo and authenticated staging lifecycles. A separate Worker with Static Assets provides the same full-stack runtime while preserving the demo unchanged.
4. Adapt the three runtime surfaces to Workers, Hyperdrive, Queues, and Cron. This is the selected approach because it keeps the deployment Cloudflare-native, preserves database capability separation, and can remain at zero incremental monthly cost if the compatibility gates pass.

## Safety boundary

The following existing resources remain unchanged:

- The live Render API and ingress services and all of their environment variables.
- The public static Cloudflare Pages demo at `review-anchor-demo.pages.dev`.
- The live Supabase project and all live provider integrations.
- The draft pull request branch, except for separately reviewed and committed implementation changes.

All new Cloudflare resource names must contain `staging`. Staging receives its own Worker deployments, Queue, Hyperdrive configurations, hostnames, session pepper, and field-encryption key. No live secret is copied into staging, and no staging secret is copied into a live service.

The migration database login remains local-only. It must never be stored in a Worker secret, Hyperdrive configuration, CI variable, or deployment file.

## Target architecture

| Surface | Cloudflare resource | Database capability | Responsibilities |
| --- | --- | --- | --- |
| Application | `review-anchor-staging` Worker with Static Assets | `AUTH_DB` and `RUNTIME_DB` Hyperdrive bindings | React SPA, sessions, authenticated API, workspace routes |
| Public ingress | `review-anchor-staging-ingress` Worker with Static Assets | `INGRESS_DB` Hyperdrive binding | Public QR/review SPA, public API, and fail-closed provider callbacks |
| Background jobs | `review-anchor-staging-jobs` Worker | `WORKER_DB` Hyperdrive binding | Queue consumer and bounded scheduled maintenance |
| Schema changes | Local migration command only | `MIGRATION_DATABASE_URL` in ignored `.env.staging` | Migrations and grants; never deployed |

One Cloudflare Queue, `review-anchor-staging-jobs`, will carry bounded job notifications. A second Queue, `review-anchor-staging-jobs-dlq`, will hold terminal failures within the same Free-plan operation allowance. The application Worker receives a producer binding, and the jobs Worker receives the sole consumer binding with bounded batch size, retries, and the dead-letter queue. One Cron Trigger will invoke the jobs Worker every five minutes. The schedule is deliberately modest for staging and does not claim production timing parity.

The application and ingress deployments use Cloudflare-provided `workers.dev` hostnames. The jobs Worker has no public route and disables its `workers.dev` hostname. A custom staging domain is optional and outside this phase; its absence must not block acceptance.

## Application Worker

The application Worker deploys the Vite `dist` directory as Workers Static Assets and executes Worker code first for `/api/*`. Static asset requests are served by the `ASSETS` binding. Unmatched browser routes use the single-page-application fallback so `/app/*` and `/workspace` resolve to `index.html` without `@fastify/static`.

The existing `public/_headers` policy remains the source for CSP, permissions, cache, and no-index headers on static assets. Worker responses preserve equivalent headers through Fastify. Acceptance must prove that Workers Static Assets applies the tracked header policy before the Pages demo configuration is treated as reusable.

The React application and API remain same-origin. This preserves the current secure-cookie model and avoids adding cross-origin credentials or permissive CORS rules.

The existing Fastify application is retained initially through Cloudflare's Node HTTP server bridge:

- Enable `nodejs_compat` and `enable_nodejs_http_server_modules` with a current compatibility date.
- Create the Fastify/Node HTTP server once per isolate.
- Route `/api/*` requests through `handleAsNodeRequest` or `httpServerHandler`.
- Remove process signal handlers, real TCP port lifecycle, and filesystem-based static serving from the Worker entrypoint.
- Keep the existing cookie, security-header, raw-body, validation, and error-handling behavior where the compatibility tests prove it works.

The bridge is an explicit compatibility spike, not an assumption. It must prove Fastify startup, cookie handling, security headers, rate limiting, raw JSON and form bodies, request IDs, error responses, and concurrent request isolation. If Fastify core cannot run correctly in Workers, implementation stops and reports the exact blocker. An incompatible plugin can be replaced only by an explicitly planned Cloudflare-native equivalent with matching security tests. Replacing the full router with a fetch-native implementation would be a separately reviewed fallback, not an implicit rewrite.

The existing in-memory Fastify rate limiter is only per Worker isolate. It remains useful as defense in depth for staging but is not accepted as a globally consistent production rate limit. Production edge-rate-limiting design remains a later launch decision.

## PostgreSQL and Hyperdrive

Create four cache-disabled Hyperdrive configurations, each using the Supabase Direct connection endpoint and only its matching least-privilege login in Supabase staging:

- `review-anchor-staging-auth`
- `review-anchor-staging-runtime`
- `review-anchor-staging-ingress`
- `review-anchor-staging-worker`

Hyperdrive query caching is disabled for this phase. Authentication, sessions, permissions, billing state, tenant-scoped reads, and read-after-write flows require fresh results. Caching can be reconsidered later only for explicitly identified stale-tolerant reads.

Do not give Hyperdrive the Session Pooler or Transaction Pooler URLs used by local tools. Hyperdrive provides its own connection pool and Cloudflare explicitly recommends the Supabase Direct connection endpoint. The four role-specific connection strings are constructed only for Hyperdrive creation and are never written to a tracked file.

Each Hyperdrive origin pool starts at the minimum supported connection count. Before creating all four configurations, confirm that their combined minimum origin connections fit the staging Supabase project's current connection budget. If that cannot be proven, resource creation stops rather than weakening the four-role capability boundary.

The current server uses long-lived `pg.Pool` objects. Worker code must instead use event-scoped `pg.Client` connections created from the appropriate Hyperdrive binding and closed in `finally` blocks. No `pg.Pool` or connected client may be retained globally across Worker invocations.

The repository layer will gain a narrow database-capability adapter so the existing Node entrypoints can continue using pools while Cloudflare entrypoints use event-scoped clients. The adapter must preserve these guarantees:

- Application requests can access only auth and runtime bindings.
- Ingress requests can access only the ingress binding.
- Queue and scheduled events can access only the worker binding.
- Actor context is established and consumed inside the same explicit transaction.
- A transaction is committed or rolled back before its client is closed.
- Concurrent requests cannot observe another request's binding, actor, or transaction state.

If the Fastify bridge requires request context to reach a shared repository object, use `AsyncLocalStorage` around the bridged request and test it under concurrency. Failure to prove context isolation blocks deployment.

Hyperdrive operates in transaction-pooling mode, so any session state must be set inside the transaction that consumes it. The existing `set_request_context_from_session` transaction pattern is retained and covered by the staging tenant-isolation checks.

## Ingress Worker

The ingress Worker exposes only the existing public QR/review and webhook routes. It does not serve the authenticated application and receives no auth, runtime, worker, or migration database capability.

The live public review route `/r/:token` is a React route whose API calls are relative to its current origin. The ingress deployment therefore includes the same Vite Static Assets bundle, serves assets and `/r/*`, and runs Worker code first for `/api/*` and `/webhooks/*`. Requests for `/app/*` or `/workspace` on the ingress hostname return 404 so the authenticated product remains on the application hostname.

The Worker must preserve exact raw request bytes before JSON or form parsing so Twilio, SendGrid, Google Pub/Sub, and Stripe signatures can be verified later. During this staging phase, real provider credentials remain absent. Provider callback routes must fail closed with a stable non-success response when their verifier is unconfigured; they must not accept or persist unverifiable events.

Public QR links use the ingress Worker origin. Application links and login use the application Worker origin. No wildcard CORS policy is introduced.

## Queue and scheduled jobs

The existing background process contains an infinite polling loop and sleeps between cycles. Workers cannot run that lifecycle. The jobs Worker replaces it with bounded handlers:

- `queue(batch, env, ctx)` processes a finite batch and returns.
- `scheduled(event, env, ctx)` runs one bounded maintenance pass and returns.
- Every database claim retains its existing lease token and idempotency checks.
- No handler waits, sleeps, or loops indefinitely.
- A failed item is retried or sent to the staging dead-letter queue without replaying successful items.

Provider delivery is disabled until provider acceptance is separately approved. With delivery disabled, the application must not enqueue real delivery work, and the consumer must not claim or mutate outbound message jobs. Queue acceptance sends a non-delivery diagnostic message from the Cloudflare Queue dashboard. The message proves consumer, logging, and worker-role database connectivity without adding a public diagnostic endpoint or contacting an external provider.

The five-minute scheduled pass runs bounded expired-Stripe-payload cleanup and pilot-period checks. Google synchronization and token revocation return without work when Google is unconfigured. External SMS, email, Google, and Stripe calls are not part of this staging phase.

## Configuration and secrets

Use separate tracked Wrangler JSONC configurations under a `cloudflare/` directory for the application, ingress, and jobs Workers. Tracked files contain resource names, compatibility settings, static-asset routing, non-secret feature flags, Hyperdrive binding identifiers, Queue bindings, and the Cron expression only.

Secrets are set through Wrangler or the Cloudflare dashboard and never committed:

- Application Worker: `SESSION_PEPPER`, `DATA_HASH_PEPPER`, and `FIELD_ENCRYPTION_KEY`.
- Ingress Worker: the same `DATA_HASH_PEPPER` and `FIELD_ENCRYPTION_KEY`, but never `SESSION_PEPPER`.
- Jobs Worker: the same `FIELD_ENCRYPTION_KEY` used by the other staging Workers.

The same staging `FIELD_ENCRYPTION_KEY` is required wherever encrypted staging data is written or read. `DATA_HASH_PEPPER` is a purpose-specific key for destination and privacy-minimised visitor hashes that must match between application and ingress. `SESSION_PEPPER` remains separate and exists only on the application surface. Existing Node deployments may temporarily fall back from `DATA_HASH_PEPPER` to `SESSION_PEPPER` for release compatibility, but every new Cloudflare staging Worker uses the explicit split. Hyperdrive stores the database-role credentials; Worker code receives bindings rather than plaintext PostgreSQL URLs.

`STRIPE_CHECKOUT_ENABLED` remains `false`, `STRIPE_MODE` remains `test`, and Google, Twilio, SendGrid, and Stripe secrets remain absent. `.env.staging`, Supabase platform credentials, role passwords, and `MIGRATION_DATABASE_URL` must never be uploaded.

Logs must retain the current redaction of authorization headers, cookies, and passwords. They must also avoid database connection strings, Hyperdrive credentials, field-encryption material, session material, provider payloads, and decrypted customer data.

## Zero-cost gate

The staging design uses only products currently included in Workers Free:

- Up to 100,000 dynamic Worker requests per day and 10 ms CPU time per invocation.
- Static asset requests served without invoking Worker code.
- Up to 100,000 Hyperdrive database queries per day.
- Up to 10,000 Queue operations per day with 24-hour retention.

These are account-level planning limits, not capacity targets. Acceptance traffic must remain far below them. The dashboard must show Workers Free, or otherwise show that this deployment adds no recurring subscription or charge. No Cloudflare Container, Workers Paid upgrade, paid observability export, or other billable resource is allowed.

The existing password verifier uses Node `scrypt` with `N=16384`, `r=8`, `p=1`, and a 64 MB memory ceiling. Workers supports Node `scrypt`, but the Free plan CPU limit may still make login unsuitable. Before the full application deployment, a remote compatibility Worker must benchmark one valid and one invalid password verification and record Cloudflare CPU usage. The password parameters must not be weakened to fit the platform.

If login, Fastify startup, or a normal authenticated route cannot reliably fit the Free plan limits, deployment stops. The follow-up choices are a separately approved authentication redesign or a paid compute plan. Render is not used as a silent fallback.

## Deployment sequence

After this specification and its implementation plan are approved:

1. Add Worker-specific types, configs, and a minimal compatibility Worker without changing existing Node entrypoints.
2. Run local compatibility tests and Wrangler dry runs, then confirm the Supabase direct-connection budget.
3. Create the four cache-disabled Hyperdrive configurations with staging-only direct-connection role credentials.
4. Deploy the temporary compatibility Worker and prove Node HTTP bridging, `pg` through Hyperdrive, request-context isolation, raw bodies, and `scrypt` CPU behavior remotely.
5. Remove the temporary Worker after recording the gate results, then adapt the database layer and application entrypoint.
6. Deploy the application Worker and complete health, static asset, login, and tenant-isolation acceptance.
7. Deploy the ingress Worker and prove public QR behavior plus fail-closed webhook handling.
8. Create the staging Queue and dead-letter queue, then deploy the jobs Worker with delivery disabled and prove diagnostic Queue and scheduled events.
9. Confirm usage and billing remain at zero incremental monthly cost and record the acceptance evidence.

Deployments are manual during this phase. Automatic branch deployments are not enabled until staging has passed and the branch lifecycle after merge is decided.

## Verification

Before any Cloudflare resource creation:

1. Run the repository secret scan, typecheck, complete test suite, production build, and `git diff --check`.
2. Add focused tests for the database adapter, transaction cleanup, concurrent request context, Worker route dispatch, provider-disabled behavior, Queue retry boundaries, and scheduled-cycle bounds.
3. Run `wrangler deploy --dry-run` for all three Worker bundles and inspect them for accidental secrets and unsupported modules.
4. Confirm every resource and binding name contains `staging` and no configuration references the live Supabase project.

Remote compatibility gate:

1. Confirm the Node HTTP bridge starts and returns HTTP 200.
2. Confirm `pg.Client` connects through each staging Hyperdrive configuration and that combined origin connections stay within the Supabase staging budget.
3. Re-run tenant-role and cross-tenant denial checks through Worker-facing adapters.
4. Benchmark valid and invalid `scrypt` verification and inspect Worker CPU metrics.
5. Send concurrent requests and prove there is no actor, transaction, or binding leakage.
6. Verify exact raw request bytes survive the Fastify bridge.

Staging acceptance:

1. Confirm application and ingress health routes return HTTP 200 from cold and warm invocations.
2. Confirm static assets, SPA fallback, CSP, permissions policy, secure cookies, and no-index behavior.
3. Complete the authenticated browser journey against Supabase staging.
4. Complete the public QR/review journey without contacting a real provider.
5. Confirm unconfigured webhook routes fail closed and do not persist data.
6. Send a diagnostic Queue message from the Cloudflare dashboard and observe one successful consumer result with no external send.
7. Invoke the scheduled handler and prove it completes one bounded, provider-independent pass.
8. Inspect logs for redaction and Cloudflare metrics for errors, CPU, request, Hyperdrive, and Queue usage.
9. Confirm the Cloudflare account shows no new recurring monthly charge.

## Failure handling and rollback

- A compatibility-gate failure stops the rollout before the full application is deployed.
- Hyperdrive authentication or tenant-isolation failures are corrected only in staging; live database roles are never edited as a workaround.
- A Worker pointing at any Supabase project other than `cwwgvkepocldophqzijf` is misconfigured and must not receive traffic.
- A CPU-limit failure must not be solved by weakening password hashing, skipping verification, or enabling a paid plan without approval.
- A provider-disabled check failure must not be solved by adding real provider credentials.
- Rollback removes or disables only the new staging Workers, Queue, dead-letter queue, Hyperdrive configurations, and their staging secrets.
- Supabase staging and the static Pages demo remain available unless the user separately authorizes their removal.

## Non-goals

This phase does not modify or retire Render, move the existing Pages demo, merge the draft pull request, cut over production traffic, create a custom domain, enable real Google/Twilio/SendGrid/Stripe credentials, bootstrap the pilot business, or begin the seven-day pilot.

It also does not claim production parity for globally consistent rate limiting, job timing, queue retention, or traffic capacity. Those require a separate production-readiness decision after Cloudflare staging evidence exists.

## Completion criteria

Cloudflare staging is complete when all three staging Workers are healthy, the application and ingress journeys pass, each runtime has only its assigned staging database capabilities, actor isolation is proven through Hyperdrive, Queue and Cron handlers complete bounded provider-disabled work, the `scrypt` and route CPU measurements fit the Free plan, no secrets are exposed, every existing live resource remains unchanged, and Cloudflare shows no new recurring monthly charge.

## Cloudflare references

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Node HTTP server integration](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [Node crypto support](https://developers.cloudflare.com/changelog/post/2025-04-08-nodejs-crypto-and-tls/)
- [Connect Hyperdrive to Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)
- [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [How Hyperdrive works](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Queues configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
