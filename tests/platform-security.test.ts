import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthenticatedSession } from "../src/platform/api.ts";
import {
  ADMIN_SESSION,
  BUSINESSES,
  INITIAL_QR_CODES_BY_BUSINESS,
  INITIAL_REQUESTS_BY_BUSINESS,
  OWNER_SESSION,
  REVIEWS_BY_BUSINESS,
  canConfigureTenant,
  canManageBilling,
  canReadTenantData,
  isSupportSessionActive,
  makeAuditEvent,
  projectProductRole,
  startSupportSession,
  validateNeutralReviewTemplate,
  type SessionContext,
} from "../src/platform/domain.ts";
import { PostgresRepository } from "../server/repository/postgres.ts";

const now = new Date("2026-07-16T12:00:00.000Z");

test("business owners are limited to their own tenant", () => {
  assert.equal(canReadTenantData(OWNER_SESSION, "business_123", null, now), true);
  assert.equal(canReadTenantData(OWNER_SESSION, "business_201", null, now), false);
  assert.equal(canConfigureTenant(OWNER_SESSION, "business_201", null, now), false);
});

test("business membership roles fail closed before database authorisation", () => {
  const session = (businessRole: SessionContext["businessRole"]): SessionContext => ({
    ...OWNER_SESSION,
    businessRole,
  });
  for (const businessRole of ["owner", "admin"] as const) {
    assert.equal(canConfigureTenant(session(businessRole), "business_123", null, now), true);
    assert.equal(canManageBilling(session(businessRole), "business_123"), true);
  }
  for (const businessRole of ["operator", "viewer"] as const) {
    assert.equal(canReadTenantData(session(businessRole), "business_123", null, now), true);
    assert.equal(canConfigureTenant(session(businessRole), "business_123", null, now), false);
    assert.equal(canManageBilling(session(businessRole), "business_123"), false);
  }
  assert.equal(canReadTenantData(session("billing"), "business_123", null, now), false);
  assert.equal(canConfigureTenant(session("billing"), "business_123", null, now), false);
  assert.equal(canManageBilling(session("billing"), "business_123"), true);
  assert.equal(canManageBilling(session("billing"), "business_201"), false);
});

test("content roles project narrowly without widening legacy membership access", () => {
  assert.equal(projectProductRole({ businessRole: "owner" }), "owner");
  assert.equal(projectProductRole({ businessRole: "admin" }), "owner");
  assert.equal(projectProductRole({ businessRole: "operator" }), "staff");
  assert.equal(projectProductRole({ businessRole: "approver" }), "client_approver");
  assert.equal(projectProductRole({ agencyRole: "owner" }), "owner");
  assert.equal(projectProductRole({ agencyRole: "admin" }), "owner");
  assert.equal(projectProductRole({ agencyRole: "operator" }), "staff");
  assert.equal(projectProductRole({ businessRole: "viewer" }), undefined);
  assert.equal(projectProductRole({ businessRole: "billing" }), undefined);
  assert.equal(projectProductRole({ agencyRole: "support" }), undefined);

  const approver: SessionContext = { ...OWNER_SESSION, businessRole: "approver" };
  assert.equal(canReadTenantData(approver, "business_123", null, now), false);
  assert.equal(canConfigureTenant(approver, "business_123", null, now), false);
  assert.equal(canManageBilling(approver, "business_123"), false);
});

test("agency operators cannot create support sessions", () => {
  const operator: SessionContext = {
    ...ADMIN_SESSION,
    role: "agency_user",
    agencyRole: "operator",
  };
  assert.throws(
    () => startSupportSession(operator, { businessId: "business_123", reason: "SUP-187 operator attempt", scope: "view", durationMinutes: 15 }, now),
    /agency administrator or support member/i,
  );
});

test("billing membership is limited to Settings and Billing", () => {
  const billing: SessionContext = { ...OWNER_SESSION, businessRole: "billing" };
  assert.equal(canManageBilling(billing, "business_123"), true);
  assert.equal(canReadTenantData(billing, "business_123", null, now), false);
  assert.equal(canConfigureTenant(billing, "business_123", null, now), false);
});

test("agency-user sessions survive client parsing with their narrow role", () => {
  const session = parseAuthenticatedSession({
    userId: "agency-operator",
    userName: "Agency Operator",
    role: "agency_user",
    agencyRole: "operator",
    productRole: "staff",
    mfaVerified: true,
  });
  assert.equal(session.role, "agency_user");
  assert.equal(session.agencyRole, "operator");
  assert.equal(session.productRole, "staff");
});

test("repository rejects unknown non-null business roles before they reach permissions", async () => {
  const repository = new PostgresRepository({
    authPool: {
      query: async () => ({
        rows: [{
          session_id: "session-unknown-role",
          user_id: "user-unknown-role",
          email: "unknown-role@example.test",
          display_name: "Unknown Role",
          agency_id: null,
          agency_role: null,
          business_id: "business-unknown-role",
          business_role: "future_untrusted_role",
          platform_role: "business_owner",
          product_role: null,
          mfa_verified_at: null,
          step_up_verified_at: null,
        }],
      }),
    } as never,
    config: { FIELD_ENCRYPTION_KEY: "test-key", SESSION_PEPPER: "test-pepper" },
  });
  assert.equal(await repository.resolveLoginSession(Buffer.from("unknown-role")), null);
});

test("agency portfolio access does not silently grant tenant data access", () => {
  assert.equal(canReadTenantData(ADMIN_SESSION, "business_123", null, now), false);
  assert.equal(canConfigureTenant(ADMIN_SESSION, "business_123", null, now), false);
});

test("view-only support sessions cannot mutate tenant configuration", () => {
  const session = startSupportSession(
    ADMIN_SESSION,
    { businessId: "business_123", reason: "SUP-184 reconnect investigation", scope: "view", durationMinutes: 15 },
    now,
  );
  assert.equal(isSupportSessionActive(session, new Date("2026-07-16T12:14:59.000Z")), true);
  assert.equal(canReadTenantData(ADMIN_SESSION, "business_123", session, now), true);
  assert.equal(canReadTenantData(ADMIN_SESSION, "business_201", session, now), false);
  assert.equal(canConfigureTenant(ADMIN_SESSION, "business_123", session, now), false);
  assert.equal(canReadTenantData({ ...ADMIN_SESSION, userId: "user_admin_other" }, "business_123", session, now), false);
  assert.equal(canReadTenantData(ADMIN_SESSION, "business_123", session, new Date(session.expiresAt)), false);
  assert.equal(isSupportSessionActive({ ...session, startedAt: "2026-07-16T12:01:00.000Z" }, now), false);
});

test("seeded tenant rows cannot drift into another business scope", () => {
  const knownBusinessIds = new Set(BUSINESSES.map((business) => business.id));
  for (const business of BUSINESSES) {
    assert.ok((INITIAL_REQUESTS_BY_BUSINESS[business.id] ?? []).every((request) => request.businessId === business.id));
    assert.ok((INITIAL_REQUESTS_BY_BUSINESS[business.id] ?? []).every((request) => request.consentStatus === "Missing" || Boolean(request.consentReference && request.consentCapturedAt && request.consentWordingVersion)));
    assert.ok((REVIEWS_BY_BUSINESS[business.id] ?? []).every((review) => review.businessId === business.id));
    assert.equal(new Set(business.teamMembers.map((member) => member.name)).size, business.teamMembers.length);
  }
  assert.ok(Object.keys(INITIAL_REQUESTS_BY_BUSINESS).every((businessId) => knownBusinessIds.has(businessId)));
  assert.ok(Object.keys(REVIEWS_BY_BUSINESS).every((businessId) => knownBusinessIds.has(businessId)));
  assert.ok(Object.keys(INITIAL_QR_CODES_BY_BUSINESS).every((businessId) => knownBusinessIds.has(businessId)));
  assert.equal(new Set(Object.values(INITIAL_QR_CODES_BY_BUSINESS).map((record) => record.publicToken)).size, BUSINESSES.length);
  for (const [businessId, record] of Object.entries(INITIAL_QR_CODES_BY_BUSINESS)) {
    assert.equal(record.businessId, businessId);
    assert.match(record.publicToken, /^[a-z0-9-]{16,80}$/);
    assert.ok(record.artworkRevision > 0);
  }
  const allTeamNames = BUSINESSES.flatMap((business) => business.teamMembers.map((member) => member.name));
  assert.equal(new Set(allTeamNames).size, allTeamNames.length);
});

test("configuration support requires recent step-up verification", () => {
  const staleAdmin: SessionContext = { ...ADMIN_SESSION, stepUpVerifiedAt: "2026-07-16T11:30:00.000Z" };
  assert.throws(
    () => startSupportSession(staleAdmin, { businessId: "business_123", reason: "SUP-185 configuration support", scope: "configuration", durationMinutes: 30 }, now),
    /step-up verification/i,
  );

  const futureAdmin: SessionContext = { ...ADMIN_SESSION, stepUpVerifiedAt: "2026-07-16T12:05:00.000Z" };
  assert.throws(
    () => startSupportSession(futureAdmin, { businessId: "business_123", reason: "SUP-185 future verification", scope: "configuration", durationMinutes: 30 }, now),
    /step-up verification/i,
  );

  const freshAdmin: SessionContext = { ...ADMIN_SESSION, stepUpVerifiedAt: "2026-07-16T11:55:00.000Z" };
  const session = startSupportSession(
    freshAdmin,
    { businessId: "business_123", reason: "SUP-185 configuration support", scope: "configuration", durationMinutes: 30 },
    now,
  );
  assert.equal(canConfigureTenant(freshAdmin, "business_123", session, now), true);
  assert.equal(canConfigureTenant(freshAdmin, "business_123", session, new Date("2026-07-16T12:10:01.000Z")), false);
});

test("neutral template checks block gating, incentives and missing compliance fields", () => {
  const neutral = "Hi {{first_name}}, thanks for choosing {{business_name}}. Leave an honest review: {{review_link}}. Reply STOP to opt out.";
  assert.deepEqual(validateNeutralReviewTemplate(neutral), []);
  assert.ok(validateNeutralReviewTemplate("If you are happy, leave us a five-star review for a discount.").length >= 4);
  assert.ok(validateNeutralReviewTemplate("If you’re not happy, contact us first. {{business_name}} {{review_link}} Reply STOP.").some((issue) => /sentiment/i.test(issue)));
});

test("support sessions require agency MFA and a meaningful reason", () => {
  assert.throws(
    () => startSupportSession(OWNER_SESSION, { businessId: "business_123", reason: "SUP-186 owner attempt", scope: "view", durationMinutes: 15 }, now),
    /agency administrator/i,
  );
  assert.throws(
    () => startSupportSession({ ...ADMIN_SESSION, mfaVerified: false }, { businessId: "business_123", reason: "SUP-186 support request", scope: "view", durationMinutes: 15 }, now),
    /MFA/i,
  );
  assert.throws(
    () => startSupportSession(ADMIN_SESSION, { businessId: "business_123", reason: "too short", scope: "view", durationMinutes: 15 }, now),
    /reason/i,
  );
});

test("administrative events keep actor, tenant and correlation evidence", () => {
  const event = makeAuditEvent({
    occurredAt: now.toISOString(),
    actor: ADMIN_SESSION.userName,
    actorType: "user",
    businessId: "business_123",
    action: "support.session.start",
    resource: "Harbour & Hearth",
    outcome: "Completed",
    supportSessionId: "SUP-184",
    reason: "SUP-184 reconnect investigation",
  }, now);
  assert.match(event.id, /^AUD-/);
  assert.match(event.correlationId, /^COR-/);
  assert.equal(event.businessId, "business_123");
  assert.equal(event.actor, "Maya Chen");
});
