import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { loadLocalEnvironment } from "../server/load-env.js";

loadLocalEnvironment();

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required and must be able to SET ROLE afterword_migration_owner.");
}

const sql = (await readFile(path.resolve("database", "tests", "003_tenant_isolation.sql"), "utf8"))
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("\\"))
  .join("\n");

const client = new pg.Client({ connectionString, application_name: "afterword-isolation-test" });
await client.connect();
try {
  await client.query(sql);
  process.stdout.write("PostgreSQL tenant-isolation suite passed.\n");
} finally {
  await client.end();
}
