import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { databaseTlsOptions } from "../../server/database-tls.js";
import { loadLocalEnvironment } from "../../server/load-env.js";

const { Client } = pg;

export const STAGING_PROJECT_REF = "cwwgvkepocldophqzijf" as const;
export const DIRECT_DATABASE_HOST = `db.${STAGING_PROJECT_REF}.supabase.co` as const;
export const CAPACITY_THRESHOLD = 24;
export const EXPECTED_DATABASE_ROLES = new Map([
  ["AUTH_DB", "afterword_auth_login"],
  ["RUNTIME_DB", "afterword_runtime_login"],
  ["INGRESS_DB", "afterword_ingress_login"],
  ["WORKER_DB", "afterword_worker_login"],
] as const);
export const ROTATION_SENSITIVE_TABLES = [
  "customer_contacts",
  "review_requests",
  "message_dispatch_payloads",
  "integration_secrets",
  "oauth_authorization_states",
  "google_profile_selection_states",
  "provider_webhook_events",
  "oauth_token_revocations",
  "channel_suppressions",
  "ingress_events",
  "qr_scan_events",
] as const;

type DatabaseBinding = typeof EXPECTED_DATABASE_ROLES extends Map<infer Binding, string> ? Binding : never;
type RotationSensitiveTable = typeof ROTATION_SENSITIVE_TABLES[number];

const ROLE_ENVIRONMENT = {
  AUTH_DB: { password: "AUTH_DATABASE_PASSWORD", url: "AUTH_DATABASE_URL" },
  RUNTIME_DB: { password: "RUNTIME_DATABASE_PASSWORD", url: "RUNTIME_DATABASE_URL" },
  INGRESS_DB: { password: "INGRESS_DATABASE_PASSWORD", url: "INGRESS_DATABASE_URL" },
  WORKER_DB: { password: "WORKER_DATABASE_PASSWORD", url: "WORKER_DATABASE_URL" },
} as const satisfies Record<DatabaseBinding, { password: string; url: string }>;

const TABLE_IDENTITIES: Record<RotationSensitiveTable, string> = {
  customer_contacts: "public.customer_contacts",
  review_requests: "public.review_requests",
  message_dispatch_payloads: "app_private.message_dispatch_payloads",
  integration_secrets: "app_private.integration_secrets",
  oauth_authorization_states: "app_private.oauth_authorization_states",
  google_profile_selection_states: "app_private.google_profile_selection_states",
  provider_webhook_events: "app_private.provider_webhook_events",
  oauth_token_revocations: "app_private.oauth_token_revocations",
  channel_suppressions: "public.channel_suppressions",
  ingress_events: "public.ingress_events",
  qr_scan_events: "public.qr_scan_events",
};

export interface HyperdriveOrigin {
  cachingDisabled: true;
  database: "postgres";
  host: typeof DIRECT_DATABASE_HOST;
  originConnectionLimit: 5;
  password: string;
  port: 5432;
  sslmode: "require";
  user: string;
}

export interface CapacitySettings {
  capacityThreshold: typeof CAPACITY_THRESHOLD;
  certificatePath: string;
  dedicatedRoleUrls: Record<DatabaseBinding, string>;
  hyperdriveOrigins: Record<DatabaseBinding, HyperdriveOrigin>;
  migrationDatabaseUrl: string;
  poolerHost: string;
  projectRef: typeof STAGING_PROJECT_REF;
}

export interface CapacityEvidence {
  activeConnections: number;
  availableConnections: number;
  checkedAt: string;
  maxConnections: number;
  passed: true;
  projectRef: typeof STAGING_PROJECT_REF;
  roles: string[];
  tableCounts: Record<RotationSensitiveTable, number>;
  threshold: typeof CAPACITY_THRESHOLD;
  version: 1;
}

export interface CapacityQueryClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query<Row extends Record<string, unknown>>(sql: string): Promise<{ rows: Row[] }>;
}

export interface CapacityClientInput {
  connectionString: string;
  expectedRole?: string;
}

export type CapacityClientFactory = (input: CapacityClientInput) => CapacityQueryClient;

class SafeCapacityError extends Error {}

function assertSafe(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SafeCapacityError(message);
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string) {
  const value = environment[name]?.trim();
  assertSafe(value, `${name} is required for the staging capacity gate.`);
  return value;
}

function validateDatabaseUrl(value: string, expectedRole: string, poolerHost: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SafeCapacityError("A staging database URL is invalid.");
  }
  const username = decodeURIComponent(parsed.username);
  const directIdentity = parsed.hostname.toLowerCase() === DIRECT_DATABASE_HOST
    && username === expectedRole;
  const poolerIdentity = parsed.hostname.toLowerCase() === poolerHost
    && username === `${expectedRole}.${STAGING_PROJECT_REF}`;
  assertSafe(
    /^postgres(?:ql)?:$/.test(parsed.protocol)
      && (directIdentity || poolerIdentity)
      && parsed.port === "5432"
      && parsed.pathname === "/postgres"
      && Boolean(parsed.password)
      && parsed.search === ""
      && parsed.hash === "",
    `The ${expectedRole} database identity is not restricted to the Review Anchor staging project.`,
  );
  return value;
}

export function validateCapacityEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): CapacitySettings {
  assertSafe(
    environment.SUPABASE_PROJECT_REF === STAGING_PROJECT_REF,
    "The capacity gate is restricted to the Review Anchor staging project.",
  );
  assertSafe(environment.DATABASE_SSL === "require", "TLS mode require is mandatory for the capacity gate.");
  const certificatePath = required(environment, "DATABASE_CA_CERT_PATH");
  const poolerHost = required(environment, "SUPABASE_POOLER_HOST").toLowerCase();
  assertSafe(
    /^aws-[01]-[a-z0-9-]+\.pooler\.supabase\.com$/.test(poolerHost),
    "The Supabase pooler hostname is not an exact supported staging hostname.",
  );

  const migrationDatabaseUrl = validateDatabaseUrl(
    required(environment, "MIGRATION_DATABASE_URL"),
    "afterword_migration_login",
    poolerHost,
  );
  const dedicatedRoleUrls = {} as Record<DatabaseBinding, string>;
  const hyperdriveOrigins = {} as Record<DatabaseBinding, HyperdriveOrigin>;
  for (const [binding, expectedRole] of EXPECTED_DATABASE_ROLES) {
    const names = ROLE_ENVIRONMENT[binding];
    dedicatedRoleUrls[binding] = validateDatabaseUrl(required(environment, names.url), expectedRole, poolerHost);
    hyperdriveOrigins[binding] = {
      cachingDisabled: true,
      database: "postgres",
      host: DIRECT_DATABASE_HOST,
      originConnectionLimit: 5,
      password: required(environment, names.password),
      port: 5432,
      sslmode: "require",
      user: expectedRole,
    };
  }
  return {
    capacityThreshold: CAPACITY_THRESHOLD,
    certificatePath,
    dedicatedRoleUrls,
    hyperdriveOrigins,
    migrationDatabaseUrl,
    poolerHost,
    projectRef: STAGING_PROJECT_REF,
  };
}

async function withClient<T>(client: CapacityQueryClient, operation: () => Promise<T>) {
  try {
    await client.connect();
    return await operation();
  } finally {
    await client.end().catch(() => undefined);
  }
}

function numeric(value: unknown, description: string) {
  const number = Number(value);
  assertSafe(Number.isSafeInteger(number) && number >= 0, `${description} returned an invalid count.`);
  return number;
}

export async function runCapacityPreflight(
  settings: CapacitySettings,
  createClient: CapacityClientFactory,
): Promise<CapacityEvidence> {
  let maxConnections = 0;
  let activeConnections = 0;
  const tableCounts = {} as Record<RotationSensitiveTable, number>;
  try {
    const migrationClient = createClient({ connectionString: settings.migrationDatabaseUrl });
    await withClient(migrationClient, async () => {
      const capacity = await migrationClient.query<{
        active_connections: unknown;
        max_connections: unknown;
      }>(
        "select current_setting('max_connections')::int as max_connections, (select count(*)::int from pg_stat_activity) as active_connections",
      );
      maxConnections = numeric(capacity.rows[0]?.max_connections, "PostgreSQL max_connections");
      activeConnections = numeric(capacity.rows[0]?.active_connections, "PostgreSQL pg_stat_activity");
      const available = maxConnections - activeConnections;
      assertSafe(
        available >= settings.capacityThreshold,
        `The staging database must have at least ${settings.capacityThreshold} available direct connections; ${available} are available.`,
      );
      for (const table of ROTATION_SENSITIVE_TABLES) {
        const result = await migrationClient.query<{ row_count: unknown }>(
          `select count(*)::int as row_count from ${TABLE_IDENTITIES[table]}`,
        );
        tableCounts[table] = numeric(result.rows[0]?.row_count, `${table} row count`);
      }
      const nonEmpty = ROTATION_SENSITIVE_TABLES
        .filter((table) => tableCounts[table] !== 0)
        .map((table) => `${table}=${tableCounts[table]}`);
      assertSafe(
        nonEmpty.length === 0,
        `Rotation-sensitive staging tables are not empty: ${nonEmpty.join(", ")}.`,
      );
    });

    const roles: string[] = [];
    for (const [binding, expectedRole] of EXPECTED_DATABASE_ROLES) {
      const client = createClient({
        connectionString: settings.dedicatedRoleUrls[binding],
        expectedRole,
      });
      await withClient(client, async () => {
        const result = await client.query<{ current_user: unknown }>("select current_user");
        assertSafe(
          result.rows[0]?.current_user === expectedRole,
          `The ${binding} role identity did not match its exact staging login.`,
        );
        roles.push(expectedRole);
      });
    }

    return {
      activeConnections,
      availableConnections: maxConnections - activeConnections,
      checkedAt: new Date().toISOString(),
      maxConnections,
      passed: true,
      projectRef: STAGING_PROJECT_REF,
      roles,
      tableCounts,
      threshold: CAPACITY_THRESHOLD,
      version: 1,
    };
  } catch (error) {
    if (error instanceof SafeCapacityError) throw error;
    throw new SafeCapacityError("The staging capacity gate failed without exposing database details.");
  }
}

export function redactSensitive(
  value: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  let result = value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED]");
  const sensitiveNames = [
    "MIGRATION_DATABASE_URL",
    "AUTH_DATABASE_URL",
    "RUNTIME_DATABASE_URL",
    "INGRESS_DATABASE_URL",
    "WORKER_DATABASE_URL",
    "AUTH_DATABASE_PASSWORD",
    "RUNTIME_DATABASE_PASSWORD",
    "INGRESS_DATABASE_PASSWORD",
    "WORKER_DATABASE_PASSWORD",
    "DATABASE_CA_CERT_PATH",
    "SUPABASE_POOLER_HOST",
  ];
  for (const name of sensitiveNames) {
    const secret = environment[name]?.trim();
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  result = result.split(DIRECT_DATABASE_HOST).join("[REDACTED]");
  return result;
}

async function main() {
  loadLocalEnvironment(".env.staging");
  const settings = validateCapacityEnvironment(process.env);
  const ssl = databaseTlsOptions(true, settings.certificatePath);
  const evidence = await runCapacityPreflight(settings, ({ connectionString }) => new Client({
    application_name: "review-anchor-staging-capacity-gate",
    connectionString,
    ssl,
  }));
  const evidencePath = path.resolve(".cloudflare", "evidence", "capacity.json");
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `Staging capacity gate passed: ${evidence.availableConnections} available connections; ${evidence.roles.length} roles; ${ROTATION_SENSITIVE_TABLES.length} empty tables.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof SafeCapacityError
      ? redactSensitive(error.message)
      : "The staging capacity gate failed without exposing database details.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
