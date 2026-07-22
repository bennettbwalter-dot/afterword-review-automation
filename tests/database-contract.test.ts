import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("every PostgreSQL command used by the repository exists in the forward migrations", async () => {
  const postgresModules = (await readdir(path.resolve("server"), { recursive: true }))
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((entry) => /(?:^|\/)postgres\.ts$/.test(entry));
  const repositories = await Promise.all(postgresModules.map((entry) => readFile(path.resolve("server", entry), "utf8")));
  const migrationDirectory = path.resolve("database", "migrations");
  const migrations = await Promise.all(
    (await readdir(migrationDirectory))
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .map((file) => readFile(path.join(migrationDirectory, file), "utf8")),
  );
  const schema = migrations.join("\n");
  const commandNames = new Set(
    [...repositories.join("\n").matchAll(/app_private\.([a-z][a-z0-9_]*)/g)].map((match) => match[1]),
  );

  assert.ok(commandNames.size > 20, "The repository command scan unexpectedly found too few database commands.");
  for (const commandName of commandNames) {
    assert.match(
      schema,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+app_private\\.${commandName}\\s*\\(`, "i"),
      `Missing migration function for app_private.${commandName}`,
    );
  }
});

test("token revocation has no unfenced authentication-role shortcut", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "003_authenticated_review_automation.sql"),
    "utf8",
  );
  assert.doesNotMatch(schema, /create\s+or\s+replace\s+function\s+app_private\.complete_google_token_revocation/i);
  assert.doesNotMatch(schema, /grant\s+execute[^;]*complete_google_token_revocation[^;]*afterword_auth/i);
  assert.match(schema, /grant\s+execute[^;]*finish_google_token_revocation[^;]*afterword_worker/i);
});

test("authenticated sessions expose only an unambiguous initial tenant role without replacing the legacy resolver", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "008_expose_business_membership_role.sql"),
    "utf8",
  );
  assert.match(schema, /returns\s+table\s*\([^)]*business_role\s+public\.business_role/is);
  assert.match(schema, /select\s+membership\.business_id,\s*membership\.role/is);
  assert.match(schema, /not\s+exists\s*\([^)]*other_membership\.user_id\s*=\s*users\.id[^)]*other_membership\.business_id\s*<>\s*membership\.business_id/is);
  assert.match(schema, /grant\s+execute\s+on\s+function\s+app_private\.resolve_auth_session_with_role\(bytea\)\s+to\s+afterword_auth/i);
  assert.doesNotMatch(schema, /drop\s+function\s+app_private\.resolve_auth_session/i);
});

test("content-role migration is forward-only and keeps role projections fail closed", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "009_add_content_roles.sql"),
    "utf8",
  );
  const databaseTest = await readFile(path.resolve("database", "tests", "004_content_roles.sql"), "utf8");

  assert.match(schema, /alter\s+type\s+public\.agency_role\s+add\s+value\s+if\s+not\s+exists\s+'operator'/i);
  assert.match(schema, /alter\s+type\s+public\.business_role\s+add\s+value\s+if\s+not\s+exists\s+'approver'/i);
  assert.doesNotMatch(schema, /drop\s+type\s+public\.(?:agency_role|business_role)/i);
  assert.match(schema, /drop\s+function\s+app_private\.resolve_auth_session_with_role\(bytea\)\s*;/i);
  assert.match(schema, /create\s+function\s+app_private\.resolve_auth_session_with_role\(p_token_hash\s+bytea\)/i);
  assert.doesNotMatch(schema, /create\s+or\s+replace\s+function\s+app_private\.resolve_auth_session_with_role/i);
  assert.match(schema, /membership\.role::text\s+in\s*\('owner',\s*'admin',\s*'operator',\s*'support'\)/i);
  assert.match(schema, /when\s+agency_membership\.role::text\s*=\s*'operator'\s+then\s+'agency_user'/i);
  assert.match(schema, /when\s+business_membership\.role::text\s*=\s*'approver'\s+then\s+'client_approver'/i);
  assert.match(schema, /active_business_membership\.status\s*=\s*'active'/i);
  assert.match(schema, /set\s+search_path\s*=\s+pg_catalog/i);
  assert.match(schema, /revoke\s+all\s+on\s+function\s+app_private\.resolve_auth_session_with_role\(bytea\)\s+from\s+public/i);
  assert.match(schema, /grant\s+execute\s+on\s+function\s+app_private\.resolve_auth_session_with_role\(bytea\)\s+to\s+afterword_auth/i);
  assert.match(schema, /create\s+or\s+replace\s+function\s+app_private\.start_support_session\(/i);
  assert.match(schema, /v_agency_role::text\s+not\s+in\s*\('owner',\s*'admin',\s*'support'\)/i);
  assert.match(databaseTest, /agency operator/i);
  assert.match(databaseTest, /business approver/i);
  assert.match(databaseTest, /coalesce\(product_role::text,\s*''\)\s+as\s+product_role/i);
});

test("provider-independent support sessions require a real agency customer before insertion", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "019_provider_independent_security.sql"),
    "utf8",
  ).catch(() => "");
  const databaseTest = await readFile(
    path.resolve("database", "tests", "007_provider_independent_security.sql"),
    "utf8",
  );

  assert.match(schema, /create\s+or\s+replace\s+function\s+app_private\.start_support_session\s*\(\s*p_business_id\s+uuid,\s*p_scope\s+public\.support_scope,\s*p_reason\s+text,\s*p_duration_minutes\s+integer,\s*p_correlation_id\s+uuid\s*\)/i);
  assert.match(schema, /select\s+business\.agency_id[\s\S]+from\s+public\.businesses\s+business[\s\S]+business\.id\s*=\s*p_business_id/i);
  assert.match(schema, /if\s+not\s+exists\s*\([\s\S]+from\s+public\.agencies\s+agency[\s\S]+agency\.id\s*=\s*v_agency_id[\s\S]+agency\.customer_kind\s*=\s*'agency'[\s\S]+raise exception 'agency customer support identity is required'[\s\S]+insert\s+into\s+public\.support_sessions/i);
  assert.match(schema, /set\s+search_path\s*=\s*pg_catalog/i);
  assert.match(schema, /revoke\s+all\s+on\s+function\s+app_private\.start_support_session\(uuid,\s*public\.support_scope,\s*text,\s*integer,\s*uuid\)[\s\S]+from\s+public,\s*afterword_auth,\s*afterword_runtime,\s*afterword_ingress,\s*afterword_worker,\s*afterword_ops/i);
  assert.match(schema, /grant\s+execute\s+on\s+function\s+app_private\.start_support_session\(uuid,\s*public\.support_scope,\s*text,\s*integer,\s*uuid\)\s+to\s+afterword_runtime/i);
  for (const assertion of [
    "direct_container_cannot_start_support_session",
    "agency_customer_can_start_support_session",
    "direct_container_is_excluded_from_expected_legacy_scopes",
    "agency_customer_remains_in_expected_legacy_scopes",
  ]) {
    assert.match(databaseTest, new RegExp(assertion, "i"));
  }
  for (const block of databaseTest.match(/do \$\$[\s\S]*?end \$\$;/gi) ?? []) {
    assert.doesNotMatch(block, /:'[A-Za-z_][A-Za-z0-9_]*'/);
  }
});

test("SMS billing migration is forward-only, tenant-isolated and worker-fenced", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "004_sms_billing_and_location_reporting.sql"),
    "utf8",
  );

  for (const table of ["billing_accounts", "sms_allowance_bundles", "sms_usage_reservations", "sms_usage_alerts"]) {
    assert.match(schema, new RegExp(`create\\s+table\\s+public\\.${table}`, "i"));
    assert.match(schema, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, "i"));
    assert.match(schema, new RegExp(`create\\s+policy\\s+migration_owner_all\\s+on\\s+public\\.${table}`, "i"));
  }

  assert.match(schema, /grant\s+execute\s+on\s+function\s+app_private\.reserve_sms_segments\([^;]+to\s+afterword_worker/i);
  assert.doesNotMatch(schema, /grant\s+execute\s+on\s+function\s+app_private\.reserve_sms_segments\([^;]+to\s+afterword_runtime/i);
  assert.match(schema, /subscription_price_pence\s*=\s*3900[^;]+sms_base_allowance\s*=\s*100/i);
  assert.match(schema, /subscription_price_pence\s*=\s*39000[^;]+sms_base_allowance\s*=\s*100/i);
  assert.match(schema, /subscription_price_pence\s*=\s*7900[^;]+setup_fee_pence\s+in\s*\(24900,\s*34900\)[^;]+sms_base_allowance\s*=\s*300/i);
  assert.match(schema, /segments\s+integer\s+not\s+null\s+default\s+100[^;]+amount_pence\s+integer\s+not\s+null\s+default\s+1000/i);
});

test("Stripe billing migration is replay-safe, ingress-fenced and requires paid setup before activation", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "005_stripe_checkout_and_webhooks.sql"),
    "utf8",
  );

  assert.match(schema, /create\s+table\s+app_private\.stripe_checkout_attempts/i);
  assert.match(schema, /create\s+table\s+app_private\.stripe_billing_events/i);
  assert.match(schema, /event_id\s+text\s+primary\s+key/i);
  assert.match(schema, /on\s+conflict\s*\(event_id\)\s+do\s+nothing/i);
  assert.match(schema, /payload_hash\s*<>\s*p_payload_hash/i);
  assert.match(schema, /when\s+'active'\s+then\s+case\s+when\s+setup_fee_paid_at\s+is\s+not\s+null\s+then\s+'active'/i);
  assert.match(schema, /grant\s+execute\s+on\s+function\s+app_private\.apply_stripe_billing_event\([^;]+to\s+afterword_ingress/i);
  assert.doesNotMatch(schema, /grant\s+execute\s+on\s+function\s+app_private\.apply_stripe_billing_event\([^;]+to\s+afterword_runtime/i);
  assert.match(schema, /current_support_session_id\(\)\s+is\s+not\s+null[^;]+billing_checkout_access_denied/is);
});

test("Stripe readiness view grants only its required underlying columns to runtime", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "006_grant_runtime_stripe_readiness_columns.sql"),
    "utf8",
  );

  assert.match(
    schema,
    /grant\s+select\s*\(\s*stripe_customer_id\s*,\s*stripe_subscription_id\s*,\s*setup_fee_paid_at\s*\)\s+on\s+public\.billing_accounts\s+to\s+afterword_runtime/i,
  );
  assert.doesNotMatch(schema, /to\s+(?:afterword_auth|afterword_ingress|afterword_worker|public)/i);
  assert.doesNotMatch(schema, /grant\s+(?:insert|update|delete|all)/i);
});

test("workspace reporting grants only the missing QR and consent columns", async () => {
  const schema = await readFile(
    path.resolve("database", "migrations", "007_grant_runtime_workspace_reporting_columns.sql"),
    "utf8",
  );

  assert.match(
    schema,
    /grant\s+select\s*\(\s*anonymous_visitor_hash\s*\)\s+on\s+public\.qr_scan_events\s+to\s+afterword_runtime/i,
  );
  assert.match(
    schema,
    /grant\s+select\s*\(\s*transaction_reference\s*\)\s+on\s+public\.consent_records\s+to\s+afterword_runtime/i,
  );
  assert.doesNotMatch(schema, /to\s+(?:afterword_auth|afterword_ingress|afterword_worker|public)/i);
  assert.doesNotMatch(schema, /grant\s+(?:insert|update|delete|all)/i);
});

test("location QR reporting derives location through the QR code", async () => {
  const repository = await readFile(path.resolve("server", "repository", "postgres.ts"), "utf8");

  assert.doesNotMatch(repository, /scan\.location_id/i);
  assert.match(
    repository,
    /from\s+public\.qr_scan_events\s+scan\s+join\s+public\.qr_codes\s+scan_code[\s\S]+scan_code\.location_id\s*=\s*location\.id/i,
  );
});
