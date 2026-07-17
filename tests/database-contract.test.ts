import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("every PostgreSQL command used by the repository exists in the forward migrations", async () => {
  const repository = await readFile(path.resolve("server", "repository", "postgres.ts"), "utf8");
  const migrationDirectory = path.resolve("database", "migrations");
  const migrations = await Promise.all(
    (await readdir(migrationDirectory))
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .map((file) => readFile(path.join(migrationDirectory, file), "utf8")),
  );
  const schema = migrations.join("\n");
  const commandNames = new Set(
    [...repository.matchAll(/app_private\.([a-z][a-z0-9_]*)/g)].map((match) => match[1]),
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
