import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CAPACITY_THRESHOLD,
  DIRECT_DATABASE_HOST,
  EXPECTED_DATABASE_ROLES,
  ROTATION_SENSITIVE_TABLES,
  redactSensitive,
  runCapacityPreflight,
  validateCapacityEnvironment,
  type CapacityQueryClient,
} from "../scripts/cloudflare/assert-free-capacity.js";
import {
  HYPERDRIVE_SPECS,
  bindCompatibilityConfig,
  buildHyperdriveCreateInvocation,
  buildHyperdriveListInvocation,
  buildWranglerWhoamiInvocation,
  createSecretMaterial,
  createdHyperdriveCleanupTargets,
  deriveWorkersDevOrigins,
  parseHyperdriveCreateOutput,
  parseHyperdriveGetOutput,
  parseHyperdriveListOutput,
  patchEnvironmentText,
  patchHyperdriveBindings,
  patchOriginConfigs,
  prepareStagingFiles,
  provisionHyperdrives,
  redactWranglerInvocation,
  restoreCompatibilityConfig,
  selectReusableHyperdrive,
  assertHyperdriveCleanupTarget,
  validateAccountEvidence,
  validateCapacityEvidence,
  verifySecretPayloads,
  type AccountEvidence,
  type PreparationPaths,
  type HyperdriveProvisionPaths,
  type WranglerInvocation,
} from "../scripts/cloudflare/provision.js";

test("Cloudflare staging secret and evidence files are ignored", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  assert.match(gitignore, /^\.cloudflare\/\*-secrets\.json$/m);
  assert.match(gitignore, /^\.cloudflare\/staging-resource-ids\.json$/m);
  assert.match(gitignore, /^\.cloudflare\/staging-resource-ids\.json\.\*\.pending$/m);
  assert.match(gitignore, /^\.cloudflare\/evidence\/$/m);

  const pendingEvidence = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", ".cloudflare/staging-resource-ids.json.90000000-0000-4000-8000-000000000001.pending"],
    { cwd: path.resolve("."), stdio: "ignore" },
  );
  assert.equal(pendingEvidence.error, undefined);
  assert.equal(pendingEvidence.status, 0);
  const unrelatedPending = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", ".cloudflare/unrelated.pending"],
    { cwd: path.resolve("."), stdio: "ignore" },
  );
  assert.equal(unrelatedPending.error, undefined);
  assert.notEqual(unrelatedPending.status, 0);
});

const projectRef = "cwwgvkepocldophqzijf";
const poolerHost = "aws-0-eu-west-2.pooler.supabase.com";

function roleUrl(role: string) {
  return `postgresql://${role}.${projectRef}:synthetic-password@${poolerHost}:5432/postgres`;
}

function capacityEnvironment() {
  return {
    SUPABASE_PROJECT_REF: projectRef,
    SUPABASE_POOLER_HOST: poolerHost,
    DATABASE_SSL: "require",
    DATABASE_CA_CERT_PATH: "synthetic-ca.pem",
    MIGRATION_DATABASE_URL: roleUrl("afterword_migration_login"),
    AUTH_DATABASE_URL: roleUrl("afterword_auth_login"),
    RUNTIME_DATABASE_URL: roleUrl("afterword_runtime_login"),
    INGRESS_DATABASE_URL: roleUrl("afterword_ingress_login"),
    WORKER_DATABASE_URL: roleUrl("afterword_worker_login"),
    AUTH_DATABASE_PASSWORD: "auth-hyperdrive-password",
    RUNTIME_DATABASE_PASSWORD: "runtime-hyperdrive-password",
    INGRESS_DATABASE_PASSWORD: "ingress-hyperdrive-password",
    WORKER_DATABASE_PASSWORD: "worker-hyperdrive-password",
  };
}

test("capacity settings bind exact staging identities and construct direct-only Hyperdrive origins", () => {
  const settings = validateCapacityEnvironment(capacityEnvironment());

  assert.equal(settings.projectRef, projectRef);
  assert.equal(settings.poolerHost, poolerHost);
  assert.equal(settings.capacityThreshold, CAPACITY_THRESHOLD);
  assert.deepEqual(Object.keys(settings.hyperdriveOrigins), [...EXPECTED_DATABASE_ROLES.keys()]);
  for (const [binding, expectedRole] of EXPECTED_DATABASE_ROLES) {
    const origin = settings.hyperdriveOrigins[binding];
    assert.equal(origin.host, DIRECT_DATABASE_HOST);
    assert.equal(origin.database, "postgres");
    assert.equal(origin.port, 5432);
    assert.equal(origin.user, expectedRole);
    assert.equal(origin.sslmode, "require");
    assert.equal(origin.cachingDisabled, true);
    assert.equal(origin.originConnectionLimit, 5);
    assert.ok(origin.password.endsWith("hyperdrive-password"));
  }
});

test("capacity settings fail closed on wrong projects, pooler lookalikes, TLS, or role identities", () => {
  const valid = capacityEnvironment();
  const invalidEnvironments = [
    { ...valid, SUPABASE_PROJECT_REF: "another-project" },
    { ...valid, SUPABASE_POOLER_HOST: `${poolerHost}.attacker.test` },
    { ...valid, DATABASE_SSL: "prefer" },
    { ...valid, DATABASE_CA_CERT_PATH: "" },
    { ...valid, AUTH_DATABASE_URL: roleUrl("afterword_runtime_login") },
    { ...valid, MIGRATION_DATABASE_URL: `postgresql://afterword_migration_login.${projectRef}:synthetic-password@${poolerHost}:6543/postgres` },
    { ...valid, WORKER_DATABASE_PASSWORD: "" },
  ];
  for (const environment of invalidEnvironments) {
    assert.throws(() => validateCapacityEnvironment(environment), /staging|TLS|certificate|identity|password/i);
  }
});

class SyntheticClient implements CapacityQueryClient {
  connected = false;
  ended = false;

  constructor(
    readonly label: string,
    private readonly availableConnections = 24,
    private readonly nonEmptyTable?: string,
    private readonly wrongRole?: string,
  ) {}

  async connect() {
    this.connected = true;
  }

  async end() {
    this.ended = true;
  }

  async query<Row extends Record<string, unknown>>(sql: string): Promise<{ rows: Row[] }> {
    if (sql.includes("current_setting('max_connections')")) {
      return { rows: [{ max_connections: 40, active_connections: 40 - this.availableConnections }] as Row[] };
    }
    if (sql.includes("count(*)::int as row_count")) {
      const table = ROTATION_SENSITIVE_TABLES.find((candidate) => sql.includes(candidate));
      return { rows: [{ row_count: table === this.nonEmptyTable ? 1 : 0 }] as Row[] };
    }
    if (sql.includes("current_user")) {
      return { rows: [{ current_user: this.wrongRole ?? this.label }] as Row[] };
    }
    throw new Error("Unexpected synthetic query");
  }
}

test("capacity preflight proves 24 available connections, exact roles, and empty sensitive tables", async () => {
  const clients: SyntheticClient[] = [];
  const evidence = await runCapacityPreflight(validateCapacityEnvironment(capacityEnvironment()), (input) => {
    const client = new SyntheticClient(input.expectedRole ?? "migration");
    clients.push(client);
    return client;
  });

  assert.equal(evidence.projectRef, projectRef);
  assert.equal(evidence.availableConnections, 24);
  assert.deepEqual(evidence.roles, [...EXPECTED_DATABASE_ROLES.values()]);
  assert.deepEqual(Object.keys(evidence.tableCounts), [...ROTATION_SENSITIVE_TABLES]);
  assert.ok(Object.values(evidence.tableCounts).every((count) => count === 0));
  assert.equal(clients.length, 5);
  assert.ok(clients.every((client) => client.connected && client.ended));
});

test("capacity preflight closes clients and refuses low capacity, existing rows, or wrong roles", async () => {
  for (const scenario of ["capacity", "rows", "role"] as const) {
    const clients: SyntheticClient[] = [];
    await assert.rejects(
      runCapacityPreflight(validateCapacityEnvironment(capacityEnvironment()), (input) => {
        const client = new SyntheticClient(
          input.expectedRole ?? "migration",
          scenario === "capacity" ? 23 : 24,
          scenario === "rows" && !input.expectedRole ? ROTATION_SENSITIVE_TABLES[0] : undefined,
          scenario === "role" && input.expectedRole === "afterword_auth_login" ? "wrong_role" : undefined,
        );
        clients.push(client);
        return client;
      }),
      scenario === "capacity" ? /24 available/ : scenario === "rows" ? /customer_contacts=1/ : /role identity/,
    );
    assert.ok(clients.every((client) => client.ended));
  }
});

test("capacity diagnostics redact URLs, hosts, passwords, and certificate material", () => {
  const secretUrl = roleUrl("afterword_migration_login");
  const redacted = redactSensitive(
    `failed ${secretUrl} ${poolerHost} ${DIRECT_DATABASE_HOST} auth-hyperdrive-password synthetic-ca.pem`,
    capacityEnvironment(),
  );

  assert.equal(redacted.includes("synthetic-password"), false);
  assert.equal(redacted.includes(poolerHost), false);
  assert.equal(redacted.includes(DIRECT_DATABASE_HOST), false);
  assert.equal(redacted.includes("auth-hyperdrive-password"), false);
  assert.equal(redacted.includes("synthetic-ca.pem"), false);
  assert.match(redacted, /\[REDACTED\]/);
});

function accountEvidence(checkedAt = new Date().toISOString()): AccountEvidence {
  return {
    version: 1,
    projectRef,
    accountId: "ab".repeat(16),
    workersDevSubdomain: "review-anchor-staging-test",
    accountVerified: true,
    freePlanVerified: true,
    hyperdriveAvailableWithoutUpgrade: true,
    queuesAvailableWithoutUpgrade: true,
    monthlyRecurringCostUsd: 0,
    checkedAt,
  };
}

function capacityEvidence(checkedAt = new Date().toISOString()) {
  return {
    version: 1 as const,
    passed: true as const,
    projectRef,
    checkedAt,
    maxConnections: 40,
    activeConnections: 16,
    availableConnections: 24,
    threshold: 24 as const,
    roles: [...EXPECTED_DATABASE_ROLES.values()],
    tableCounts: Object.fromEntries(ROTATION_SENSITIVE_TABLES.map((table) => [table, 0])),
  };
}

test("account and capacity evidence require the exact verified free staging boundary", () => {
  const account = accountEvidence();
  assert.deepEqual(validateAccountEvidence(account), account);
  assert.equal(validateCapacityEvidence(capacityEvidence()).availableConnections, 24);

  for (const invalid of [
    { ...accountEvidence(), projectRef: "production" },
    { ...accountEvidence(), accountId: "not-an-account" },
    { ...accountEvidence(), workersDevSubdomain: "two.labels" },
    { ...accountEvidence(), accountVerified: false },
    { ...accountEvidence(), freePlanVerified: false },
    { ...accountEvidence(), hyperdriveAvailableWithoutUpgrade: false },
    { ...accountEvidence(), queuesAvailableWithoutUpgrade: false },
    { ...accountEvidence(), monthlyRecurringCostUsd: 0.01 },
  ]) {
    assert.throws(() => validateAccountEvidence(invalid), /account|staging|subdomain|free|upgrade|cost/i);
  }
  assert.throws(
    () => validateCapacityEvidence({ ...capacityEvidence(), availableConnections: 23 }),
    /arithmetic|24 available/,
  );
  assert.throws(
    () => validateCapacityEvidence({
      ...capacityEvidence(),
      tableCounts: { ...capacityEvidence().tableCounts, review_requests: 1 },
    }),
    /review_requests=1/,
  );
});

test("mutation preflight enforces fresh account and arithmetic-consistent capacity evidence with a controlled clock", async () => {
  const provisionModule = await import("../scripts/cloudflare/provision.js") as typeof import("../scripts/cloudflare/provision.js") & {
    validateMutationPreflight?: (account: unknown, capacity: unknown, now: number) => unknown;
  };
  assert.equal(typeof provisionModule.validateMutationPreflight, "function");
  const now = Date.parse("2026-07-20T12:10:00.000Z");
  assert.ok(provisionModule.validateMutationPreflight?.(
    accountEvidence("2026-07-20T12:00:00.000Z"),
    capacityEvidence("2026-07-20T12:00:00.000Z"),
    now,
  ));
  assert.throws(
    () => provisionModule.validateMutationPreflight?.(
      accountEvidence("2026-07-20T11:00:00.000Z"),
      capacityEvidence("2026-07-20T12:00:00.000Z"),
      now,
    ),
    /account.*stale/i,
  );
  assert.throws(
    () => provisionModule.validateMutationPreflight?.(
      accountEvidence("2026-07-20T12:00:00.000Z"),
      { ...capacityEvidence("2026-07-20T12:00:00.000Z"), availableConnections: 25 },
      now,
    ),
    /arithmetic/,
  );
});

test("Workers.dev origins require exact explicit confirmation", () => {
  const evidence = accountEvidence();
  const expected = {
    application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
    ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
  };
  assert.deepEqual(deriveWorkersDevOrigins(evidence, expected), expected);
  assert.throws(
    () => deriveWorkersDevOrigins(evidence, { ...expected, application: `${expected.application}/wrong` }),
    /confirmation/,
  );
  assert.throws(
    () => deriveWorkersDevOrigins({ ...evidence, workersDevSubdomain: "attacker.test" }, expected),
    /subdomain/,
  );
});

test("secret preparation creates independent least-privilege payloads", () => {
  let byte = 1;
  const secrets = createSecretMaterial((size) => Buffer.alloc(size, byte++));
  const payloads = verifySecretPayloads(secrets.payloads);

  assert.deepEqual(Object.keys(payloads.compatibility), ["COMPAT_GATE_TOKEN"]);
  assert.deepEqual(Object.keys(payloads.application).sort(), [
    "DATA_HASH_PEPPER",
    "FIELD_ENCRYPTION_KEY",
    "SESSION_PEPPER",
  ]);
  assert.deepEqual(Object.keys(payloads.ingress).sort(), ["DATA_HASH_PEPPER", "FIELD_ENCRYPTION_KEY"]);
  assert.deepEqual(Object.keys(payloads.jobs), ["FIELD_ENCRYPTION_KEY"]);
  assert.equal(payloads.application.DATA_HASH_PEPPER, payloads.ingress.DATA_HASH_PEPPER);
  assert.equal(payloads.application.FIELD_ENCRYPTION_KEY, payloads.ingress.FIELD_ENCRYPTION_KEY);
  assert.equal(payloads.application.FIELD_ENCRYPTION_KEY, payloads.jobs.FIELD_ENCRYPTION_KEY);
  assert.notEqual(payloads.application.SESSION_PEPPER, payloads.application.DATA_HASH_PEPPER);
  assert.equal(new Set(Object.values(secrets.values)).size, 4);
  assert.ok(Object.values(secrets.values).every((value) => /^[A-Za-z0-9_-]{43}$/.test(value)));

  assert.throws(
    () => verifySecretPayloads({ ...payloads, jobs: { SESSION_PEPPER: payloads.application.SESSION_PEPPER } }),
    /least-privilege|secret payload/i,
  );
});

test("environment patch changes only the three staging cryptographic values and rejects duplicates", () => {
  const before = [
    "MIGRATION_DATABASE_URL=postgresql://migration:do-not-touch@example.test:5432/postgres",
    "AUTH_DATABASE_PASSWORD=do-not-touch-auth",
    "SESSION_PEPPER=old-session",
    "FIELD_ENCRYPTION_KEY=old-field",
    "PROVIDER_DELIVERY_ENABLED=false",
    "",
  ].join("\n");
  const patched = patchEnvironmentText(before, {
    SESSION_PEPPER: "new-session",
    DATA_HASH_PEPPER: "new-data",
    FIELD_ENCRYPTION_KEY: "new-field",
  });

  assert.match(patched, /^MIGRATION_DATABASE_URL=postgresql:\/\/migration:do-not-touch@example\.test:5432\/postgres$/m);
  assert.match(patched, /^AUTH_DATABASE_PASSWORD=do-not-touch-auth$/m);
  assert.match(patched, /^PROVIDER_DELIVERY_ENABLED=false$/m);
  assert.match(patched, /^SESSION_PEPPER=new-session$/m);
  assert.match(patched, /^DATA_HASH_PEPPER=new-data$/m);
  assert.match(patched, /^FIELD_ENCRYPTION_KEY=new-field$/m);
  assert.throws(
    () => patchEnvironmentText(`${before}SESSION_PEPPER=duplicate\n`, {
      SESSION_PEPPER: "new-session",
      DATA_HASH_PEPPER: "new-data",
      FIELD_ENCRYPTION_KEY: "new-field",
    }),
    /duplicate/,
  );
});

function syntheticWranglerConfig(name: string) {
  return `${JSON.stringify({
    name,
    main: "src/index.ts",
    vars: {
      NODE_ENV: "production",
      PROVIDER_DELIVERY_ENABLED: "false",
      STRIPE_CHECKOUT_ENABLED: "false",
      STRIPE_MODE: "test",
    },
  }, null, 2)}\n`;
}

test("origin and Hyperdrive config patchers touch only exact staging configs and bindings", () => {
  const origins = deriveWorkersDevOrigins(accountEvidence(), {
    application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
    ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
  });
  const patchedOrigins = patchOriginConfigs({
    application: syntheticWranglerConfig("review-anchor-staging"),
    ingress: syntheticWranglerConfig("review-anchor-staging-ingress"),
  }, origins);
  const application = JSON.parse(patchedOrigins.application) as { vars: Record<string, string> };
  const ingress = JSON.parse(patchedOrigins.ingress) as { vars: Record<string, string> };
  assert.equal(application.vars.APP_ORIGIN, origins.application);
  assert.equal(application.vars.PUBLIC_REVIEW_ORIGIN, origins.application);
  assert.equal(ingress.vars.APP_ORIGIN, origins.application);
  assert.equal(ingress.vars.PUBLIC_REVIEW_BASE_URL, origins.application);
  assert.equal(ingress.vars.EXTERNAL_WEBHOOK_BASE_URL, origins.ingress);
  assert.equal(application.vars.PROVIDER_DELIVERY_ENABLED, "false");

  const ids = Object.fromEntries(HYPERDRIVE_SPECS.map((spec, index) => [spec.binding, index.toString(16).padStart(32, "a")]));
  const configs = patchHyperdriveBindings({
    application: patchedOrigins.application,
    ingress: patchedOrigins.ingress,
    jobs: syntheticWranglerConfig("review-anchor-staging-jobs"),
  }, ids);
  const appHyperdrives = (JSON.parse(configs.application) as { hyperdrive: Array<{ binding: string; id: string }> }).hyperdrive;
  assert.deepEqual(appHyperdrives.map(({ binding }) => binding), ["AUTH_DB", "RUNTIME_DB"]);
  assert.deepEqual(
    (JSON.parse(configs.ingress) as { hyperdrive: Array<{ binding: string }> }).hyperdrive.map(({ binding }) => binding),
    ["INGRESS_DB"],
  );
  assert.deepEqual(
    (JSON.parse(configs.jobs) as { hyperdrive: Array<{ binding: string }> }).hyperdrive.map(({ binding }) => binding),
    ["WORKER_DB"],
  );
  assert.throws(
    () => patchOriginConfigs({ ...patchedOrigins, application: syntheticWranglerConfig("review-anchor-production") }, origins),
    /exact staging Worker/,
  );
});

test("compatibility binding helper is reversible and rejects a dirty or wrong config", () => {
  const original = `${JSON.stringify({
    name: "review-anchor-staging-compat",
    main: "src/index.ts",
    observability: { enabled: true },
  }, null, 2)}\n`;
  const ids = Object.fromEntries(HYPERDRIVE_SPECS.map((spec, index) => [spec.binding, `${index + 1}`.repeat(32)]));
  const bound = bindCompatibilityConfig(original, ids);
  assert.equal((JSON.parse(bound) as { hyperdrive: unknown[] }).hyperdrive.length, 4);
  assert.equal(restoreCompatibilityConfig(bound, original), original);
  assert.throws(() => bindCompatibilityConfig(bound, ids), /binding-free/);
  assert.throws(
    () => restoreCompatibilityConfig(syntheticWranglerConfig("review-anchor-production"), original),
    /exact staging Worker/,
  );
});

test("Hyperdrive 4.112.0 commands use the real list/create/get contracts without nonexistent JSON flags", async () => {
  const settings = validateCapacityEnvironment(capacityEnvironment());
  const spec = HYPERDRIVE_SPECS[0];
  const invocation = buildHyperdriveCreateInvocation(spec, settings.hyperdriveOrigins.AUTH_DB, "C:\\synthetic-workspace");
  assert.equal(invocation.file, process.execPath);
  assert.ok(invocation.args.includes("hyperdrive"));
  assert.ok(invocation.args.includes("create"));
  assert.ok(invocation.args.includes("--host"));
  assert.ok(invocation.args.includes(DIRECT_DATABASE_HOST));
  assert.ok(invocation.args.includes("--database"));
  assert.ok(invocation.args.includes("postgres"));
  assert.ok(invocation.args.includes("--user"));
  assert.ok(invocation.args.includes("afterword_auth_login"));
  assert.ok(invocation.args.includes("--password"));
  assert.ok(invocation.args.includes("auth-hyperdrive-password"));
  assert.ok(invocation.args.includes("--port"));
  assert.ok(invocation.args.includes("5432"));
  assert.ok(invocation.args.includes("--sslmode"));
  assert.ok(invocation.args.includes("require"));
  assert.ok(invocation.args.includes("--caching-disabled"));
  assert.ok(invocation.args.includes("--origin-connection-limit"));
  assert.ok(invocation.args.includes("5"));
  assert.equal(invocation.args.includes("--json"), false);
  assert.equal(invocation.args.some((value) => value.includes("postgresql://")), false);
  assert.equal(invocation.args.includes("MIGRATION_DATABASE_URL"), false);

  const safe = redactWranglerInvocation(invocation);
  assert.equal(JSON.stringify(safe).includes("auth-hyperdrive-password"), false);
  assert.match(JSON.stringify(safe), /\[REDACTED\]/);
  const list = buildHyperdriveListInvocation("C:\\synthetic-workspace");
  assert.deepEqual(list.args.slice(-2), ["hyperdrive", "list"]);

  const provisionModule = await import("../scripts/cloudflare/provision.js") as typeof import("../scripts/cloudflare/provision.js") & {
    buildHyperdriveGetInvocation?: (id: string, cwd: string) => WranglerInvocation;
    validateWranglerVersion?: (version: string) => string;
  };
  assert.equal(typeof provisionModule.buildHyperdriveGetInvocation, "function");
  assert.deepEqual(
    provisionModule.buildHyperdriveGetInvocation?.("12".repeat(16), "C:\\synthetic-workspace").args.slice(-3),
    ["hyperdrive", "get", "12".repeat(16)],
  );
  assert.equal(provisionModule.validateWranglerVersion?.("4.112.0"), "4.112.0");
  assert.throws(() => provisionModule.validateWranglerVersion?.("4.113.0"), /unsupported Wrangler version/);
});

const CAPTURED_EMPTY_HYPERDRIVE_LIST = "📋 Listing Hyperdrive configs\n";
const CAPTURED_NONEMPTY_HYPERDRIVE_LIST = `📋 Listing Hyperdrive configs
┌──────────────────────────────────┬────────────────────────────┬──────────────────────┬───────────────────────────────────────────────┬──────┬────────────┬──────────┬──────────┬──────┬─────────────────────────┐
│ id                               │ name                       │ user                 │ host                                          │ port │ scheme     │ database │ caching  │ mtls │ origin_connection_limit │
├──────────────────────────────────┼────────────────────────────┼──────────────────────┼───────────────────────────────────────────────┼──────┼────────────┼──────────┼──────────┼──────┼─────────────────────────┤
│ 12121212121212121212121212121212 │ review-anchor-staging-auth │ afterword_auth_login │ db.cwwgvkepocldophqzijf.supabase.co           │ 5432 │ PostgreSQL │ postgres │ disabled │      │ 5                       │
└──────────────────────────────────┴────────────────────────────┴──────────────────────┴───────────────────────────────────────────────┴──────┴────────────┴──────────┴──────────┴──────┴─────────────────────────┘
`;

test("Hyperdrive list parser accepts captured Wrangler 4.112.0 empty and Unicode table output only", () => {
  const settings = validateCapacityEnvironment(capacityEnvironment());
  const spec = HYPERDRIVE_SPECS[0];
  const origin = settings.hyperdriveOrigins.AUTH_DB;
  assert.deepEqual(parseHyperdriveListOutput(CAPTURED_EMPTY_HYPERDRIVE_LIST), []);
  const parsed = parseHyperdriveListOutput(CAPTURED_NONEMPTY_HYPERDRIVE_LIST);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    id: "12".repeat(16),
    name: spec.name,
    user: origin.user,
    host: origin.host,
    port: 5432,
    scheme: "PostgreSQL",
    database: "postgres",
    caching: "disabled",
    mtls: "",
    originConnectionLimit: 5,
  });
  assert.throws(
    () => parseHyperdriveListOutput(`${CAPTURED_NONEMPTY_HYPERDRIVE_LIST}unexpected`),
    /captured Wrangler 4\.112\.0 table/,
  );
  assert.throws(() => parseHyperdriveListOutput("📋 Listing Hyperdrive configs\nmalformed"), /captured Wrangler 4\.112\.0 table/);
});

test("Hyperdrive get parser accepts captured Wrangler JSON metadata and refuses malformed output", () => {
  const captured = hyperdriveResource(0);
  assert.deepEqual(parseHyperdriveGetOutput(JSON.stringify(captured, null, 2)), captured);
  assert.throws(() => parseHyperdriveGetOutput("not-json"), /did not return valid Wrangler 4\.112\.0 JSON/);
  assert.throws(
    () => parseHyperdriveGetOutput(JSON.stringify({ ...captured, origin: null })),
    /origin metadata/,
  );
});

test("Hyperdrive create parser accepts only the exact captured Wrangler 4.112.0 success line", () => {
  const resource = hyperdriveResource(0);
  assert.deepEqual(
    parseHyperdriveCreateOutput(capturedCreate(resource)),
    { scheme: "PostgreSQL", id: resource.id },
  );
  assert.throws(
    () => parseHyperdriveCreateOutput(JSON.stringify({ success: true, id: "12".repeat(16) })),
    /exact Wrangler 4\.112\.0 success contract/,
  );
  assert.throws(
    () => parseHyperdriveCreateOutput(`✅ Created new Hyperdrive postgresql config: ${"12".repeat(16)}\n`),
    /exact Wrangler 4\.112\.0 success contract/,
  );
  const secondId = "ab".repeat(16);
  assert.throws(
    () => parseHyperdriveCreateOutput(`${capturedCreate(resource)}✅ Created new Hyperdrive PostgreSQL config: ${secondId}\n`),
    /exactly one.*success/i,
  );
  assert.throws(
    () => parseHyperdriveCreateOutput(capturedCreate(resource).replace(resource.id, `${resource.id} ${secondId}`)),
    /exact Wrangler 4\.112\.0 success contract/,
  );
});

function preparationPaths(root: string): PreparationPaths {
  return {
    environment: path.join(root, ".env.staging"),
    accountEvidence: path.join(root, ".cloudflare", "staging-resource-ids.json"),
    capacityEvidence: path.join(root, ".cloudflare", "evidence", "capacity.json"),
    preRotationSecrets: path.join(root, ".cloudflare", "pre-rotation-secrets.json"),
    transactionJournal: path.join(root, ".cloudflare", "evidence", "staging-prepare-transaction.json"),
    secretFiles: {
      compatibility: path.join(root, ".cloudflare", "staging-compat-secrets.json"),
      application: path.join(root, ".cloudflare", "staging-application-secrets.json"),
      ingress: path.join(root, ".cloudflare", "staging-ingress-secrets.json"),
      jobs: path.join(root, ".cloudflare", "staging-jobs-secrets.json"),
    },
    configs: {
      application: path.join(root, "cloudflare", "application", "wrangler.jsonc"),
      ingress: path.join(root, "cloudflare", "ingress", "wrangler.jsonc"),
    },
  };
}

async function writePreparationFixture(root: string) {
  const paths = preparationPaths(root);
  await mkdir(path.dirname(paths.accountEvidence), { recursive: true });
  await mkdir(path.dirname(paths.capacityEvidence), { recursive: true });
  await mkdir(path.dirname(paths.configs.application), { recursive: true });
  await mkdir(path.dirname(paths.configs.ingress), { recursive: true });
  await writeFile(paths.accountEvidence, JSON.stringify(accountEvidence()));
  await writeFile(paths.capacityEvidence, JSON.stringify(capacityEvidence()));
  await writeFile(paths.environment, [
    "MIGRATION_DATABASE_URL=postgresql://migration:keep@example.test:5432/postgres",
    "AUTH_DATABASE_PASSWORD=keep-auth",
    "SESSION_PEPPER=old-session",
    "FIELD_ENCRYPTION_KEY=old-field",
    "PROVIDER_DELIVERY_ENABLED=false",
    "",
  ].join("\n"));
  await writeFile(paths.configs.application, syntheticWranglerConfig("review-anchor-staging"));
  await writeFile(paths.configs.ingress, syntheticWranglerConfig("review-anchor-staging-ingress"));
  return paths;
}

test("prepare writes synthetic least-privilege files without changing database or provider values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-"));
  const paths = await writePreparationFixture(root);
  let byte = 1;
  await prepareStagingFiles({
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size) => Buffer.alloc(size, byte++),
    rotate: false,
    confirmedEmptyStagingData: false,
  });

  const environment = await readFile(paths.environment, "utf8");
  assert.match(environment, /^MIGRATION_DATABASE_URL=postgresql:\/\/migration:keep@example\.test:5432\/postgres$/m);
  assert.match(environment, /^AUTH_DATABASE_PASSWORD=keep-auth$/m);
  assert.match(environment, /^PROVIDER_DELIVERY_ENABLED=false$/m);
  const payloads = verifySecretPayloads({
    compatibility: JSON.parse(await readFile(paths.secretFiles.compatibility, "utf8")),
    application: JSON.parse(await readFile(paths.secretFiles.application, "utf8")),
    ingress: JSON.parse(await readFile(paths.secretFiles.ingress, "utf8")),
    jobs: JSON.parse(await readFile(paths.secretFiles.jobs, "utf8")),
  });
  assert.match(environment, new RegExp(`^SESSION_PEPPER=${payloads.application.SESSION_PEPPER}$`, "m"));
  assert.match(environment, new RegExp(`^DATA_HASH_PEPPER=${payloads.application.DATA_HASH_PEPPER}$`, "m"));
  assert.match(environment, new RegExp(`^FIELD_ENCRYPTION_KEY=${payloads.application.FIELD_ENCRYPTION_KEY}$`, "m"));
  assert.equal(JSON.stringify(payloads).includes("keep-auth"), false);
});

test("prepare refuses overwrite without an explicit confirmed rotation and preserves prior crypto values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-rotate-"));
  const paths = await writePreparationFixture(root);
  await mkdir(path.dirname(paths.secretFiles.application), { recursive: true });
  await writeFile(paths.secretFiles.application, JSON.stringify({ SESSION_PEPPER: "existing" }));

  await assert.rejects(
    prepareStagingFiles({
      paths,
      confirmations: {
        application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
        ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
      },
      randomBytes: (size) => Buffer.alloc(size, 1),
      rotate: false,
      confirmedEmptyStagingData: false,
    }),
    /--rotate/,
  );
  assert.equal(JSON.parse(await readFile(paths.secretFiles.application, "utf8")).SESSION_PEPPER, "existing");

  let byte = 1;
  await prepareStagingFiles({
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size) => Buffer.alloc(size, byte++),
    rotate: true,
    confirmedEmptyStagingData: true,
  });
  assert.deepEqual(JSON.parse(await readFile(paths.preRotationSecrets, "utf8")), {
    SESSION_PEPPER: "old-session",
    FIELD_ENCRYPTION_KEY: "old-field",
  });
});

async function fileExists(filePath: string) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function preparationLockPaths(paths: PreparationPaths) {
  const lockDirectory = path.join(path.dirname(paths.transactionJournal), "staging-prepare.lock");
  return { lockDirectory, ownerFile: path.join(lockDirectory, "owner.json") };
}

async function writePreparationLock(
  paths: PreparationPaths,
  owner: { hostname?: string; ownerId?: string; pid?: number } = {},
) {
  const lock = preparationLockPaths(paths);
  await mkdir(lock.lockDirectory, { recursive: true });
  await writeFile(lock.ownerFile, JSON.stringify({
    version: 1,
    acquiredAt: "2026-07-20T09:00:00.000Z",
    hostname: owner.hostname ?? os.hostname(),
    ownerId: owner.ownerId ?? "90000000-0000-4000-8000-000000000020",
    pid: owner.pid ?? 4242,
  }));
  return lock;
}

function prepareOptions(paths: PreparationPaths, byte = 1) {
  let nextByte = byte;
  return {
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size: number) => Buffer.alloc(size, nextByte++),
    rotate: false,
    confirmedEmptyStagingData: false,
  };
}

test("prepare refuses a concurrent live cross-process lock owner without touching staging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-live-lock-"));
  const paths = await writePreparationFixture(root);
  const originalEnvironment = await readFile(paths.environment, "utf8");
  const lock = await writePreparationLock(paths);

  await assert.rejects(
    prepareStagingFiles({
      ...prepareOptions(paths),
      preparationLock: { isProcessAlive: async (pid) => pid === 4242 },
    }),
    /live staging preparation lock owner/i,
  );
  assert.equal(await readFile(paths.environment, "utf8"), originalEnvironment);
  assert.equal(await pathExists(lock.lockDirectory), true);
});

test("prepare reclaims a provably dead owner atomically and blocks a concurrent claimant", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-stale-lock-"));
  const paths = await writePreparationFixture(root);
  const lock = await writePreparationLock(paths);
  let releaseFirst!: () => void;
  let enteredFirst!: () => void;
  const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const entered = new Promise<void>((resolve) => { enteredFirst = resolve; });

  const first = prepareStagingFiles({
    ...prepareOptions(paths),
    preparationLock: { isProcessAlive: async (pid) => pid !== 4242 },
    transactionHooks: {
      beforeReplace: async (index) => {
        if (index !== 0) return;
        enteredFirst();
        await held;
      },
    },
  });
  await entered;
  await assert.rejects(
    prepareStagingFiles(prepareOptions(paths, 2)),
    /live staging preparation lock owner/i,
  );
  releaseFirst();
  await first;
  assert.equal(await pathExists(lock.lockDirectory), false);
});

test("prepare releases its cross-process lock after both success and transactional failure", async () => {
  const successRoot = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-lock-success-"));
  const successPaths = await writePreparationFixture(successRoot);
  await prepareStagingFiles(prepareOptions(successPaths));
  assert.equal(await pathExists(preparationLockPaths(successPaths).lockDirectory), false);

  const failureRoot = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-lock-failure-"));
  const failurePaths = await writePreparationFixture(failureRoot);
  await assert.rejects(
    prepareStagingFiles({
      ...prepareOptions(failurePaths),
      transactionHooks: { beforeReplace: () => { throw new Error("synthetic lock cleanup failure path"); } },
    }),
    /rolled back/,
  );
  assert.equal(await pathExists(preparationLockPaths(failurePaths).lockDirectory), false);
});

test("prepare fails closed on invalid lock ownership metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-invalid-lock-"));
  const paths = await writePreparationFixture(root);
  const lock = preparationLockPaths(paths);
  await mkdir(lock.lockDirectory, { recursive: true });
  await writeFile(lock.ownerFile, "{\"pid\":4242}");

  await assert.rejects(prepareStagingFiles(prepareOptions(paths)), /lock ownership metadata is invalid/i);
  assert.equal(await pathExists(lock.lockDirectory), true);
});

test("prepare transaction rolls back every prior replacement at multiple injected failure points", async () => {
  for (const failureIndex of [1, 5]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `review-anchor-stage-a-transaction-${failureIndex}-`));
    const paths = await writePreparationFixture(root);
    let byte = failureIndex + 1;
    const originals = new Map<string, string>();
    for (const filePath of [paths.environment, paths.configs.application, paths.configs.ingress]) {
      originals.set(filePath, await readFile(filePath, "utf8"));
    }
    await assert.rejects(
      prepareStagingFiles({
        paths,
        confirmations: {
          application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
          ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
        },
        randomBytes: (size) => Buffer.alloc(size, byte++),
        rotate: false,
        confirmedEmptyStagingData: false,
        transactionHooks: {
          beforeReplace: (index) => {
            if (index === failureIndex) throw new Error("synthetic replacement failure");
          },
        },
      }),
      /rolled back/,
    );
    for (const [filePath, original] of originals) assert.equal(await readFile(filePath, "utf8"), original);
    for (const filePath of [...Object.values(paths.secretFiles), paths.preRotationSecrets, paths.transactionJournal]) {
      assert.equal(await fileExists(filePath), false);
    }
  }
});

test("secret atomic replacement stages plaintext only inside the ignored transaction directory and recovers an interrupted rename", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-secret-atomic-"));
  const paths = await writePreparationFixture(root);
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const originalEnvironment = await readFile(paths.environment, "utf8");
  let byte = 1;
  let inspected = false;
  await assert.rejects(
    prepareStagingFiles({
      paths,
      confirmations: {
        application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
        ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
      },
      randomBytes: (size) => Buffer.alloc(size, byte++),
      rotate: false,
      confirmedEmptyStagingData: false,
      transactionHooks: {
        beforeAtomicRename: (temporaryPath, destination) => {
          if (destination !== paths.secretFiles.application) return;
          inspected = true;
          const relative = path.relative(root, temporaryPath).replaceAll("\\", "/");
          assert.match(relative, /^\.cloudflare\/evidence\/staging-prepare-[0-9a-f-]+\/\d+\.staged$/);
          assert.match(gitignore, /^\.cloudflare\/evidence\/$/m);
          throw new Error("synthetic crash before secret rename");
        },
      },
    }),
    /rolled back/,
  );
  assert.equal(inspected, true);
  assert.equal(await readFile(paths.environment, "utf8"), originalEnvironment);
  assert.equal(await fileExists(paths.secretFiles.application), false);
  assert.equal(await fileExists(paths.transactionJournal), false);
});

test("prepare cleans an interrupted pre-mutation staging journal containing plaintext only in the ignored directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-staging-recovery-"));
  const paths = await writePreparationFixture(root);
  const runId = "90000000-0000-4000-8000-000000000013";
  const transactionDirectory = path.join(path.dirname(paths.transactionJournal), `staging-prepare-${runId}`);
  const stagedPath = path.join(transactionDirectory, "0.staged");
  const backupPath = path.join(transactionDirectory, "0.backup");
  await mkdir(transactionDirectory, { recursive: true });
  await writeFile(stagedPath, "synthetic plaintext runtime secret\n");
  await writeFile(paths.transactionJournal, JSON.stringify({
    version: 1,
    runId,
    status: "staging",
    transactionDirectory,
    entries: [{
      destination: paths.secretFiles.application,
      stagedPath,
      backupPath,
      existed: false,
    }],
  }));

  let byte = 1;
  await prepareStagingFiles({
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size) => Buffer.alloc(size, byte++),
    rotate: false,
    confirmedEmptyStagingData: false,
  });
  assert.equal(await fileExists(stagedPath), false);
  assert.equal(await fileExists(paths.transactionJournal), false);
  assert.equal((await readFile(paths.secretFiles.application, "utf8")).includes("synthetic plaintext runtime secret"), false);
});

test("prepare retry recovers a valid interrupted transaction before generating new outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-recover-"));
  const paths = await writePreparationFixture(root);
  const runId = "90000000-0000-4000-8000-000000000010";
  const transactionDirectory = path.join(path.dirname(paths.transactionJournal), `staging-prepare-${runId}`);
  const stagedPath = path.join(transactionDirectory, "0.staged");
  const backupPath = path.join(transactionDirectory, "0.backup");
  const originalEnvironment = await readFile(paths.environment, "utf8");
  await mkdir(transactionDirectory, { recursive: true });
  await writeFile(stagedPath, "synthetic staged output\n");
  await writeFile(backupPath, originalEnvironment);
  await writeFile(paths.environment, originalEnvironment.replace("migration:keep", "migration:interrupted"));
  await writeFile(paths.transactionJournal, JSON.stringify({
    version: 1,
    runId,
    status: "prepared",
    transactionDirectory,
    entries: [{
      destination: paths.environment,
      stagedPath,
      backupPath,
      existed: true,
    }],
  }));

  let byte = 1;
  await prepareStagingFiles({
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size) => Buffer.alloc(size, byte++),
    rotate: false,
    confirmedEmptyStagingData: false,
  });
  const recovered = await readFile(paths.environment, "utf8");
  assert.match(recovered, /migration:keep/);
  assert.equal(recovered.includes("migration:interrupted"), false);
  assert.equal(await fileExists(paths.transactionJournal), false);
});

test("rollback recovery is idempotent after cleanup removes backups and then fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-two-pass-recovery-"));
  const paths = await writePreparationFixture(root);
  const runId = "90000000-0000-4000-8000-000000000012";
  const transactionDirectory = path.join(path.dirname(paths.transactionJournal), `staging-prepare-${runId}`);
  const stagedPath = path.join(transactionDirectory, "0.staged");
  const backupPath = path.join(transactionDirectory, "0.backup");
  const blockerPath = path.join(transactionDirectory, "synthetic-cleanup-blocker");
  const originalEnvironment = await readFile(paths.environment, "utf8");
  await mkdir(transactionDirectory, { recursive: true });
  await writeFile(stagedPath, "synthetic staged output\n");
  await writeFile(backupPath, originalEnvironment);
  await writeFile(blockerPath, "force first cleanup to fail\n");
  await writeFile(paths.environment, originalEnvironment.replace("migration:keep", "migration:interrupted"));
  await writeFile(paths.transactionJournal, JSON.stringify({
    version: 1,
    runId,
    status: "prepared",
    transactionDirectory,
    entries: [{ destination: paths.environment, stagedPath, backupPath, existed: true }],
  }));

  await assert.rejects(prepareStagingFiles({
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size) => Buffer.alloc(size, 1),
    rotate: false,
    confirmedEmptyStagingData: false,
  }));
  assert.equal(await readFile(paths.environment, "utf8"), originalEnvironment);
  assert.equal((JSON.parse(await readFile(paths.transactionJournal, "utf8")) as { status: string }).status, "rolled_back");
  assert.equal(await fileExists(backupPath), false);

  await unlink(blockerPath);
  let byte = 1;
  await prepareStagingFiles({
    paths,
    confirmations: {
      application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
      ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
    },
    randomBytes: (size) => Buffer.alloc(size, byte++),
    rotate: false,
    confirmedEmptyStagingData: false,
  });
  assert.equal(await fileExists(paths.transactionJournal), false);
  assert.match(await readFile(paths.environment, "utf8"), /migration:keep/);
});

test("prepare refuses an invalid recovery journal without touching any destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-invalid-journal-"));
  const paths = await writePreparationFixture(root);
  const originalEnvironment = await readFile(paths.environment, "utf8");
  const runId = "90000000-0000-4000-8000-000000000011";
  const transactionDirectory = path.join(path.dirname(paths.transactionJournal), `staging-prepare-${runId}`);
  await writeFile(paths.transactionJournal, JSON.stringify({
    version: 1,
    runId,
    status: "prepared",
    transactionDirectory,
    entries: [{
      destination: path.join(root, "outside-staging-target.txt"),
      stagedPath: path.join(transactionDirectory, "0.staged"),
      backupPath: path.join(transactionDirectory, "0.backup"),
      existed: false,
    }],
  }));
  await assert.rejects(
    prepareStagingFiles({
      paths,
      confirmations: {
        application: "https://review-anchor-staging.review-anchor-staging-test.workers.dev",
        ingress: "https://review-anchor-staging-ingress.review-anchor-staging-test.workers.dev",
      },
      randomBytes: (size) => Buffer.alloc(size, 1),
      rotate: false,
      confirmedEmptyStagingData: false,
    }),
    /outside the exact staging preparation set/,
  );
  assert.equal(await readFile(paths.environment, "utf8"), originalEnvironment);
  assert.equal(await fileExists(path.join(root, "outside-staging-target.txt")), false);
  assert.equal(await fileExists(paths.transactionJournal), true);
});

function hyperdriveProvisionPaths(root: string): HyperdriveProvisionPaths {
  const prepared = preparationPaths(root);
  return {
    accountEvidence: prepared.accountEvidence,
    capacityEvidence: prepared.capacityEvidence,
    environment: prepared.environment,
    configs: {
      application: prepared.configs.application,
      ingress: prepared.configs.ingress,
      jobs: path.join(root, "cloudflare", "jobs", "wrangler.jsonc"),
    },
  };
}

async function writeHyperdriveFixture(root: string) {
  const paths = hyperdriveProvisionPaths(root);
  await mkdir(path.dirname(paths.accountEvidence), { recursive: true });
  await mkdir(path.dirname(paths.capacityEvidence), { recursive: true });
  for (const configPath of Object.values(paths.configs)) await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(paths.accountEvidence, JSON.stringify(accountEvidence()));
  await writeFile(paths.capacityEvidence, JSON.stringify(capacityEvidence()));
  await writeFile(paths.environment, Object.entries(capacityEnvironment()).map(([name, value]) => `${name}=${value}`).join("\n"));
  await writeFile(paths.configs.application, syntheticWranglerConfig("review-anchor-staging"));
  await writeFile(paths.configs.ingress, syntheticWranglerConfig("review-anchor-staging-ingress"));
  await writeFile(paths.configs.jobs, syntheticWranglerConfig("review-anchor-staging-jobs"));
  return paths;
}

function hyperdriveResource(index: number) {
  const spec = HYPERDRIVE_SPECS[index];
  const role = [...EXPECTED_DATABASE_ROLES.values()][index];
  return {
    id: `${index + 1}`.repeat(32),
    name: spec.name,
    origin: {
      host: DIRECT_DATABASE_HOST,
      database: "postgres",
      user: role,
      port: 5432,
      scheme: "postgresql",
    },
    caching: { disabled: true },
    origin_connection_limit: 5,
    sslmode: "require",
  };
}

function hyperdriveDescriptor(index: number) {
  const resource = hyperdriveResource(index);
  const spec = HYPERDRIVE_SPECS[index];
  return {
    binding: spec.binding,
    name: spec.name,
    host: resource.origin.host,
    database: resource.origin.database,
    user: resource.origin.user,
    port: 5432,
    sslmode: "require",
    cachingDisabled: true,
    originConnectionLimit: 5,
  };
}

function capturedHyperdriveList(resources: Array<ReturnType<typeof hyperdriveResource>>) {
  if (resources.length === 0) return CAPTURED_EMPTY_HYPERDRIVE_LIST;
  const border = "┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐";
  const middle = "├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤";
  const bottom = "└─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘";
  const row = (values: Array<string | number>) => `│ ${values.join(" │ ")} │`;
  return [
    "📋 Listing Hyperdrive configs",
    border,
    row(["id", "name", "user", "host", "port", "scheme", "database", "caching", "mtls", "origin_connection_limit"]),
    middle,
    ...resources.map((resource) => row([
      resource.id,
      resource.name,
      resource.origin.user,
      resource.origin.host,
      resource.origin.port,
      "PostgreSQL",
      resource.origin.database,
      resource.caching.disabled ? "disabled" : "enabled",
      "",
      resource.origin_connection_limit,
    ])),
    bottom,
    "",
  ].join("\n");
}

function capturedCreate(resource: ReturnType<typeof hyperdriveResource>) {
  return [
    `🚧 Creating '${resource.name}'`,
    `✅ Created new Hyperdrive PostgreSQL config: ${resource.id}`,
    "To access your new Hyperdrive Config in your Worker, add the following snippet to your configuration file:",
    "{",
    '  "hyperdrive": [',
    "    {",
    '      "binding": "HYPERDRIVE",',
    `      "id": "${resource.id}"`,
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n");
}

function whoamiResult(accountId = accountEvidence().accountId) {
  return JSON.stringify({ loggedIn: true, accounts: [{ id: accountId, name: "Synthetic account" }] });
}

const SYNTHETIC_RUN_ID = "90000000-0000-4000-8000-000000000001";

test("Hyperdrive provisioning re-verifies account ownership and reuses exact resources without create calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-reuse-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  await provisionHyperdrives({
    cwd: root,
    paths,
    runIdFactory: () => SYNTHETIC_RUN_ID,
    runner: async (invocation) => {
      invocations.push(invocation);
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("list")) {
        return {
          exitCode: 0,
          stdout: capturedHyperdriveList(HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index))),
          stderr: "",
        };
      }
      if (invocation.args.includes("get")) {
        const id = invocation.args.at(-1);
        const resource = HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)).find((candidate) => candidate.id === id);
        return { exitCode: 0, stdout: JSON.stringify(resource, null, 2), stderr: "" };
      }
      throw new Error("A create call was not expected");
    },
  });

  assert.equal(invocations.filter((invocation) => invocation.args.includes("create")).length, 0);
  assert.deepEqual(invocations[0]?.args.slice(-2), ["whoami", "--json"]);
  assert.deepEqual(invocations[1]?.args.slice(-2), ["hyperdrive", "list"]);
  assert.equal(invocations[1]?.environment.CLOUDFLARE_ACCOUNT_ID, accountEvidence().accountId);
  const evidence = JSON.parse(await readFile(paths.accountEvidence, "utf8")) as AccountEvidence;
  const operation = (evidence as unknown as { hyperdriveOperation: { runId: string; status: string; resources: Record<string, { disposition: string; id: string; runId: string }> } }).hyperdriveOperation;
  assert.equal(operation.runId, SYNTHETIC_RUN_ID);
  assert.equal(operation.status, "complete");
  assert.ok(Object.values(operation.resources).every((resource) => resource.disposition === "reused" && resource.runId === SYNTHETIC_RUN_ID));
  assert.equal((JSON.parse(await readFile(paths.configs.application, "utf8")) as { hyperdrive: unknown[] }).hyperdrive.length, 2);
});

test("Hyperdrive provisioning creates four missing resources with redacted fail-closed commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-create-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  await provisionHyperdrives({
    cwd: root,
    paths,
    runIdFactory: () => SYNTHETIC_RUN_ID,
    runner: async (invocation) => {
      invocations.push(invocation);
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("list")) return { exitCode: 0, stdout: CAPTURED_EMPTY_HYPERDRIVE_LIST, stderr: "" };
      if (invocation.args.includes("get")) {
        const id = invocation.args.at(-1);
        const resource = HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)).find((candidate) => candidate.id === id);
        return { exitCode: 0, stdout: JSON.stringify(resource, null, 2), stderr: "" };
      }
      const name = invocation.args[invocation.args.indexOf("create") + 1];
      const index = HYPERDRIVE_SPECS.findIndex((spec) => spec.name === name);
      const evidence = JSON.parse(await readFile(paths.accountEvidence, "utf8")) as {
        hyperdriveOperation: { resources: Record<string, { attempted: boolean; runId: string; state: string }> };
      };
      const pending = evidence.hyperdriveOperation.resources[HYPERDRIVE_SPECS[index].binding];
      assert.deepEqual({ attempted: pending.attempted, runId: pending.runId, state: pending.state }, {
        attempted: true,
        runId: SYNTHETIC_RUN_ID,
        state: "pending",
      });
      return { exitCode: 0, stdout: capturedCreate(hyperdriveResource(index)), stderr: "" };
    },
  });

  const creates = invocations.filter((invocation) => invocation.args.includes("create"));
  assert.equal(creates.length, 4);
  assert.ok(creates.every((invocation) => invocation.environment.CLOUDFLARE_ACCOUNT_ID === accountEvidence().accountId));
  assert.ok(creates.every((invocation) => invocation.args.includes("--password")));
  assert.ok(creates.every((invocation) => !invocation.args.some((value) => value.includes("postgresql://"))));
  const tracked = await Promise.all(Object.values(paths.configs).map((filePath) => readFile(filePath, "utf8")));
  assert.equal(tracked.some((contents) => contents.includes("hyperdrive-password")), false);
  const evidence = JSON.parse(await readFile(paths.accountEvidence, "utf8")) as {
    hyperdriveOperation: { runId: string; status: string; resources: Record<string, { disposition: string; id: string; runId: string }> };
  };
  assert.equal(evidence.hyperdriveOperation.status, "complete");
  assert.ok(Object.values(evidence.hyperdriveOperation.resources).every((resource) => resource.disposition === "created" && resource.runId === SYNTHETIC_RUN_ID));
});

test("cleanup helpers return only current-run created resources and refuse reused or foreign-run targets", async () => {
  const provisionModule = await import("../scripts/cloudflare/provision.js") as typeof import("../scripts/cloudflare/provision.js") & {
    assertHyperdriveCleanupTarget?: (evidence: unknown, runId: string, binding: string, id: string) => unknown;
    createdHyperdriveCleanupTargets?: (evidence: unknown, runId: string) => Array<{ binding: string; id: string }>;
  };
  assert.equal(typeof provisionModule.createdHyperdriveCleanupTargets, "function");
  assert.equal(typeof provisionModule.assertHyperdriveCleanupTarget, "function");
  const evidence = {
    ...accountEvidence(),
    hyperdriveOperation: {
      runId: SYNTHETIC_RUN_ID,
      startedAt: new Date().toISOString(),
      status: "complete",
      resources: Object.fromEntries(HYPERDRIVE_SPECS.map((spec, index) => [spec.binding, {
        descriptor: hyperdriveDescriptor(index),
        state: "resolved",
        attempted: index === 0,
        id: hyperdriveResource(index).id,
        disposition: index === 0 ? "created" : "reused",
        runId: SYNTHETIC_RUN_ID,
      }])),
    },
  };
  assert.deepEqual(provisionModule.createdHyperdriveCleanupTargets?.(evidence, SYNTHETIC_RUN_ID), [
    { binding: "AUTH_DB", id: "11".repeat(16) },
  ]);
  assert.throws(
    () => provisionModule.assertHyperdriveCleanupTarget?.(evidence, SYNTHETIC_RUN_ID, "RUNTIME_DB", hyperdriveResource(1).id),
    /reused/,
  );
  assert.throws(
    () => provisionModule.assertHyperdriveCleanupTarget?.(evidence, "90000000-0000-4000-8000-000000000099", "AUTH_DB", "11".repeat(16)),
    /foreign run/,
  );
});

test("a concurrent resource appearing after ambiguous create is reused and cleanup-ineligible", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-ambiguous-"));
  const paths = await writeHyperdriveFixture(root);
  let listCount = 0;
  let createCount = 0;
  const created = HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index));
  await provisionHyperdrives({
    cwd: root,
    paths,
    runIdFactory: () => SYNTHETIC_RUN_ID,
    runner: async (invocation) => {
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("list")) {
        listCount += 1;
        return { exitCode: 0, stdout: listCount === 1 ? CAPTURED_EMPTY_HYPERDRIVE_LIST : capturedHyperdriveList(created.slice(0, 1)), stderr: "" };
      }
      if (invocation.args.includes("get")) {
        const resource = created.find((candidate) => candidate.id === invocation.args.at(-1));
        return { exitCode: 0, stdout: JSON.stringify(resource, null, 2), stderr: "" };
      }
      createCount += 1;
      if (createCount === 1) return { exitCode: 1, stdout: "ambiguous", stderr: "ambiguous" };
      const name = invocation.args[invocation.args.indexOf("create") + 1];
      const resource = created[HYPERDRIVE_SPECS.findIndex((spec) => spec.name === name)];
      return { exitCode: 0, stdout: capturedCreate(resource), stderr: "" };
    },
  });
  assert.equal(createCount, 4);
  assert.equal(listCount, 2);
  const evidence = JSON.parse(await readFile(paths.accountEvidence, "utf8")) as AccountEvidence;
  const operation = evidence.hyperdriveOperation;
  assert.ok(operation);
  assert.equal(operation.resources.AUTH_DB.disposition, "reused");
  assert.equal(operation.resources.AUTH_DB.attempted, true);
  assert.equal(createdHyperdriveCleanupTargets(evidence, SYNTHETIC_RUN_ID).some(({ binding }) => binding === "AUTH_DB"), false);
  assert.throws(
    () => assertHyperdriveCleanupTarget(evidence, SYNTHETIC_RUN_ID, "AUTH_DB", created[0].id),
    /reused/,
  );
});

test("resume after an attempted create treats a newly listed resource as reused and never cleanup-owned", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-resume-conflict-"));
  const paths = await writeHyperdriveFixture(root);
  const resources = HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index));
  await writeFile(paths.accountEvidence, JSON.stringify({
    ...accountEvidence(),
    hyperdriveOperation: {
      runId: SYNTHETIC_RUN_ID,
      startedAt: new Date().toISOString(),
      status: "pending",
      resources: Object.fromEntries(HYPERDRIVE_SPECS.map((spec, index) => [spec.binding, index === 0
        ? {
            descriptor: hyperdriveDescriptor(index),
            state: "pending",
            attempted: true,
            runId: SYNTHETIC_RUN_ID,
          }
        : {
            descriptor: hyperdriveDescriptor(index),
            state: "resolved",
            attempted: false,
            id: resources[index].id,
            disposition: "reused",
            runId: SYNTHETIC_RUN_ID,
          }])),
    },
  }));
  let createCount = 0;
  await provisionHyperdrives({
    cwd: root,
    paths,
    runner: async (invocation) => {
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("list")) return { exitCode: 0, stdout: capturedHyperdriveList(resources), stderr: "" };
      if (invocation.args.includes("get")) {
        const resource = resources.find(({ id }) => id === invocation.args.at(-1));
        return { exitCode: 0, stdout: JSON.stringify(resource, null, 2), stderr: "" };
      }
      createCount += 1;
      return { exitCode: 0, stdout: capturedCreate(resources[0]), stderr: "" };
    },
  });
  assert.equal(createCount, 0);
  const evidence = JSON.parse(await readFile(paths.accountEvidence, "utf8")) as AccountEvidence;
  assert.equal(evidence.hyperdriveOperation?.resources.AUTH_DB.disposition, "reused");
  assert.equal(createdHyperdriveCleanupTargets(evidence, SYNTHETIC_RUN_ID).length, 0);
  assert.throws(
    () => assertHyperdriveCleanupTarget(evidence, SYNTHETIC_RUN_ID, "AUTH_DB", resources[0].id),
    /reused/,
  );
});

test("malformed get output and unresolved ambiguous create fail closed without a second create on retry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-unresolved-"));
  const paths = await writeHyperdriveFixture(root);
  let createCount = 0;
  const runner = async (invocation: WranglerInvocation) => {
    if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
    if (invocation.args.includes("list")) return { exitCode: 0, stdout: CAPTURED_EMPTY_HYPERDRIVE_LIST, stderr: "" };
    if (invocation.args.includes("get")) return { exitCode: 0, stdout: "malformed get", stderr: "" };
    createCount += 1;
    return { exitCode: 0, stdout: "ambiguous create", stderr: "" };
  };
  await assert.rejects(
    provisionHyperdrives({ cwd: root, paths, runIdFactory: () => SYNTHETIC_RUN_ID, runner }),
    /ambiguous create could not be reconciled/,
  );
  await assert.rejects(
    provisionHyperdrives({ cwd: root, paths, runIdFactory: () => "90000000-0000-4000-8000-000000000002", runner }),
    /pending mutation.*manual reconciliation/i,
  );
  assert.equal(createCount, 1);
});

test("mutation evidence is revalidated immediately before create", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-stale-before-create-"));
  const checkedAt = "2026-07-20T12:00:00.000Z";
  const paths = await writeHyperdriveFixture(root);
  await writeFile(paths.accountEvidence, JSON.stringify(accountEvidence(checkedAt)));
  await writeFile(paths.capacityEvidence, JSON.stringify(capacityEvidence(checkedAt)));
  let clockCalls = 0;
  let createCount = 0;
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      runIdFactory: () => SYNTHETIC_RUN_ID,
      now: () => ++clockCalls === 1 ? Date.parse("2026-07-20T12:05:00.000Z") : Date.parse("2026-07-20T13:00:00.000Z"),
      runner: async (invocation) => {
        if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
        if (invocation.args.includes("list")) return { exitCode: 0, stdout: CAPTURED_EMPTY_HYPERDRIVE_LIST, stderr: "" };
        createCount += 1;
        return { exitCode: 0, stdout: "should not run", stderr: "" };
      },
    }),
    /stale/,
  );
  assert.equal(createCount, 0);
});

test("unsupported Wrangler version fails before authentication or resource commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-version-"));
  const paths = await writeHyperdriveFixture(root);
  let invocationCount = 0;
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      wranglerVersion: "4.113.0",
      runner: async () => {
        invocationCount += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    }),
    /unsupported Wrangler version/,
  );
  assert.equal(invocationCount, 0);
});

test("Hyperdrive provisioning stops before list or mutation on the wrong authenticated account", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-account-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      runner: async (invocation) => {
        invocations.push(invocation);
        return { exitCode: 0, stdout: whoamiResult("cd".repeat(16)), stderr: "" };
      },
    }),
    /authenticated Cloudflare account does not match/,
  );
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0]?.args, buildWranglerWhoamiInvocation(root).args);
});

test("Hyperdrive provisioning refuses same-name drift before any create", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-drift-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      runner: async (invocation) => {
        invocations.push(invocation);
        if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
        if (invocation.args.includes("list")) return { exitCode: 0, stdout: capturedHyperdriveList([hyperdriveResource(0)]), stderr: "" };
        return { exitCode: 0, stdout: JSON.stringify({ ...hyperdriveResource(0), origin_connection_limit: 6 }, null, 2), stderr: "" };
      },
    }),
    /same-name Hyperdrive does not match/,
  );
  assert.equal(invocations.filter((invocation) => invocation.args.includes("create")).length, 0);
});

test("Hyperdrive provisioning refuses recorded resource-ID drift before any create", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-id-drift-"));
  const paths = await writeHyperdriveFixture(root);
  await writeFile(paths.accountEvidence, JSON.stringify({
    ...accountEvidence(),
    hyperdriveOperation: {
      runId: SYNTHETIC_RUN_ID,
      startedAt: new Date().toISOString(),
      status: "complete",
      resources: Object.fromEntries(HYPERDRIVE_SPECS.map((spec, index) => [spec.binding, {
        descriptor: hyperdriveDescriptor(index),
        state: "resolved",
        attempted: false,
        id: index === 0 ? "aa".repeat(16) : hyperdriveResource(index).id,
        disposition: "reused",
        runId: SYNTHETIC_RUN_ID,
      }])),
    },
  }));
  const invocations: WranglerInvocation[] = [];
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      runner: async (invocation) => {
        invocations.push(invocation);
        if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
        if (invocation.args.includes("list")) return { exitCode: 0, stdout: capturedHyperdriveList(HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index))), stderr: "" };
        const id = invocation.args.at(-1);
        const resource = HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)).find((candidate) => candidate.id === id);
        return { exitCode: 0, stdout: JSON.stringify(resource, null, 2), stderr: "" };
      },
    }),
    /recorded AUTH_DB Hyperdrive ID does not match/,
  );
  assert.equal(invocations.filter((invocation) => invocation.args.includes("create")).length, 0);
});

test("Hyperdrive child failures never expose passwords or child output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-redact-"));
  const paths = await writeHyperdriveFixture(root);
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      runner: async (invocation) => {
        if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
        if (invocation.args.includes("list")) return { exitCode: 0, stdout: CAPTURED_EMPTY_HYPERDRIVE_LIST, stderr: "" };
        return {
          exitCode: 1,
          stdout: "auth-hyperdrive-password",
          stderr: `failed at ${DIRECT_DATABASE_HOST} with auth-hyperdrive-password`,
        };
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("auth-hyperdrive-password"), false);
      assert.equal(error.message.includes(DIRECT_DATABASE_HOST), false);
      assert.match(error.message, /create command failed safely/);
      return true;
    },
  );
});

test("provision command dispatches hyperdrive through the authenticated gated executor", async () => {
  const provisionModule = await import("../scripts/cloudflare/provision.js") as typeof import("../scripts/cloudflare/provision.js") & {
    runProvisionCommand?: (
      args: string[],
      context: {
        cwd: string;
        hyperdrivePaths: HyperdriveProvisionPaths;
        runner: (invocation: WranglerInvocation) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
      },
    ) => Promise<string>;
  };
  assert.equal(typeof provisionModule.runProvisionCommand, "function");

  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-cli-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  const message = await provisionModule.runProvisionCommand?.(["hyperdrive"], {
    cwd: root,
    hyperdrivePaths: paths,
    runner: async (invocation) => {
      invocations.push(invocation);
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("get")) {
        const id = invocation.args.at(-1);
        const resource = HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)).find((candidate) => candidate.id === id);
        return { exitCode: 0, stdout: JSON.stringify(resource, null, 2), stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: capturedHyperdriveList(HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index))),
        stderr: "",
      };
    },
  });

  assert.equal(message, "Bound four verified Cloudflare staging Hyperdrives.");
  assert.equal(invocations.length, 6);
});
