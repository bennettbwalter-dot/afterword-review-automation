import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { databaseTlsOptions } from "../server/database-tls.js";
import { loadLocalEnvironment } from "../server/load-env.js";
import {
  agencyGrantCoverageLockSql,
  agencyGrantCoverageSql,
} from "./agency-grant-coverage.js";
import {
  migrationChecksum,
  migrationChecksumVariants,
  unwrapMigrationTransaction,
} from "./migration-checksum.js";
import {
  assertMigrationApproved,
  migrationTargetFingerprint,
  parseMigrationApprovalManifest,
} from "./migration-policy.js";

loadLocalEnvironment();

const { Client } = pg;
const connectionString = process.env.MIGRATION_DATABASE_URL;

if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required and must be able to SET ROLE afterword_migration_owner.");
}

const ssl = databaseTlsOptions(process.env.DATABASE_SSL === "require");
const client = new Client({ connectionString, ssl, application_name: "afterword-migrator" });
const migrationsDirectoryOverride = process.env.MIGRATIONS_DIRECTORY;
if (migrationsDirectoryOverride && process.env.NODE_ENV !== "test") {
  throw new Error("MIGRATIONS_DIRECTORY is available only when NODE_ENV=test.");
}
const migrationsDirectory = migrationsDirectoryOverride
  ? path.resolve(migrationsDirectoryOverride)
  : path.resolve("database", "migrations");
const targetFingerprint = migrationTargetFingerprint(connectionString);
const approvalManifest = parseMigrationApprovalManifest(process.env.MIGRATION_APPROVAL_MANIFEST);

async function assertMigration012Ready(evidenceId: string) {
  if (!evidenceId.trim()) {
    throw new Error("Migration 012 requires retained agency-grant coverage evidence.");
  }
  const migration011Path = path.join(migrationsDirectory, "011_agency_client_grants.sql");
  const migration011Sql = await readFile(migration011Path, "utf8");
  const migration011Ledger = await client.query<{ checksum_sha256: string }>(
    "select checksum_sha256 from public.schema_migrations where migration_id = $1",
    ["011_agency_client_grants.sql"],
  );
  if (
    !migration011Ledger.rows[0]
    || !migrationChecksumVariants(migration011Sql).has(migration011Ledger.rows[0].checksum_sha256)
  ) {
    throw new Error("Migration 012 requires the expected migration 011 ledger entry.");
  }
  await client.query(agencyGrantCoverageLockSql);
  const uncoveredAgencyGrants = await client.query(agencyGrantCoverageSql);
  if (uncoveredAgencyGrants.rowCount !== 0) {
    throw new Error("Migration 012 requires zero uncovered agency-client grants.");
  }
}

await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('afterword-schema-migrations'))");
  await client.query("set role afterword_migration_owner");
  await client.query(`
    create table if not exists public.schema_migrations (
      migration_id text primary key,
      checksum_sha256 text not null,
      applied_at timestamptz not null default clock_timestamp()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    const checksum = migrationChecksum(sql);
    const previous = await client.query<{ checksum_sha256: string }>(
      "select checksum_sha256 from public.schema_migrations where migration_id = $1",
      [file],
    );
    if (previous.rows[0]) {
      if (!migrationChecksumVariants(sql).has(previous.rows[0].checksum_sha256)) {
        throw new Error(`Applied migration ${file} has changed; create a new forward-only migration instead.`);
      }
      process.stdout.write(`already applied ${file}\n`);
      continue;
    }

    assertMigrationApproved(file, checksum, targetFingerprint, approvalManifest);

    process.stdout.write(`applying ${file}\n`);
    await client.query("begin");
    try {
      if (file.startsWith("012_")) {
        await assertMigration012Ready(approvalManifest?.evidenceId ?? "");
      }
      await client.query(unwrapMigrationTransaction(sql));
      await client.query(
        "insert into public.schema_migrations (migration_id, checksum_sha256) values ($1, $2)",
        [file, checksum],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }
} finally {
  await client.query("select pg_advisory_unlock(hashtext('afterword-schema-migrations'))").catch(() => undefined);
  await client.end();
}
