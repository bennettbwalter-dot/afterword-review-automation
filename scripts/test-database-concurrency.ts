import assert from "node:assert/strict";
import pg from "pg";
import { databaseTlsOptions } from "../server/database-tls.js";
import { loadLocalEnvironment } from "../server/load-env.js";

loadLocalEnvironment();

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required for database concurrency tests.");
}
const databaseName = new URL(connectionString).pathname.slice(1);
if (!databaseName.endsWith("_test") && !databaseName.startsWith("afterword_test_")) {
  throw new Error("Database concurrency tests require a dedicated test database.");
}

const ssl = databaseTlsOptions(process.env.DATABASE_SSL === "require");
const admin = new pg.Client({
  connectionString,
  ssl,
  application_name: "afterword-concurrency-fixtures",
});
const clientA = new pg.Client({
  connectionString,
  ssl,
  application_name: "afterword-concurrency-a",
});
const clientB = new pg.Client({
  connectionString,
  ssl,
  application_name: "afterword-concurrency-b",
});

const fixture = {
  userA: "82000000-0000-4000-8000-000000000001",
  userB: "82000000-0000-4000-8000-000000000002",
  agencyA: "82000000-0000-4000-8000-000000000010",
  agencyB: "82000000-0000-4000-8000-000000000011",
  businessA: "82000000-0000-4000-8000-000000000020",
  businessB: "82000000-0000-4000-8000-000000000021",
  locationA: "82000000-0000-4000-8000-000000000030",
  locationB: "82000000-0000-4000-8000-000000000031",
  supportA: "82000000-0000-4000-8000-000000000040",
  tokenA: Buffer.from("81".repeat(32), "hex"),
  tokenB: Buffer.from("82".repeat(32), "hex"),
};

async function bindContext(
  client: pg.Client,
  token: Buffer,
  supportSessionId: string | null = null,
) {
  await client.query("begin");
  await client.query(
    "select app_private.set_request_context_from_session($1, $2)",
    [token, supportSessionId],
  );
}

async function visibleBusinesses(client: pg.Client) {
  const result = await client.query<{ id: string }>(
    "select id::text from public.businesses order by id",
  );
  return result.rows.map((row) => row.id);
}

async function currentContext(client: pg.Client) {
  const result = await client.query<{
    support_session_id: string | null;
    user_id: string | null;
  }>(`
    select
      app_private.current_user_id()::text as user_id,
      app_private.current_support_session_id()::text as support_session_id
  `);
  return result.rows[0];
}

await Promise.all([admin.connect(), clientA.connect(), clientB.connect()]);
try {
  await admin.query("set role afterword_migration_owner");
  await admin.query("begin");
  try {
    await admin.query(`
      insert into public.users (id, auth_subject, email, display_name) values
        ('${fixture.userA}', 'test:concurrency-a', 'concurrency-a@example.test', 'Concurrency A'),
        ('${fixture.userB}', 'test:concurrency-b', 'concurrency-b@example.test', 'Concurrency B');
      insert into public.agencies (id, name, customer_kind) values
        ('${fixture.agencyA}', 'Concurrency Agency A', 'agency'),
        ('${fixture.agencyB}', 'Concurrency Agency B', 'agency');
      insert into public.agency_memberships (agency_id, user_id, role) values
        ('${fixture.agencyA}', '${fixture.userA}', 'owner'),
        ('${fixture.agencyB}', '${fixture.userB}', 'owner');
      insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code) values
        ('${fixture.businessA}', '${fixture.agencyA}', 'Concurrency Business A', 'concurrency-a', 'UTC', 'GB'),
        ('${fixture.businessB}', '${fixture.agencyB}', 'Concurrency Business B', 'concurrency-b', 'UTC', 'GB');
      insert into public.business_memberships (business_id, user_id, role) values
        ('${fixture.businessA}', '${fixture.userA}', 'owner'),
        ('${fixture.businessB}', '${fixture.userB}', 'owner');
      insert into public.locations (id, business_id, name, timezone) values
        ('${fixture.locationA}', '${fixture.businessA}', 'Concurrency Location A', 'UTC'),
        ('${fixture.locationB}', '${fixture.businessB}', 'Concurrency Location B', 'UTC');
    `);
    await admin.query(
      `insert into app_private.auth_sessions (
        user_id, token_hash, idle_expires_at, absolute_expires_at, mfa_verified_at, step_up_verified_at
      ) values
        ($1, $2, statement_timestamp() + interval '12 hours', statement_timestamp() + interval '30 days', statement_timestamp(), statement_timestamp()),
        ($3, $4, statement_timestamp() + interval '12 hours', statement_timestamp() + interval '30 days', statement_timestamp(), statement_timestamp())`,
      [fixture.userA, fixture.tokenA, fixture.userB, fixture.tokenB],
    );
    await admin.query(`
      insert into public.support_sessions (
        id, agency_id, business_id, actor_user_id, scope, reason,
        mfa_verified_at, started_at, last_activity_at, expires_at
      ) values (
        '${fixture.supportA}', '${fixture.agencyA}', '${fixture.businessA}', '${fixture.userA}',
        'view', 'Concurrency support context', statement_timestamp(),
        statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '15 minutes'
      )
    `);
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }

  await Promise.all([
    clientA.query("set role afterword_runtime"),
    clientB.query("set role afterword_runtime"),
  ]);

  await Promise.all([
    bindContext(clientA, fixture.tokenA, fixture.supportA),
    bindContext(clientB, fixture.tokenB),
  ]);
  const [initialBusinessesA, initialBusinessesB, initialContextA, initialContextB] = await Promise.all([
    visibleBusinesses(clientA),
    visibleBusinesses(clientB),
    currentContext(clientA),
    currentContext(clientB),
  ]);
  assert.deepEqual(initialBusinessesA, [fixture.businessA]);
  assert.deepEqual(initialBusinessesB, [fixture.businessB]);
  assert.equal(initialContextA?.user_id, fixture.userA);
  assert.equal(initialContextA?.support_session_id, fixture.supportA);
  assert.equal(initialContextB?.user_id, fixture.userB);
  assert.equal(initialContextB?.support_session_id, null);

  await Promise.all([clientA.query("commit"), clientB.query("commit")]);
  const [committedContextA, committedContextB] = await Promise.all([
    currentContext(clientA),
    currentContext(clientB),
  ]);
  assert.deepEqual(committedContextA, { user_id: null, support_session_id: null });
  assert.deepEqual(committedContextB, { user_id: null, support_session_id: null });

  await bindContext(clientA, fixture.tokenA);
  assert.deepEqual(await visibleBusinesses(clientA), [fixture.businessA]);
  await clientA.query("rollback");
  assert.deepEqual(await currentContext(clientA), { user_id: null, support_session_id: null });

  await bindContext(clientA, fixture.tokenB);
  assert.deepEqual(await visibleBusinesses(clientA), [fixture.businessB]);
  assert.deepEqual(await currentContext(clientA), { user_id: fixture.userB, support_session_id: null });
  await clientA.query("commit");

  await Promise.all([
    bindContext(clientA, fixture.tokenA, fixture.supportA),
    bindContext(clientB, fixture.tokenB),
  ]);
  const [concurrentBusinessesA, concurrentBusinessesB, concurrentContextA, concurrentContextB] = await Promise.all([
    visibleBusinesses(clientA),
    visibleBusinesses(clientB),
    currentContext(clientA),
    currentContext(clientB),
  ]);
  assert.deepEqual(concurrentBusinessesA, [fixture.businessA]);
  assert.deepEqual(concurrentBusinessesB, [fixture.businessB]);
  assert.equal(concurrentContextA?.support_session_id, fixture.supportA);
  assert.equal(concurrentContextB?.support_session_id, null);
  await Promise.all([clientA.query("rollback"), clientB.query("rollback")]);

  await Promise.all([
    clientA.query("reset role"),
    clientB.query("reset role"),
  ]);
  await Promise.all([
    clientA.query("set role afterword_auth"),
    clientB.query("set role afterword_auth"),
  ]);

  const signupToken = Buffer.from("83".repeat(32), "hex");
  const resendReceipt = Buffer.from("84".repeat(32), "hex");
  const providerReferenceHash = Buffer.from("85".repeat(32), "hex");
  const claimTokenA = Buffer.from("86".repeat(32), "hex");
  const claimTokenB = Buffer.from("87".repeat(32), "hex");
  const signup = await clientA.query<{ signup_intent_id: string; should_send_email: boolean }>(
    `select * from app_private.create_signup_email_request(
      $1, $2, $3, $4, $5,
      statement_timestamp() + interval '15 minutes',
      statement_timestamp() + interval '60 seconds'
    )`,
    ["concurrency-signup@example.test", "Concurrency Signup", "business", signupToken, resendReceipt],
  );
  assert.equal(signup.rows[0]?.should_send_email, true);
  const signupIntentId = signup.rows[0]?.signup_intent_id;
  assert.ok(signupIntentId);
  await clientA.query(
    "select app_private.record_signup_email_delivery($1, 'accepted', $2, null)",
    [signupIntentId, providerReferenceHash],
  );
  await admin.query(
    `update app_private.signup_intents
     set next_delivery_attempt_at = statement_timestamp() - interval '1 second'
     where id = $1`,
    [signupIntentId],
  );

  const claimSql = `select * from app_private.claim_signup_email_resend(
    $1, $2,
    statement_timestamp() + interval '15 minutes',
    statement_timestamp() + interval '60 seconds'
  )`;
  const [claimA, claimB] = await Promise.all([
    clientA.query(claimSql, [resendReceipt, claimTokenA]),
    clientB.query(claimSql, [resendReceipt, claimTokenB]),
  ]);
  assert.equal(claimA.rows.length + claimB.rows.length, 1, "two concurrent resend claims both succeeded");

  const persistedClaim = await admin.query<{
    delivery_state: string;
    delivery_attempt_count: number;
    token_hash: Buffer;
  }>(
    `select delivery_state, delivery_attempt_count, token_hash
     from app_private.signup_intents
     where id = $1`,
    [signupIntentId],
  );
  assert.equal(persistedClaim.rows[0]?.delivery_state, "pending");
  assert.equal(persistedClaim.rows[0]?.delivery_attempt_count, 2);
  assert.ok(
    persistedClaim.rows[0]?.token_hash.equals(claimTokenA)
      || persistedClaim.rows[0]?.token_hash.equals(claimTokenB),
  );

  process.stdout.write("PostgreSQL two-connection context and signup resend isolation passed.\n");
} finally {
  await Promise.all([
    clientA.query("rollback").catch(() => undefined),
    clientB.query("rollback").catch(() => undefined),
  ]);
  await Promise.all([clientA.end(), clientB.end()]);
  await admin.query("reset role").catch(() => undefined);
  await admin.query("begin").catch(() => undefined);
  try {
    await admin.query("set role afterword_migration_owner");
    await admin.query(`
      delete from app_private.signup_intents where email = 'concurrency-signup@example.test';
      delete from public.support_sessions where id = '${fixture.supportA}';
      delete from app_private.auth_sessions where user_id in ('${fixture.userA}', '${fixture.userB}');
      delete from public.locations where id in ('${fixture.locationA}', '${fixture.locationB}');
      delete from public.business_memberships where user_id in ('${fixture.userA}', '${fixture.userB}');
      delete from public.businesses where id in ('${fixture.businessA}', '${fixture.businessB}');
      delete from public.agency_memberships where user_id in ('${fixture.userA}', '${fixture.userB}');
      delete from public.agencies where id in ('${fixture.agencyA}', '${fixture.agencyB}');
      delete from public.users where id in ('${fixture.userA}', '${fixture.userB}');
    `);
    await admin.query("commit");
  } catch {
    await admin.query("rollback").catch(() => undefined);
  }
  await admin.end();
}
