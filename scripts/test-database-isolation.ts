import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { databaseTlsOptions } from "../server/database-tls.js";
import { loadLocalEnvironment } from "../server/load-env.js";

loadLocalEnvironment();

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required and must be able to SET ROLE afterword_migration_owner.");
}

const sqlLines = (await readFile(path.resolve("database", "tests", "003_tenant_isolation.sql"), "utf8"))
  .split(/\r?\n/);

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function psqlText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function runPsqlCompatibleScript(client: pg.Client) {
  const variables = new Map<string, string>();
  let segment: string[] = [];

  const renderVariables = (query: string) => query.replace(
    /:'([A-Za-z_][A-Za-z0-9_]*)'/g,
    (_match, name: string) => {
      const value = variables.get(name);
      if (value === undefined) throw new Error(`psql variable ${name} is unavailable.`);
      return quoteLiteral(value);
    },
  );

  const execute = async (prefix?: string) => {
    const query = renderVariables(segment.join("\n")).trim();
    segment = [];
    if (!query) return;
    const result = await client.query(query);
    if (prefix === undefined) return;
    const finalResult = Array.isArray(result) ? result.at(-1) : result;
    if (!finalResult || finalResult.rows.length !== 1) {
      throw new Error(`\\gset expected one row but received ${finalResult?.rows.length ?? 0}.`);
    }
    for (const [column, value] of Object.entries(finalResult.rows[0])) {
      variables.set(`${prefix}${column}`, psqlText(value));
    }
  };

  for (const line of sqlLines) {
    if (line.trimStart().startsWith("\\set ")) continue;
    const marker = line.match(/\\gset(?:[ \t]+([A-Za-z_][A-Za-z0-9_]*))?[ \t]*$/);
    if (!marker) {
      segment.push(line);
      continue;
    }
    segment.push(line.slice(0, marker.index).trimEnd());
    await execute(marker[1] ?? "");
  }
  await execute();
}

const ssl = databaseTlsOptions(process.env.DATABASE_SSL === "require");
const client = new pg.Client({ connectionString, ssl, application_name: "afterword-isolation-test" });
await client.connect();
try {
  await runPsqlCompatibleScript(client);
  process.stdout.write("PostgreSQL tenant-isolation suite passed.\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
