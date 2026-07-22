# Review Anchor Cloudflare-Native Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the authenticated Review Anchor staging application, public review and webhook ingress, and bounded background jobs on Cloudflare Workers at $0/month while preserving the existing Render services, static Pages demo, Supabase tenant isolation, and disabled real-provider delivery.

**Architecture:** One Cloudflare Worker serves the authenticated React application plus application API; a second Worker serves the public `/r/:token` experience plus public/webhook API; a third Worker consumes a Queue and runs a bounded Cron cycle. Each runtime receives only its own cache-disabled Hyperdrive binding and secrets. A disposable remote compatibility Worker proves Fastify's Node HTTP bridge, raw webhook bodies, AsyncLocalStorage actor context, `pg` over Hyperdrive, and the existing scrypt password before any product staging Worker is deployed.

**Tech Stack:** TypeScript, React/Vite, Fastify, Cloudflare Workers Static Assets, Hyperdrive, Queues, Cron Triggers, Supabase PostgreSQL, Wrangler 4, Node test runner, Cloudflare Workers Vitest pool, Playwright.

## Global Constraints

- [ ] Keep `https://review-anchor-demo.pages.dev/`, all Render services, provider credentials, and production DNS unchanged.
- [ ] Every new Cloudflare resource name must contain `staging`. Never reuse a production Worker, Queue, Hyperdrive configuration, route, secret, or hostname.
- [ ] Remain on Cloudflare's free tier. Stop before any plan upgrade, paid add-on, or non-zero recurring charge and request separate approval.
- [ ] Authenticate Wrangler and confirm the intended Cloudflare account before creating resources. The last read-only check found an expired token, so authentication is an explicit first execution gate.
- [ ] Use only the Review Anchor Supabase staging project `cwwgvkepocldophqzijf`. Never point a binding or migration command at another project.
- [ ] Keep migrations 001-008 unchanged unless a failing compatibility test demonstrates that a database change is required. Any new migration is a separately reviewed change.
- [ ] Keep provider delivery disabled. Do not give staging live Google, Twilio, SendGrid, or Stripe secrets during this plan.
- [ ] Keep secrets out of `wrangler.jsonc`, source, command history, logs, test snapshots, pull-request text, and commits. Supply secrets interactively with `wrangler secret bulk` from an ignored local file.
- [ ] Preserve PostgreSQL capability separation: application auth, application runtime, ingress, and worker each use their dedicated database role and Hyperdrive configuration.
- [ ] Use direct Supabase PostgreSQL origins for Hyperdrive, TLS required, caching disabled, and an origin connection limit of 5 per configuration.
- [ ] Require at least 24 direct database connections available before provisioning four Hyperdrive configurations: 20 configured connections plus a reserve of 4.
- [ ] Treat the compatibility gate as blocking. Do not provision permanent Workers or deploy the product if any required remote assertion fails.
- [ ] Preserve `preview=1` on browser acceptance requests that must not record real QR scan analytics.
- [ ] Stage only intentional source, test, documentation, and generated Worker type files. Keep `.gstack/` and local evidence/secrets out of Git.
- [ ] Run the secret scan and `git diff --check` before every commit that changes deployment or configuration files.

---

## Planned File Map

Files modified:

- `package.json` — add Cloudflare type checking, dry-run, compatibility, provisioning, deployment, and acceptance scripts.
- `package-lock.json` — lock the Cloudflare Worker type dependency.
- `server/config.ts` — support capability-bound validation and separate session and data-hash peppers.
- `server/request-address.ts` — trust Cloudflare's client-address header only in explicit Worker mode.
- `server/db.ts` — replace concrete `pg.Pool` assumptions with structural SQL capability interfaces.
- `server/repository/postgres.ts` — accept structural database capabilities and use the data-hash pepper.
- `server/routes/public-review.ts` — hash Cloudflare's trusted visitor address with the data-hash pepper.
- `server/worker.ts` — expose one bounded delivery cycle and prevent claims while delivery is disabled.
- `scripts/bootstrap.ts` — optionally seed a synthetic public-review destination and QR code.
- `scripts/verify-journeys.ts` — verify both application and ingress origins, including non-recording public review.
- `.env.example` — document `DATA_HASH_PEPPER` and the default-off provider-delivery flag.
- `.gitignore` — ignore local Cloudflare secret and acceptance-evidence files.
- `README.md` — link the Cloudflare staging runbook and state the static-demo boundary.

Files created:

- `tsconfig.cloudflare.json` — Worker-only type-check configuration.
- `vitest.cloudflare.config.ts` — Workerd-backed tests for Worker-only modules.
- `tests/cloudflare/tsconfig.json` — Worker test types without changing the Node test project.
- `cloudflare/shared/types.ts` — binding and queue message contracts.
- `cloudflare/shared/database.ts` — event-scoped `pg.Client` adapters for Hyperdrive.
- `cloudflare/shared/async-scope.ts` — request/job-scoped AsyncLocalStorage-compatible proxy.
- `cloudflare/shared/http.ts` — Fastify Node HTTP server to Worker Fetch bridge.
- `cloudflare/shared/routing.ts` — explicit application and ingress route ownership.
- `cloudflare/application/src/index.ts` — fail-closed dry-run sentinel, then authenticated application Worker.
- `cloudflare/application/wrangler.jsonc` — application Worker and Static Assets config.
- `cloudflare/ingress/src/index.ts` — fail-closed dry-run sentinel, then public review and webhook ingress Worker.
- `cloudflare/ingress/wrangler.jsonc` — ingress Worker and public-review Static Assets config.
- `cloudflare/jobs/src/index.ts` — fail-closed dry-run sentinel, then Queue consumer and Cron Worker.
- `cloudflare/jobs/wrangler.jsonc` — Queue consumer, dead-letter queue, and Cron config.
- `cloudflare/compat/src/index.ts` — fail-closed dry-run sentinel, then temporary remote runtime compatibility Worker.
- `cloudflare/compat/wrangler.jsonc` — temporary compatibility deployment config.
- `scripts/cloudflare/assert-free-capacity.ts` — preflight account and Supabase connection-capacity checks.
- `scripts/cloudflare/provision.ts` — idempotent creation and config-ID capture for permanent Cloudflare resources.
- `scripts/cloudflare/verify-compat.ts` — remote compatibility assertions and cleanup guidance.
- `scripts/cloudflare/compat-fixture.ts` — create and remove two synthetic tenant-isolation fixtures for the remote gate.
- `scripts/cloudflare/deploy-staging.ts` — ordered dry-run and deployment orchestration.
- `scripts/cloudflare/accept-staging.ts` — post-deploy health, headers, routing, database-role, Queue, and Cron checks.
- `tests/cloudflare-config.test.ts` — capability and pepper validation.
- `tests/database-capability.test.ts` — structural and event-scoped database behavior.
- `tests/cloudflare/routing.test.ts` — host/path routing and asset-boundary behavior in Workerd.
- `tests/cloudflare/http.test.ts` — Fetch-to-Fastify bridge and raw-body behavior in Workerd.
- `tests/cloudflare/jobs.test.ts` — disabled-delivery, retry, acknowledgement, and bounded-cycle behavior in Workerd.
- `docs/runbooks/cloudflare-staging.md` — operator commands, rollback, evidence, and free-tier monitoring.

Generated but committed:

- `cloudflare/application/worker-configuration.d.ts`
- `cloudflare/ingress/worker-configuration.d.ts`
- `cloudflare/jobs/worker-configuration.d.ts`
- `cloudflare/compat/worker-configuration.d.ts`

Local-only and ignored:

- `.cloudflare/*-secrets.json`
- `.cloudflare/staging-resource-ids.json` until the compatibility gate passes; after permanent provisioning, commit only the non-secret IDs copied into Wrangler configuration.
- `.cloudflare/evidence/`

---

### Task 1: Add Worker runtime contracts, routing, and local bundle gates

**Files:**

- Create: `tests/cloudflare/routing.test.ts`
- Create: `tests/cloudflare/tsconfig.json`
- Create: `vitest.cloudflare.config.ts`
- Create: `cloudflare/shared/types.ts`
- Create: `cloudflare/shared/async-scope.ts`
- Create: `cloudflare/shared/routing.ts`
- Create: `cloudflare/application/src/index.ts`
- Create: `cloudflare/ingress/src/index.ts`
- Create: `cloudflare/jobs/src/index.ts`
- Modify: `cloudflare/compat/src/index.ts`
- Create: `tsconfig.cloudflare.json`
- Create: `cloudflare/application/wrangler.jsonc`
- Create: `cloudflare/ingress/wrangler.jsonc`
- Create: `cloudflare/jobs/wrangler.jsonc`
- Create: `cloudflare/compat/wrangler.jsonc`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install Worker test/type dependencies and configure Workerd tests**

Run:

```powershell
npm.cmd install --save-dev @cloudflare/workers-types vitest@^4.1.0 @cloudflare/vitest-pool-workers
```

Do not upgrade Wrangler or unrelated packages. Inspect `package-lock.json` and confirm dependency-tree changes are limited to the three requested Worker testing/type packages and their transitive dependencies.

Create `vitest.cloudflare.config.ts` before writing the first Worker test:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-20",
        compatibilityFlags: [
          "nodejs_compat",
          "enable_nodejs_http_server_modules",
        ],
      },
    }),
  ],
  test: {
    include: ["tests/cloudflare/**/*.test.ts"],
  },
});
```

Create `tsconfig.cloudflare.json` with Worker types, ES2022, bundler module resolution, no emit, and includes for `cloudflare/**/*.ts` plus generated binding declarations. Create `tests/cloudflare/tsconfig.json` extending it, adding `@cloudflare/vitest-pool-workers/types`, and including only Worker tests. Add:

```json
{
  "test:cloudflare": "vitest run --config vitest.cloudflare.config.ts"
}
```

- [ ] **Step 2: Write failing route-ownership tests**

Add table-driven tests with these exact expectations:

| Host surface | Path | Owner/result |
| --- | --- | --- |
| application | `/api/v1/health` | Fastify |
| application | `/api/v1/workspace` | Fastify |
| application | `/app` | Static Assets |
| application | `/workspace` | Static Assets |
| application POST | `/workspace` | 404 |
| application | `/r/token` | 308 redirect to the same path and query on `PUBLIC_REVIEW_ORIGIN` |
| ingress | `/api/v1/public/review-flows/token` | Fastify |
| ingress | `/webhooks/stripe` | Fastify |
| ingress | `/r/token` | Static Assets |
| ingress POST | `/r/token` | 404 |
| ingress | `/app` | 404 |
| ingress | `/workspace` | 404 |
| ingress | `/api/v1/workspace` | 404 without invoking Fastify |

Also test query preservation on the application-to-ingress redirect, including `preview=1`.

- [ ] **Step 3: Run the focused test and confirm failure**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/routing.test.ts
```

Expected: FAIL because the route classifier does not exist.

- [ ] **Step 4: Define binding and queue contracts**

In `cloudflare/shared/types.ts` define:

```ts
export type StagingJobMessage =
  | {
      kind: "diagnostic";
      id: string;
      requestedAt: string;
    }
  | {
      kind: "delivery-kick";
      id: string;
      requestedAt: string;
    };

interface SharedStaticAssets {
  fetch(request: Request): Promise<Response>;
}

export interface ApplicationEnv {
  APP_ORIGIN: string;
  PUBLIC_REVIEW_ORIGIN: string;
  SESSION_PEPPER: string;
  DATA_HASH_PEPPER: string;
  FIELD_ENCRYPTION_KEY: string;
  AUTH_DB: Hyperdrive;
  RUNTIME_DB: Hyperdrive;
  JOBS_QUEUE?: Queue<StagingJobMessage>;
  ASSETS: SharedStaticAssets;
}

export interface IngressEnv {
  APP_ORIGIN: string;
  PUBLIC_REVIEW_BASE_URL: string;
  EXTERNAL_WEBHOOK_BASE_URL: string;
  DATA_HASH_PEPPER: string;
  FIELD_ENCRYPTION_KEY: string;
  INGRESS_DB: Hyperdrive;
  ASSETS: SharedStaticAssets;
}

export interface JobsEnv {
  PROVIDER_DELIVERY_ENABLED: "false";
  FIELD_ENCRYPTION_KEY: string;
  WORKER_DB: Hyperdrive;
}
```

The ingress contract must not include `SESSION_PEPPER`. The jobs contract must not include auth, runtime, ingress, assets, session, or data-hash bindings.

- [ ] **Step 5: Implement deterministic routing**

In `cloudflare/shared/routing.ts` return discriminated decisions rather than forwarding first and filtering later:

```ts
export type RouteDecision =
  | { owner: "fastify" }
  | { owner: "assets" }
  | { owner: "redirect"; location: string }
  | { owner: "not-found" };

export function applicationRoute(
  request: Pick<Request, "method" | "url">,
  publicReviewOrigin: string,
): RouteDecision;

export function ingressRoute(
  request: Pick<Request, "method" | "url">,
): RouteDecision;
```

Rules:

- Application sends every `/api/` path to Fastify.
- Application redirects `/r` and `/r/*` with status 308 to `PUBLIC_REVIEW_ORIGIN` while preserving path and query.
- Application sends every other GET/HEAD route to Static Assets and returns 404 for non-API browser-route methods.
- Ingress sends only `/api/v1/public/*` and `/webhooks/*` to Fastify.
- Ingress sends GET/HEAD `/r`, `/r/*`, and fingerprinted static assets to Static Assets; non-GET/HEAD asset routes return 404.
- Ingress returns a plain 404 for authenticated paths and every non-public `/api/*` path.
- No route adds wildcard CORS.

- [ ] **Step 6: Add the request-scoped binding proxy**

In `cloudflare/shared/async-scope.ts` wrap Node `AsyncLocalStorage`:

```ts
export interface AsyncScope<T extends object> {
  current: T;
  run<R>(value: T, callback: () => R): R;
}

export function createAsyncScope<T extends object>(label: string): AsyncScope<T>;
```

`current` is a Proxy that:

- Throws a stable error naming `label` when accessed outside `run`.
- Gets the current store for every property access.
- Binds methods to the current store so class methods keep their receiver.
- Never caches one request's store on a module-global object.

Extend `tests/cloudflare/routing.test.ts` with two interleaved async scopes and assert that each returns only its own marker before and after an awaited barrier.

- [ ] **Step 7: Add baseline Wrangler configurations without secret values**

Each configuration must use:

```jsonc
"compatibility_date": "2026-07-20",
"compatibility_flags": [
  "nodejs_compat",
  "enable_nodejs_http_server_modules"
],
"observability": {
  "enabled": true
}
```

Application configuration:

- Name `review-anchor-staging`.
- Main `src/index.ts`.
- Workers.dev enabled.
- Static Assets directory `../../dist` with binding `ASSETS`.
- `not_found_handling` set to `single-page-application`.
- `run_worker_first` set to `["/api/*", "/r", "/r/*"]`.
- Plaintext vars set `NODE_ENV="production"`, `STRIPE_CHECKOUT_ENABLED="false"`, `STRIPE_MODE="test"`, and `PROVIDER_DELIVERY_ENABLED="false"`.
- Do not add origin vars until Task 3 has authenticated the account and verified the exact Workers.dev subdomain.

Ingress configuration:

- Name `review-anchor-staging-ingress`.
- Main `src/index.ts`.
- Workers.dev enabled.
- Same Static Assets directory and SPA fallback.
- `run_worker_first` set to `["/api/*", "/webhooks/*", "/app", "/app/*", "/workspace", "/workspace/*"]`.
- Same production/test/default-off plaintext vars as application.

Jobs configuration:

- Name `review-anchor-staging-jobs`.
- Main `src/index.ts`.
- `workers_dev` false.
- Plaintext vars set `NODE_ENV="production"`, `PROVIDER_DELIVERY_ENABLED="false"`, `STRIPE_CHECKOUT_ENABLED="false"`, and `STRIPE_MODE="test"`.
- Do not add Queue, Hyperdrive, or Cron bindings until their permanent resources exist.

Compatibility configuration:

- Name `review-anchor-staging-compat`.
- Main `src/index.ts`.
- Workers.dev enabled.
- No Static Assets.
- No permanent resource identifiers yet.

Do not place `localConnectionString` in a tracked configuration.

- [ ] **Step 8: Add fail-closed sentinel entrypoints**

Create all four configured `src/index.ts` files now so strict dry-runs exercise real bundles before remote resources exist:

- Application and ingress sentinels return 503 JSON with code `STAGING_NOT_IMPLEMENTED` for every request.
- Jobs sentinel exports only `queue` and `scheduled`; it retries every queue item and throws `STAGING_NOT_IMPLEMENTED` from scheduled execution.
- Compatibility sentinel returns 503 except `GET /health`, which returns 503 with the same code.
- No sentinel reads a binding, contacts a database, serves an asset, acknowledges a Queue message, or is deployed remotely.

Each later runtime task replaces its sentinel completely and changes the file action from creation to modification.

- [ ] **Step 9: Add Worker-only type checking and deployment scripts**

Add the remaining scripts:

```json
{
  "typecheck:cloudflare": "tsc -p tsconfig.cloudflare.json --noEmit && tsc -p tests/cloudflare/tsconfig.json --noEmit",
  "cf:types": "wrangler types cloudflare/application/worker-configuration.d.ts --config cloudflare/application/wrangler.jsonc && wrangler types cloudflare/ingress/worker-configuration.d.ts --config cloudflare/ingress/wrangler.jsonc && wrangler types cloudflare/jobs/worker-configuration.d.ts --config cloudflare/jobs/wrangler.jsonc && wrangler types cloudflare/compat/worker-configuration.d.ts --config cloudflare/compat/wrangler.jsonc",
  "cf:dry-run": "wrangler deploy --dry-run --strict --config cloudflare/application/wrangler.jsonc && wrangler deploy --dry-run --strict --config cloudflare/ingress/wrangler.jsonc && wrangler deploy --dry-run --strict --config cloudflare/jobs/wrangler.jsonc && wrangler deploy --dry-run --strict --config cloudflare/compat/wrangler.jsonc"
}
```

If Windows command chaining in a package script makes failure reporting unclear, replace the chain with a typed Node orchestration script under `scripts/cloudflare/`. Do not suppress a failed subcommand.

- [ ] **Step 10: Validate routes, types, and baseline bundles**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/routing.test.ts
npm.cmd run typecheck
npm.cmd run cf:types
npm.cmd run typecheck:cloudflare
npm.cmd run build
npm.cmd run cf:dry-run
npm.cmd run security:secrets
git diff --check
```

Expected: all commands pass. Dry runs must not require remote authentication and bundle only the four named staging Workers.

- [ ] **Step 11: Commit the Worker scaffold**

```powershell
git add -- package.json package-lock.json tsconfig.cloudflare.json vitest.cloudflare.config.ts tests/cloudflare/tsconfig.json tests/cloudflare/routing.test.ts cloudflare/shared/types.ts cloudflare/shared/async-scope.ts cloudflare/shared/routing.ts cloudflare/application/src/index.ts cloudflare/application/wrangler.jsonc cloudflare/application/worker-configuration.d.ts cloudflare/ingress/src/index.ts cloudflare/ingress/wrangler.jsonc cloudflare/ingress/worker-configuration.d.ts cloudflare/jobs/src/index.ts cloudflare/jobs/wrangler.jsonc cloudflare/jobs/worker-configuration.d.ts cloudflare/compat/src/index.ts cloudflare/compat/wrangler.jsonc cloudflare/compat/worker-configuration.d.ts
git commit -m "feat: scaffold Cloudflare staging runtimes"
```

---

### Task 2: Build the disposable remote compatibility probe

**Files:**

- Create: `tests/cloudflare/http.test.ts`
- Create: `cloudflare/shared/http.ts`
- Modify: `cloudflare/compat/src/index.ts`
- Create: `scripts/cloudflare/verify-compat.ts`
- Create: `scripts/cloudflare/compat-fixture.ts`
- Modify: `cloudflare/compat/wrangler.jsonc`
- Modify: `package.json`

- [ ] **Step 1: Write failing bridge and raw-body tests**

The tests must prove:

- A minimal Fastify server returns a response through a Worker `Request`.
- Duplicate headers and Set-Cookie behavior survive the bridge.
- A JSON body and an `application/x-www-form-urlencoded` body arrive as exact original bytes before parsing.
- Two interleaved requests observe their own async-scope marker.
- Unsupported methods and malformed bodies return the existing Fastify error shape, not an unhandled Worker exception.
- The bridge closes event-scoped database capabilities in a `finally` block after both success and failure.

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/http.test.ts
```

Expected: FAIL because the Fastify bridge is not implemented.

- [ ] **Step 3: Implement the official Node HTTP bridge**

In `cloudflare/shared/http.ts` use the server-first Cloudflare API:

```ts
import { httpServerHandler } from "cloudflare:node";
import type { FastifyInstance } from "fastify";

export async function createFastifyFetchHandler(app: FastifyInstance) {
  await app.ready();
  const handler = httpServerHandler(app.server);
  return handler.fetch.bind(handler);
}
```

Declare this helper `async` and return the typed Fetch handler promise. Build and ready the Fastify instance once per isolate. Do not call `app.listen`, install signal handlers, or serve files from disk. Request-specific repository capabilities are resolved through the async-scope proxy established around each `fetch`.

- [ ] **Step 4: Implement authenticated compatibility assertions**

The compatibility Worker must require an exact bearer token from Worker secret `COMPAT_GATE_TOKEN` for every route except `/health`. It exposes:

| Route | Assertion |
| --- | --- |
| `GET /health` | Node HTTP bridge and Fastify startup return `{"ok":true}` |
| `POST /compat/raw` | Return SHA-256 of exact raw bytes plus parsed body type; never echo the body |
| `GET /compat/context/:marker` | Await a deterministic interleaving barrier and return only the request marker |
| `GET /compat/database` | Query `current_user` and `current_database()` once through each of `AUTH_DB`, `RUNTIME_DB`, `INGRESS_DB`, and `WORKER_DB` |
| `POST /compat/isolation` | Resolve two synthetic sessions and prove each runtime transaction sees its own tenant and not the other |
| `POST /compat/scrypt` | Verify one valid and one invalid password against the fixed synthetic hash and report wall duration only |

Use this non-customer fixture:

```text
Password: Cloudflare compatibility password 2026!
Hash: scrypt$16384$8$1$XrtXOb8CvTz77fgedLmkKg$8Kx_JFypoqhWfIdL42mShiNIIlivAaaWykxhNBQmNeAZwrELwxESLKrYBEzcqnMBBujrcdYJaMOUX0-Uw29rDQ
```

Expected database users:

- `afterword_auth_login`
- `afterword_runtime_login`
- `afterword_ingress_login`
- `afterword_worker_login`

The endpoint returns only expected/actual role names, booleans, and timing. It must never return connection strings, database host details, hashes, tokens, environment values, or query error internals.

- [ ] **Step 5: Add a reversible two-tenant compatibility fixture**

`scripts/cloudflare/compat-fixture.ts prepare` uses local-only `MIGRATION_DATABASE_URL` and the table/function patterns already exercised by `database/tests/003_tenant_isolation.sql` to create two clearly named synthetic businesses, locations, users, and unexpired login sessions. It must:

- Refuse any project except `cwwgvkepocldophqzijf`.
- Generate fresh opaque session hashes and IDs.
- Write only the synthetic IDs and encoded hashes required by the verifier to ignored `.cloudflare/evidence/compat-fixture.json`.
- Never use or modify a real user, business, location, session, or provider row.
- Be idempotent for one active fixture manifest.
- Support `cleanup` that verifies the exact IDs and synthetic name prefix before deleting only those rows.

The compatibility Worker's `/compat/isolation` handler receives the two synthetic fixture contexts only after bearer authentication. For each context it uses `AUTH_DB` to resolve the matching session, then `RUNTIME_DB` to begin a transaction, call `set_request_context_from_session`, query the fixture rows, and commit/roll back before closing. It returns booleans proving own-tenant visibility and other-tenant denial, not row data or identifiers.

- [ ] **Step 6: Add a strict remote verifier**

`scripts/cloudflare/verify-compat.ts` accepts `COMPAT_BASE_URL` and `COMPAT_GATE_TOKEN` from the current process. It must:

1. Reject a base URL that is not HTTPS or whose hostname does not belong to the authenticated account's Workers.dev subdomain.
2. Call `/health` cold and warm.
3. Send known JSON and form byte sequences to `/compat/raw` and compare local SHA-256 values.
4. Launch at least 20 paired concurrent context requests and reject any marker leak.
5. Require all four exact database role names.
6. Submit the two synthetic contexts to `/compat/isolation` and require own-tenant visibility plus cross-tenant denial in both directions.
7. Run valid and invalid scrypt checks at least three times each.
8. Require both valid/invalid booleans to be correct and record durations in ignored evidence JSON.
9. Return non-zero on any failed assertion.

Do not encode a CPU pass threshold from wall time alone. After this verifier passes, the executor must inspect Cloudflare CPU metrics and confirm the valid and invalid checks, plus `/health`, stay below the current Free-plan invocation CPU allowance without exceptions or throttling.

- [ ] **Step 7: Run local compatibility validation**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/http.test.ts tests/cloudflare/routing.test.ts
npm.cmd run typecheck:cloudflare
npm.cmd exec wrangler -- deploy --dry-run --strict --config cloudflare/compat/wrangler.jsonc
npm.cmd run security:secrets
git diff --check
```

Expected: tests, types, and dry-run pass with no live binding or secret.

- [ ] **Step 8: Commit the compatibility probe**

```powershell
git add -- package.json cloudflare/shared/http.ts cloudflare/compat/src/index.ts cloudflare/compat/wrangler.jsonc scripts/cloudflare/compat-fixture.ts scripts/cloudflare/verify-compat.ts tests/cloudflare/http.test.ts
git commit -m "test: add Cloudflare runtime compatibility gate"
```

---

### Task 3: Authenticate, prove free capacity, create Hyperdrive, and execute the remote gate

**Files:**

- Create: `scripts/cloudflare/assert-free-capacity.ts`
- Create: `scripts/cloudflare/provision.ts`
- Create locally: `.cloudflare/staging-compat-secrets.json`
- Create locally: `.cloudflare/staging-application-secrets.json`
- Create locally: `.cloudflare/staging-ingress-secrets.json`
- Create locally: `.cloudflare/staging-jobs-secrets.json`
- Create locally: `.cloudflare/evidence/compatibility.json`
- Modify: `.gitignore`
- Modify: `cloudflare/application/wrangler.jsonc`
- Modify: `cloudflare/ingress/wrangler.jsonc`
- Modify: `cloudflare/jobs/wrangler.jsonc`
- Modify temporarily, then restore: `cloudflare/compat/wrangler.jsonc`
- Generate: `cloudflare/application/worker-configuration.d.ts`
- Generate: `cloudflare/ingress/worker-configuration.d.ts`
- Generate: `cloudflare/jobs/worker-configuration.d.ts`
- Generate: `cloudflare/compat/worker-configuration.d.ts`

- [ ] **Step 1: Ignore local Cloudflare secret and evidence material**

Add:

```gitignore
.cloudflare/*-secrets.json
.cloudflare/staging-resource-ids.json
.cloudflare/evidence/
```

The tracked Wrangler files will hold permanent resource IDs after the gate, but the complete local provisioning response remains ignored.

- [ ] **Step 2: Implement the account and capacity preflight**

`scripts/cloudflare/assert-free-capacity.ts` must:

- Load `.env.staging` without printing values.
- Require `SUPABASE_PROJECT_REF` to equal `cwwgvkepocldophqzijf`.
- Validate `SUPABASE_POOLER_HOST` as belonging to the same project, but keep it local-only.
- Use `MIGRATION_DATABASE_URL`, `AUTH_DATABASE_URL`, `RUNTIME_DATABASE_URL`, `INGRESS_DATABASE_URL`, and `WORKER_DATABASE_URL` only for local preflight queries; those existing URLs may use the Supabase pooler.
- Construct separate sanitized Hyperdrive origin descriptors from direct host `db.cwwgvkepocldophqzijf.supabase.co`, database `postgres`, port `5432`, the four exact role names, and `AUTH_DATABASE_PASSWORD`, `RUNTIME_DATABASE_PASSWORD`, `INGRESS_DATABASE_PASSWORD`, or `WORKER_DATABASE_PASSWORD`.
- Reject any attempt to pass a pooler URL, pooled username suffix, `DATABASE_URL`, or `MIGRATION_DATABASE_URL` to Hyperdrive provisioning.
- Connect locally with `MIGRATION_DATABASE_URL` only for the preflight.
- Query `max_connections` and the current `pg_stat_activity` count.
- Require at least 24 currently available direct connections.
- Connect once with each dedicated role URL and require `current_user` to match its expected login.
- Count rows in `customer_contacts`, `review_requests`, `message_dispatch_payloads`, `integration_secrets`, `oauth_authorization_states`, `google_profile_selection_states`, `provider_webhook_events`, `oauth_token_revocations`, `channel_suppressions`, `ingress_events`, and `qr_scan_events`.
- Require all rotation-sensitive table counts to be zero before generating a new session/data/encryption secret set. Report table names and counts only; never decrypt or print row contents.
- Exit non-zero without creating resources if any check fails.
- Redact passwords, URLs, hostnames, and certificate material from output and thrown errors.

The migration URL remains local-only and is never passed to Wrangler.

- [ ] **Step 3: Authenticate Wrangler interactively**

Run:

```powershell
npm.cmd exec wrangler -- login
npm.cmd exec wrangler -- whoami
```

Stop if login fails, the token remains expired, or `whoami` shows the wrong account. Record the account ID in ignored evidence, not in prose containing tokens. In the same account's Workers dashboard, read the exact Workers.dev subdomain, record it in `.cloudflare/staging-resource-ids.json`, and reject any value that does not match the dashboard.

- [ ] **Step 4: Confirm the zero-cost account boundary before mutation**

In the Cloudflare dashboard for that exact account, verify:

- Workers plan is Free.
- Hyperdrive and Queues are available without prompting for a plan upgrade.
- No paid observability export, Container, or subscription is selected.
- The UI shows no recurring monthly charge for the planned resources.

Capture screenshots or text evidence under `.cloudflare/evidence/`. If the dashboard asks for payment or an upgrade, stop and report the blocker.

- [ ] **Step 5: Run the Supabase capacity gate**

```powershell
npm.cmd exec tsx -- scripts/cloudflare/assert-free-capacity.ts
```

Expected: exact project, four role logins, zero rotation-sensitive rows, and at least 24 available connections pass. Do not continue on a warning or an indeterminate result. If any rotation-sensitive row exists, stop for a separately reviewed preserve/rehash/purge decision; do not silently make existing encrypted or hashed staging data unreadable.

- [ ] **Step 6: Generate staging secrets and lock the exact Workers.dev origins**

Implement `scripts/cloudflare/provision.ts prepare` to:

- Read the account-verified Workers.dev subdomain from ignored resource evidence.
- Validate it as one DNS label and require explicit confirmation of the resulting URLs.
- Derive `https://review-anchor-staging.<verified-subdomain>.workers.dev` and `https://review-anchor-staging-ingress.<verified-subdomain>.workers.dev`.
- Patch the permanent Wrangler vars with those exact URLs: application `APP_ORIGIN` and `PUBLIC_REVIEW_ORIGIN`; ingress `APP_ORIGIN`, `PUBLIC_REVIEW_BASE_URL`, and `EXTERNAL_WEBHOOK_BASE_URL`.
- Generate four independent 32-byte base64url values for `COMPAT_GATE_TOKEN`, `SESSION_PEPPER`, `DATA_HASH_PEPPER`, and `FIELD_ENCRYPTION_KEY` using Node `randomBytes`.
- Require `SESSION_PEPPER` and `DATA_HASH_PEPPER` to differ.
- Write the four ignored runtime-specific secret JSON files with the least-privilege key sets described in Tasks 6-8.
- Copy the same generated data-hash value to application and ingress only.
- Copy the same generated field-encryption value to application, ingress, and jobs only.
- Write `SESSION_PEPPER` to application only and `COMPAT_GATE_TOKEN` to compatibility only.
- Before replacing local `SESSION_PEPPER` or `FIELD_ENCRYPTION_KEY`, copy the prior staging-only values to ignored `.cloudflare/pre-rotation-secrets.json` without printing them.
- Update only `SESSION_PEPPER`, `DATA_HASH_PEPPER`, and `FIELD_ENCRYPTION_KEY` in ignored `.env.staging` so local bootstrap/acceptance code and Cloudflare use the same staging cryptographic domain. Leave every database URL/password and provider field unchanged.
- Refuse to overwrite an existing secret file unless the executor passes an explicit `--rotate` flag after confirming no staging data needs the existing values.
- Never print generated values or include them in a child-process argument other than the local `wrangler secret bulk` file read.

Run:

```powershell
npm.cmd exec tsx -- scripts/cloudflare/provision.ts prepare
```

Inspect the tracked config diff and confirm both origins use the verified subdomain and every name contains `staging`.

- [ ] **Step 7: Create exactly four cache-disabled Hyperdrive configurations**

Implement `scripts/cloudflare/provision.ts hyperdrive` to invoke the local Wrangler binary without a shell. It reads passwords from ignored local input, passes them as child-process arguments without logging them, redacts child errors, parses Wrangler JSON output, validates the returned names/IDs, and updates only the matching tracked configuration:

| Hyperdrive name | Direct database login | Binding | Tracked config |
| --- | --- | --- | --- |
| `review-anchor-staging-auth` | `afterword_auth_login` / `AUTH_DATABASE_PASSWORD` | `AUTH_DB` | application |
| `review-anchor-staging-runtime` | `afterword_runtime_login` / `RUNTIME_DATABASE_PASSWORD` | `RUNTIME_DB` | application |
| `review-anchor-staging-ingress` | `afterword_ingress_login` / `INGRESS_DATABASE_PASSWORD` | `INGRESS_DB` | ingress |
| `review-anchor-staging-worker` | `afterword_worker_login` / `WORKER_DATABASE_PASSWORD` | `WORKER_DB` | jobs |

Every create call must use Wrangler's separate `--host`, `--database`, `--user`, `--password`, `--port`, `--sslmode`, `--caching-disabled`, and `--origin-connection-limit` arguments rather than constructing a logged connection-string argument. Set database `postgres`, port `5432`, TLS mode `require`, caching disabled, and origin connection limit `5`. The script must list existing configurations first and:

- Reuse one only when its exact staging name and sanitized origin metadata match.
- Stop on a same-name mismatch; never overwrite or retarget it.
- Persist non-secret IDs to `.cloudflare/staging-resource-ids.json`.
- Patch the three permanent Wrangler files with only binding names and IDs.
- Never write origin passwords or connection strings into a tracked file.

Run:

```powershell
npm.cmd exec tsx -- scripts/cloudflare/provision.ts hyperdrive
```

- [ ] **Step 8: Bind all four staging Hyperdrives to the temporary probe**

Temporarily add the four non-secret IDs to `cloudflare/compat/wrangler.jsonc` under their normal binding names. Set a fresh random `COMPAT_GATE_TOKEN` from the ignored secrets file:

```powershell
npm.cmd exec wrangler -- secret bulk .cloudflare/staging-compat-secrets.json --config cloudflare/compat/wrangler.jsonc
```

The compatibility secret file generated in Step 6 contains only `COMPAT_GATE_TOKEN`. Do not include application, encryption, database, or provider secrets in the compatibility Worker.

- [ ] **Step 9: Generate binding types and rerun local gates**

```powershell
npm.cmd run cf:types
npm.cmd run typecheck:cloudflare
npm.cmd run cf:dry-run
npm.cmd run security:secrets
git diff --check
```

Inspect every dry-run bundle report. Reject unexpected filesystem, child-process, raw TCP listener, provider secret, or non-staging resource references.

- [ ] **Step 10: Deploy only the compatibility Worker**

```powershell
npm.cmd exec wrangler -- deploy --strict --config cloudflare/compat/wrangler.jsonc
npm.cmd exec wrangler -- deployments status --json --config cloudflare/compat/wrangler.jsonc
```

Record the immutable deployment ID and Workers.dev URL under ignored evidence. Confirm no application, ingress, or jobs Worker was deployed by this step.

- [ ] **Step 11: Execute every remote assertion**

Set `COMPAT_BASE_URL` and `COMPAT_GATE_TOKEN` only in the current process, then run:

```powershell
npm.cmd exec tsx -- scripts/cloudflare/compat-fixture.ts prepare
npm.cmd exec tsx -- scripts/cloudflare/verify-compat.ts
```

In parallel with a second test pass, tail logs:

```powershell
npm.cmd exec wrangler -- tail review-anchor-staging-compat --format json
```

Required result:

- Cold and warm health pass.
- Exact JSON and form raw-body hashes pass.
- All 20 paired concurrent context checks pass with no leakage.
- All four roles return the exact expected `current_user`.
- Both synthetic sessions see only their own tenant through Worker-facing auth/runtime adapters.
- Valid and invalid scrypt results are correct across all samples.
- No uncaught exception, CPU timeout, secret-bearing log, database detail, or cross-role query appears.
- Cloudflare metrics show the bridge, normal database query, and both scrypt paths fit the Free-plan CPU limit reliably.
- Supabase connections remain inside the measured budget.

- [ ] **Step 12: Apply the hard decision gate**

If any required result fails:

1. Save only redacted failure evidence.
2. Run `scripts/cloudflare/compat-fixture.ts cleanup` and verify the synthetic manifest rows no longer exist.
3. Verify the exact compatibility Worker name and deployment ID.
4. Delete `review-anchor-staging-compat`.
5. Verify the exact four Hyperdrive IDs created by this run, delete only those staging configurations, and leave pre-existing resources untouched.
6. Restore `cloudflare/compat/wrangler.jsonc` to its binding-free tracked state.
7. Stop implementation and report the specific failed assertion. Do not deploy product Workers, weaken scrypt, combine database roles, enable a paid plan, or fall back to Render.

If every result passes:

1. Save the redacted timing, role, isolation, deployment, connection, and dashboard evidence.
2. Run `scripts/cloudflare/compat-fixture.ts cleanup` and verify the synthetic manifest rows no longer exist.
3. Delete only `review-anchor-staging-compat`.
4. Restore the compatibility config to its binding-free state.
5. Keep the four proven staging Hyperdrive configurations for the product Workers.

- [ ] **Step 13: Validate and commit only permanent non-secret configuration**

```powershell
npm.cmd run cf:types
npm.cmd run typecheck:cloudflare
npm.cmd run cf:dry-run
npm.cmd run security:secrets
git diff --check
git status --short
```

Confirm `.cloudflare/` and `.gstack/` are absent from the index. Then:

```powershell
git add -- .gitignore package.json scripts/cloudflare/assert-free-capacity.ts scripts/cloudflare/provision.ts cloudflare/application/wrangler.jsonc cloudflare/ingress/wrangler.jsonc cloudflare/jobs/wrangler.jsonc cloudflare/application/worker-configuration.d.ts cloudflare/ingress/worker-configuration.d.ts cloudflare/jobs/worker-configuration.d.ts cloudflare/compat/worker-configuration.d.ts
git commit -m "chore: bind Cloudflare staging databases"
```

---

### Task 4: Separate session secrets from durable data hashing

**Files:**

- Create: `tests/cloudflare-config.test.ts`
- Modify: `server/config.ts`
- Modify: `server/app.ts`
- Modify: `server/repository/postgres.ts`
- Create: `server/request-address.ts`
- Modify: `server/routes/auth.ts`
- Modify: `server/routes/google.ts`
- Modify: `server/routes/public-review.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing capability and pepper tests**

Add focused tests that exercise `loadConfig` with explicitly bound database capabilities:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  dataHashPepper,
  loadConfig,
  sessionPepper,
} from "../server/config.js";

const base = {
  NODE_ENV: "test",
  FIELD_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  APP_ORIGIN: "https://app.staging.example",
};

test("ingress-only config does not require a session pepper", () => {
  const config = loadConfig(
    { ...base, DATA_HASH_PEPPER: "d".repeat(32) },
    ["ingress"],
    { boundDatabaseCapabilities: ["ingress"], surface: "ingress" },
  );
  assert.equal(dataHashPepper(config), "d".repeat(32));
  assert.throws(() => sessionPepper(config), /SESSION_PEPPER/);
});

test("application config requires a session pepper", () => {
  assert.throws(
    () => loadConfig(
      { ...base, DATA_HASH_PEPPER: "d".repeat(32) },
      ["auth", "runtime"],
      { boundDatabaseCapabilities: ["auth", "runtime"], surface: "application" },
    ),
    /SESSION_PEPPER/,
  );
});

test("Node config temporarily falls back to SESSION_PEPPER", () => {
  const config = loadConfig(
    { ...base, SESSION_PEPPER: "s".repeat(32) },
    [],
    { surface: "node" },
  );
  assert.equal(dataHashPepper(config), "s".repeat(32));
});
```

Use the actual valid example encryption key from `.env.example` if the test key above does not pass the existing canonical base64url validator. Do not weaken that validator.

Also cover:

- A production application with bound auth/runtime capabilities does not require database URLs or `DATABASE_CA_CERT_PATH`.
- A production ingress config with a bound ingress capability requires data hashing but not session material.
- A production worker config with a bound worker capability requires field encryption but not session/data peppers or `APP_ORIGIN`.
- An unbound production Node capability retains the current database URL, distinct-login, TLS, and CA-certificate checks.
- Worker config cannot mark a provider capability as database-bound.
- A spoofed `CF-Connecting-IP` is ignored in Node mode and accepted only when the explicit Cloudflare trust flag is true.

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run:

```powershell
node --import tsx --test tests/cloudflare-config.test.ts
```

Expected: FAIL because `LoadConfigOptions`, `dataHashPepper`, and `sessionPepper` do not exist and `SESSION_PEPPER` is still unconditionally required.

- [ ] **Step 3: Add purpose-specific configuration helpers**

Change `server/config.ts` so the base schema accepts optional peppers, while post-parse validation enforces only what the bound runtime needs:

```ts
export interface LoadConfigOptions {
  boundDatabaseCapabilities?: readonly DatabaseCapability[];
  surface?: "node" | "application" | "ingress" | "worker";
}

export function sessionPepper(config: AppConfig): string {
  if (!config.SESSION_PEPPER) {
    throw new Error("SESSION_PEPPER is required for session-capable runtimes.");
  }
  return config.SESSION_PEPPER;
}

export function dataHashPepper(config: AppConfig): string {
  const pepper = config.DATA_HASH_PEPPER ?? config.SESSION_PEPPER;
  if (!pepper) {
    throw new Error("DATA_HASH_PEPPER is required for data-hashing runtimes.");
  }
  return pepper;
}
```

Preserve the existing `loadConfig(environment, requiredCapabilities)` call shape and add options as the third argument. Default `surface` to `node`. Bound database capabilities satisfy the database-URL and CA-certificate requirements only for that Worker invocation; unbound Node capabilities retain all current validation. Application requires `SESSION_PEPPER` and `DATA_HASH_PEPPER`. Ingress requires `DATA_HASH_PEPPER` but never session material. Worker requires neither pepper. The legacy data-hash fallback to `SESSION_PEPPER` is Node-only; every Cloudflare surface requires the explicit secret. Production example-value checks cover both peppers. HTTPS `APP_ORIGIN` validation applies to HTTP surfaces, not the jobs Worker.

- [ ] **Step 4: Replace durable hashes with the data-hash pepper**

In `server/repository/postgres.ts`:

- Expand the config pick to `FIELD_ENCRYPTION_KEY | SESSION_PEPPER | DATA_HASH_PEPPER`.
- Keep both peppers optional in the repository's structural config type and resolve the data pepper only inside methods that create durable hashes.
- Use it for destination hashes, customer references derived from hashes, phone/email hashes, inbound suppression hashes, and other durable non-session identifiers.
- Keep `SESSION_PEPPER` exclusively for login/session/CSRF/OAuth-state material.
- Prove a worker-only repository can be constructed with `FIELD_ENCRYPTION_KEY` alone; it must not resolve a pepper unless a hash-producing method is actually called.

In `server/routes/public-review.ts`:

- Use `dataHashPepper(options.config)` for the rotating visitor hash.
- Resolve the client address through `server/request-address.ts` in this order: validated Cloudflare `CF-Connecting-IP` header when explicitly trusted, then `request.ip` for local/Node execution.
- Accept one syntactically valid IPv4 or IPv6 value only. Reject lists and malformed values, and never trust the header on arbitrary Node ingress.

In `server/app.ts`, `server/routes/auth.ts`, and `server/routes/google.ts`, resolve every login/session/OAuth-state HMAC with `sessionPepper(options.config)`. Use the same trusted-address helper for login IP hashing. Keep session hashing unavailable on the ingress surface and preserve current Node behavior through the explicit helper.

- [ ] **Step 5: Document the new secret without supplying a value**

Add these entries to `.env.example` with explanatory comments:

```dotenv
# Independent HMAC pepper for durable destination and anonymous visitor hashes.
DATA_HASH_PEPPER=

# Background delivery remains off in Cloudflare staging until separately approved.
PROVIDER_DELIVERY_ENABLED=false
```

- [ ] **Step 6: Run focused and regression validation**

Run:

```powershell
node --import tsx --test tests/cloudflare-config.test.ts tests/backend-security.test.ts
npm.cmd run typecheck
npm.cmd run security:secrets
git diff --check
```

Expected: focused tests pass; existing security tests and typecheck remain green; secret scan and whitespace check report no findings.

- [ ] **Step 7: Commit the secret-boundary change**

```powershell
git add -- .env.example server/config.ts server/app.ts server/request-address.ts server/repository/postgres.ts server/routes/auth.ts server/routes/google.ts server/routes/public-review.ts tests/cloudflare-config.test.ts
git commit -m "refactor: separate session and data hash secrets"
```

---

### Task 5: Introduce event-scoped database capabilities

**Files:**

- Create: `tests/database-capability.test.ts`
- Create: `cloudflare/shared/database.ts`
- Modify: `server/db.ts`
- Modify: `server/repository/postgres.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`
- Modify: `server/ingress.ts`
- Modify: `server/worker.ts`

- [ ] **Step 1: Write failing structural capability tests**

Test a fake query client without constructing a `pg.Pool`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  createHyperdriveCapability,
  type PgClientLike,
} from "../cloudflare/shared/database.js";

test("Hyperdrive capability connects lazily and closes once", async () => {
  const calls = { connect: 0, end: 0, query: 0 };
  const capability = createHyperdriveCapability(
    "postgres://role:synthetic@host.invalid:5432/postgres",
    () => ({
      connect: async () => { calls.connect += 1; },
      end: async () => { calls.end += 1; },
      query: async () => {
        calls.query += 1;
        return { rows: [{ ok: 1 }], rowCount: 1 };
      },
    } as unknown as PgClientLike),
  );

  assert.equal(calls.connect, 0);
  await capability.query("select 1");
  assert.equal(calls.connect, 1);
  assert.equal(calls.query, 1);
  await capability.close();
  await capability.close();
  assert.equal(calls.end, 1);
});
```

Also cover:

- `connect()` returning a lease whose `release()` does not close the event client.
- `close()` after a failed query.
- repository construction from structural capabilities.
- existing Pool-backed Node processes still closing pools on shutdown.

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
node --import tsx --test tests/database-capability.test.ts
```

Expected: FAIL because the structural capability and Hyperdrive adapter do not exist.

- [ ] **Step 3: Define the minimal database interfaces**

In `server/db.ts` add:

```ts
import type { QueryResult, QueryResultRow } from "pg";

export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface LeasedSqlExecutor extends SqlExecutor {
  release(): void;
}

export interface DatabaseCapability extends SqlExecutor {
  connect(): Promise<LeasedSqlExecutor>;
}

export interface ClosableDatabaseCapability extends DatabaseCapability {
  close(): Promise<void>;
}
```

Add `createPoolCapability(pool)` to wrap the current `pg.Pool` and expose `close()` as `pool.end()`. Change `inTransaction` and `setActorContext` to accept structural interfaces instead of concrete `PoolClient` types.

- [ ] **Step 4: Change repository constructor types without changing SQL**

In `server/repository/postgres.ts`:

- Replace each `Pool` field with `DatabaseCapability`.
- Keep capability names `auth`, `runtime`, `ingress`, and `worker`.
- Do not merge roles or add a generic fallback from one capability to another.
- Preserve every query, transaction boundary, actor-context call, and return shape.

Update `server/app.ts` and Node entrypoints to wrap existing pools with `createPoolCapability`. Keep Node signal handling and pool closure behavior unchanged.

- [ ] **Step 5: Implement one-client-per-event Hyperdrive access**

In `cloudflare/shared/database.ts` expose:

```ts
export interface PgClientLike extends SqlExecutor {
  connect(): Promise<void>;
  end(): Promise<void>;
}

export function createHyperdriveCapability(
  connectionString: string,
  clientFactory?: (connectionString: string) => PgClientLike,
): ClosableDatabaseCapability;
```

Required behavior:

- Construct the client lazily on the first `query` or `connect`.
- Use one `pg.Client` per Worker fetch, queue batch, or scheduled event.
- Never create a global `pg.Pool` in a Worker module.
- Use the Hyperdrive-provided connection string as-is.
- Make `close()` idempotent and call it from each event handler's `finally` block.
- Surface connection/query failures; do not silently retry writes in this adapter.

- [ ] **Step 6: Run database and full regression tests**

```powershell
node --import tsx --test tests/database-capability.test.ts tests/database-context.test.ts tests/database-contract.test.ts tests/backend-security.test.ts
npm.cmd run typecheck
npm.cmd run security:secrets
git diff --check
```

Expected: all selected tests pass and no SQL contract snapshot changes unless they are type-only.

- [ ] **Step 7: Commit the database seam**

```powershell
git add -- cloudflare/shared/database.ts server/db.ts server/repository/postgres.ts server/app.ts server/index.ts server/ingress.ts server/worker.ts tests/database-capability.test.ts
git commit -m "refactor: add event scoped database capabilities"
```

---

### Task 6: Implement and deploy the application Worker

**Files:**

- Modify: `cloudflare/application/src/index.ts`
- Modify: `cloudflare/shared/types.ts`
- Modify: `cloudflare/application/wrangler.jsonc`
- Modify: `tests/cloudflare/http.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing application-entrypoint tests**

Add tests using fake `AUTH_DB`, `RUNTIME_DB`, `ASSETS`, and Queue bindings. Assert:

- `/api/v1/health` reaches Fastify and returns the application service name.
- `/app` and `/workspace` use `ASSETS.fetch` without touching either database.
- `/r/token?preview=1` returns 308 to the ingress origin with the query intact.
- An authenticated API request receives only auth and runtime capabilities.
- Both database capabilities close once after a success, a Fastify 4xx, and a thrown query.
- A second concurrent request cannot see the first request's repository or actor state.
- No filesystem static-serving plugin is registered in Worker mode.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/http.test.ts tests/cloudflare/routing.test.ts
```

Expected: FAIL because the application Worker entrypoint does not exist.

- [ ] **Step 3: Make Worker mode explicit in the Fastify builder**

Extend `BuildAppOptions` in `server/app.ts` with:

```ts
runtime?: "node" | "cloudflare";
trustCloudflareConnectingIp?: boolean;
```

Rules:

- Default `runtime` to `"node"` so current Node entrypoints do not change.
- Register `@fastify/static` only when `frontendRoot` is provided and runtime is Node.
- Use `sessionPepper(options.config)` in the authentication pre-handler rather than direct optional-property access.
- Preserve cookie, Helmet, rate-limit, raw-body, request-ID, validation, and error behavior.
- Do not add a broad CORS plugin or weaken secure-cookie settings.

- [ ] **Step 4: Build one Fastify application per isolate with request-scoped repositories**

`cloudflare/application/src/index.ts` must:

1. Classify the URL before invoking Fastify.
2. Delegate asset routes directly to `env.ASSETS.fetch(request)`.
3. Return a 308 redirect for public review routes.
4. Lazily build one `surface: "application"` Fastify instance per isolate.
5. Build configuration with `loadConfig(workerEnvironment, ["auth", "runtime"], { boundDatabaseCapabilities: ["auth", "runtime"], surface: "application" })` and map `PUBLIC_REVIEW_BASE_URL` from `PUBLIC_REVIEW_ORIGIN`.
6. Pass a `PlatformRepository` async-scope proxy to `buildApp`.
7. For each API request, create one event-scoped auth capability and one runtime capability, construct `PostgresRepository`, and run the bridged request inside the repository scope.
8. Close both clients in `finally` after the bridged response resolves.

Use this handler shape:

```ts
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const decision = applicationRoute(request, env.PUBLIC_REVIEW_ORIGIN);
    if (decision.owner === "assets") return env.ASSETS.fetch(request);
    if (decision.owner === "redirect") {
      return Response.redirect(decision.location, 308);
    }

    const auth = createHyperdriveCapability(env.AUTH_DB.connectionString);
    const runtime = createHyperdriveCapability(env.RUNTIME_DB.connectionString);
    const repository = new PostgresRepository({
      authPool: auth,
      runtimePool: runtime,
      config: applicationConfig(env),
    });
    try {
      return await repositoryScope.run(repository, () =>
        applicationFetch(request, env, ctx),
      );
    } finally {
      await Promise.all([auth.close(), runtime.close()]);
    }
  },
} satisfies ExportedHandler<ApplicationEnv>;
```

Adapt constructor property names only if Task 5 deliberately renamed them; do not reintroduce concrete Pool types.

Build Fastify with `runtime: "cloudflare"` and `trustCloudflareConnectingIp: true` so the explicit request-address helper, not generic proxy-hop trust, supplies the session IP hash.

- [ ] **Step 5: Keep provider and delivery surfaces disabled**

The application Worker:

- Does not construct Google, Twilio, SendGrid, or Stripe clients.
- Sets `STRIPE_CHECKOUT_ENABLED=false` and `STRIPE_MODE=test` as non-secret vars.
- Exposes service-readiness states through the existing API.
- Does not enqueue `delivery-kick` while `PROVIDER_DELIVERY_ENABLED` is false.
- Returns the existing stable unavailable response from provider-dependent routes.

- [ ] **Step 6: Supply only application secrets**

Use the ignored `.cloudflare/staging-application-secrets.json` generated by Task 3. Run `scripts/cloudflare/provision.ts verify-secrets` to assert, without printing values, that it contains exactly `SESSION_PEPPER`, `DATA_HASH_PEPPER`, and `FIELD_ENCRYPTION_KEY`; that each value has the required entropy/encoding; and that the cross-runtime equality and exclusion rules still hold.

Set them:

```powershell
npm.cmd exec tsx -- scripts/cloudflare/provision.ts verify-secrets
npm.cmd exec wrangler -- secret bulk .cloudflare/staging-application-secrets.json --config cloudflare/application/wrangler.jsonc
```

- [ ] **Step 7: Run application validation and dry-run**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/http.test.ts tests/cloudflare/routing.test.ts
node --import tsx --test tests/backend-security.test.ts tests/database-context.test.ts
npm.cmd run typecheck
npm.cmd run typecheck:cloudflare
npm.cmd run build
npm.cmd exec wrangler -- deploy --dry-run --strict --config cloudflare/application/wrangler.jsonc
npm.cmd run security:secrets
git diff --check
```

Inspect the bundle for only `AUTH_DB`, `RUNTIME_DB`, `ASSETS`, and non-secret vars. It must not reference ingress, worker, migration, provider, or compatibility bindings.

- [ ] **Step 8: Commit the application Worker before remote deployment**

```powershell
git add -- cloudflare/application/src/index.ts cloudflare/application/wrangler.jsonc cloudflare/shared/types.ts server/app.ts tests/cloudflare/http.test.ts
git commit -m "feat: add Cloudflare application Worker"
```

- [ ] **Step 9: Deploy and smoke-check the application surface**

```powershell
npm.cmd exec wrangler -- deploy --strict --config cloudflare/application/wrangler.jsonc
npm.cmd exec wrangler -- deployments status --json --config cloudflare/application/wrangler.jsonc
```

Call the deployed URL:

- First and immediate second `GET /api/v1/health` return 200.
- `GET /app` returns the SPA with CSP, permissions, cache, and no-index headers.
- `GET /workspace` returns the SPA.
- `GET /r/synthetic?preview=1` redirects to the exact ingress origin even if the ingress Worker is not deployed yet.
- `GET /api/v1/workspace` without a cookie returns the expected auth failure and no CORS wildcard.

If any check fails, use the recorded deployment ID to roll back or delete only `review-anchor-staging`. Do not touch the Pages demo or Render.

---

### Task 7: Implement and deploy the public-review and webhook ingress Worker

**Files:**

- Modify: `cloudflare/ingress/src/index.ts`
- Modify: `cloudflare/shared/types.ts`
- Modify: `cloudflare/ingress/wrangler.jsonc`
- Modify: `tests/cloudflare/http.test.ts`
- Modify: `server/app.ts`
- Modify: `server/routes/public-review.ts`

- [ ] **Step 1: Write failing ingress-entrypoint tests**

Using fake `INGRESS_DB` and `ASSETS` bindings, assert:

- `/r/token?preview=1` is served by Static Assets and never sent to Fastify.
- `/api/v1/public/review-flows/token` reaches Fastify with only ingress capability.
- `/webhooks/stripe` reaches Fastify and preserves exact raw bytes.
- `/app`, `/workspace`, `/api/v1/workspace`, and `/api/v1/auth/login` return 404 before repository access.
- No request can resolve auth, runtime, worker, or session bindings.
- `CF-Connecting-IP` is used only when the Worker marks the request trusted.
- The ingress database client closes after success, 4xx, and failure.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/http.test.ts tests/cloudflare/routing.test.ts
node --import tsx --test tests/backend-security.test.ts
```

Expected: FAIL because the ingress Worker entrypoint is missing.

- [ ] **Step 3: Implement the ingress entrypoint**

`cloudflare/ingress/src/index.ts` mirrors the application lifecycle with these differences:

- Route with `ingressRoute` before invoking assets or Fastify.
- Build `surface: "ingress"` with `runtime: "cloudflare"` and `trustCloudflareConnectingIp: true`.
- Load config with `loadConfig(workerEnvironment, ["ingress"], { boundDatabaseCapabilities: ["ingress"], surface: "ingress" })`.
- Build exactly one event-scoped `INGRESS_DB` client per Fastify request.
- Supply `DATA_HASH_PEPPER` and `FIELD_ENCRYPTION_KEY`, but no `SESSION_PEPPER`.
- Set `EXTERNAL_WEBHOOK_BASE_URL` and `PUBLIC_REVIEW_BASE_URL` to the exact ingress Workers.dev origin.
- Construct webhook security with no provider credentials.
- Do not construct Stripe verification, billing, Google, delivery, or auth clients.
- Close the ingress database capability in `finally`.

- [ ] **Step 4: Preserve fail-closed webhook semantics**

Add or retain tests for every callback:

| Route | No-provider-secret result |
| --- | --- |
| `POST /webhooks/stripe` | 503 `STRIPE_WEBHOOK_NOT_CONFIGURED` |
| `POST /webhooks/twilio/status` | 503 `TWILIO_WEBHOOK_NOT_CONFIGURED` |
| `POST /webhooks/twilio/inbound/:integrationId` | 503 `TWILIO_WEBHOOK_NOT_CONFIGURED` |
| `POST /webhooks/sendgrid/events` | 503 `SENDGRID_WEBHOOK_NOT_CONFIGURED` |
| `POST /webhooks/google-business-profile/reviews` | 503 `GOOGLE_PUBSUB_NOT_CONFIGURED` |

For each, assert the persistence method is not called. Do not change a stable 503 to a permissive 2xx for provider convenience.

- [ ] **Step 5: Supply only ingress secrets**

Use the ignored ingress secret file generated by Task 3. `verify-secrets` must prove it contains exactly `DATA_HASH_PEPPER` and `FIELD_ENCRYPTION_KEY`, matches the corresponding application values, and contains neither `SESSION_PEPPER` nor a provider secret.

```powershell
npm.cmd exec tsx -- scripts/cloudflare/provision.ts verify-secrets
npm.cmd exec wrangler -- secret bulk .cloudflare/staging-ingress-secrets.json --config cloudflare/ingress/wrangler.jsonc
```

- [ ] **Step 6: Run ingress validation and dry-run**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/http.test.ts tests/cloudflare/routing.test.ts
node --import tsx --test tests/backend-security.test.ts
npm.cmd run typecheck
npm.cmd run typecheck:cloudflare
npm.cmd run build
npm.cmd exec wrangler -- deploy --dry-run --strict --config cloudflare/ingress/wrangler.jsonc
npm.cmd run security:secrets
git diff --check
```

Inspect the bundle for only `INGRESS_DB`, `ASSETS`, allowed origins, and the two ingress secrets.

- [ ] **Step 7: Commit and deploy ingress**

```powershell
git add -- cloudflare/ingress/src/index.ts cloudflare/ingress/wrangler.jsonc cloudflare/shared/types.ts server/app.ts server/routes/public-review.ts tests/cloudflare/http.test.ts
git commit -m "feat: add Cloudflare ingress Worker"
npm.cmd exec wrangler -- deploy --strict --config cloudflare/ingress/wrangler.jsonc
npm.cmd exec wrangler -- deployments status --json --config cloudflare/ingress/wrangler.jsonc
```

- [ ] **Step 8: Smoke-check ingress remotely**

Required checks:

- Cold and warm `GET /api/v1/health` return 200 and identify ingress.
- `GET /r/nonexistent?preview=1` renders the SPA shell with static security headers.
- Authenticated application paths return plain 404.
- A non-existent public token returns the existing not-found response without exposing SQL details.
- Every unconfigured webhook route returns its expected stable 503.
- Logs contain no body, authorization, cookie, database, encryption, pepper, or provider-secret material.

On failure, roll back or delete only `review-anchor-staging-ingress`.

---

### Task 8: Replace the infinite worker loop with bounded Queue and Cron handlers

**Files:**

- Create: `tests/cloudflare/jobs.test.ts`
- Modify: `cloudflare/jobs/src/index.ts`
- Modify: `server/config.ts`
- Modify: `server/worker.ts`
- Modify: `cloudflare/shared/types.ts`
- Modify: `cloudflare/jobs/wrangler.jsonc`
- Modify: `cloudflare/application/wrangler.jsonc`
- Modify: `scripts/cloudflare/provision.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing disabled-delivery and bounded-cycle tests**

Test:

1. `runDeliveryCycle({ enabled: false })` returns all-zero counts.
2. With delivery disabled, `claimMessageJobs`, decrypt, authorize, reserve, finish, and every provider send are never called.
3. A diagnostic Queue message performs exactly `select 1` through the worker capability and acknowledges only itself.
4. A disabled `delivery-kick` acknowledges without claiming or mutating a message job.
5. One failed diagnostic calls `retry({ delaySeconds: 60 })` and does not acknowledge.
6. Successful messages in a mixed batch remain acknowledged when another item retries.
7. One scheduled invocation calls each allowed maintenance operation no more than once and returns without sleeping.
8. Google synchronization and token revocation do no work when Google is unconfigured.
9. No Queue or scheduled handler creates a timer loop or retains a database client after return.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/jobs.test.ts
node --import tsx --test tests/workflow-readiness.test.ts
```

Expected: FAIL because delivery cannot be disabled before claim and bounded Worker handlers are absent.

- [ ] **Step 3: Make the delivery guard precede all claims**

Extend `DeliveryCycleOptions`:

```ts
export interface DeliveryCycleOptions {
  enabled: boolean;
  repository: PlatformRepository;
  providers: DeliveryProviderMap;
  encryptionKey: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}
```

The first executable branch in `runDeliveryCycle` after constructing its zero result is:

```ts
if (!options.enabled) return result;
```

No repository or provider call may precede it. Parse `PROVIDER_DELIVERY_ENABLED` as an optional `"true" | "false"` value. The existing Node loop passes `config.PROVIDER_DELIVERY_ENABLED ?? true` so an omitted variable preserves the current release behavior; Cloudflare staging declares and passes the literal false. Do not alter lease tokens, idempotency checks, SMS allowance behavior, or completion semantics for the enabled path.

- [ ] **Step 4: Extract one bounded maintenance pass**

Export `runMaintenanceCycle` from `server/worker.ts`. It may:

- Purge at most 100 expired Stripe webhook payloads.
- Roll at most 100 pilot billing periods.
- Synchronize at most 20 Google connections only when a configured Google client is supplied.
- Process at most 20 Google token revocations only when a configured Google client is supplied.

It must not poll, sleep, recurse, or call an external provider when no configured client is supplied. Keep the existing Node `main` loop, signals, and timing around these extracted functions for backward compatibility.

- [ ] **Step 5: Implement Queue and scheduled handlers**

`cloudflare/jobs/src/index.ts`:

- Loads config with `loadConfig(workerEnvironment, ["worker"], { boundDatabaseCapabilities: ["worker"], surface: "worker" })`.
- Creates one `WORKER_DB` event-scoped capability per queue batch or scheduled event.
- Uses `PostgresRepository` with only the worker capability.
- Validates each message as the `StagingJobMessage` discriminated union.
- For `diagnostic`, executes `select 1 as ok` and logs only message ID, kind, outcome, and request correlation.
- For `delivery-kick` while disabled, acknowledges without calling `runDeliveryCycle` or any claim method.
- Calls `message.ack()` only after success.
- Calls `message.retry({ delaySeconds: 60 })` only for that failed item.
- Runs one `runMaintenanceCycle` in `scheduled` with no provider clients.
- Closes the database capability in `finally`.
- Has no `fetch` export and no public diagnostic route.

- [ ] **Step 6: Provision the Queue and dead-letter queue idempotently**

Extend `scripts/cloudflare/provision.ts queues` to list before creating:

- `review-anchor-staging-jobs` with 86,400-second retention.
- `review-anchor-staging-jobs-dlq` with 86,400-second retention.

Stop on a same-name incompatible resource. Patch:

- Application producer binding `JOBS_QUEUE` to `review-anchor-staging-jobs`.
- Jobs consumer with batch size 10, batch timeout 5 seconds, max retries 3, retry delay 60 seconds, max concurrency 1, and dead-letter queue `review-anchor-staging-jobs-dlq`.
- Jobs Cron Trigger `*/5 * * * *`.
- Jobs `workers_dev` remains false.

After the producer binding is present, change `ApplicationEnv.JOBS_QUEUE` from optional to required and regenerate application binding types.

Run:

```powershell
npm.cmd exec tsx -- scripts/cloudflare/provision.ts queues
```

- [ ] **Step 7: Supply only the jobs encryption secret**

Use the ignored jobs secret file generated by Task 3. `verify-secrets` must prove it contains exactly `FIELD_ENCRYPTION_KEY`, matches the application/ingress value, and contains neither pepper nor any provider secret.

```powershell
npm.cmd exec tsx -- scripts/cloudflare/provision.ts verify-secrets
npm.cmd exec wrangler -- secret bulk .cloudflare/staging-jobs-secrets.json --config cloudflare/jobs/wrangler.jsonc
```

- [ ] **Step 8: Validate Queue/Cron code and all bundles**

```powershell
npm.cmd run test:cloudflare -- tests/cloudflare/jobs.test.ts
node --import tsx --test tests/workflow-readiness.test.ts tests/backend-security.test.ts
npm.cmd run typecheck
npm.cmd run typecheck:cloudflare
npm.cmd run build
npm.cmd run cf:dry-run
npm.cmd run security:secrets
git diff --check
```

Inspect bindings:

- Application: auth, runtime, assets, producer Queue; no consumer or worker DB.
- Ingress: ingress DB and assets only.
- Jobs: worker DB, one Queue consumer, one DLQ reference, one Cron; no Workers.dev route.

- [ ] **Step 9: Commit the bounded jobs runtime**

```powershell
git add -- package.json server/config.ts server/worker.ts cloudflare/shared/types.ts cloudflare/jobs/src/index.ts cloudflare/jobs/wrangler.jsonc cloudflare/application/wrangler.jsonc scripts/cloudflare/provision.ts tests/cloudflare/jobs.test.ts
git commit -m "feat: add bounded Cloudflare jobs Worker"
```

- [ ] **Step 10: Redeploy application and deploy jobs**

The application must be redeployed because it now has the Queue producer binding:

```powershell
npm.cmd exec wrangler -- deploy --strict --config cloudflare/application/wrangler.jsonc
npm.cmd exec wrangler -- deploy --strict --config cloudflare/jobs/wrangler.jsonc
npm.cmd exec wrangler -- deployments status --json --config cloudflare/application/wrangler.jsonc
npm.cmd exec wrangler -- deployments status --json --config cloudflare/jobs/wrangler.jsonc
```

Confirm the jobs Worker has no public Workers.dev hostname and `PROVIDER_DELIVERY_ENABLED` remains exactly `false`.

---

### Task 9: Automate deployment, seed synthetic acceptance data, and close staging acceptance

**Files:**

- Create: `scripts/cloudflare/deploy-staging.ts`
- Create: `scripts/cloudflare/accept-staging.ts`
- Create: `docs/runbooks/cloudflare-staging.md`
- Modify: `scripts/bootstrap.ts`
- Modify: `scripts/verify-journeys.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Extend bootstrap with a synthetic, provider-free QR fixture**

Add an opt-in `--cloudflare-staging-fixture` mode to `scripts/bootstrap.ts`. It must:

- Refuse to run unless `SUPABASE_PROJECT_REF` equals `cwwgvkepocldophqzijf`.
- Reuse the existing synthetic business, location, and user idempotently.
- Create a synthetic review destination that does not require Google OAuth or a provider API.
- Create or reuse one active QR code with a stable fixture label.
- Print only synthetic IDs and the public token; never print passwords, database URLs, exact customer data, or encryption values.
- Leave provider credentials and live businesses untouched.

Add database-contract coverage for idempotent reruns.

- [ ] **Step 2: Extend the journey verifier across both origins**

`scripts/verify-journeys.ts` must require:

- `APP_BASE_URL` — application Workers.dev origin.
- `INGRESS_BASE_URL` — ingress Workers.dev origin.
- Existing synthetic staging login credentials supplied through process environment.
- Synthetic public token supplied through process environment.

Preserve existing health, login, secure-cookie, CSRF, workspace, cross-tenant denial, completed-job idempotency, billing-disabled, and logout assertions. Add:

1. Application `/r/:token?preview=1` redirects to ingress.
2. Ingress `/r/:token?preview=1` returns the SPA and security headers.
3. Ingress public-flow lookup succeeds.
4. Preview mode does not create a scan event.
5. Ingress auth/workspace routes return 404.
6. All five unconfigured webhook routes fail closed.
7. Application and ingress responses omit wildcard CORS.

- [ ] **Step 3: Write an ordered deployment orchestrator**

`scripts/cloudflare/deploy-staging.ts` must:

- Require a clean index except the files deliberately staged by the executor.
- Run secret scan, typechecks, full tests, production build, `git diff --check`, and strict dry-runs first.
- Read only ignored runtime-specific secret files.
- Verify all three configurations reference only staging resources and project `cwwgvkepocldophqzijf`.
- Verify the authenticated Cloudflare account matches the preflight evidence.
- Set each runtime's secrets from its own file.
- Deploy application, ingress, then jobs.
- Stop on the first failed deploy.
- Record redacted deployment IDs and URLs under `.cloudflare/evidence/`.
- Never delete or roll back automatically; print the exact verified staging target and documented recovery command for a human-reviewed failure.

Add scripts:

```json
{
  "cf:provision": "tsx scripts/cloudflare/provision.ts all",
  "cf:compat": "tsx scripts/cloudflare/verify-compat.ts",
  "cf:deploy:staging": "tsx scripts/cloudflare/deploy-staging.ts",
  "cf:accept:staging": "tsx scripts/cloudflare/accept-staging.ts"
}
```

- [ ] **Step 4: Implement machine-checkable post-deploy acceptance**

`scripts/cloudflare/accept-staging.ts` must:

- Reject non-HTTPS or non-Workers.dev origins.
- Reject Worker names that do not exactly match the three staging names.
- Run cold-first and warm-second health probes.
- Verify Static Asset CSP, Permissions-Policy, Cache-Control, and X-Robots-Tag behavior.
- Run `scripts/verify-journeys.ts` as a child process and propagate failure.
- Query staging audit tables through the local migration connection only to prove preview mode and unsigned webhooks did not persist events.
- Query `current_user` through Worker-facing paths where available and compare exact role names.
- Write redacted JSON evidence and exit non-zero on any failed assertion.

Do not add a public diagnostic endpoint to make acceptance easier.

- [ ] **Step 5: Write the operator runbook before the final deployment**

`docs/runbooks/cloudflare-staging.md` must include:

- Scope and explicit non-goals.
- Exact resource inventory and database capability matrix.
- Authentication and account-verification commands.
- Free-plan and Supabase capacity gates.
- Local validation, provisioning, compatibility, deploy, and acceptance commands.
- Runtime-specific secret matrix.
- How to rotate each staging secret.
- How to tail each Worker without logging secrets.
- How to inspect Worker CPU, requests, errors, Hyperdrive queries/connections, Queue operations/retries/DLQ, Cron outcomes, and billing.
- Failure decisions and exact rollback/delete order for only the new staging resources.
- A warning that Render and `review-anchor-demo.pages.dev` remain unchanged.
- A warning that this staging result is not production parity for global rate limiting, Queue retention, timing, or traffic capacity.

Rollback must resolve and record exact IDs before any deletion. Order:

1. Disable the staging Cron/consumer by deploying a reviewed binding-free jobs config.
2. Roll back a bad Worker deployment to its previous recorded deployment; delete a Worker only when it has no safe previous staging deployment.
3. Delete the two exact staging Queues only if the staging rollout is being abandoned.
4. Delete the four exact staging Hyperdrive configurations only if the staging rollout is being abandoned.
5. Leave Supabase staging, Render, Pages demo, and every non-staging Cloudflare resource unchanged.

- [ ] **Step 6: Run the complete local release gate**

```powershell
npm.cmd run security:secrets
npm.cmd run typecheck
npm.cmd run typecheck:cloudflare
npm.cmd test
npm.cmd run test:cloudflare
npm.cmd run build
npm.cmd run cf:dry-run
git diff --check
git status --short
```

Expected: secret scan, both typechecks, the complete test suite, build, all Worker dry-runs, and diff check pass. Review `git status` and keep `.gstack/`, `.cloudflare/`, `.env.staging`, and all evidence out of the index.

- [ ] **Step 7: Commit deployment tooling and runbook**

```powershell
git add -- package.json README.md scripts/bootstrap.ts scripts/verify-journeys.ts scripts/cloudflare/deploy-staging.ts scripts/cloudflare/accept-staging.ts docs/runbooks/cloudflare-staging.md
git commit -m "docs: add Cloudflare staging operations"
```

- [ ] **Step 8: Run the controlled deployment**

```powershell
npm.cmd run cf:deploy:staging
```

Record three successful deployment statuses. Confirm no command changed Render, Pages demo, production DNS, or a non-staging Cloudflare resource.

- [ ] **Step 9: Seed and execute API acceptance**

Run the opt-in bootstrap locally against Supabase staging, export only the synthetic acceptance inputs to the current process, then:

```powershell
npm.cmd exec tsx -- scripts/bootstrap.ts --cloudflare-staging-fixture
npm.cmd run cf:accept:staging
```

Expected: authenticated application journey, cross-tenant denials, public preview journey, fail-closed callbacks, security headers, and role boundaries all pass.

- [ ] **Step 10: Complete browser acceptance**

Use project Playwright against the application and ingress Workers.dev origins:

- Log in with the synthetic staging user.
- Navigate every Growth Suite route: Command Center, Get Reviews, QR Codes, Connect Google, Reviews, Performance, Billing, Support, Privacy, and Settings.
- Refresh deep links under `/app/*` and `/workspace`.
- Verify secure session cookie behavior and logout.
- Open the application QR preview and confirm the browser lands on ingress `/r/:token?preview=1`.
- Complete the provider-free public review UI path.
- Confirm preview mode did not increment scan analytics.
- Confirm desktop and mobile layouts remain usable.
- Confirm no console error, failed first-party request, mixed content, permissive CORS, or provider request.

Save screenshots and a concise result manifest under ignored `.cloudflare/evidence/`.

- [ ] **Step 11: Prove Queue and Cron without external delivery**

1. Tail `review-anchor-staging-jobs` in JSON mode.
2. From the Cloudflare Queue dashboard, send one `diagnostic` message with a fresh synthetic ID to `review-anchor-staging-jobs`.
3. Observe one worker-role `select 1` success and one acknowledgement.
4. Confirm there is no outbound message claim, provider request, retry, or DLQ item.
5. Allow up to 15 minutes for a newly changed trigger to propagate, then observe the next five-minute Cron invocation in live logs; use a 22-minute maximum wait from deployment.
6. Confirm one bounded maintenance result, no sleep/loop, no external provider call, and no held database connection.

Do not fail solely because the dashboard's historical Cron Events view has not populated yet; retain the live-log correlation and recheck history later because new-Worker event history can lag.

If the diagnostic fails, inspect retry behavior through the configured three-retry boundary. Do not intentionally send a poison message to consume free operations unless needed to diagnose a real failure.

- [ ] **Step 12: Close the cost, security, and operational evidence gates**

In Cloudflare and Supabase dashboards verify:

- Workers remain on Free and show no new recurring monthly charge.
- Dynamic requests, CPU, errors, Hyperdrive queries, and Queue operations remain far below account limits.
- Valid and invalid scrypt, cold/warm health, login, and normal authenticated routes show no CPU-limit events.
- Four Hyperdrive configurations remain cache-disabled and within the connection budget.
- Queue consumer, retries, DLQ, and Cron are configured exactly as tracked.
- No provider credential exists on any staging Worker.
- Application has auth/runtime/Queue only; ingress has ingress only; jobs has worker only.
- Logs and evidence contain no secret or decrypted customer data.
- Render and the Pages demo are still healthy and unchanged.

- [ ] **Step 13: Publish the final implementation evidence commit**

Do not commit screenshots, dashboard exports, secrets, raw logs, customer data, or mutable runtime IDs outside the tracked Wrangler bindings. Update the runbook with only redacted pass/fail dates and deployment identifiers that are safe to track, then:

```powershell
npm.cmd run security:secrets
git diff --check
git add -- docs/runbooks/cloudflare-staging.md
git commit -m "docs: record Cloudflare staging acceptance"
git status --short --branch
```

Expected final worktree: only intentionally ignored local evidence or the pre-existing untracked `.gstack/` remains. The branch is ready for review but is not merged and production is not cut over.

---

## Final Completion Gate

Cloudflare staging is complete only when every checkbox above is satisfied and all of the following are true:

- The compatibility Worker was removed after passing; no disposable gate resource remains.
- `review-anchor-staging` and `review-anchor-staging-ingress` are healthy on their Workers.dev origins.
- `review-anchor-staging-jobs` has no public route and completes Queue/Cron work in bounded invocations.
- Each runtime has only its assigned Hyperdrive role and secrets.
- Authenticated, public-review, webhook-failure, tenant-isolation, Queue, Cron, browser, and security-header acceptance passed.
- Existing password hashing parameters were not weakened and measured Worker CPU fits the Free plan.
- Provider delivery and checkout remain disabled and no live provider was contacted.
- Cloudflare shows no new recurring monthly charge.
- Render, the static Pages demo, production DNS, and non-staging resources are unchanged.
- The complete local validation suite, all three product Worker dry-runs, and the binding-free compatibility Worker dry-run pass from the final commit.

If any item is unproven, report staging as incomplete with the exact failing gate. Do not call the rollout production-ready and do not begin the seven-day pilot.
