import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { loadLocalEnvironment } from "../server/load-env.js";

loadLocalEnvironment();

const { Client } = pg;
const connectionString = process.env.MIGRATION_DATABASE_URL;

if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required and must be able to SET ROLE afterword_migration_owner.");
}

const client = new Client({ connectionString, application_name: "afterword-migrator" });
const migrationsDirectory = path.resolve("database", "migrations");

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
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query<{ checksum_sha256: string }>(
      "select checksum_sha256 from public.schema_migrations where migration_id = $1",
      [file],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Applied migration ${file} has changed; create a new forward-only migration instead.`);
      }
      process.stdout.write(`already applied ${file}\n`);
      continue;
    }

    process.stdout.write(`applying ${file}\n`);
    await client.query(sql);
    await client.query(
      "insert into public.schema_migrations (migration_id, checksum_sha256) values ($1, $2)",
      [file, checksum],
    );
  }
} finally {
  await client.query("select pg_advisory_unlock(hashtext('afterword-schema-migrations'))").catch(() => undefined);
  await client.end();
}
