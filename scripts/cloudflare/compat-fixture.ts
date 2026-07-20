import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { databaseTlsOptions } from "../../server/database-tls.js";
import { loadLocalEnvironment } from "../../server/load-env.js";

const { Client } = pg;

const STAGING_PROJECT_REF = "cwwgvkepocldophqzijf";
const SYNTHETIC_PREFIX = "Review Anchor Compatibility 2026";
const SYNTHETIC_PASSWORD_HASH = "scrypt$16384$8$1$XrtXOb8CvTz77fgedLmkKg$8Kx_JFypoqhWfIdL42mShiNIIlivAaaWykxhNBQmNeAZwrELwxESLKrYBEzcqnMBBujrcdYJaMOUX0-Uw29rDQ";
const EVIDENCE_DIRECTORY = path.resolve(".cloudflare", "evidence");
const MANIFEST_PATH = path.join(EVIDENCE_DIRECTORY, "compat-fixture.json");
const TEMP_MANIFEST_PATH = path.join(EVIDENCE_DIRECTORY, "compat-fixture.pending.json");

export interface CompatibilityFixtureContext {
  agencyId: string;
  businessId: string;
  locationId: string;
  otherBusinessId: string;
  sessionHashHex: string;
  sessionId: string;
  userId: string;
}

export interface CompatibilityFixtureManifest {
  contexts: [CompatibilityFixtureContext, CompatibilityFixtureContext];
  projectRef: typeof STAGING_PROJECT_REF;
  version: 1;
}

class SafeFixtureError extends Error {}

function loadStagingEnvironment() {
  loadLocalEnvironment(".env.staging");
  loadLocalEnvironment();
}

function migrationConnectionString() {
  loadStagingEnvironment();
  if (process.env.SUPABASE_PROJECT_REF !== STAGING_PROJECT_REF) {
    throw new SafeFixtureError("The compatibility fixture is restricted to the Review Anchor staging project.");
  }
  const value = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!value) throw new SafeFixtureError("MIGRATION_DATABASE_URL is required for the local compatibility fixture.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SafeFixtureError("MIGRATION_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  const belongsToStaging = parsed.hostname.toLowerCase().includes(STAGING_PROJECT_REF)
    || decodeURIComponent(parsed.username).toLowerCase().includes(STAGING_PROJECT_REF);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !belongsToStaging) {
    throw new SafeFixtureError("MIGRATION_DATABASE_URL does not belong to the Review Anchor staging project.");
  }
  return value;
}

function createManifest(): CompatibilityFixtureManifest {
  const firstBusinessId = randomUUID();
  const secondBusinessId = randomUUID();
  const createContext = (businessId: string, otherBusinessId: string): CompatibilityFixtureContext => ({
    agencyId: randomUUID(),
    businessId,
    locationId: randomUUID(),
    otherBusinessId,
    sessionHashHex: randomBytes(32).toString("hex"),
    sessionId: randomUUID(),
    userId: randomUUID(),
  });
  return {
    contexts: [
      createContext(firstBusinessId, secondBusinessId),
      createContext(secondBusinessId, firstBusinessId),
    ],
    projectRef: STAGING_PROJECT_REF,
    version: 1,
  };
}

function validateManifest(value: unknown): CompatibilityFixtureManifest {
  const manifest = value as Partial<CompatibilityFixtureManifest> | null;
  if (
    !manifest
    || manifest.version !== 1
    || manifest.projectRef !== STAGING_PROJECT_REF
    || !Array.isArray(manifest.contexts)
    || manifest.contexts.length !== 2
  ) {
    throw new SafeFixtureError("The compatibility fixture manifest is invalid.");
  }
  for (const context of manifest.contexts) {
    if (
      !context
      || !context.agencyId
      || !context.businessId
      || !context.locationId
      || !context.otherBusinessId
      || !context.sessionId
      || !context.userId
      || !/^[0-9a-f]{64}$/i.test(context.sessionHashHex)
    ) {
      throw new SafeFixtureError("The compatibility fixture manifest is incomplete.");
    }
  }
  if (
    manifest.contexts[0].businessId !== manifest.contexts[1].otherBusinessId
    || manifest.contexts[1].businessId !== manifest.contexts[0].otherBusinessId
  ) {
    throw new SafeFixtureError("The compatibility fixture manifest has an inconsistent tenant pair.");
  }
  return manifest as CompatibilityFixtureManifest;
}

async function readManifest() {
  try {
    return validateManifest(JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SafeFixtureError) throw error;
    throw new SafeFixtureError("The compatibility fixture manifest could not be read.");
  }
}

function syntheticValues(context: CompatibilityFixtureContext, index: number) {
  const suffix = index === 0 ? "A" : "B";
  return {
    agencyName: `${SYNTHETIC_PREFIX} Agency ${suffix}`,
    authSubject: `compatibility:${context.userId}`,
    businessName: `${SYNTHETIC_PREFIX} Business ${suffix}`,
    businessSlug: `review-anchor-compat-${context.businessId}`,
    displayName: `${SYNTHETIC_PREFIX} User ${suffix}`,
    email: `compat-${context.userId}@example.test`,
    locationName: `${SYNTHETIC_PREFIX} Location ${suffix}`,
  };
}

async function exactFixtureCount(client: pg.Client, manifest: CompatibilityFixtureManifest) {
  const userIds = manifest.contexts.map((context) => context.userId);
  const agencyIds = manifest.contexts.map((context) => context.agencyId);
  const businessIds = manifest.contexts.map((context) => context.businessId);
  const locationIds = manifest.contexts.map((context) => context.locationId);
  const sessionIds = manifest.contexts.map((context) => context.sessionId);
  const result = await client.query<{ total: number }>(
    `select
      (select count(*) from public.users where id = any($1::uuid[]))
      + (select count(*) from public.agencies where id = any($2::uuid[]))
      + (select count(*) from public.businesses where id = any($3::uuid[]))
      + (select count(*) from public.locations where id = any($4::uuid[]))
      + (select count(*) from app_private.auth_sessions where id = any($5::uuid[]))
      + (select count(*) from app_private.auth_credentials where user_id = any($1::uuid[]))
      + (select count(*) from public.agency_memberships where agency_id = any($2::uuid[]))
      + (select count(*) from public.business_memberships where business_id = any($3::uuid[])) as total`,
    [userIds, agencyIds, businessIds, locationIds, sessionIds],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function assertSyntheticIdentity(client: pg.Client, manifest: CompatibilityFixtureManifest) {
  for (const [index, context] of manifest.contexts.entries()) {
    const expected = syntheticValues(context, index);
    const result = await client.query<{
      agency_name: string;
      auth_subject: string;
      business_name: string;
      business_slug: string;
      display_name: string;
      email: string;
      location_name: string;
      password_hash: string;
      session_hash_hex: string;
    }>(
      `select
        agency.name as agency_name,
        app_user.auth_subject,
        business.name as business_name,
        business.slug as business_slug,
        app_user.display_name,
        app_user.email,
        location.name as location_name,
        credential.password_hash,
        encode(session.token_hash, 'hex') as session_hash_hex
      from public.users app_user
      join app_private.auth_credentials credential on credential.user_id = app_user.id
      join public.agencies agency on agency.id = $2::uuid
      join public.agency_memberships agency_membership
        on agency_membership.agency_id = agency.id
       and agency_membership.user_id = app_user.id
       and agency_membership.role = 'owner'
       and agency_membership.status = 'active'
      join public.businesses business on business.id = $3::uuid and business.agency_id = agency.id
      join public.business_memberships business_membership
        on business_membership.business_id = business.id
       and business_membership.user_id = app_user.id
       and business_membership.role = 'owner'
       and business_membership.status = 'active'
      join public.locations location on location.id = $4::uuid and location.business_id = business.id
      join app_private.auth_sessions session
        on session.id = $5::uuid
       and session.user_id = app_user.id
       and session.revoked_at is null
       and session.idle_expires_at > statement_timestamp()
       and session.absolute_expires_at > statement_timestamp()
      where app_user.id = $1::uuid`,
      [context.userId, context.agencyId, context.businessId, context.locationId, context.sessionId],
    );
    if (
      result.rows.length !== 1
      || result.rows[0]?.password_hash !== SYNTHETIC_PASSWORD_HASH
      || result.rows[0]?.session_hash_hex !== context.sessionHashHex
      || Object.entries(expected).some(([key, value]) => {
      const databaseKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) as keyof typeof result.rows[0];
      return result.rows[0]?.[databaseKey] !== value;
      })
    ) {
      throw new SafeFixtureError("The active compatibility fixture does not match its synthetic identity boundary.");
    }
  }
}

async function prepare(client: pg.Client) {
  const existing = await readManifest();
  if (existing) {
    await client.query("set role afterword_migration_owner");
    await assertSyntheticIdentity(client, existing);
    if (await exactFixtureCount(client, existing) !== 16) {
      throw new SafeFixtureError("The active compatibility fixture is incomplete.");
    }
    process.stdout.write("Compatibility fixture is already prepared.\n");
    return;
  }

  const manifest = createManifest();
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(TEMP_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });

  await client.query("begin");
  try {
    await client.query("set local role afterword_migration_owner");
    for (const [index, context] of manifest.contexts.entries()) {
      const values = syntheticValues(context, index);
      await client.query(
        `insert into public.users (id, auth_subject, email, display_name)
         values ($1::uuid, $2, $3, $4)`,
        [context.userId, values.authSubject, values.email, values.displayName],
      );
      await client.query(
        `insert into app_private.auth_credentials (user_id, password_hash, email_verified_at)
         values ($1::uuid, $2, statement_timestamp())`,
        [context.userId, SYNTHETIC_PASSWORD_HASH],
      );
      await client.query(
        "insert into public.agencies (id, name) values ($1::uuid, $2)",
        [context.agencyId, values.agencyName],
      );
      await client.query(
        "insert into public.agency_memberships (agency_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')",
        [context.agencyId, context.userId],
      );
      await client.query(
        `insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code)
         values ($1::uuid, $2::uuid, $3, $4, 'UTC', 'GB')`,
        [context.businessId, context.agencyId, values.businessName, values.businessSlug],
      );
      await client.query(
        "insert into public.business_memberships (business_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')",
        [context.businessId, context.userId],
      );
      await client.query(
        "insert into public.locations (id, business_id, name, timezone) values ($1::uuid, $2::uuid, $3, 'UTC')",
        [context.locationId, context.businessId, values.locationName],
      );
      await client.query(
        `insert into app_private.auth_sessions (
          id, user_id, token_hash, idle_expires_at, absolute_expires_at, mfa_verified_at
        ) values (
          $1::uuid, $2::uuid, decode($3, 'hex'),
          statement_timestamp() + interval '1 day',
          statement_timestamp() + interval '7 days',
          statement_timestamp()
        )`,
        [context.sessionId, context.userId, context.sessionHashHex],
      );
    }
    await client.query("commit");
    await rename(TEMP_MANIFEST_PATH, MANIFEST_PATH);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await unlink(TEMP_MANIFEST_PATH).catch(() => undefined);
    throw error;
  }
  process.stdout.write("Prepared two synthetic compatibility tenants.\n");
}

async function cleanup(client: pg.Client) {
  const manifest = await readManifest();
  if (!manifest) {
    process.stdout.write("No active compatibility fixture exists.\n");
    return;
  }

  await client.query("begin");
  try {
    await client.query("set local role afterword_migration_owner");
    await assertSyntheticIdentity(client, manifest);
    if (await exactFixtureCount(client, manifest) !== 16) {
      throw new SafeFixtureError("The compatibility fixture is incomplete; cleanup refused.");
    }
    const userIds = manifest.contexts.map((context) => context.userId);
    const agencyIds = manifest.contexts.map((context) => context.agencyId);
    const businessIds = manifest.contexts.map((context) => context.businessId);
    const locationIds = manifest.contexts.map((context) => context.locationId);
    const sessionIds = manifest.contexts.map((context) => context.sessionId);
    await client.query("delete from app_private.auth_sessions where id = any($1::uuid[])", [sessionIds]);
    await client.query("delete from app_private.auth_credentials where user_id = any($1::uuid[])", [userIds]);
    await client.query("delete from public.locations where id = any($1::uuid[])", [locationIds]);
    await client.query("delete from public.business_memberships where business_id = any($1::uuid[])", [businessIds]);
    await client.query("delete from public.businesses where id = any($1::uuid[])", [businessIds]);
    await client.query("delete from public.agency_memberships where agency_id = any($1::uuid[])", [agencyIds]);
    await client.query("delete from public.agencies where id = any($1::uuid[])", [agencyIds]);
    await client.query("delete from public.users where id = any($1::uuid[])", [userIds]);
    if (await exactFixtureCount(client, manifest) !== 0) {
      throw new SafeFixtureError("The compatibility fixture cleanup did not remove every synthetic row.");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  await unlink(MANIFEST_PATH);
  process.stdout.write("Removed the synthetic compatibility tenants.\n");
}

async function main() {
  const command = process.argv[2];
  if (command !== "prepare" && command !== "cleanup") {
    throw new SafeFixtureError("Usage: compat-fixture.ts prepare|cleanup");
  }
  const client = new Client({
    connectionString: migrationConnectionString(),
    ssl: databaseTlsOptions(process.env.DATABASE_SSL === "require"),
    application_name: "review-anchor-compat-fixture",
  });
  try {
    await client.connect();
    if (command === "prepare") await prepare(client);
    else await cleanup(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof SafeFixtureError
      ? error.message
      : "The compatibility fixture command failed without exposing database details.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
