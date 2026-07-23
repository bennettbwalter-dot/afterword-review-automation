# Launch Slice 1 Security, Migration, and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining provider-independent support-session, Google-account, migration-release, database-isolation, and CI supply-chain gaps without enabling migration 012 or any external provider capability.

**Architecture:** Keep application authorization fail-closed at both Fastify and PostgreSQL boundaries. Refactor the migrator so each migration body and its ledger row commit atomically, and require a checksum-bound approval manifest for every migration after 011; migration 012 also requires verified migration-011 ledger state plus a zero-row agency-grant query. Run the real migrator and two independent PostgreSQL connections in CI, and pin external CI actions/images immutably.

**Tech Stack:** TypeScript 7, Node.js 22, Fastify 5, PostgreSQL 16.13, GitHub Actions, Node test runner, `pg`.

## Global Constraints

- Migration 012 remains reserved for explicit agency-access enforcement and paused until the target ledger and zero-row agency-grant coverage evidence pass.
- Migrations 013 through 018 remain reserved for the externally gated roadmap.
- New provider-independent database work uses migration `019_provider_independent_security.sql`; its presence must not make migration 012 deployable.
- No live database mutation is authorised. Database execution uses ephemeral CI PostgreSQL only.
- No Google OAuth start, profile selection completion, user-triggered sync, or disconnect is allowed through a support session or agency actor.
- Direct-container business owners cannot create support sessions.
- Application runtime remains Node.js `22`; GitHub Action runtime upgrades do not change it.
- No provider capability, Storage path, social adapter, MobileWAN provider, or paid-video entitlement is added or enabled.
- Every task follows red-green-refactor, commits only its intended files, and receives independent spec and quality review.

---

### Task 1: Pin CI action and PostgreSQL service dependencies

**Files:**
- Modify: `.github/workflows/application-security.yml`
- Modify: `.github/workflows/database-security.yml`
- Create: `tests/workflow-supply-chain.test.ts`

**Interfaces:**
- Consumes: existing Application Security and Database Security workflows.
- Produces: immutable action/image references and a source contract that prevents regression.

- [ ] **Step 1: Write the failing workflow supply-chain test**

Create `tests/workflow-supply-chain.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkoutSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNodeSha = "820762786026740c76f36085b0efc47a31fe5020";
const postgresImage = "postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50";

test("security workflows pin reviewed Node 24 actions and PostgreSQL", async () => {
  const application = await readFile(".github/workflows/application-security.yml", "utf8");
  const database = await readFile(".github/workflows/database-security.yml", "utf8");
  for (const source of [application, database]) {
    assert.match(source, new RegExp(`actions/checkout@${checkoutSha}\\s+# v7\\.0\\.1`));
    assert.match(source, new RegExp(`actions/setup-node@${setupNodeSha}\\s+# v7\\.0\\.0`));
    assert.doesNotMatch(source, /actions\/(?:checkout|setup-node)@v\d/u);
  }
  assert.match(database, new RegExp(postgresImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(database, /image:\s+postgres:16-alpine/u);
});

test("database workflow filters are broad without redundant entries", async () => {
  const database = await readFile(".github/workflows/database-security.yml", "utf8");
  assert.match(database, /- "server\/\*\*"/u);
  assert.match(database, /- "scripts\/\*\*"/u);
  assert.match(database, /- "tests\/\*\*"/u);
  assert.doesNotMatch(database, /server\/repository\/postgres\.ts/u);
  assert.doesNotMatch(database, /tests\/database-contract\.test\.ts/u);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --import tsx --test tests/workflow-supply-chain.test.ts
```

Expected: FAIL because both workflows still use `actions/checkout@v4`, `actions/setup-node@v4`, and the mutable `postgres:16-alpine` tag.

- [ ] **Step 3: Pin the reviewed dependencies and simplify filters**

In both workflows replace the action steps with:

```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
```

Preserve the existing `node-version` values. In Database Security set:

```yaml
        image: postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50
```

For both `pull_request.paths` and `push.paths`, retain `database/**`, `server/**`, `tests/**`, and the workflow file; replace the single-script entry with `scripts/**` and remove entries already covered by `server/**` or `tests/**`.

- [ ] **Step 4: Run focused and full source tests**

Run:

```powershell
node --import tsx --test tests/workflow-supply-chain.test.ts tests/agency-grants.test.ts
npm.cmd run test
```

Expected: both commands PASS; the full suite count increases from 252.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/application-security.yml .github/workflows/database-security.yml tests/workflow-supply-chain.test.ts
git commit -m "ci: pin security workflow dependencies"
```

---

### Task 2: Enforce direct-business Google mutations and real-agency support identity

**Files:**
- Modify: `server/routes/google.ts`
- Modify: `server/routes/support.ts`
- Modify: `tests/backend-security.test.ts`
- Modify: `tests/route-authorization-contract.test.ts`

**Interfaces:**
- Produces: `requireDirectBusinessGoogleActor(actor: ActorContext): void` local to `google.ts`.
- Produces: `requireSupportOperator(actor: ActorContext): void` that accepts only platform roles `agency_admin` or `agency_user` plus the existing agency-role checks.

- [ ] **Step 1: Add failing runtime authorization tests**

Extend `tests/backend-security.test.ts` with tests that use the existing `authenticatedApp` helper:

```ts
test("direct-container business owners cannot start agency support sessions", async (t) => {
  const { app, cookie } = await authenticatedApp({
    role: "business_owner",
    agencyRole: "owner",
    agencyId: randomUUID(),
    mfaVerified: true,
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/support-sessions",
    headers: { cookie, origin: appOrigin },
    payload: { businessId, scope: "view", reason: "Direct owner self support", durationMinutes: 15 },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "AGENCY_SUPPORT_REQUIRED");
});

test("agency and support-session actors cannot mutate Google account state", async (t) => {
  const cases = [
    { role: "agency_admin" as const, agencyRole: "admin" as const, supportSessionId: undefined },
    { role: "business_owner" as const, agencyRole: undefined, supportSessionId: randomUUID() },
  ];
  for (const actor of cases) {
    const { app, cookie } = await authenticatedApp(actor);
    t.after(() => app.close());
    for (const request of [
      { method: "POST", url: `/api/v1/businesses/${businessId}/integrations/google/reviews/sync` },
      { method: "DELETE", url: `/api/v1/businesses/${businessId}/locations/${locationId}/integrations/google` },
    ] as const) {
      const response = await app.inject({ ...request, headers: { cookie, origin: appOrigin } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "GOOGLE_DIRECT_BUSINESS_REQUIRED");
    }
  }
});
```

Add `supportSessionId?: string` to `TestActorOptions` and set `supportSessionId: actorOptions.supportSessionId` in the fake resolved actor. Add source assertions covering OAuth start and selection completion to `tests/route-authorization-contract.test.ts`.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
node --import tsx --test tests/backend-security.test.ts tests/route-authorization-contract.test.ts
```

Expected: FAIL because direct-container actors pass the support guard and Google sync/disconnect do not share a direct-business actor guard.

- [ ] **Step 3: Implement the shared Google route guard**

Add to `server/routes/google.ts`:

```ts
function requireDirectBusinessGoogleActor(actor: ActorContext): void {
  if (actor.role !== "business_owner" || actor.supportSessionId) {
    throw new ApiError(
      403,
      "GOOGLE_DIRECT_BUSINESS_REQUIRED",
      "Google account changes require a directly signed-in business owner or administrator.",
    );
  }
}
```

Call it immediately after `requireActor(request)` in OAuth start, selection POST, user-triggered sync, and disconnect. Keep selection GET read-only. Preserve `requireBusinessManagement` after the actor guard so business-role and tenant checks remain authoritative.

Update `server/routes/support.ts`:

```ts
function requireSupportOperator(actor: ActorContext) {
  if (
    !["agency_admin", "agency_user"].includes(actor.role)
    || !actor.agencyId
    || !["owner", "admin", "support"].includes(actor.agencyRole ?? "")
  ) {
    throw new ApiError(403, "AGENCY_SUPPORT_REQUIRED", "Agency support access is required.");
  }
}
```

- [ ] **Step 4: Run focused tests, security tests, and type checks**

```powershell
node --import tsx --test tests/backend-security.test.ts tests/route-authorization-contract.test.ts
npm.cmd run test:security
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/routes/google.ts server/routes/support.ts tests/backend-security.test.ts tests/route-authorization-contract.test.ts
git commit -m "fix: enforce direct Google and agency support actors"
```

---

### Task 3: Add the forward-only database support guard and correct agency coverage

**Files:**
- Create: `database/migrations/019_provider_independent_security.sql`
- Create: `database/tests/007_provider_independent_security.sql`
- Create: `scripts/agency-grant-coverage.ts`
- Modify: `docs/evidence/platform-capability-readiness.md`
- Modify: `tests/agency-grants.test.ts`
- Modify: `tests/database-contract.test.ts`

**Interfaces:**
- Produces: `agencyGrantCoverageSql: string` from `scripts/agency-grant-coverage.ts`.
- Migration 019 replaces `app_private.start_support_session(uuid, public.support_scope, text, integer, uuid)` without changing its signature or grants.

- [ ] **Step 1: Add failing source and database behavior contracts**

In `tests/agency-grants.test.ts`, require the evidence query and shared SQL to contain:

```ts
assert.match(readiness, /join public\.agencies as agency[\s\S]+agency\.customer_kind = 'agency'/i);
assert.doesNotMatch(readiness, /expected_legacy_scopes[\s\S]+direct_container/i);
```

In `tests/database-contract.test.ts`, require migration 019 to redefine `start_support_session`, join the target agency, and reject `customer_kind <> 'agency'` before insertion.

Create `database/tests/007_provider_independent_security.sql` with migration-owner fixtures for one `direct_container` and one real `agency`, active owner memberships, businesses, sessions with current MFA evidence, and assertions that:

```sql
-- direct_container_cannot_start_support_session
-- agency_customer_can_start_support_session
-- direct_container_is_excluded_from_expected_legacy_scopes
-- agency_customer_remains_in_expected_legacy_scopes
```

Use the same `do $$ begin ... exception when others ... end $$;` assertion pattern as `database/tests/006_agency_grants.sql`, without psql variables inside `DO` blocks.

- [ ] **Step 2: Run source tests and confirm RED**

```powershell
node --import tsx --test tests/agency-grants.test.ts tests/database-contract.test.ts
```

Expected: FAIL because migration 019 and the agency-only query do not exist.

- [ ] **Step 3: Centralise the exact coverage query**

Create `scripts/agency-grant-coverage.ts` exporting this query:

```ts
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
  select grant.agency_id, grant.business_id, grant.location_id
  from public.agency_client_grants as grant
  join public.business_memberships as accepting_member
    on accepting_member.business_id = grant.business_id
   and accepting_member.user_id = grant.accepted_by_user_id
   and accepting_member.status = 'active'
   and accepting_member.role::text in ('owner', 'admin')
  where grant.status = 'active'
    and (grant.expires_at is null or grant.expires_at > statement_timestamp())
)
select expected.agency_id, expected.business_id, expected.location_id
from expected_legacy_scopes as expected
left join valid_active_grants as grant
  on grant.agency_id = expected.agency_id
 and grant.business_id = expected.business_id
 and grant.location_id = expected.location_id
where grant.location_id is null
order by expected.agency_id, expected.business_id, expected.location_id
`;
```

Update the evidence document to the exact same SQL and explain that direct containers are deliberately excluded.

- [ ] **Step 4: Add migration 019 and executable SQL behavior tests**

Copy the full `start_support_session` definition from migration 009 into migration 019. After selecting `v_agency_id`, add:

```sql
  if not exists (
    select 1 from public.agencies agency
    where agency.id = v_agency_id
      and agency.customer_kind = 'agency'
  ) then
    raise exception 'agency customer support identity is required';
  end if;
```

Preserve the fixed `search_path`, revoke from all roles, and grant execute only to `afterword_runtime`. Add the fixtures and four named assertions to database test 007.

- [ ] **Step 5: Run source tests**

```powershell
node --import tsx --test tests/agency-grants.test.ts tests/database-contract.test.ts
```

Expected: PASS. PostgreSQL execution is deferred to Task 5’s ephemeral workflow.

- [ ] **Step 6: Commit**

```powershell
git add database/migrations/019_provider_independent_security.sql database/tests/007_provider_independent_security.sql scripts/agency-grant-coverage.ts docs/evidence/platform-capability-readiness.md tests/agency-grants.test.ts tests/database-contract.test.ts
git commit -m "fix: require agency customer support identity"
```

---

### Task 4: Make migration application atomic and policy-gated

**Files:**
- Create: `scripts/migration-policy.ts`
- Modify: `scripts/migrate.ts`
- Modify: `scripts/migration-checksum.ts`
- Modify: `tests/migration-checksum.test.ts`
- Create: `tests/migration-policy.test.ts`
- Modify: `.env.example`
- Modify: `docs/architecture.md`

**Interfaces:**
- Produces: `unwrapMigrationTransaction(sql: string): string`.
- Produces: `migrationTargetFingerprint(connectionString: string): string`.
- Produces: `parseMigrationApprovalManifest(raw: string | undefined): MigrationApprovalManifest | undefined`.
- Produces: `assertMigrationApproved(file, checksum, targetFingerprint, manifest): void`.
- `MigrationApprovalManifest` is:

```ts
export interface MigrationApprovalManifest {
  targetSha256: string;
  evidenceId: string;
  migrations: Record<string, string>;
}
```

- [ ] **Step 1: Add failing transaction-unwrapping tests**

Extend `tests/migration-checksum.test.ts`:

```ts
test("migration transaction wrappers are removed for atomic ledger commits", () => {
  assert.equal(unwrapMigrationTransaction("begin;\nselect 1;\ncommit;\n"), "select 1;\n");
  assert.throws(() => unwrapMigrationTransaction("select 1;"), /begin and commit/i);
  assert.throws(() => unwrapMigrationTransaction("begin;\ncommit;\nselect 1;"), /outer transaction/i);
});
```

- [ ] **Step 2: Add failing migration-policy tests**

Create `tests/migration-policy.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMigrationApproved,
  migrationTargetFingerprint,
  parseMigrationApprovalManifest,
} from "../scripts/migration-policy.js";

const target = migrationTargetFingerprint("postgresql://user:secret@db.example:5432/review_anchor");

test("migrations through 011 need no deployment override", () => {
  assert.doesNotThrow(() => assertMigrationApproved("011_agency_client_grants.sql", "a".repeat(64), target, undefined));
});

test("later migrations require an exact target and checksum manifest", () => {
  assert.throws(() => assertMigrationApproved("019_provider_independent_security.sql", "b".repeat(64), target, undefined), /not approved/i);
  const manifest = parseMigrationApprovalManifest(JSON.stringify({
    targetSha256: target,
    evidenceId: "ci-provider-independent-security",
    migrations: { "019_provider_independent_security.sql": "b".repeat(64) },
  }));
  assert.doesNotThrow(() => assertMigrationApproved("019_provider_independent_security.sql", "b".repeat(64), target, manifest));
  assert.throws(() => assertMigrationApproved("019_provider_independent_security.sql", "c".repeat(64), target, manifest), /checksum/i);
});

test("approval manifests reject secrets, malformed hashes and empty evidence", () => {
  assert.throws(() => parseMigrationApprovalManifest('{"targetSha256":"bad","evidenceId":"","migrations":{}}'), /manifest/i);
  assert.equal(target.includes("secret"), false);
});
```

- [ ] **Step 3: Run tests and confirm RED**

```powershell
node --import tsx --test tests/migration-checksum.test.ts tests/migration-policy.test.ts
```

Expected: FAIL because the new interfaces do not exist.

- [ ] **Step 4: Implement transaction unwrapping**

In `scripts/migration-checksum.ts`, export `unwrapMigrationTransaction`. Normalise line endings, require the first non-comment statement to be `begin;`, the final statement to be `commit;`, reject any text after the final commit, and return the body while preserving a trailing newline. Do not remove nested PL/pgSQL `begin/end` blocks.

- [ ] **Step 5: Implement the approval manifest**

In `scripts/migration-policy.ts`:

```ts
import { createHash } from "node:crypto";

const sha256Pattern = /^[a-f0-9]{64}$/u;

export interface MigrationApprovalManifest {
  targetSha256: string;
  evidenceId: string;
  migrations: Record<string, string>;
}

export function migrationTargetFingerprint(connectionString: string): string {
  const url = new URL(connectionString);
  return createHash("sha256").update(`${url.hostname}:${url.port || "5432"}${url.pathname}`).digest("hex");
}

export function parseMigrationApprovalManifest(raw: string | undefined): MigrationApprovalManifest | undefined {
  if (!raw) return undefined;
  const value = JSON.parse(raw) as MigrationApprovalManifest;
  if (!sha256Pattern.test(value.targetSha256) || !value.evidenceId?.trim() || !value.migrations || Array.isArray(value.migrations)) {
    throw new Error("Migration approval manifest is invalid.");
  }
  for (const [file, checksum] of Object.entries(value.migrations)) {
    if (!/^\d{3}_.+\.sql$/u.test(file) || !sha256Pattern.test(checksum)) throw new Error("Migration approval manifest is invalid.");
  }
  return value;
}

export function assertMigrationApproved(
  file: string,
  checksum: string,
  targetFingerprint: string,
  manifest: MigrationApprovalManifest | undefined,
): void {
  const version = Number.parseInt(file.slice(0, 3), 10);
  if (version <= 11) return;
  if (!manifest || manifest.targetSha256 !== targetFingerprint) throw new Error(`Migration ${file} is not approved for this target.`);
  if (manifest.migrations[file] !== checksum) throw new Error(`Migration ${file} approval checksum does not match.`);
}
```

- [ ] **Step 6: Refactor the migrator for atomic ledger writes**

In `scripts/migrate.ts`:

- parse `MIGRATION_APPROVAL_MANIFEST` once;
- compute the target fingerprint without logging the connection string;
- call `assertMigrationApproved` before checking/appplying every migration;
- for an unapplied migration call `unwrapMigrationTransaction(sql)`;
- execute `begin`, the unwrapped body, the ledger insert, and `commit` on the same client;
- on error call `rollback` before rethrowing;
- retain the advisory lock and semantic checksum checks.

Before allowing migration 012, additionally verify migration 011’s ledger checksum with `migrationChecksumVariants`, run `agencyGrantCoverageSql`, require zero rows, and require a non-empty approval `evidenceId`. Do not special-case migration 019 around this 012 check.

Document `MIGRATION_APPROVAL_MANIFEST` in `.env.example` as an unset deployment-only JSON value and in `docs/architecture.md` with a PowerShell-safe example generated from the exact target fingerprint and migration checksum. State that approval is not a secret but must be deployment-specific and short-lived.

- [ ] **Step 7: Run focused tests, types, and secret scan**

```powershell
node --import tsx --test tests/migration-checksum.test.ts tests/migration-policy.test.ts
npm.cmd run typecheck
npm.cmd run security:secrets
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add scripts/migration-policy.ts scripts/migrate.ts scripts/migration-checksum.ts scripts/agency-grant-coverage.ts tests/migration-checksum.test.ts tests/migration-policy.test.ts .env.example docs/architecture.md
git commit -m "fix: gate and atomically ledger migrations"
```

---

### Task 5: Exercise the real migrator and connection isolation in PostgreSQL CI

**Files:**
- Create: `scripts/test-migrator.ts`
- Create: `scripts/test-database-concurrency.ts`
- Modify: `scripts/test-database-isolation.ts`
- Modify: `package.json`
- Modify: `.github/workflows/database-security.yml`
- Modify: `tests/database-contract.test.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/production-readiness.md`

**Interfaces:**
- Produces npm command `db:test:migrator`.
- Produces npm command `db:test:concurrency`.
- Database workflow supplies `MIGRATION_DATABASE_URL` and a checksum-bound `MIGRATION_APPROVAL_MANIFEST` for migration 019.

- [ ] **Step 1: Add failing source contracts for the CI journeys**

Extend `tests/database-contract.test.ts` to require:

```ts
assert.match(workflow, /npm run db:test:migrator/u);
assert.match(workflow, /npm run db:test:concurrency/u);
assert.doesNotMatch(workflow, /for migration in database\/migrations\/\*\.sql/u);
assert.match(packageJson, /"db:test:migrator"/u);
assert.match(packageJson, /"db:test:concurrency"/u);
```

- [ ] **Step 2: Run the source contract and confirm RED**

```powershell
node --import tsx --test tests/database-contract.test.ts
```

Expected: FAIL because the real migrator and concurrency commands are absent.

- [ ] **Step 3: Implement migrator integration verification**

Create `scripts/test-migrator.ts`. It must use an admin PostgreSQL connection from `MIGRATION_DATABASE_URL`, create uniquely suffixed temporary databases owned by `afterword_migration_owner`, and spawn `tsx scripts/migrate.ts` with a database-specific URL and computed approval manifest for migration 019. The script must prove:

1. first apply records every present migration exactly once;
2. second apply prints `already applied` and changes no ledger row;
3. replacing a migration checksum in the ledger with a semantic mismatch makes the migrator fail with `has changed`;
4. omitting the approval manifest refuses migration 019;
5. a deliberately failing temporary migration body leaves neither its schema object nor ledger row, proving atomic rollback;
6. a synthetic migration 012 is refused unless its exact approval, valid 011 ledger entry, and zero-row coverage gate all pass.

Use a temporary migration directory passed through a new `MIGRATIONS_DIRECTORY` test-only override that is accepted only when `NODE_ENV=test`; production always resolves `database/migrations`. Clean up temporary databases and directories in `finally` blocks.

- [ ] **Step 4: Implement two-connection context isolation verification**

Create `scripts/test-database-concurrency.ts` using two simultaneous `pg.Client` instances. Insert two users, businesses, memberships, auth sessions, and one support session under `afterword_migration_owner`. Set both clients to `afterword_runtime`, then prove:

- tenant A context on client A cannot read tenant B;
- tenant B context on client B cannot read tenant A;
- committing or rolling back clears transaction-local request/support context;
- reusing client A for tenant B after rollback exposes only tenant B;
- concurrent `Promise.all` reads return only their bound tenant;
- a support-session ID bound on client A never appears on client B.

Use explicit UUID fixtures, transactions, and boolean assertions. Roll back fixture transactions or delete fixtures in `finally`; never target a non-test database. Require the database name to end in `_test` or begin with `afterword_test_`.

- [ ] **Step 5: Update scripts and workflow**

Add to `package.json`:

```json
"db:test:migrator": "tsx scripts/test-migrator.ts",
"db:test:concurrency": "tsx scripts/test-database-concurrency.ts"
```

Replace the workflow’s direct migration loop with:

```yaml
      - name: Prove migrator safety and idempotency
        env:
          MIGRATION_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/postgres
        run: npm run db:test:migrator
      - name: Apply reviewed migrations through the real migrator
        env:
          MIGRATION_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/afterword_test
        run: npm run db:migrate
      - name: Prove every database-security contract
        env:
          MIGRATION_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/afterword_test
        run: npm run db:test:isolation
      - name: Prove pooled and concurrent context isolation
        env:
          MIGRATION_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/afterword_test
        run: npm run db:test:concurrency
```

Generate the exact migration-019 approval manifest within the workflow in a preceding Node step and append it to `$GITHUB_ENV`; never hard-code a stale checksum. The manifest target must match `afterword_test`, and the migrator integration script creates its own manifests for temporary databases.

- [ ] **Step 6: Run all locally available gates**

```powershell
node --import tsx --test tests/database-contract.test.ts tests/migration-checksum.test.ts tests/migration-policy.test.ts tests/workflow-supply-chain.test.ts
npm.cmd run check
npm.cmd run test:cloudflare
npm.cmd run typecheck:cloudflare
npm.cmd run cf:dry-run
npm.cmd run build:demo
npm.cmd audit --omit=dev --audit-level=high
git diff --check
```

Expected: PASS. If no local PostgreSQL runtime exists, record `db:test:migrator`, `db:test:isolation`, and `db:test:concurrency` as pending GitHub CI proof; do not substitute a live database.

- [ ] **Step 7: Update readiness documentation**

Update `docs/architecture.md` and `docs/production-readiness.md` to record atomic migration ledgering, guarded migration 012, real migrator idempotency/checksum CI, two-connection context isolation, exact action/image pins, and remaining external/live limits. Remove the resolved two-connection blocker only after GitHub Database Security passes.

- [ ] **Step 8: Commit**

```powershell
git add scripts/test-migrator.ts scripts/test-database-concurrency.ts scripts/test-database-isolation.ts package.json .github/workflows/database-security.yml tests/database-contract.test.ts docs/architecture.md docs/production-readiness.md
git commit -m "test: prove migrator and connection isolation"
```

---

## Slice verification and review

- [ ] Generate a review package from base `8169de4` through the slice head.
- [ ] Dispatch a whole-slice security/code reviewer with the approved design, this plan, implementer reports, and review package.
- [ ] Fix every critical or important finding through one focused fix subagent and re-review.
- [ ] Run the complete local gate from Task 5.
- [ ] Push `codex/provider-independent-launch` only after local review is clean.
- [ ] Open a focused pull request describing that no provider or live migration was enabled.
- [ ] Require GitHub Application Security and Database Security to pass, including real migrator, migration 019, database SQL tests, and two-connection isolation.
- [ ] Confirm the prior Node.js 20 GitHub Action warning is absent.

## External limits preserved

This slice does not apply any target migration, run migration 012, enable Google writes or publishing, create Storage access, add social adapters, integrate MobileWAN, create Stripe video prices, or claim pilot evidence. Those remain separate external gates.
