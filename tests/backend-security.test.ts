import assert from "node:assert/strict";
import {
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Stripe from "stripe";
import { buildApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";
import { databaseTlsOptions } from "../server/database-tls.js";
import {
  StripeSdkWebhookVerifier,
  type StripeBillingClient,
  type StripeCheckoutContext,
  type StripeWebhookVerifier,
} from "../server/providers/stripe.js";
import { createWebhookSecurity } from "../server/providers/webhook-security.js";
import { synchronizeDueGoogleConnections, type GoogleBusinessProfileClient } from "../server/providers/google.js";
import { encryptField, hashOpaqueToken, hashPassword, verifyPassword } from "../server/security/crypto.js";
import type {
  ActorContext,
  BusinessRole,
  CompletedJobInput,
  EncryptedPayload,
  GoogleConnectionInput,
  PlatformRepository,
  WorkspacePayload,
} from "../server/types.js";
import { runDeliveryCycle, runGoogleTokenRevocationCycle } from "../server/worker.js";

const appOrigin = "http://127.0.0.1:4173";
const encryptionKey = randomBytes(32).toString("base64url");
const sessionPepper = "test-session-pepper-that-is-longer-than-32-characters";
const businessId = randomUUID();
const otherBusinessId = randomUUID();
const foreignBusinessId = randomUUID();
const locationId = randomUUID();
const otherLocationId = randomUUID();
const userId = randomUUID();
const password = "correct horse battery staple 2026";
const passwordHash = await hashPassword(password);

test("the application process serves the production frontend with hardened cache and browser headers", async () => {
  const frontendRoot = await mkdtemp(path.join(tmpdir(), "review-anchor-frontend-"));
  await mkdir(path.join(frontendRoot, "assets"));
  await writeFile(path.join(frontendRoot, "index.html"), "<!doctype html><title>Review Anchor</title>");
  await writeFile(path.join(frontendRoot, "assets", "app.js"), "console.log('review-anchor');");

  const { repository } = createRepository();
  const app = await buildApp({ config, repository, surface: "application", frontendRoot });
  try {
    const document = await app.inject({ method: "GET", url: "/" });
    assert.equal(document.statusCode, 200);
    assert.match(document.body, /Review Anchor/);
    assert.equal(document.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.equal(document.headers["x-robots-tag"], "noindex, nofollow, noarchive");
    assert.match(String(document.headers["content-security-policy"]), /frame-ancestors 'none'/);

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    assert.equal(asset.statusCode, 200);
    assert.match(String(asset.headers["cache-control"]), /immutable/);

    const directWorkspaceRoute = await app.inject({ method: "GET", url: "/app/reviews?business=demo&location=main" });
    assert.equal(directWorkspaceRoute.statusCode, 200);
    assert.match(directWorkspaceRoute.body, /Review Anchor/);
    assert.equal(directWorkspaceRoute.headers["cache-control"], "public, max-age=0, must-revalidate");

    const uppercaseWorkspaceRoute = await app.inject({ method: "GET", url: "/APP/REVIEWS" });
    assert.equal(uppercaseWorkspaceRoute.statusCode, 200);
    const legacyWorkspaceRoute = await app.inject({ method: "GET", url: "/workspace" });
    assert.equal(legacyWorkspaceRoute.statusCode, 200);

    const unknownApi = await app.inject({ method: "GET", url: "/api/v1/not-a-route" });
    assert.equal(unknownApi.statusCode, 404);
    assert.equal(unknownApi.json().error.code, "NOT_FOUND");

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.statusCode, 200);
  } finally {
    await app.close();
    await rm(frontendRoot, { recursive: true, force: true });
  }
});

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
  APP_ORIGIN: appOrigin,
  SESSION_PEPPER: sessionPepper,
  FIELD_ENCRYPTION_KEY: encryptionKey,
});

function workspace(actor: ActorContext, accessibleBusinessIds: string[] = [businessId], selectedBusinessId?: string, canManageBusiness = true): WorkspacePayload {
  const businesses: WorkspacePayload["businesses"] = accessibleBusinessIds.map((accessibleBusinessId) => ({
    id: accessibleBusinessId,
    agencyId: randomUUID(),
    locationId: accessibleBusinessId === businessId ? locationId : otherLocationId,
    name: accessibleBusinessId === businessId ? "Pilot Plumbing" : "Second Pilot Plumbing",
    locationName: accessibleBusinessId === businessId ? "Main location" : "Second location",
    initials: accessibleBusinessId === businessId ? "PP" : "SP",
    country: "GB" as const,
    timezone: "Europe/London",
    health: "Healthy",
    healthTone: "success" as const,
    automationState: "Live",
    integrationSummary: "Server connected",
    lastSuccess: "Awaiting provider activity",
    affectedCount: 0,
    plan: "Reputation Pro",
    locationReports: [],
    seedRequestCount: 0,
    metrics: {
      completedJobs: 0,
      eligibleCustomers: 0,
      delivered: 0,
      uniqueClicks: 0,
      reviewsDetected: 0,
      rating: 0,
      totalReviews: 0,
    },
    teamMembers: [],
    integrations: {
      google: { status: "Connected", tone: "success" as const, lastEvent: "Now" },
      messaging: { status: "Connected", tone: "success" as const, lastEvent: "Now" },
      jobIntake: { status: "Listening", tone: "success" as const, lastEvent: "Now" },
    },
  }));
  const accessBusinessId = selectedBusinessId ?? actor.businessId;
  return {
    session: {
      userId: actor.userId,
      userName: actor.userName,
      email: actor.email,
      role: actor.role,
      businessRole: actor.businessRole,
      businessId: actor.businessId,
      agencyId: actor.agencyId,
      mfaVerified: actor.mfaVerified,
      stepUpVerifiedAt: actor.stepUpVerifiedAt,
      supportSessionId: actor.supportSessionId,
    },
    businesses,
    requestsByBusiness: Object.fromEntries(accessibleBusinessIds.map((id) => [id, []])),
    reviewsByBusiness: Object.fromEntries(accessibleBusinessIds.map((id) => [id, []])),
    qrCodesByBusiness: {},
    workflowsByLocation: {},
    access: accessBusinessId && accessibleBusinessIds.includes(accessBusinessId) ? {
      businessId: accessBusinessId,
      canReadTenant: true,
      canManageBusiness,
      canReadBilling: true,
      canManageBilling: canManageBusiness,
      canManageStripeBilling: canManageBusiness,
    } : undefined,
    exceptions: [],
    auditEvents: [],
  };
}

interface TestActorOptions {
  role?: ActorContext["role"];
  agencyRole?: ActorContext["agencyRole"];
  mfaVerified?: boolean;
  agencyId?: string;
  initialBusinessId?: string | null;
  accessibleBusinessIds?: string[];
  businessRoles?: Partial<Record<string, BusinessRole>>;
  canManageBusiness?: boolean;
}

function createRepository(actorOptions: TestActorOptions = {}) {
  const sessionActors = new Map<string, ActorContext>();
  let capturedJob: CompletedJobInput | undefined;
  let capturedSmsPolicy: "auto_top_up" | "pause_sms" | undefined;
  let capturedWorkspaceContext: { businessId?: string; locationId?: string } | undefined;
  let activeSupportSession: Awaited<ReturnType<PlatformRepository["getActiveSupportSession"]>> = null;
  const loginResults: Array<{ email: string; succeeded: boolean }> = [];
  const repository: PlatformRepository = {
    async findCredentialByEmail(email) {
      return email === "owner@example.com"
        ? { userId, email, displayName: "Owner", passwordHash, mfaRequired: false, disabled: false }
        : null;
    },
    async recordLoginResult(email, succeeded) { loginResults.push({ email, succeeded }); },
    async createLoginSession(input) {
      const sessionId = randomUUID();
      sessionActors.set(input.tokenHash.toString("hex"), {
        userId,
        userName: "Owner",
        email: "owner@example.com",
        role: actorOptions.role ?? "business_owner",
        businessId: actorOptions.role === "agency_admin" || actorOptions.role === "agency_user"
          ? undefined
          : actorOptions.initialBusinessId === null
            ? undefined
            : actorOptions.initialBusinessId ?? businessId,
        agencyId: actorOptions.role === "agency_admin" || actorOptions.role === "agency_user" ? actorOptions.agencyId ?? randomUUID() : undefined,
        agencyRole: actorOptions.agencyRole ?? (actorOptions.role === "agency_admin" ? "admin" : undefined),
        mfaVerified: actorOptions.mfaVerified ?? false,
        sessionId,
        sessionTokenHash: input.tokenHash,
      });
      return sessionId;
    },
    async resolveLoginSession(tokenHash) {
      return sessionActors.get(tokenHash.toString("hex")) ?? null;
    },
    async revokeLoginSession(_sessionId, tokenHash) {
      sessionActors.delete(tokenHash.toString("hex"));
    },
    async getWorkspace(actor, selectedBusinessId, selectedLocationId) {
      capturedWorkspaceContext = { businessId: selectedBusinessId, locationId: selectedLocationId };
      const accessibleBusinessIds = actorOptions.accessibleBusinessIds ?? [businessId];
      const projectedActor = actor.role === "business_owner" && selectedBusinessId
        ? {
            ...actor,
            businessId: selectedBusinessId,
            businessRole: actorOptions.businessRoles?.[selectedBusinessId],
          }
        : actor;
      return workspace(projectedActor, accessibleBusinessIds, selectedBusinessId, actorOptions.canManageBusiness ?? true);
    },
    async updateSmsOveragePolicy(_actor, _businessId, policy) {
      capturedSmsPolicy = policy;
      return { updated: true, policy, reason: "saved" };
    },
    async startSupportSession(_actor, input) {
      const id = randomUUID();
      activeSupportSession = {
        id,
        businessId: input.businessId,
        scope: input.scope,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + input.durationMinutes * 60_000).toISOString(),
      };
      return id;
    },
    async getActiveSupportSession() { return activeSupportSession; },
    async endSupportSession() { activeSupportSession = null; return true; },
    async createCompletedJob(_actor, input) {
      capturedJob = input;
      return { requestId: randomUUID(), status: "Queued", duplicate: false };
    },
    async beginGoogleOAuth() {},
    async consumeGoogleOAuthState() { return null; },
    async saveGoogleConnection() {},
    async listDueGoogleConnections() { return []; },
    async upsertGoogleReviews() { return 0; },
    async claimMessageJobs() { return []; },
    async authorizeMessageDispatch() { return { allowed: false, reason: "not_due" }; },
    async getMessagePayload() { throw new Error("No message payload in API test repository."); },
    async reserveSmsSegments() { return { allowed: true, reason: "reserved" }; },
    async holdMessageForSmsAllowance() { return new Date(Date.now() + 60_000); },
    async finishMessageAttempt() {},
    async deferMessageJob() {},
    async rollPilotBillingPeriods() { return 0; },
    async resolvePublicReviewFlow(token) {
      return token === "valid-public-token"
        ? { qrCodeId: randomUUID(), businessId, locationId, destinationUrl: "https://g.page/r/example/review" }
        : null;
    },
    async recordPublicQrScan() {
      return { scanId: randomUUID(), destinationUrl: "https://g.page/r/example/review" };
    },
    async markPublicQrContinue() {},
  };
  return {
    repository,
    getCapturedJob: () => capturedJob,
    getCapturedSmsPolicy: () => capturedSmsPolicy,
    getCapturedWorkspaceContext: () => capturedWorkspaceContext,
    getLoginResults: () => loginResults,
  };
}

async function authenticatedApp(actorOptions: TestActorOptions = {}) {
  const state = createRepository(actorOptions);
  const app = await buildApp({ config, repository: state.repository });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: appOrigin },
    payload: { email: "owner@example.com", password },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers["set-cookie"];
  assert.equal(typeof cookie, "string");
  const cookiePair = String(cookie).split(";", 1)[0];
  return { app, cookie: cookiePair, setCookie: String(cookie), ...state };
}

test("production configuration requires separate least-privilege database connections", () => {
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://all-powerful:secret@example.com/afterword",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
  }), /Production requires AUTH_DATABASE_URL/i);
});

test("database TLS requires and loads an explicit trusted CA", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-anchor-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certificatePath = path.join(directory, "database-ca.crt");
  await writeFile(certificatePath, "test trusted CA\n", "utf8");

  assert.equal(databaseTlsOptions(false), undefined);
  assert.throws(() => databaseTlsOptions(true, ""), /DATABASE_CA_CERT_PATH is required/i);
  assert.deepEqual(databaseTlsOptions(true, certificatePath), {
    ca: "test trusted CA\n",
    rejectUnauthorized: true,
  });
});

test("production configuration rejects example secrets and insecure application origins", () => {
  const productionDatabaseUrls = {
    AUTH_DATABASE_URL: "postgresql://auth:secret@db.example.com/afterword",
    RUNTIME_DATABASE_URL: "postgresql://runtime:secret@db.example.com/afterword",
    INGRESS_DATABASE_URL: "postgresql://ingress:secret@db.example.com/afterword",
    WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.com/afterword",
  };

  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    ...productionDatabaseUrls,
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: "replace-with-at-least-32-random-characters",
    FIELD_ENCRYPTION_KEY: encryptionKey,
  }), /example SESSION_PEPPER/i);

  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    ...productionDatabaseUrls,
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }), /example FIELD_ENCRYPTION_KEY/i);

  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    ...productionDatabaseUrls,
    APP_ORIGIN: "http://app.example.com",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
  }), /APP_ORIGIN must use HTTPS/i);
});

test("production configuration requires four distinct database login identities", () => {
  const shared = "postgresql://shared:secret@db.example.com/afterword";
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    AUTH_DATABASE_URL: shared,
    RUNTIME_DATABASE_URL: shared,
    INGRESS_DATABASE_URL: shared,
    WORKER_DATABASE_URL: shared,
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
  }), /four distinct least-privilege login identities/i);

  assert.doesNotThrow(() => loadConfig({
    NODE_ENV: "production",
    AUTH_DATABASE_URL: "postgresql://auth:secret@db.example.com/afterword",
    RUNTIME_DATABASE_URL: "postgresql://runtime:secret@db.example.com/afterword",
    INGRESS_DATABASE_URL: "postgresql://ingress:secret@db.example.com/afterword",
    WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.com/afterword",
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    SIGNUP_EMAIL_ENABLED: "false",
  }));
});

test("each production process can start without credentials for other capabilities", () => {
  const common = {
    NODE_ENV: "production",
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    SIGNUP_EMAIL_ENABLED: "false",
  } as const;
  assert.doesNotThrow(() => loadConfig({
    ...common,
    AUTH_DATABASE_URL: "postgresql://auth:secret@db.example.com/afterword",
    RUNTIME_DATABASE_URL: "postgresql://runtime:secret@db.example.com/afterword",
  }, ["auth", "runtime"]));
  assert.doesNotThrow(() => loadConfig({
    ...common,
    INGRESS_DATABASE_URL: "postgresql://ingress:secret@db.example.com/afterword",
  }, ["ingress"]));
  assert.doesNotThrow(() => loadConfig({
    ...common,
    WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.com/afterword",
  }, ["worker"]));
});

test("blank optional provider values are treated as unset while their capability is disabled", () => {
  assert.doesNotThrow(() => loadConfig({
    NODE_ENV: "production",
    APP_ORIGIN: "https://app.example.com",
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    AUTH_DATABASE_URL: "postgresql://auth:secret@db.example.com/afterword",
    RUNTIME_DATABASE_URL: "postgresql://runtime:secret@db.example.com/afterword",
    STRIPE_CHECKOUT_ENABLED: "false",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_PRICE_SETUP_PRO: " ",
    GOOGLE_REDIRECT_URI: "",
    GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: "",
    SENDGRID_ASM_GROUP_ID: "",
    SIGNUP_EMAIL_ENABLED: "false",
  }, ["auth", "runtime", "stripeCheckout"]));
});

test("Stripe configuration is capability-scoped, test-first and complete before checkout can start", () => {
  const common = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    APP_ORIGIN: appOrigin,
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    STRIPE_CHECKOUT_ENABLED: "true",
    STRIPE_MODE: "test",
  } as const;
  assert.throws(() => loadConfig(common, ["auth", "runtime", "stripeCheckout"]), /STRIPE_API_KEY is missing/i);
  assert.doesNotThrow(() => loadConfig({
    ...common,
    STRIPE_API_KEY: "rk_test_not-a-real-key-value",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
    STRIPE_PRICE_PRO_ANNUAL: "price_pro_annual",
    STRIPE_PRICE_MULTI_MONTHLY: "price_multi_monthly",
    STRIPE_PRICE_SETUP_PRO: "price_setup_pro",
    STRIPE_PRICE_SETUP_MULTI_2_3: "price_setup_multi_2_3",
    STRIPE_PRICE_SETUP_MULTI_4_5: "price_setup_multi_4_5",
  }, ["auth", "runtime", "stripeCheckout"]));
  assert.throws(() => loadConfig({ ...common, STRIPE_MODE: "live" }), /Live Stripe mode is allowed only/i);
  assert.throws(() => loadConfig({
    ...common,
    STRIPE_API_KEY: "rk_live_not-a-real-key-value",
  }), /Live Stripe mode is allowed only|does not match STRIPE_MODE/i);
});

test("Stripe Checkout and portal routes are same-origin, tenant-bound and server-priced", async (t) => {
  const state = createRepository();
  let checkoutContext: StripeCheckoutContext | undefined;
  let boundSessionId: string | undefined;
  let portalReturnUrl: string | undefined;
  state.repository.prepareStripeCheckout = async (_actor, requestedBusinessId, attemptId) => ({
    allowed: true,
    reason: "ready",
    attemptId,
    businessId: requestedBusinessId,
    planKey: "pro_monthly",
    billingCycle: "monthly",
    subscriptionPricePence: 3900,
    setupFeePence: 14900,
  });
  state.repository.bindStripeCheckoutSession = async (_actor, _businessId, _attemptId, sessionId) => {
    boundSessionId = sessionId;
  };
  state.repository.getStripeBillingCustomer = async () => ({
    allowed: true,
    reason: "ready",
    customerId: "cus_test_customer",
  });
  const stripeBilling: StripeBillingClient = {
    async createSubscriptionCheckout(context) {
      checkoutContext = context;
      return {
        id: "cs_test_server_owned",
        url: "https://checkout.stripe.com/c/pay/cs_test_server_owned",
        livemode: false,
      };
    },
    async createCustomerPortal(customerId, returnUrl) {
      assert.equal(customerId, "cus_test_customer");
      portalReturnUrl = returnUrl;
      return { url: "https://billing.stripe.com/p/session/test_portal" };
    },
  };
  const stripeConfig = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    APP_ORIGIN: appOrigin,
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    STRIPE_CHECKOUT_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_API_KEY: "rk_test_not-a-real-key-value",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
    STRIPE_PRICE_PRO_ANNUAL: "price_pro_annual",
    STRIPE_PRICE_MULTI_MONTHLY: "price_multi_monthly",
    STRIPE_PRICE_SETUP_PRO: "price_setup_pro",
    STRIPE_PRICE_SETUP_MULTI_2_3: "price_setup_multi_2_3",
    STRIPE_PRICE_SETUP_MULTI_4_5: "price_setup_multi_4_5",
  }, ["auth", "runtime", "stripeCheckout"]);
  const app = await buildApp({ config: stripeConfig, repository: state.repository, stripeBilling });
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: appOrigin },
    payload: { email: "owner@example.com", password },
  });
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
  const attemptId = randomUUID();

  const wrongOrigin = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/billing/checkout`,
    headers: { cookie, origin: "https://attacker.example" },
    payload: { attemptId, locationId },
  });
  assert.equal(wrongOrigin.statusCode, 403);

  const crossTenant = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${otherBusinessId}/billing/checkout`,
    headers: { cookie, origin: appOrigin },
    payload: { attemptId, locationId },
  });
  assert.equal(crossTenant.statusCode, 403);

  const checkout = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/billing/checkout`,
    headers: { cookie, origin: appOrigin },
    payload: { attemptId, locationId },
  });
  assert.equal(checkout.statusCode, 201);
  assert.equal(checkout.json().data.url, "https://checkout.stripe.com/c/pay/cs_test_server_owned");
  assert.equal(checkoutContext?.businessId, businessId);
  assert.equal(checkoutContext?.subscriptionPricePence, 3900);
  assert.equal(checkoutContext?.setupFeePence, 14900);
  assert.match(checkoutContext?.successUrl ?? "", new RegExp(`business=${businessId}`));
  assert.match(checkoutContext?.successUrl ?? "", new RegExp(`location=${locationId}`));
  assert.match(checkoutContext?.successUrl ?? "", /checkout=success/);
  assert.match(checkoutContext?.successUrl ?? "", /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.match(checkoutContext?.cancelUrl ?? "", /checkout=cancelled/);
  assert.equal(boundSessionId, "cs_test_server_owned");

  const businessScopedCheckout = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/billing/checkout`,
    headers: { cookie, origin: appOrigin },
    payload: { attemptId: randomUUID() },
  });
  assert.equal(businessScopedCheckout.statusCode, 201);
  assert.match(checkoutContext?.successUrl ?? "", new RegExp(`business=${businessId}`));
  assert.doesNotMatch(checkoutContext?.successUrl ?? "", /[?&]location=/);
  assert.match(checkoutContext?.cancelUrl ?? "", new RegExp(`business=${businessId}`));
  assert.doesNotMatch(checkoutContext?.cancelUrl ?? "", /[?&]location=/);

  const wrongLocation = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/billing/checkout`,
    headers: { cookie, origin: appOrigin },
    payload: { attemptId: randomUUID(), locationId: otherBusinessId },
  });
  assert.equal(wrongLocation.statusCode, 404);
  assert.equal(wrongLocation.json().error.code, "LOCATION_NOT_FOUND");

  const portal = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/billing/portal`,
    headers: { cookie, origin: appOrigin },
    payload: { locationId },
  });
  assert.equal(portal.statusCode, 201);
  assert.equal(portal.json().data.url, "https://billing.stripe.com/p/session/test_portal");
  assert.match(portalReturnUrl ?? "", new RegExp(`business=${businessId}`));
  assert.match(portalReturnUrl ?? "", new RegExp(`location=${locationId}`));
  assert.match(portalReturnUrl ?? "", /billing=return/);

  const businessScopedPortal = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/billing/portal`,
    headers: { cookie, origin: appOrigin },
    payload: {},
  });
  assert.equal(businessScopedPortal.statusCode, 201);
  assert.match(portalReturnUrl ?? "", new RegExp(`business=${businessId}`));
  assert.doesNotMatch(portalReturnUrl ?? "", /[?&]location=/);
  assert.match(portalReturnUrl ?? "", /billing=return/);
});

test("support sessions cannot begin Google Business Profile OAuth", async (t) => {
  const { app, cookie } = await authenticatedApp({ role: "agency_admin", mfaVerified: true });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/locations/${locationId}/integrations/google/oauth/start`,
    headers: {
      cookie,
      origin: appOrigin,
      "x-support-session-id": randomUUID(),
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "GOOGLE_OWNER_REQUIRED");
  assert.match(response.json().error.message, /direct business owner or administrator/i);
});

test("Google Profile responses remain no-store when the global support pre-handler rejects", async (t) => {
  const { app, cookie } = await authenticatedApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: `/api/v1/businesses/${businessId}/locations/${locationId}/google-profile`,
    headers: {
      cookie,
      "x-support-session-id": randomUUID(),
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "SUPPORT_SESSION_FORBIDDEN");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("Stripe webhook route verifies first and persists the exact raw body", async (t) => {
  const state = createRepository();
  let persistedRawBody: Buffer | undefined;
  state.repository.recordStripeBillingWebhook = async (input) => {
    persistedRawBody = input.rawBody;
    return { duplicate: false };
  };
  const webhookVerifier: StripeWebhookVerifier = {
    verify(_rawBody, signature) {
      if (signature !== "valid-test-signature") throw new Error("invalid");
      return {
        kind: "checkout",
        eventId: "evt_test_webhook",
        eventType: "checkout.session.completed",
        eventCreatedAt: new Date("2026-07-17T12:00:00.000Z"),
        apiVersion: "2026-06-24.dahlia",
        livemode: false,
        businessId,
        attemptId: randomUUID(),
        checkoutSessionId: "cs_test_webhook",
        customerId: "cus_test_customer",
        subscriptionId: "sub_test_subscription",
        state: "completed",
        setupPaid: true,
      };
    },
  };
  const ingressConfig = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    APP_ORIGIN: appOrigin,
    SESSION_PEPPER: sessionPepper,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    STRIPE_WEBHOOK_SECRET: "whsec_not-a-real-secret-value",
  }, ["ingress", "stripeWebhook"]);
  const app = await buildApp({
    config: ingressConfig,
    repository: state.repository,
    surface: "ingress",
    stripeWebhookVerifier: webhookVerifier,
  });
  t.after(() => app.close());
  const payload = JSON.stringify({ id: "evt_test_webhook", exact: "spacing is evidence" });

  const invalid = await app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": "invalid" },
    payload,
  });
  assert.equal(invalid.statusCode, 401);

  const accepted = await app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": "valid-test-signature" },
    payload,
  });
  assert.equal(accepted.statusCode, 204);
  assert.equal(persistedRawBody?.toString("utf8"), payload);
});

test("Stripe SDK webhook verification rejects tampering and normalizes signed Checkout metadata", () => {
  const endpointSecret = "whsec_not-a-real-secret-value";
  const stripe = new Stripe("rk_test_signature_generation_only", { apiVersion: "2026-06-24.dahlia" });
  const attemptId = randomUUID();
  const payload = JSON.stringify({
    id: "evt_signed_checkout",
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_signed_checkout",
        object: "checkout.session",
        customer: "cus_test_customer",
        subscription: "sub_test_subscription",
        payment_status: "paid",
        metadata: {
          integration: "review_anchor",
          business_id: businessId,
          checkout_attempt_id: attemptId,
          plan_key: "pro_monthly",
        },
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: endpointSecret });
  const verifier = new StripeSdkWebhookVerifier(endpointSecret);
  const verified = verifier.verify(Buffer.from(payload), signature);
  assert.equal(verified.kind, "checkout");
  if (verified.kind === "checkout") {
    assert.equal(verified.businessId, businessId);
    assert.equal(verified.attemptId, attemptId);
    assert.equal(verified.setupPaid, true);
  }
  assert.throws(() => verifier.verify(Buffer.from(`${payload} `), signature));
});

test("application and public-ingress routes are separated into different processes", async (t) => {
  const state = createRepository();
  const application = await buildApp({ config, repository: state.repository, surface: "application" });
  const ingress = await buildApp({ config, repository: state.repository, surface: "ingress" });
  t.after(async () => Promise.all([application.close(), ingress.close()]));

  assert.equal((await application.inject({ method: "GET", url: "/api/v1/public/review-flows/valid-public-token" })).statusCode, 404);
  assert.equal((await ingress.inject({ method: "POST", url: "/api/v1/auth/login", payload: {} })).statusCode, 404);
  assert.equal((await ingress.inject({ method: "GET", url: "/api/v1/public/review-flows/valid-public-token" })).statusCode, 200);
});

test("password and field encryption use salt, authenticated context and constant-time verification", async () => {
  const secondHash = await hashPassword(password);
  assert.notEqual(secondHash, passwordHash);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("wrong password", passwordHash), false);

  const encrypted = encryptField("+447700900123", encryptionKey, `${businessId}:message-destination`);
  assert.notEqual(encrypted.ciphertext.toString("utf8"), "+447700900123");
  const { decryptField } = await import("../server/security/crypto.js");
  assert.equal(decryptField(encrypted, encryptionKey, `${businessId}:message-destination`), "+447700900123");
  assert.throws(() => decryptField(encrypted, encryptionKey, `${otherBusinessId}:message-destination`));
});

test("login uses an opaque HttpOnly cookie and records durable success and failure results", async (t) => {
  const { app, cookie, setCookie, getLoginResults } = await authenticatedApp();
  t.after(() => app.close());
  assert.match(setCookie, /^afterword_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);

  const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie } });
  assert.equal(session.statusCode, 200);
  assert.doesNotMatch(session.body, /sessionTokenHash|sessionId|afterword_session/i);

  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: appOrigin },
    payload: { email: "missing@example.com", password: "not the password" },
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json().error.code, "INVALID_CREDENTIALS");
  assert.deepEqual(getLoginResults(), [
    { email: "owner@example.com", succeeded: true },
    { email: "missing@example.com", succeeded: false },
  ]);
});

test("workspace deep links validate and forward business and location context", async (t) => {
  const { app, cookie, getCapturedWorkspaceContext } = await authenticatedApp();
  t.after(() => app.close());

  const selected = await app.inject({
    method: "GET",
    url: `/api/v1/workspace?businessId=${businessId}&locationId=${locationId}`,
    headers: { cookie },
  });
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(getCapturedWorkspaceContext(), { businessId, locationId });

  const unavailableLocation = await app.inject({
    method: "GET",
    url: `/api/v1/workspace?businessId=${businessId}&locationId=${otherBusinessId}`,
    headers: { cookie },
  });
  assert.equal(unavailableLocation.statusCode, 404);
  assert.equal(unavailableLocation.json().error.code, "LOCATION_NOT_FOUND");

  const malformedLocation = await app.inject({
    method: "GET",
    url: `/api/v1/workspace?businessId=${businessId}&locationId=not-a-uuid`,
    headers: { cookie },
  });
  assert.equal(malformedLocation.statusCode, 400);
});

test("ambiguous multi-business sessions authorize selected owner and billing memberships through the repository", async (t) => {
  const { app, cookie, getCapturedSmsPolicy } = await authenticatedApp({
    initialBusinessId: null,
    accessibleBusinessIds: [businessId, otherBusinessId],
    businessRoles: {
      [businessId]: "owner",
      [otherBusinessId]: "billing",
    },
  });
  t.after(() => app.close());

  const ownerWorkspace = await app.inject({
    method: "GET",
    url: `/api/v1/workspace?businessId=${businessId}&locationId=${locationId}`,
    headers: { cookie },
  });
  assert.equal(ownerWorkspace.statusCode, 200);
  assert.equal(ownerWorkspace.json().data.session.businessId, businessId);
  assert.equal(ownerWorkspace.json().data.session.businessRole, "owner");

  const billingWorkspace = await app.inject({
    method: "GET",
    url: `/api/v1/workspace?businessId=${otherBusinessId}&locationId=${otherLocationId}`,
    headers: { cookie },
  });
  assert.equal(billingWorkspace.statusCode, 200);
  assert.equal(billingWorkspace.json().data.session.businessId, otherBusinessId);
  assert.equal(billingWorkspace.json().data.session.businessRole, "billing");

  const billingCommand = await app.inject({
    method: "PATCH",
    url: `/api/v1/businesses/${otherBusinessId}/billing/sms-policy`,
    headers: { cookie, origin: appOrigin },
    payload: { policy: "pause_sms" },
  });
  assert.equal(billingCommand.statusCode, 200);
  assert.equal(getCapturedSmsPolicy(), "pause_sms");

  const foreignWorkspace = await app.inject({
    method: "GET",
    url: `/api/v1/workspace?businessId=${foreignBusinessId}`,
    headers: { cookie },
  });
  assert.equal(foreignWorkspace.statusCode, 403);
  assert.equal(foreignWorkspace.json().error.code, "BUSINESS_ACCESS_DENIED");
});

test("agency support context can be restored after a browser refresh and explicitly ended", async (t) => {
  const { app, cookie } = await authenticatedApp({ role: "agency_admin", mfaVerified: true });
  t.after(() => app.close());

  const before = await app.inject({ method: "GET", url: "/api/v1/support-sessions/active", headers: { cookie } });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().data.session, null);

  const started = await app.inject({
    method: "POST",
    url: "/api/v1/support-sessions",
    headers: { cookie, origin: appOrigin },
    payload: {
      businessId,
      scope: "view",
      reason: "Investigate the location integration safely",
      durationMinutes: 15,
    },
  });
  assert.equal(started.statusCode, 201);
  const supportSessionId = started.json().data.id as string;

  const restored = await app.inject({ method: "GET", url: "/api/v1/support-sessions/active", headers: { cookie } });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().data.session.id, supportSessionId);
  assert.equal(restored.json().data.session.businessId, businessId);

  const ended = await app.inject({
    method: "DELETE",
    url: `/api/v1/support-sessions/${supportSessionId}`,
    headers: { cookie, origin: appOrigin },
    payload: { reason: "Support investigation completed safely" },
  });
  assert.equal(ended.statusCode, 204);

  const after = await app.inject({ method: "GET", url: "/api/v1/support-sessions/active", headers: { cookie } });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().data.session, null);
});

test("agency support-role operators can start only view sessions", async (t) => {
  const { app, cookie } = await authenticatedApp({ role: "agency_user", agencyRole: "support", mfaVerified: true });
  t.after(() => app.close());

  const configuration = await app.inject({
    method: "POST",
    url: "/api/v1/support-sessions",
    headers: { cookie, origin: appOrigin },
    payload: { businessId, scope: "configuration", reason: "Inspect configuration safely", durationMinutes: 15 },
  });
  assert.equal(configuration.statusCode, 403);
  assert.equal(configuration.json().error.code, "SUPPORT_VIEW_ONLY");

  const tooShort = await app.inject({
    method: "POST",
    url: "/api/v1/support-sessions",
    headers: { cookie, origin: appOrigin },
    payload: { businessId, scope: "view", reason: "12345678901", durationMinutes: 15 },
  });
  assert.equal(tooShort.statusCode, 400);

  const view = await app.inject({
    method: "POST",
    url: "/api/v1/support-sessions",
    headers: { cookie, origin: appOrigin },
    payload: { businessId, scope: "view", reason: "123456789012", durationMinutes: 15 },
  });
  assert.equal(view.statusCode, 201);
  const active = await app.inject({ method: "GET", url: "/api/v1/support-sessions/active", headers: { cookie } });
  assert.equal(active.statusCode, 200);
  assert.equal(active.json().data.session.scope, "view");
});

test("Google mutations reject summary-visible actors without business management", async (t) => {
  const { app, cookie } = await authenticatedApp({ canManageBusiness: false });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/locations/${locationId}/integrations/google/oauth/start`,
    headers: { cookie, origin: appOrigin },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "BUSINESS_MANAGEMENT_REQUIRED");
});

test("origin guard and path-derived tenant prevent browser-selected authority", async (t) => {
  const { app, cookie, getCapturedJob } = await authenticatedApp();
  t.after(() => app.close());
  const commonJob = {
    locationId,
    externalJobId: "job-1001",
    serviceLabel: "Boiler service",
    occurredAt: "2026-07-16T12:00:00.000Z",
    firstName: "Alex",
    phone: "+447700900123",
    preferredChannel: "SMS",
    consent: {
      status: "granted",
      wording: "I agree to receive a service follow-up by SMS.",
      wordingVersion: "pilot-v1",
      purpose: "review_request",
      capturedAt: "2026-07-16T11:59:00.000Z",
      source: "completed_job_form",
      transactionReference: "consent-1001",
    },
  };

  const wrongOrigin = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/completed-jobs`,
    headers: { cookie, origin: "https://attacker.example" },
    payload: commonJob,
  });
  assert.equal(wrongOrigin.statusCode, 403);

  const injectedTenant = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/completed-jobs`,
    headers: { cookie, origin: appOrigin },
    payload: { ...commonJob, businessId: otherBusinessId },
  });
  assert.equal(injectedTenant.statusCode, 400);

  const crossTenant = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${otherBusinessId}/completed-jobs`,
    headers: { cookie, origin: appOrigin },
    payload: commonJob,
  });
  assert.equal(crossTenant.statusCode, 403);

  const accepted = await app.inject({
    method: "POST",
    url: `/api/v1/businesses/${businessId}/completed-jobs`,
    headers: { cookie, origin: appOrigin },
    payload: commonJob,
  });
  assert.equal(accepted.statusCode, 201);
  assert.equal(getCapturedJob()?.businessId, businessId);
});

test("SMS overage policy is same-origin, tenant-bound and server-persisted", async (t) => {
  const { app, cookie, getCapturedSmsPolicy } = await authenticatedApp();
  t.after(() => app.close());

  const crossTenant = await app.inject({
    method: "PATCH",
    url: `/api/v1/businesses/${otherBusinessId}/billing/sms-policy`,
    headers: { cookie, origin: appOrigin },
    payload: { policy: "auto_top_up" },
  });
  assert.equal(crossTenant.statusCode, 403);

  const wrongOrigin = await app.inject({
    method: "PATCH",
    url: `/api/v1/businesses/${businessId}/billing/sms-policy`,
    headers: { cookie, origin: "https://attacker.example" },
    payload: { policy: "auto_top_up" },
  });
  assert.equal(wrongOrigin.statusCode, 403);

  const saved = await app.inject({
    method: "PATCH",
    url: `/api/v1/businesses/${businessId}/billing/sms-policy`,
    headers: { cookie, origin: appOrigin },
    payload: { policy: "auto_top_up" },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().data.policy, "auto_top_up");
  assert.equal(getCapturedSmsPolicy(), "auto_top_up");
});

test("public QR flow validates stable tokens and trusted Google destinations", async (t) => {
  const { repository } = createRepository();
  const app = await buildApp({ config, repository });
  t.after(() => app.close());
  const missing = await app.inject({ method: "GET", url: "/api/v1/public/review-flows/not-present-token" });
  assert.equal(missing.statusCode, 404);
  const flow = await app.inject({ method: "GET", url: "/api/v1/public/review-flows/valid-public-token" });
  assert.equal(flow.statusCode, 200);
  assert.equal(flow.json().data.destinationUrl, "https://g.page/r/example/review");
});

test("multi-profile Google OAuth selection is opaque, actor-bound and single use", async (t) => {
  interface SelectionRepository extends PlatformRepository {
    peekGoogleProfileSelection(
      actor: ActorContext,
      tokenHash: Buffer,
    ): Promise<{ businessId: string; locationId: string; payload: EncryptedPayload } | null>;
    consumeGoogleProfileSelection(
      actor: ActorContext,
      tokenHash: Buffer,
    ): Promise<{ businessId: string; locationId: string; payload: EncryptedPayload } | null>;
  }
  const { repository: baseRepository } = createRepository();
  const repository = baseRepository as SelectionRepository;
  const selectionToken = randomBytes(32).toString("base64url");
  const expectedHash = hashOpaqueToken(selectionToken, sessionPepper);
  const payload = encryptField(JSON.stringify({
    actorUserId: userId,
    accessToken: "access-token-must-not-reach-browser",
    refreshToken: "refresh-token-must-not-reach-browser",
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    profiles: [
      {
        accountName: "accounts/1001",
        accountDisplayName: "Pilot Account",
        locationName: "locations/2001",
        locationTitle: "Pilot Plumbing North",
        newReviewUri: "https://g.page/r/pilot-north/review",
      },
      {
        accountName: "accounts/1001",
        accountDisplayName: "Pilot Account",
        locationName: "locations/2002",
        locationTitle: "Pilot Plumbing South",
        newReviewUri: "https://g.page/r/pilot-south/review",
      },
    ],
  }), encryptionKey, `${businessId}:${locationId}:google-profile-selection`);
  let consumed = false;
  let savedConnection: GoogleConnectionInput | undefined;
  repository.peekGoogleProfileSelection = async (actor, tokenHash) => {
    assert.equal(actor.userId, userId);
    assert.deepEqual(tokenHash, expectedHash);
    return consumed ? null : { businessId, locationId, payload };
  };
  repository.consumeGoogleProfileSelection = async (actor, tokenHash) => {
    const state = await repository.peekGoogleProfileSelection(actor, tokenHash);
    consumed = true;
    return state;
  };
  repository.saveGoogleConnection = async (input) => { savedConnection = input; };
  const app = await buildApp({ config, repository });
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: appOrigin },
    payload: { email: "owner@example.com", password },
  });
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];

  const selection = await app.inject({
    method: "GET",
    url: `/api/v1/integrations/google/oauth/selections/${selectionToken}`,
    headers: { cookie },
  });
  assert.equal(selection.statusCode, 200);
  assert.match(selection.body, /Pilot Plumbing South/);
  assert.doesNotMatch(selection.body, /access-token|refresh-token|accounts\/1001|locations\/2001/);

  const completed = await app.inject({
    method: "POST",
    url: `/api/v1/integrations/google/oauth/selections/${selectionToken}`,
    headers: { cookie, origin: appOrigin },
    payload: { profileIndex: 1 },
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(savedConnection?.actorUserId, userId);
  assert.equal(savedConnection?.locationName, "locations/2002");

  const replay = await app.inject({
    method: "POST",
    url: `/api/v1/integrations/google/oauth/selections/${selectionToken}`,
    headers: { cookie, origin: appOrigin },
    payload: { profileIndex: 0 },
  });
  assert.equal(replay.statusCode, 404);
});

test("delivery worker renders the canonical review URI and records the immutable attempt", async () => {
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const leaseToken = randomUUID();
  const destination = encryptField("+447700900123", encryptionKey, `${businessId}:message-destination`);
  let deliveredBody = "";
  let finishedAttempt = "";
  let reservedSegments = 0;
  const { repository } = createRepository();
  repository.claimMessageJobs = async () => [{
    id: jobId,
    businessId,
    locationId,
    channel: "sms",
    provider: "twilio",
    leaseToken,
  }];
  repository.authorizeMessageDispatch = async () => ({ allowed: true, reason: "authorized" });
  repository.getMessagePayload = async () => ({
    messageAttemptId: attemptId,
    businessId,
    channel: "sms",
    reviewUri: "https://g.page/r/example/review",
    destination,
    body: "Please leave an honest review: {{review_link}} Reply STOP to opt out.",
    idempotencyKey: `afterword:${jobId}`,
  });
  repository.reserveSmsSegments = async (input) => {
    reservedSegments = input.segments;
    return { allowed: true, reason: "reserved" };
  };
  repository.finishMessageAttempt = async (input) => { finishedAttempt = input.messageAttemptId; };
  const cycle = await runDeliveryCycle({
    repository,
    workerId: "test-worker",
    encryptionKey,
    providers: {
      sms: {
        name: "fake-sms",
        isConfigured: () => true,
        async send(input) {
          deliveredBody = input.body;
          return { result: "accepted", providerMessageId: "SM_TEST" };
        },
      },
    },
  });
  assert.equal(cycle.accepted, 1);
  assert.equal(finishedAttempt, attemptId);
  assert.equal(reservedSegments, 1);
  assert.match(deliveredBody, /https:\/\/g\.page\/r\/example\/review/);
  assert.doesNotMatch(deliveredBody, /\{\{review_link\}\}/);
});

test("delivery worker holds SMS before Twilio when the pooled allowance is exhausted", async () => {
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const leaseToken = randomUUID();
  const retryAt = new Date(Date.now() + 60 * 60 * 1_000);
  const destination = encryptField("+447700900123", encryptionKey, `${businessId}:message-destination`);
  const { repository } = createRepository();
  let providerCalls = 0;
  let heldReason = "";
  repository.claimMessageJobs = async () => [{
    id: jobId,
    businessId,
    locationId,
    channel: "sms",
    provider: "twilio",
    leaseToken,
  }];
  repository.authorizeMessageDispatch = async () => ({ allowed: true, reason: "authorized" });
  repository.getMessagePayload = async () => ({
    messageAttemptId: attemptId,
    businessId,
    channel: "sms",
    reviewUri: "https://g.page/r/example/review",
    destination,
    body: "Please leave an honest review: {{review_link}} Reply STOP to opt out.",
    idempotencyKey: `afterword:${jobId}`,
  });
  repository.reserveSmsSegments = async () => ({
    allowed: false,
    reason: "sms_allowance_exhausted",
    retryAt,
  });
  repository.holdMessageForSmsAllowance = async (input) => {
    heldReason = input.reason;
    assert.equal(input.messageAttemptId, attemptId);
    assert.equal(input.retryAt, retryAt);
    return retryAt;
  };

  const cycle = await runDeliveryCycle({
    repository,
    workerId: "test-worker",
    encryptionKey,
    providers: {
      sms: {
        name: "fake-sms",
        isConfigured: () => true,
        async send() {
          providerCalls += 1;
          return { result: "accepted" };
        },
      },
    },
  });

  assert.equal(providerCalls, 0);
  assert.equal(heldReason, "sms_allowance_exhausted");
  assert.equal(cycle.deferred, 1);
  assert.equal(cycle.accepted, 0);
});

test("Google review sync closes its lease once for zero-review success and failure", async () => {
  const { repository } = createRepository();
  const accessToken = encryptField("google-access-token", encryptionKey, `${businessId}:google-oauth-access`);
  const connection = {
    integrationId: randomUUID(),
    businessId,
    locationId,
    accountName: "accounts/1001",
    locationName: "locations/2001",
    reviewUri: "https://g.page/r/example/review",
    accessToken,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    grantedScopes: ["https://www.googleapis.com/auth/business.manage"],
    syncWorkerId: "sync-worker-1",
    syncLeaseToken: randomUUID(),
  };
  repository.listDueGoogleConnections = async () => [connection];
  const completions: Array<{ succeeded: boolean; error?: string; seen?: string[] }> = [];
  repository.finishGoogleReviewSync = async (_connection, succeeded, error, seen) => {
    completions.push({ succeeded, error, seen });
  };
  const client: GoogleBusinessProfileClient = {
    isConfigured: () => true,
    authorizationUrl: () => "https://accounts.google.com/",
    async exchangeCode() { throw new Error("unused"); },
    async refreshAccessToken() { throw new Error("unused"); },
    async listProfiles() { return []; },
    async listReviews() { return []; },
  };
  const success = await synchronizeDueGoogleConnections(repository, client, encryptionKey, 1);
  assert.equal(success[0]?.imported, 0);
  assert.deepEqual(completions, [{ succeeded: true, error: undefined, seen: [] }]);

  completions.length = 0;
  client.listReviews = async () => { throw new Error("permission denied"); };
  const failure = await synchronizeDueGoogleConnections(repository, client, encryptionKey, 1);
  assert.match(failure[0]?.error ?? "", /permission denied/);
  assert.deepEqual(completions, [{ succeeded: false, error: "permission denied", seen: undefined }]);
});

test("Google token revocation decrypts with tenant context and durably finishes the lease", async () => {
  const { repository } = createRepository();
  const revocationId = randomUUID();
  const leaseToken = randomUUID();
  const token = encryptField("refresh-token-secret", encryptionKey, `${businessId}:google-oauth-refresh`);
  repository.claimGoogleTokenRevocations = async () => [{
    revocationId,
    integrationId: randomUUID(),
    businessId,
    tokenKind: "refresh",
    token,
    keyVersion: 1,
    leaseToken,
  }];
  let revoked = "";
  let finished: { succeeded: boolean; error?: string } | undefined;
  repository.finishGoogleTokenRevocation = async (_id, _worker, _lease, succeeded, error) => {
    finished = { succeeded, error };
  };
  const result = await runGoogleTokenRevocationCycle({
    repository,
    googleClient: { async revokeToken(value) { revoked = value; } },
    encryptionKey,
    workerId: "revocation-worker-1",
  });
  assert.equal(revoked, "refresh-token-secret");
  assert.deepEqual(finished, { succeeded: true, error: undefined });
  assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0 });
});

test("Twilio and SendGrid webhook verifiers reject tampering", () => {
  const twilioToken = "twilio-test-token";
  const twilioUrl = "https://api.example.com/webhooks/twilio/status";
  const fields = { MessageSid: "SM123", MessageStatus: "delivered" };
  const twilioPayload = `${twilioUrl}MessageSidSM123MessageStatusdelivered`;
  const twilioSignature = createHmac("sha1", twilioToken).update(twilioPayload).digest("base64");
  const twilioVerifier = createWebhookSecurity({ twilioAuthToken: twilioToken });
  assert.equal(twilioVerifier.verifyTwilio({ signature: twilioSignature, url: twilioUrl, fields }), true);
  assert.equal(twilioVerifier.verifyTwilio({ signature: twilioSignature, url: twilioUrl, fields: { ...fields, MessageStatus: "failed" } }), false);

  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const timestamp = "1784203200";
  const rawBody = Buffer.from('[{"event":"delivered","sg_event_id":"evt-1"}]');
  const signature = sign("sha256", Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString("base64");
  const sendGridVerifier = createWebhookSecurity({ sendGridVerificationKey: publicDer });
  assert.equal(sendGridVerifier.verifySendGrid({ signature, timestamp, rawBody }), true);
  assert.equal(sendGridVerifier.verifySendGrid({ signature, timestamp, rawBody: Buffer.from("[]") }), false);
});

test("opaque session hashes are deterministic only under the server pepper", () => {
  const token = randomBytes(32).toString("base64url");
  const first = hashOpaqueToken(token, sessionPepper);
  const second = hashOpaqueToken(token, sessionPepper);
  const other = hashOpaqueToken(token, `${sessionPepper}-other`);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
});
