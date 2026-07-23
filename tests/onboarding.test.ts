import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";
import { hashPassword } from "../server/security/crypto.js";
import type { PlatformRepository } from "../server/types.js";

const origin = "http://127.0.0.1:4173";
const config = loadConfig({
  NODE_ENV: "test", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
  APP_ORIGIN: origin, SESSION_PEPPER: "test-session-pepper-that-is-longer-than-32-characters",
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
});

function repository() {
  const issued: Array<{ email: string; accountType: string; tokenHash: Buffer; displayName: string }> = [];
  const registrations: unknown[] = [];
  const fake = {
    async createSignupIntent(input: { email: string; accountType: string; tokenHash: Buffer; displayName: string }) {
      issued.push(input); return { accepted: true, shouldSendEmail: true };
    },
    async consumeSignupIntent(tokenHash: Buffer) {
      const index = issued.findIndex((intent) => intent.tokenHash.equals(tokenHash));
      const intent = index >= 0 ? issued.splice(index, 1)[0] : undefined;
      return intent ? { verifiedSignupId: randomUUID(), email: intent.email, accountType: intent.accountType, displayName: intent.displayName } : null;
    },
    async registerVerifiedSignup(input: unknown) {
      registrations.push(input); return { userId: randomUUID(), sessionId: randomUUID(), businessId: randomUUID(), locationId: randomUUID(), agencyId: randomUUID(), onboardingStep: "google_connection" };
    },
  } as unknown as PlatformRepository & { issued: typeof issued; registrations: typeof registrations };
  Object.assign(fake, { issued, registrations });
  return fake;
}

test("signup intent gives the same generic response for registered and new emails without retaining a password", async () => {
  const repo = repository();
  const app = await buildApp({ config, repository: repo });
  try {
    const headers = { origin };
    const fresh = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents", headers, payload: { email: "new@example.com", displayName: "New owner", accountType: "business" } });
    const known = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents", headers, payload: { email: "owner@example.com", displayName: "Known owner", accountType: "business" } });
    assert.equal(fresh.statusCode, 202);
    assert.deepEqual({ accepted: fresh.json().data.accepted, message: fresh.json().data.message }, { accepted: known.json().data.accepted, message: known.json().data.message });
    assert.equal(repo.issued.length, 2);
    assert.equal("password" in repo.issued[0]!, false);
    assert.equal(repo.issued[0]!.tokenHash.length, 32);
  } finally { await app.close(); }
});

test("signup verification is same-origin, short-lived cookie backed, and single use", async () => {
  const repo = repository();
  const app = await buildApp({ config, repository: repo });
  try {
    const start = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents", headers: { origin }, payload: { email: "new@example.com", displayName: "New owner", accountType: "agency" } });
    assert.equal(start.statusCode, 202);
    const token = start.json().data.debugToken as string;
    const denied = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents/verify", headers: { origin: "https://evil.example" }, payload: { token } });
    assert.equal(denied.statusCode, 403);
    const verified = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents/verify", headers: { origin }, payload: { token } });
    assert.equal(verified.statusCode, 200);
    assert.match(String(verified.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(verified.headers["set-cookie"]), /SameSite=Strict/);
    const replay = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents/verify", headers: { origin }, payload: { token } });
    assert.equal(replay.statusCode, 400);
  } finally { await app.close(); }
});

test("registration requires a verified cookie, hashes its scrypt credential and creates direct versus agency ownership atomically", async () => {
  const repo = repository();
  const app = await buildApp({ config, repository: repo });
  try {
    const rejected = await app.inject({ method: "POST", url: "/api/v1/auth/register", headers: { origin }, payload: { password: "correct horse battery staple", accountType: "business", businessName: "One", locationName: "Main", country: "GB", timezone: "Europe/London" } });
    assert.equal(rejected.statusCode, 401);
    const created = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents", headers: { origin }, payload: { email: "new@example.com", displayName: "New owner", accountType: "business" } });
    const verified = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents/verify", headers: { origin }, payload: { token: created.json().data.debugToken } });
    const cookie = String(verified.headers["set-cookie"]).split(";", 1)[0];
    const registered = await app.inject({ method: "POST", url: "/api/v1/auth/register", headers: { origin, cookie }, payload: { password: "correct horse battery staple", accountType: "business", businessName: "One Plumbing", locationName: "Main", country: "GB", timezone: "Europe/London" } });
    assert.equal(registered.statusCode, 201);
    assert.match(String(registered.headers["set-cookie"]), /afterword_session=/);
    assert.equal(repo.registrations.length, 1);
    const captured = repo.registrations[0] as { passwordHash: string; accountType: string; directContainer: boolean };
    assert.match(captured.passwordHash, /^scrypt\$/);
    assert.equal(captured.accountType, "business");
    assert.equal(captured.directContainer, true);
  } finally { await app.close(); }
});

test("password hashing remains scrypt-compatible for registration", async () => {
  assert.match(await hashPassword("correct horse battery staple"), /^scrypt\$/);
});

test("signup intent returns the same generic response when transactional email delivery fails", async () => {
  const repo = repository();
  const app = await buildApp({ config, repository: repo, transactionalEmail: { availability() { return { available: true }; }, async sendAccountVerification() { throw new Error("provider unavailable"); } } });
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents", headers: { origin }, payload: { email: "new@example.com", displayName: "New owner", accountType: "business" } });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().data.accepted, true);
  } finally { await app.close(); }
});

test("onboarding migration projects a direct-container owner as a business owner before agency roles", async () => {
  const schema = await readFile(path.resolve("database", "migrations", "010_signup_onboarding.sql"), "utf8");
  assert.match(schema, /drop\s+function\s+app_private\.resolve_auth_session_with_role\(bytea\)/i);
  assert.match(schema, /agency\.customer_kind\s*=\s*'direct_container'[\s\S]+then\s+'business_owner'/i);
  assert.doesNotMatch(schema, /when\s+agency_membership\.role::text\s+in\s*\('owner',\s*'admin'\)\s+then\s+'agency_admin'[\s\S]{0,120}direct_container/i);
});

test("production signup email capability fails closed when Brevo credentials are absent", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", AUTH_DATABASE_URL: "postgresql://auth:a@db.example.com/x", RUNTIME_DATABASE_URL: "postgresql://runtime:a@db.example.com/x", INGRESS_DATABASE_URL: "postgresql://ingress:a@db.example.com/x", WORKER_DATABASE_URL: "postgresql://worker:a@db.example.com/x", APP_ORIGIN: "https://app.example.com", SESSION_PEPPER: "test-session-pepper-that-is-longer-than-32-characters", FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), SIGNUP_EMAIL_ENABLED: "true", TRANSACTIONAL_EMAIL_PROVIDER: "brevo" }), /BREVO_API_KEY/i);
});
