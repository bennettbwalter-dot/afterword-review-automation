import { randomUUID } from "node:crypto";
import pg from "pg";
import { databaseTlsOptions } from "../server/database-tls.js";
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
const planKey = (process.env.BOOTSTRAP_PLAN?.trim() || "pro_monthly") as "pro_monthly" | "pro_annual" | "multi_monthly";
if (!["pro_monthly", "pro_annual", "multi_monthly"].includes(planKey)) {
  throw new Error("BOOTSTRAP_PLAN must be pro_monthly, pro_annual or multi_monthly.");
}
const multiSetupFee = Number(process.env.BOOTSTRAP_MULTI_SETUP_FEE_PENCE || 24900);
if (planKey === "multi_monthly" && ![24900, 34900].includes(multiSetupFee)) {
  throw new Error("BOOTSTRAP_MULTI_SETUP_FEE_PENCE must be 24900 or 34900 for Reputation Multi.");
}
const commercialPlan = planKey === "pro_annual"
  ? { cycle: "annual", subscription: 39000, setup: 14900, allowance: 100 }
  : planKey === "multi_monthly"
    ? { cycle: "monthly", subscription: 7900, setup: multiSetupFee, allowance: 300 }
    : { cycle: "monthly", subscription: 3900, setup: 14900, allowance: 100 };
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
const ssl = databaseTlsOptions(process.env.DATABASE_SSL === "require");
const client = new Client({ connectionString, ssl, application_name: "afterword-bootstrap" });
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
  await client.query(`
    insert into public.billing_accounts (
      business_id, plan_key, subscription_status, billing_cycle,
      subscription_price_pence, setup_fee_pence, sms_base_allowance,
      sms_overage_policy, current_period_start, current_period_end, updated_by
    ) values (
      $1,$2,'pilot',$3,$4,$5,$6,'pause_sms',statement_timestamp(),
      statement_timestamp() + case when $3 = 'annual' then interval '1 year' else interval '1 month' end,
      $7
    )
    on conflict (business_id) do update set
      plan_key = excluded.plan_key,
      subscription_status = excluded.subscription_status,
      billing_cycle = excluded.billing_cycle,
      subscription_price_pence = excluded.subscription_price_pence,
      setup_fee_pence = excluded.setup_fee_pence,
      sms_base_allowance = excluded.sms_base_allowance,
      sms_overage_policy = excluded.sms_overage_policy,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      updated_by = excluded.updated_by,
      updated_at = statement_timestamp()
  `, [businessId, planKey, commercialPlan.cycle, commercialPlan.subscription, commercialPlan.setup, commercialPlan.allowance, userId]);

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
    planKey,
    email,
  }, null, 2) + "\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
