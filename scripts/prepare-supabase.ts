import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function unquote(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function randomSecret(bytes = 36) {
  return randomBytes(bytes).toString("base64url");
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const envPath = path.resolve(".env");
const existingEnv = await readFile(envPath, "utf8").catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return "";
  throw error;
});
let envLines = existingEnv.split(/\r?\n/);

function currentEnvValue(name: string) {
  const processValue = process.env[name]?.trim();
  if (processValue) return processValue;
  const line = envLines.find((candidate) => new RegExp(`^\\s*${name}\\s*=`).test(candidate));
  return line ? unquote(line.slice(line.indexOf("=") + 1)) : undefined;
}

function setEnvValue(name: string, value: string) {
  const expression = new RegExp(`^\\s*${name}\\s*=`);
  const index = envLines.findIndex((candidate) => expression.test(candidate));
  if (index >= 0) envLines[index] = `${name}=${value}`;
  else envLines.push(`${name}=${value}`);
}

const projectRef = argument("project-ref") ?? currentEnvValue("SUPABASE_PROJECT_REF");
const poolerHost = argument("pooler-host") ?? currentEnvValue("SUPABASE_POOLER_HOST");
if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
  throw new Error("Pass a valid Supabase project reference with --project-ref.");
}
if (!poolerHost || !/^[a-z0-9.-]+\.supabase\.com$/i.test(poolerHost)) {
  throw new Error("Pass the Session Pooler host with --pooler-host.");
}

const passwordNames = [
  "MIGRATION_DATABASE_PASSWORD",
  "AUTH_DATABASE_PASSWORD",
  "RUNTIME_DATABASE_PASSWORD",
  "INGRESS_DATABASE_PASSWORD",
  "WORKER_DATABASE_PASSWORD",
] as const;
const passwords = Object.fromEntries(
  passwordNames.map((name) => [name, currentEnvValue(name) || randomSecret()]),
) as Record<(typeof passwordNames)[number], string>;

const loginRoles = {
  afterword_migration_login: {
    password: passwords.MIGRATION_DATABASE_PASSWORD,
    capability: "afterword_migration_owner",
  },
  afterword_auth_login: {
    password: passwords.AUTH_DATABASE_PASSWORD,
    capability: "afterword_auth",
  },
  afterword_runtime_login: {
    password: passwords.RUNTIME_DATABASE_PASSWORD,
    capability: "afterword_runtime",
  },
  afterword_ingress_login: {
    password: passwords.INGRESS_DATABASE_PASSWORD,
    capability: "afterword_ingress",
  },
  afterword_worker_login: {
    password: passwords.WORKER_DATABASE_PASSWORD,
    capability: "afterword_worker",
  },
} as const;

function connectionUrl(role: keyof typeof loginRoles) {
  const username = encodeURIComponent(`${role}.${projectRef}`);
  const password = encodeURIComponent(loginRoles[role].password);
  return `postgresql://${username}:${password}@${poolerHost}:5432/postgres`;
}

setEnvValue("DATABASE_PLATFORM", "supabase");
setEnvValue("SUPABASE_PROJECT_REF", projectRef);
setEnvValue("SUPABASE_POOLER_HOST", poolerHost);
setEnvValue("DATABASE_SSL", "require");
setEnvValue("DATABASE_CA_CERT_PATH", "database/certificates/supabase-prod-ca-2021.crt");
for (const name of passwordNames) setEnvValue(name, passwords[name]);
setEnvValue("MIGRATION_DATABASE_URL", connectionUrl("afterword_migration_login"));
setEnvValue("AUTH_DATABASE_URL", connectionUrl("afterword_auth_login"));
setEnvValue("RUNTIME_DATABASE_URL", connectionUrl("afterword_runtime_login"));
setEnvValue("INGRESS_DATABASE_URL", connectionUrl("afterword_ingress_login"));
setEnvValue("WORKER_DATABASE_URL", connectionUrl("afterword_worker_login"));
setEnvValue("DATABASE_URL", connectionUrl("afterword_runtime_login"));
setEnvValue("SESSION_PEPPER", currentEnvValue("SESSION_PEPPER") || randomSecret(48));
setEnvValue("FIELD_ENCRYPTION_KEY", currentEnvValue("FIELD_ENCRYPTION_KEY") || randomSecret(32));

while (envLines.length > 0 && envLines[envLines.length - 1] === "") envLines.pop();
await writeFile(envPath, `${envLines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

const groupRoles = [
  "afterword_migration_owner",
  "afterword_auth",
  "afterword_runtime",
  "afterword_ingress",
  "afterword_worker",
  "afterword_ops",
] as const;

const createGroupRoleSql = [...groupRoles, "afterword_supabase_database"].map((role) => `
do $provision$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = ${quoteLiteral(role)}) then
    execute ${quoteLiteral(`create role "${role}" nologin noinherit`)};
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = ${quoteLiteral(role)}
      and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception ${quoteLiteral(`Existing role ${role} has forbidden elevated privileges`)};
  end if;
end
$provision$;
alter role "${role}" nologin noinherit;
`).join("\n");

const createLoginRoleSql = Object.entries(loginRoles).map(([role, settings]) => `
do $provision$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = ${quoteLiteral(role)}) then
    execute ${quoteLiteral(`create role "${role}" login inherit password ${quoteLiteral(settings.password)}`)};
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = ${quoteLiteral(role)}
      and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception ${quoteLiteral(`Existing role ${role} has forbidden elevated privileges`)};
  end if;
end
$provision$;
alter role "${role}" login inherit password ${quoteLiteral(settings.password)};
`).join("\n");

const isolateLoginRoleSql = Object.entries(loginRoles).map(([role, settings]) => {
  const revoked = groupRoles.filter((group) => group !== settings.capability);
  return `revoke ${revoked.map((group) => `"${group}"`).join(", ")} from "${role}";
grant "${settings.capability}" to "${role}";`;
}).join("\n");

const bootstrapSql = `-- Review Anchor managed Supabase capability-role bootstrap.
-- Generated locally with secrets; delete this file after it runs successfully.
begin;
${createGroupRoleSql}
${createLoginRoleSql}
grant ${groupRoles.slice(1).map((role) => `"${role}"`).join(", ")}
  to "afterword_migration_owner" with admin option;
${isolateLoginRoleSql}
grant connect on database postgres to "afterword_migration_login", "afterword_auth_login",
  "afterword_runtime_login", "afterword_ingress_login", "afterword_worker_login";
grant create on database postgres to "afterword_migration_owner";
grant usage, create on schema public to "afterword_migration_owner";
do $hardening$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$hardening$;
commit;

select
  current_user = 'postgres' as ran_as_platform_admin,
  to_regrole('afterword_supabase_database') is not null as platform_marker_ready,
  to_regrole('afterword_migration_login') is not null as migration_login_ready,
  to_regrole('afterword_runtime_login') is not null as runtime_login_ready;
`;

const bootstrapPath = path.join(tmpdir(), `review-anchor-supabase-bootstrap-${projectRef}.sql`);
await writeFile(bootstrapPath, bootstrapSql, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`Prepared Review Anchor Supabase credentials in .env and privileged bootstrap SQL at ${bootstrapPath}.\n`);
