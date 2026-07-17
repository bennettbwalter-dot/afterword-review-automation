import pg from "pg";
import { databaseTlsOptions } from "../server/database-tls.js";
import { loadLocalEnvironment } from "../server/load-env.js";

loadLocalEnvironment();

const { Client } = pg;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const connectionString = required("MIGRATION_DATABASE_URL");
const loginPasswords = {
  afterword_auth_login: required("AUTH_DATABASE_PASSWORD"),
  afterword_runtime_login: required("RUNTIME_DATABASE_PASSWORD"),
  afterword_ingress_login: required("INGRESS_DATABASE_PASSWORD"),
  afterword_worker_login: required("WORKER_DATABASE_PASSWORD"),
} as const;

const groupRoles = [
  "afterword_migration_owner",
  "afterword_auth",
  "afterword_runtime",
  "afterword_ingress",
  "afterword_worker",
  "afterword_ops",
] as const;

const ssl = databaseTlsOptions(process.env.DATABASE_SSL === "require");
const client = new Client({ connectionString, ssl, application_name: "afterword-database-provisioner" });
await client.connect();

try {
  const identity = await client.query<{ current_user: string; database_name: string }>(
    "select current_user, current_database() as database_name",
  );
  const administrator = identity.rows[0]?.current_user;
  const databaseName = identity.rows[0]?.database_name;
  if (!administrator || !databaseName) throw new Error("The database identity could not be resolved.");

  await client.query("begin");
  try {
    for (const role of groupRoles) {
      await client.query(`
        do $provision$
        begin
          if not exists (select 1 from pg_catalog.pg_roles where rolname = ${quoteLiteral(role)}) then
            execute ${quoteLiteral(`create role ${quoteIdentifier(role)} nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`)};
          end if;
        end
        $provision$
      `);
      await client.query(
        `alter role ${quoteIdentifier(role)} nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      );
    }

    await client.query(
      `grant ${quoteIdentifier("afterword_migration_owner")} to ${quoteIdentifier(administrator)} with admin option`,
    );
    await client.query(
      `grant ${[
        "afterword_auth",
        "afterword_runtime",
        "afterword_ingress",
        "afterword_worker",
        "afterword_ops",
      ].map(quoteIdentifier).join(", ")} to ${quoteIdentifier("afterword_migration_owner")} with admin option`,
    );

    for (const [loginRole, password] of Object.entries(loginPasswords)) {
      await client.query(`
        do $provision$
        begin
          if not exists (select 1 from pg_catalog.pg_roles where rolname = ${quoteLiteral(loginRole)}) then
            execute ${quoteLiteral(`create role ${quoteIdentifier(loginRole)} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${quoteLiteral(password)}`)};
          end if;
        end
        $provision$
      `);
      await client.query(
        `alter role ${quoteIdentifier(loginRole)} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${quoteLiteral(password)}`,
      );
      const groupRole = loginRole.replace(/_login$/, "");
      for (const role of groupRoles) {
        if (role !== groupRole) {
          await client.query(`revoke ${quoteIdentifier(role)} from ${quoteIdentifier(loginRole)}`);
        }
      }
      await client.query(`grant ${quoteIdentifier(groupRole)} to ${quoteIdentifier(loginRole)}`);
    }

    await client.query(`alter schema public owner to ${quoteIdentifier("afterword_migration_owner")}`);
    await client.query(`alter database ${quoteIdentifier(databaseName)} owner to ${quoteIdentifier("afterword_migration_owner")}`);
    await client.query(`revoke connect on database ${quoteIdentifier(databaseName)} from public`);
    await client.query(
      `grant connect on database ${quoteIdentifier(databaseName)} to ${[
        administrator,
        "afterword_migration_owner",
        ...Object.keys(loginPasswords),
      ].map(quoteIdentifier).join(", ")}`,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  process.stdout.write(
    `Provisioned six NOLOGIN capability roles and four least-privilege application logins in ${databaseName}.\n`,
  );
} finally {
  await client.end();
}
