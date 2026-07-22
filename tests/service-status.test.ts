import assert from "node:assert/strict";
import test from "node:test";
import { describeServiceStatus } from "../server/routes/service-status.js";
import type { AppConfig } from "../server/config.js";

const baseConfig = {
  STRIPE_CHECKOUT_ENABLED: false,
} as unknown as AppConfig;

function statusFor(overrides: Partial<AppConfig>) {
  return describeServiceStatus({ ...baseConfig, ...overrides } as AppConfig);
}

function find(config: Partial<AppConfig>, key: string) {
  const service = statusFor(config).find((entry) => entry.key === key);
  assert.ok(service, `expected a ${key} service entry`);
  return service;
}

test("an unconfigured deployment reports every provider as unavailable", () => {
  const services = statusFor({});
  const configured = services.filter((service) => service.configured);
  assert.deepEqual(configured, []);
  for (const service of services) {
    assert.ok(service.detail.length > 0, `${service.key} must explain its state`);
    assert.ok(service.requires.length > 0, `${service.key} must name its requirements`);
  }
});

test("Google requires a complete OAuth triple", () => {
  assert.equal(find({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }, "google").configured, false);
  assert.equal(
    find({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "https://example.com/cb" }, "google").configured,
    true,
  );
});

test("review monitoring additionally requires Pub/Sub verification", () => {
  const googleOnly = {
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REDIRECT_URI: "https://example.com/cb",
  } satisfies Partial<AppConfig>;
  assert.equal(find(googleOnly, "reviewSync").configured, false);
  assert.equal(
    find({
      ...googleOnly,
      GOOGLE_PUBSUB_AUDIENCE: "https://example.com/push",
      GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
    }, "reviewSync").configured,
    true,
  );
});

test("SMS accepts either a from-number or a messaging service", () => {
  const credentials = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "token" } satisfies Partial<AppConfig>;
  assert.equal(find(credentials, "sms").configured, false);
  assert.equal(find({ ...credentials, TWILIO_FROM_NUMBER: "+15550100" }, "sms").configured, true);
  assert.equal(find({ ...credentials, TWILIO_MESSAGING_SERVICE_SID: "MG1" }, "sms").configured, true);
});

test("email requires both an API key and a verified sender", () => {
  assert.equal(find({ SENDGRID_API_KEY: "key" }, "email").configured, false);
  assert.equal(find({ SENDGRID_API_KEY: "key", SENDGRID_FROM_EMAIL: "hello@example.com" }, "email").configured, true);
});

test("WhatsApp is reported as not implemented rather than merely unconfigured", () => {
  const whatsapp = find({}, "whatsapp");
  assert.equal(whatsapp.configured, false);
  assert.match(whatsapp.detail, /not implemented/i);
});

test("checkout stays unavailable until every Price and the enable flag are present", () => {
  const prices = {
    STRIPE_API_KEY: "sk_test_key",
    STRIPE_PRICE_PRO_MONTHLY: "price_1",
    STRIPE_PRICE_PRO_ANNUAL: "price_2",
    STRIPE_PRICE_MULTI_MONTHLY: "price_3",
    STRIPE_PRICE_SETUP_PRO: "price_4",
    STRIPE_PRICE_SETUP_MULTI_2_3: "price_5",
    STRIPE_PRICE_SETUP_MULTI_4_5: "price_6",
  } satisfies Partial<AppConfig>;

  assert.equal(find(prices, "stripeCheckout").configured, false, "disabled flag must keep checkout unavailable");
  assert.equal(find({ ...prices, STRIPE_CHECKOUT_ENABLED: true }, "stripeCheckout").configured, true);

  const { STRIPE_PRICE_SETUP_MULTI_4_5: _omitted, ...missingSetupPrice } = prices;
  assert.equal(
    find({ ...missingSetupPrice, STRIPE_CHECKOUT_ENABLED: true }, "stripeCheckout").configured,
    false,
    "a missing setup Price must keep checkout unavailable",
  );
});

test("service status never exposes credential values", () => {
  const services = statusFor({
    GOOGLE_CLIENT_ID: "super-secret-client-id",
    GOOGLE_CLIENT_SECRET: "super-secret-client-secret",
    GOOGLE_REDIRECT_URI: "https://example.com/cb",
    STRIPE_API_KEY: "sk_test_super_secret_value",
    TWILIO_AUTH_TOKEN: "twilio-secret-token",
    SENDGRID_API_KEY: "sendgrid-secret-key",
  });
  const serialised = JSON.stringify(services);
  for (const secret of [
    "super-secret-client-id",
    "super-secret-client-secret",
    "sk_test_super_secret_value",
    "twilio-secret-token",
    "sendgrid-secret-key",
  ]) {
    assert.equal(serialised.includes(secret), false, `service status leaked ${secret}`);
  }
});
