import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  deriveWorkersDevOrigins,
  parseHyperdriveListOutput,
  patchEnvironmentText,
  patchHyperdriveBindings,
  patchOriginConfigs,
  prepareStagingFiles,
  provisionHyperdrives,
  redactWranglerInvocation,
  restoreCompatibilityConfig,
  selectReusableHyperdrive,
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
  assert.match(gitignore, /^\.cloudflare\/evidence\/$/m);
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

function accountEvidence(): AccountEvidence {
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
  };
}

function capacityEvidence() {
  return {
    version: 1 as const,
    passed: true as const,
    projectRef,
    checkedAt: "2026-07-20T12:00:00.000Z",
    maxConnections: 40,
    activeConnections: 16,
    availableConnections: 24,
    threshold: 24 as const,
    roles: [...EXPECTED_DATABASE_ROLES.values()],
    tableCounts: Object.fromEntries(ROTATION_SENSITIVE_TABLES.map((table) => [table, 0])),
  };
}

test("account and capacity evidence require the exact verified free staging boundary", () => {
  assert.deepEqual(validateAccountEvidence(accountEvidence()), accountEvidence());
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
    /24 available/,
  );
  assert.throws(
    () => validateCapacityEvidence({
      ...capacityEvidence(),
      tableCounts: { ...capacityEvidence().tableCounts, review_requests: 1 },
    }),
    /review_requests=1/,
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

test("Hyperdrive commands use separate direct-origin arguments and redact passwords", () => {
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
  assert.equal(invocation.args.some((value) => value.includes("postgresql://")), false);
  assert.equal(invocation.args.includes("MIGRATION_DATABASE_URL"), false);

  const safe = redactWranglerInvocation(invocation);
  assert.equal(JSON.stringify(safe).includes("auth-hyperdrive-password"), false);
  assert.match(JSON.stringify(safe), /\[REDACTED\]/);
  const list = buildHyperdriveListInvocation("C:\\synthetic-workspace");
  assert.deepEqual(list.args.slice(-3), ["hyperdrive", "list", "--json"]);
});

test("Hyperdrive list parsing reuses only exact sanitized staging metadata", () => {
  const settings = validateCapacityEnvironment(capacityEnvironment());
  const spec = HYPERDRIVE_SPECS[0];
  const origin = settings.hyperdriveOrigins.AUTH_DB;
  const exact = {
    id: "12".repeat(16),
    name: spec.name,
    origin: {
      host: origin.host,
      database: origin.database,
      user: origin.user,
      port: origin.port,
      scheme: "postgresql",
    },
    caching: { disabled: true },
    origin_connection_limit: 5,
    sslmode: "require",
  };
  const parsed = parseHyperdriveListOutput(JSON.stringify({ success: true, result: [exact] }));
  assert.equal(selectReusableHyperdrive(parsed, spec, origin), exact.id);
  assert.equal(selectReusableHyperdrive([], spec, origin), undefined);
  assert.throws(
    () => selectReusableHyperdrive([{ ...exact, origin_connection_limit: 6 }], spec, origin),
    /same-name Hyperdrive does not match/,
  );
  assert.throws(
    () => parseHyperdriveListOutput("not json and possibly secret-bearing output"),
    /valid Wrangler JSON/,
  );
});

function preparationPaths(root: string): PreparationPaths {
  return {
    environment: path.join(root, ".env.staging"),
    accountEvidence: path.join(root, ".cloudflare", "staging-resource-ids.json"),
    capacityEvidence: path.join(root, ".cloudflare", "evidence", "capacity.json"),
    preRotationSecrets: path.join(root, ".cloudflare", "pre-rotation-secrets.json"),
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

function whoamiResult(accountId = accountEvidence().accountId) {
  return JSON.stringify({ loggedIn: true, accounts: [{ id: accountId, name: "Synthetic account" }] });
}

test("Hyperdrive provisioning re-verifies account ownership and reuses exact resources without create calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-reuse-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  await provisionHyperdrives({
    cwd: root,
    paths,
    runner: async (invocation) => {
      invocations.push(invocation);
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("list")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            success: true,
            result: [
              {
                ...hyperdriveResource(0),
                id: "ff".repeat(16),
                name: "unrelated-production-resource",
              },
              ...HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)),
            ],
          }),
          stderr: "",
        };
      }
      throw new Error("A create call was not expected");
    },
  });

  assert.equal(invocations.filter((invocation) => invocation.args.includes("create")).length, 0);
  assert.deepEqual(invocations[0]?.args.slice(-2), ["whoami", "--json"]);
  assert.deepEqual(invocations[1]?.args.slice(-3), ["hyperdrive", "list", "--json"]);
  assert.equal(invocations[1]?.environment.CLOUDFLARE_ACCOUNT_ID, accountEvidence().accountId);
  const evidence = JSON.parse(await readFile(paths.accountEvidence, "utf8")) as AccountEvidence;
  assert.deepEqual(evidence.hyperdrives, Object.fromEntries(HYPERDRIVE_SPECS.map((spec, index) => [spec.binding, hyperdriveResource(index).id])));
  assert.equal((JSON.parse(await readFile(paths.configs.application, "utf8")) as { hyperdrive: unknown[] }).hyperdrive.length, 2);
});

test("Hyperdrive provisioning creates four missing resources with redacted fail-closed commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-anchor-stage-a-create-"));
  const paths = await writeHyperdriveFixture(root);
  const invocations: WranglerInvocation[] = [];
  await provisionHyperdrives({
    cwd: root,
    paths,
    runner: async (invocation) => {
      invocations.push(invocation);
      if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
      if (invocation.args.includes("list")) return { exitCode: 0, stdout: JSON.stringify({ success: true, result: [] }), stderr: "" };
      const name = invocation.args[invocation.args.indexOf("create") + 1];
      const index = HYPERDRIVE_SPECS.findIndex((spec) => spec.name === name);
      return { exitCode: 0, stdout: JSON.stringify({ success: true, result: hyperdriveResource(index) }), stderr: "" };
    },
  });

  const creates = invocations.filter((invocation) => invocation.args.includes("create"));
  assert.equal(creates.length, 4);
  assert.ok(creates.every((invocation) => invocation.environment.CLOUDFLARE_ACCOUNT_ID === accountEvidence().accountId));
  assert.ok(creates.every((invocation) => invocation.args.includes("--password")));
  assert.ok(creates.every((invocation) => !invocation.args.some((value) => value.includes("postgresql://"))));
  const tracked = await Promise.all(Object.values(paths.configs).map((filePath) => readFile(filePath, "utf8")));
  assert.equal(tracked.some((contents) => contents.includes("hyperdrive-password")), false);
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
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            success: true,
            result: [{ ...hyperdriveResource(0), origin_connection_limit: 6 }],
          }),
          stderr: "",
        };
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
    hyperdrives: { AUTH_DB: "aa".repeat(16) },
  }));
  const invocations: WranglerInvocation[] = [];
  await assert.rejects(
    provisionHyperdrives({
      cwd: root,
      paths,
      runner: async (invocation) => {
        invocations.push(invocation);
        if (invocation.args.includes("whoami")) return { exitCode: 0, stdout: whoamiResult(), stderr: "" };
        return {
          exitCode: 0,
          stdout: JSON.stringify({ success: true, result: HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)) }),
          stderr: "",
        };
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
        if (invocation.args.includes("list")) return { exitCode: 0, stdout: JSON.stringify({ success: true, result: [] }), stderr: "" };
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
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          success: true,
          result: HYPERDRIVE_SPECS.map((_, index) => hyperdriveResource(index)),
        }),
        stderr: "",
      };
    },
  });

  assert.equal(message, "Bound four verified Cloudflare staging Hyperdrives.");
  assert.equal(invocations.length, 2);
});
