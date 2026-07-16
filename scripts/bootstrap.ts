import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadLocalEnvironment } from "../server/load-env.js";
import { hashPassword } from "../server/security/crypto.js";

loadLocalEnvironment();

const { Client } = pg;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const connectionString = required("MIGRATION_DATABASE_URL");
const email = required("BOOTSTRAP_EMAIL").toLowerCase();
const password = required("BOOTSTRAP_PASSWORD");
const displayName = required("BOOTSTRAP_DISPLAY_NAME");
const agencyName = required("BOOTSTRAP_AGENCY_NAME");
const businessName = required("BOOTSTRAP_BUSINESS_NAME");
const locationName = required("BOOTSTRAP_LOCATION_NAME");
const timezone = process.env.BOOTSTRAP_TIMEZONE?.trim() || "Europe/London";
const country = (process.env.BOOTSTRAP_COUNTRY?.trim().toUpperCase() || "GB");
if (!/^[A-Z]{2}$/.test(country)) throw new Error("BOOTSTRAP_COUNTRY must be a two-letter country code.");

const slug = (process.env.BOOTSTRAP_BUSINESS_SLUG?.trim() || businessName)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 60);
if (!slug) throw new Error("The business name could not be converted to a valid slug.");

const passwordHash = await hashPassword(password);
const client = new Client({ connectionString, application_name: "afterword-bootstrap" });
await client.connect();
try {
  await client.query("set role afterword_migration_owner");
  await client.query("begin");
  const existing = await client.query("select id from public.users where lower(btrim(email)) = $1", [email]);
  if (existing.rowCount) throw new Error("A user with BOOTSTRAP_EMAIL already exists; bootstrap is intentionally one-time.");

  const userId = randomUUID();
  const agencyId = randomUUID();
  const businessId = randomUUID();
  const locationId = randomUUID();
  await client.query("insert into public.users (id, auth_subject, email, display_name, mfa_required) values ($1,$2,$3,$4,false)", [
    userId, `first_party:${userId}`, email, displayName,
  ]);
  await client.query("insert into app_private.auth_credentials (user_id, password_hash, email_verified_at) values ($1,$2,statement_timestamp())", [userId, passwordHash]);
  await client.query("insert into public.agencies (id, name) values ($1,$2)", [agencyId, agencyName]);
  await client.query("insert into public.businesses (id, agency_id, name, slug, default_timezone, country_code, lifecycle_status) values ($1,$2,$3,$4,$5,$6,'active')", [
    businessId, agencyId, businessName, slug, timezone, country,
  ]);
  await client.query("insert into public.business_memberships (business_id, user_id, role, status) values ($1,$2,'owner','active')", [businessId, userId]);
  await client.query("insert into public.locations (id, business_id, name, timezone, status) values ($1,$2,$3,$4,'active')", [locationId, businessId, locationName, timezone]);

  const templates = [
    ["sms", "Hi {{first_name}}, thanks for choosing {{business_name}}. Would you leave an honest Google review? {{review_link}} Reply STOP to opt out.", null],
    ["email", "Hi {{first_name}}, thanks for choosing {{business_name}}. Would you leave an honest Google review? {{review_link}}\n\nUnsubscribe: {{unsubscribe_link}}", "How was your experience with {{business_name}}?"],
  ] as const;
  for (const [channel, body, subject] of templates) {
    await client.query(`
      insert into public.message_template_versions (
        business_id, location_id, template_key, version, channel, body, subject,
        includes_business_identity, includes_unsubscribe, approved_by
      ) values ($1,$2,$3,1,$4,$5,$6,true,true,$7)
    `, [businessId, locationId, `google-review-${channel}`, channel, body, subject, userId]);
    await client.query(`
      insert into public.location_messaging_policies (
        business_id, location_id, channel, enabled, timezone, rule_version, updated_by
      ) values ($1,$2,$3,true,$4,'pilot-v1',$5)
    `, [businessId, locationId, channel, timezone, userId]);
  }

  let twilioIntegrationId: string | undefined;
  if (process.env.TWILIO_ACCOUNT_SID?.trim()
      && process.env.TWILIO_AUTH_TOKEN?.trim()
      && (process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_MESSAGING_SERVICE_SID?.trim())) {
    twilioIntegrationId = randomUUID();
    await client.query(`
      insert into public.integration_connections (
        id, business_id, location_id, provider, health, secret_reference
      ) values ($1,$2,$3,'twilio','connected','environment:TWILIO_PROVIDER_CREDENTIALS')
    `, [twilioIntegrationId, businessId, locationId]);
  }

  let sendGridIntegrationId: string | undefined;
  if (process.env.SENDGRID_API_KEY?.trim()
      && process.env.SENDGRID_FROM_EMAIL?.trim()
      && process.env.SENDGRID_ASM_GROUP_ID?.trim()) {
    sendGridIntegrationId = randomUUID();
    await client.query(`
      insert into public.integration_connections (
        id, business_id, location_id, provider, health, secret_reference
      ) values ($1,$2,$3,'sendgrid','connected','environment:SENDGRID_PROVIDER_CREDENTIALS')
    `, [sendGridIntegrationId, businessId, locationId]);
  }

  await client.query("commit");
  process.stdout.write(JSON.stringify({
    userId,
    agencyId,
    businessId,
    locationId,
    twilioIntegrationId,
    sendGridIntegrationId,
    email,
  }, null, 2) + "\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
