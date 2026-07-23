import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { databaseTlsOptions } from "../server/database-tls.js";
import { loadLocalEnvironment } from "../server/load-env.js";
import {
  agencyGrantCoverageLockSql,
  agencyGrantCoverageSql,
} from "./agency-grant-coverage.js";
import { migrationChecksum } from "./migration-checksum.js";
import { migrationTargetFingerprint } from "./migration-policy.js";

loadLocalEnvironment();

const configuredAdminConnectionString = process.env.MIGRATION_DATABASE_URL;
if (!configuredAdminConnectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required for migrator integration tests.");
}
const adminConnectionString: string = configuredAdminConnectionString;
const adminUrl = new URL(adminConnectionString);
const adminDatabase = adminUrl.pathname.slice(1);
if (adminDatabase !== "postgres" && !adminDatabase.endsWith("_test") && !adminDatabase.startsWith("afterword_test_")) {
  throw new Error("Migrator integration tests require postgres or a dedicated test database.");
}

const ssl = databaseTlsOptions(process.env.DATABASE_SSL === "require");
const admin = new pg.Client({
  connectionString: adminConnectionString,
  ssl,
  application_name: "afterword-migrator-integration",
});
const createdDatabases: string[] = [];
const temporaryDirectories: string[] = [];

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function connectionStringFor(database: string) {
  const url = new URL(adminConnectionString);
  url.pathname = `/${database}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function approvalManifest(
  connectionString: string,
  evidenceId: string,
  migrations: Record<string, string>,
) {
  return JSON.stringify({
    targetSha256: migrationTargetFingerprint(connectionString),
    evidenceId,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    migrations,
  });
}

async function runMigrator(options: {
  connectionString: string;
  manifest?: string;
  migrationsDirectory?: string;
}) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_SSL: process.env.DATABASE_SSL ?? "disable",
    MIGRATION_APPROVAL_MANIFEST: options.manifest ?? "",
    MIGRATION_DATABASE_URL: options.connectionString,
    NODE_ENV: "test",
  };
  if (options.migrationsDirectory) {
    environment.MIGRATIONS_DIRECTORY = options.migrationsDirectory;
  } else {
    delete environment.MIGRATIONS_DIRECTORY;
  }

  return await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts", "migrate.ts")],
      { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

async function expectMigratorFailure(
  options: Parameters<typeof runMigrator>[0],
  expected: RegExp,
) {
  const result = await runMigrator(options);
  assert.notEqual(result.code, 0, `Migrator unexpectedly succeeded:\n${result.output}`);
  assert.match(result.output, expected);
  return result;
}

async function createDatabase(label: string) {
  const suffix = `${Date.now().toString(36)}_${createdDatabases.length}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `afterword_test_${label}_${suffix}`.slice(0, 63);
  await admin.query(`create database ${quoteIdentifier(name)} owner afterword_migration_owner`);
  createdDatabases.push(name);
  return name;
}

async function connect(database: string) {
  const client = new pg.Client({
    connectionString: connectionStringFor(database),
    ssl,
    application_name: "afterword-migrator-assertion",
  });
  await client.connect();
  return client;
}

async function copyMigrationsThrough011(directory: string) {
  const sourceDirectory = path.resolve("database", "migrations");
  const files = (await readdir(sourceDirectory))
    .filter((file) => /^0(?:0[1-9]|1[01])_.+\.sql$/u.test(file))
    .sort();
  for (const file of files) {
    await writeFile(path.join(directory, file), await readFile(path.join(sourceDirectory, file)));
  }
}

await admin.connect();
try {
  const migration019File = "019_provider_independent_security.sql";
  const migration019Sql = await readFile(path.resolve("database", "migrations", migration019File), "utf8");

  const coreDatabase = await createDatabase("core");
  const coreConnection = connectionStringFor(coreDatabase);
  const coreManifest = approvalManifest(
    coreConnection,
    "migrator-core-verification",
    { [migration019File]: migrationChecksum(migration019Sql) },
  );
  const firstRun = await runMigrator({ connectionString: coreConnection, manifest: coreManifest });
  assert.equal(firstRun.code, 0, firstRun.output);
  const coreClient = await connect(coreDatabase);
  try {
    const expectedMigrationCount = (await readdir(path.resolve("database", "migrations")))
      .filter((file) => /^\d{3}_.+\.sql$/u.test(file)).length;
    const firstLedger = await coreClient.query<{ count: string }>(
      "select count(*)::text as count from public.schema_migrations",
    );
    assert.equal(Number(firstLedger.rows[0]?.count), expectedMigrationCount);

    const secondRun = await runMigrator({ connectionString: coreConnection });
    assert.equal(secondRun.code, 0, secondRun.output);
    assert.match(secondRun.output, /already applied 019_provider_independent_security\.sql/u);
    const secondLedger = await coreClient.query<{ count: string }>(
      "select count(*)::text as count from public.schema_migrations",
    );
    assert.equal(secondLedger.rows[0]?.count, firstLedger.rows[0]?.count);

    await coreClient.query(
      "update public.schema_migrations set checksum_sha256 = $1 where migration_id = $2",
      ["0".repeat(64), migration019File],
    );
    await expectMigratorFailure(
      { connectionString: coreConnection, manifest: coreManifest },
      /has changed/u,
    );
  } finally {
    await coreClient.end();
  }

  const unapprovedDatabase = await createDatabase("unapproved");
  const unapprovedConnection = connectionStringFor(unapprovedDatabase);
  await expectMigratorFailure(
    { connectionString: unapprovedConnection },
    /019_provider_independent_security\.sql is not approved/u,
  );
  const unapprovedClient = await connect(unapprovedDatabase);
  try {
    const result = await unapprovedClient.query<{ count: string }>(
      "select count(*)::text as count from public.schema_migrations where migration_id = $1",
      [migration019File],
    );
    assert.equal(result.rows[0]?.count, "0");
  } finally {
    await unapprovedClient.end();
  }

  const atomicDirectory = await mkdtemp(path.join(os.tmpdir(), "afterword-migrator-atomic-"));
  temporaryDirectories.push(atomicDirectory);
  await writeFile(
    path.join(atomicDirectory, "001_atomic_probe.sql"),
    "begin;\ncreate table public.atomic_committed_probe (id integer primary key);\ncommit;\n",
  );
  await writeFile(
    path.join(atomicDirectory, "002_atomic_failure.sql"),
    "begin;\ncreate table public.atomic_failed_probe (id integer primary key);\nselect missing_atomic_function();\ncommit;\n",
  );
  const atomicDatabase = await createDatabase("atomic");
  const atomicConnection = connectionStringFor(atomicDatabase);
  await expectMigratorFailure(
    { connectionString: atomicConnection, migrationsDirectory: atomicDirectory },
    /missing_atomic_function/u,
  );
  const atomicClient = await connect(atomicDatabase);
  try {
    const atomicResult = await atomicClient.query<{
      failed_table: string | null;
      failed_ledger: string;
      committed_table: string | null;
    }>(`
      select
        to_regclass('public.atomic_failed_probe')::text as failed_table,
        to_regclass('public.atomic_committed_probe')::text as committed_table,
        (select count(*)::text from public.schema_migrations where migration_id = '002_atomic_failure.sql') as failed_ledger
    `);
    assert.equal(atomicResult.rows[0]?.committed_table, "atomic_committed_probe");
    assert.equal(atomicResult.rows[0]?.failed_table, null);
    assert.equal(atomicResult.rows[0]?.failed_ledger, "0");
  } finally {
    await atomicClient.end();
  }

  const guardedDirectory = await mkdtemp(path.join(os.tmpdir(), "afterword-migrator-guarded-"));
  temporaryDirectories.push(guardedDirectory);
  await copyMigrationsThrough011(guardedDirectory);
  const migration012File = "012_test_agency_access_enforcement.sql";
  const migration012Sql = "begin;\ncreate table public.migration_012_gate_probe (id integer primary key);\ncommit;\n";
  await writeFile(path.join(guardedDirectory, migration012File), migration012Sql);

  const guardedDatabase = await createDatabase("guarded");
  const guardedConnection = connectionStringFor(guardedDatabase);
  await expectMigratorFailure(
    { connectionString: guardedConnection, migrationsDirectory: guardedDirectory },
    /012_test_agency_access_enforcement\.sql is not approved/u,
  );
  const guardedManifest = approvalManifest(
    guardedConnection,
    "migration-012-zero-row-evidence",
    { [migration012File]: migrationChecksum(migration012Sql) },
  );
  const guardedClient = await connect(guardedDatabase);
  try {
    const migration011File = "011_agency_client_grants.sql";
    const migration011Sql = await readFile(path.join(guardedDirectory, migration011File), "utf8");
    const migration011Checksum = migrationChecksum(migration011Sql);
    await guardedClient.query(
      "update public.schema_migrations set checksum_sha256 = $1 where migration_id = $2",
      ["f".repeat(64), migration011File],
    );
    await expectMigratorFailure(
      {
        connectionString: guardedConnection,
        manifest: guardedManifest,
        migrationsDirectory: guardedDirectory,
      },
      /011_agency_client_grants\.sql has changed/u,
    );
    await guardedClient.query(
      "update public.schema_migrations set checksum_sha256 = $1 where migration_id = $2",
      [migration011Checksum, migration011File],
    );

    await guardedClient.query("set role afterword_migration_owner");
    await guardedClient.query(`
      insert into public.users (id, auth_subject, email, display_name)
      values ('81000000-0000-4000-8000-000000000001', 'test:migration-012', 'migration-012@example.test', 'Migration 012');
      insert into public.agencies (id, name, customer_kind)
      values ('81000000-0000-4000-8000-000000000010', 'Migration 012 Agency', 'agency');
      insert into public.agency_memberships (agency_id, user_id, role)
      values ('81000000-0000-4000-8000-000000000010', '81000000-0000-4000-8000-000000000001', 'owner');
    `);

    const concurrentWriter = await connect(guardedDatabase);
    try {
      await concurrentWriter.query("set role afterword_migration_owner");
      await concurrentWriter.query("set lock_timeout = '250ms'");
      await guardedClient.query("begin");
      await guardedClient.query(agencyGrantCoverageLockSql);
      const coverage = await guardedClient.query<{ uncovered_agency_grants: string }>(
        agencyGrantCoverageSql,
      );
      assert.equal(coverage.rows[0]?.uncovered_agency_grants, "0");

      let writerError: unknown;
      try {
        await concurrentWriter.query(`
          insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code)
          values ('81000000-0000-4000-8000-000000000020', '81000000-0000-4000-8000-000000000010', 'Migration 012 Business', 'migration-012', 'UTC', 'GB')
        `);
      } catch (error) {
        writerError = error;
      }
      assert.equal(
        (writerError as { code?: string } | undefined)?.code,
        "55P03",
        "The migration coverage lock must block a concurrent conflicting tenant write.",
      );
      await guardedClient.query("rollback");
    } finally {
      await guardedClient.query("rollback").catch(() => undefined);
      await concurrentWriter.end();
    }

    await guardedClient.query(`
      insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code)
      values ('81000000-0000-4000-8000-000000000020', '81000000-0000-4000-8000-000000000010', 'Migration 012 Business', 'migration-012', 'UTC', 'GB');
      insert into public.locations (id, business_id, name, timezone)
      values ('81000000-0000-4000-8000-000000000030', '81000000-0000-4000-8000-000000000020', 'Migration 012 Location', 'UTC');
    `);
    await expectMigratorFailure(
      {
        connectionString: guardedConnection,
        manifest: guardedManifest,
        migrationsDirectory: guardedDirectory,
      },
      /zero uncovered agency-client grants/u,
    );
    await guardedClient.query(`
      delete from public.locations where id = '81000000-0000-4000-8000-000000000030';
      delete from public.businesses where id = '81000000-0000-4000-8000-000000000020';
      delete from public.agency_memberships where agency_id = '81000000-0000-4000-8000-000000000010';
      delete from public.agencies where id = '81000000-0000-4000-8000-000000000010';
      delete from public.users where id = '81000000-0000-4000-8000-000000000001';
      reset role;
    `);
  } finally {
    await guardedClient.end();
  }
  const guardedRun = await runMigrator({
    connectionString: guardedConnection,
    manifest: guardedManifest,
    migrationsDirectory: guardedDirectory,
  });
  assert.equal(guardedRun.code, 0, guardedRun.output);

  process.stdout.write("PostgreSQL migrator integration verification passed.\n");
} finally {
  for (const database of createdDatabases.reverse()) {
    await admin.query(`drop database if exists ${quoteIdentifier(database)} with (force)`).catch(() => undefined);
  }
  await admin.end();
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
}
