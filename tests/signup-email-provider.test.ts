import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { loadConfig } from "../server/config.js";
import {
  renderAccountVerificationEmail,
  TransactionalEmailDeliveryError,
  type AccountVerificationEmail,
} from "../server/onboarding/signup-email.js";
import { createBrevoTransactionalEmailProvider } from "../server/providers/brevo.js";

const productionDatabaseUrls = {
  AUTH_DATABASE_URL: "postgresql://auth:secret@db.example.com/afterword",
  RUNTIME_DATABASE_URL: "postgresql://runtime:secret@db.example.com/afterword",
  INGRESS_DATABASE_URL: "postgresql://ingress:secret@db.example.com/afterword",
  WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.com/afterword",
};

function productionConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "production",
    ...productionDatabaseUrls,
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: "test-session-pepper-that-is-longer-than-32-characters",
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    ...overrides,
  });
}

const emailInput: AccountVerificationEmail = {
  to: "owner@example.com",
  displayName: "Owner",
  verificationUrl: "https://app.example.com/signup/verify?token=opaque-token",
  expiresAt: new Date("2026-07-23T12:00:00.000Z"),
};

function brevoConfig() {
  return productionConfig({
    SIGNUP_EMAIL_ENABLED: "true",
    TRANSACTIONAL_EMAIL_PROVIDER: "brevo",
    BREVO_API_KEY: "test-brevo-key-that-is-long-enough",
    BREVO_ACCOUNT_SENDER_EMAIL: "accounts@reviewanchor.example",
    BREVO_ACCOUNT_SENDER_NAME: "Review Anchor Accounts",
  });
}

test("signup email can be disabled in production without provider secrets", () => {
  const config = productionConfig({ SIGNUP_EMAIL_ENABLED: "false" });
  assert.equal(config.SIGNUP_EMAIL_ENABLED, false);
});

test("enabled Brevo signup email requires every server-only sender setting", () => {
  assert.throws(
    () => productionConfig({
      SIGNUP_EMAIL_ENABLED: "true",
      TRANSACTIONAL_EMAIL_PROVIDER: "brevo",
    }),
    /BREVO_API_KEY/u,
  );
});

test("verification content is versioned, escaped, and contains one short-lived link", () => {
  const rendered = renderAccountVerificationEmail({
    displayName: "<Owner>",
    verificationUrl: "https://app.example.com/signup/verify?token=opaque",
    expiresAt: new Date("2026-07-23T12:00:00.000Z"),
  });
  assert.equal(rendered.version, "account-verification-v1");
  assert.doesNotMatch(rendered.html, /<Owner>/u);
  assert.match(rendered.html, /&lt;Owner&gt;/u);
  assert.equal(rendered.text.match(/https:\/\/app\.example\.com/g)?.length, 1);
});

test("Brevo sends one recipient with inline content and server-only authentication", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const provider = createBrevoTransactionalEmailProvider(brevoConfig(), async (url, init) => {
    captured = { url: String(url), init: init! };
    return new Response(JSON.stringify({ messageId: "<provider-id>" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  const result = await provider.sendAccountVerification(emailInput);
  assert.equal(captured?.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(new Headers(captured?.init.headers).get("api-key"), "test-brevo-key-that-is-long-enough");
  const body = JSON.parse(String(captured?.init.body));
  assert.equal(body.to.length, 1);
  assert.equal(body.to[0].email, emailInput.to);
  assert.equal(body.templateId, undefined);
  assert.match(body.htmlContent, /Verify your Review Anchor account/u);
  assert.equal(result.providerMessageId, "<provider-id>");
});

test("Brevo maps a timeout to a sanitized delivery error", async () => {
  const provider = createBrevoTransactionalEmailProvider(brevoConfig(), async () => {
    throw new DOMException("The operation timed out", "TimeoutError");
  });
  await assert.rejects(
    () => provider.sendAccountVerification(emailInput),
    (error: unknown) => error instanceof TransactionalEmailDeliveryError && error.kind === "timeout" && isSanitized(error.message),
  );
});

test("Brevo maps rejected responses to sanitized delivery errors", async () => {
  const provider = createBrevoTransactionalEmailProvider(brevoConfig(), async () => new Response("provider says no", { status: 400 }));
  await assert.rejects(
    () => provider.sendAccountVerification(emailInput),
    (error: unknown) => error instanceof TransactionalEmailDeliveryError && error.kind === "rejected" && isSanitized(error.message),
  );
});

test("Brevo maps malformed response JSON to a sanitized delivery error", async () => {
  const provider = createBrevoTransactionalEmailProvider(brevoConfig(), async () => new Response("not JSON", { status: 201 }));
  await assert.rejects(
    () => provider.sendAccountVerification(emailInput),
    (error: unknown) => error instanceof TransactionalEmailDeliveryError && error.kind === "invalid_response" && isSanitized(error.message),
  );
});

test("Brevo maps a missing provider message ID to a sanitized delivery error", async () => {
  const provider = createBrevoTransactionalEmailProvider(brevoConfig(), async () => new Response("{}", { status: 201 }));
  await assert.rejects(
    () => provider.sendAccountVerification(emailInput),
    (error: unknown) => error instanceof TransactionalEmailDeliveryError && error.kind === "invalid_response" && isSanitized(error.message),
  );
});

function isSanitized(message: string) {
  return !message.includes(emailInput.to)
    && !message.includes("opaque-token")
    && !message.includes(emailInput.verificationUrl)
    && !message.includes("provider says no");
}
