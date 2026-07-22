import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { projectGoogleProfileSnapshot, registerGoogleProfileRoutes } from "../server/routes/google-profile.js";
import { ApiError } from "../server/routes/shared.js";
import type { ActorContext, PlatformRepository, WorkspacePayload } from "../server/types.js";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000011";
const OTHER_LOCATION_ID = "00000000-0000-4000-8000-000000000012";

const workspace = {
  businesses: [{
    id: BUSINESS_ID,
    locationId: LOCATION_ID,
    name: "Harbour & Hearth",
    integrations: { google: { status: "Connected", tone: "success", lastEvent: "Last sync now" } },
    locationReports: [
      { id: LOCATION_ID, name: "Bristol" },
      { id: OTHER_LOCATION_ID, name: "Bath" },
    ],
  }],
  reviewsByBusiness: {
    [BUSINESS_ID]: [
      { id: "review-a", locationId: LOCATION_ID, body: "Visible review" },
      { id: "review-b", locationId: OTHER_LOCATION_ID, body: "Other location" },
    ],
  },
  requestsByBusiness: {
    [BUSINESS_ID]: [
      { id: "request-a", locationId: LOCATION_ID },
      { id: "request-b", locationId: OTHER_LOCATION_ID },
    ],
  },
  qrCodesByBusiness: {
    [BUSINESS_ID]: { locationId: LOCATION_ID, publicToken: "public-token" },
  },
  workflowsByLocation: {
    [LOCATION_ID]: {
      businessId: BUSINESS_ID,
      locationId: LOCATION_ID,
      reviewDestination: {
        runtimeUrl: "https://g.page/r/bristol/review?evidence=Exact%2BValue",
        qrUrl: "https://g.page/r/bristol/review?evidence=Exact%2BValue",
        verifiedAt: "2026-07-22T09:15:00.000Z",
        connectionHealth: "connected",
        matchesRuntime: true,
      },
    },
    [OTHER_LOCATION_ID]: {
      businessId: BUSINESS_ID,
      locationId: OTHER_LOCATION_ID,
      reviewDestination: {
        runtimeUrl: "https://g.page/r/bath/review",
        qrUrl: "https://g.page/r/bath/review",
        verifiedAt: "2026-07-21T08:00:00.000Z",
        connectionHealth: "connected",
        matchesRuntime: true,
      },
    },
  },
  access: { businessId: BUSINESS_ID, locationId: LOCATION_ID, canReadTenant: true },
} as unknown as WorkspacePayload;

function cloneWorkspace() {
  return structuredClone(workspace) as WorkspacePayload;
}

function assertNotFound(run: () => unknown) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, "GOOGLE_PROFILE_NOT_FOUND");
    return true;
  });
}

test("Google Profile read projection is business and location scoped", () => {
  const snapshot = projectGoogleProfileSnapshot(
    workspace,
    BUSINESS_ID,
    LOCATION_ID,
  );

  assert.equal(snapshot.businessId, BUSINESS_ID);
  assert.equal(snapshot.locationId, LOCATION_ID);
  assert.deepEqual(snapshot.reviews.map((review) => review.id), ["review-a"]);
  assert.deepEqual(snapshot.requests.map((request) => request.id), ["request-a"]);
  assert.equal(snapshot.qr?.publicToken, "public-token");
  assert.equal(snapshot.connection.state, "connected");
  assert.deepEqual(snapshot.workflow?.reviewDestination, workspace.workflowsByLocation[LOCATION_ID]?.reviewDestination);
  assert.equal(snapshot.workflow?.reviewDestination?.runtimeUrl, "https://g.page/r/bristol/review?evidence=Exact%2BValue");
  assert.notEqual(snapshot.workflow?.reviewDestination?.runtimeUrl, workspace.workflowsByLocation[OTHER_LOCATION_ID]?.reviewDestination?.runtimeUrl);
});

test("Google Profile read projection rejects a location report without location-keyed connection evidence", () => {
  const selectedWorkspace = cloneWorkspace();
  if (selectedWorkspace.access) selectedWorkspace.access.locationId = OTHER_LOCATION_ID;
  assertNotFound(() => projectGoogleProfileSnapshot(
    selectedWorkspace,
    BUSINESS_ID,
    OTHER_LOCATION_ID,
  ));
});

test("Google Profile read projection excludes a QR code from another location", () => {
  const selectedWorkspace = cloneWorkspace();
  selectedWorkspace.qrCodesByBusiness[BUSINESS_ID] = { locationId: OTHER_LOCATION_ID, publicToken: "other-location-token" };
  const snapshot = projectGoogleProfileSnapshot(selectedWorkspace, BUSINESS_ID, LOCATION_ID);

  assert.equal(snapshot.qr, null);
  assert.equal(snapshot.reviews.length, 1);
  assert.equal(snapshot.reviews[0]?.id, "review-a");
});

test("Google Profile read projection excludes a workflow whose embedded scope is another location", () => {
  const selectedWorkspace = cloneWorkspace();
  selectedWorkspace.workflowsByLocation[LOCATION_ID] = selectedWorkspace.workflowsByLocation[OTHER_LOCATION_ID]!;

  const snapshot = projectGoogleProfileSnapshot(selectedWorkspace, BUSINESS_ID, LOCATION_ID);

  assert.equal(snapshot.workflow, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /g\.page\/r\/bath\/review/u);
});

test("Google Profile read projection rejects every non-exact tenant grant with the not-found contract", () => {
  const wrongBusiness = cloneWorkspace();
  if (wrongBusiness.access) wrongBusiness.access.businessId = "00000000-0000-4000-8000-000000000099";
  assertNotFound(() => projectGoogleProfileSnapshot(wrongBusiness, BUSINESS_ID, LOCATION_ID));

  const wrongLocation = cloneWorkspace();
  if (wrongLocation.access) wrongLocation.access.locationId = OTHER_LOCATION_ID;
  assertNotFound(() => projectGoogleProfileSnapshot(wrongLocation, BUSINESS_ID, LOCATION_ID));

  const deniedTenant = cloneWorkspace();
  if (deniedTenant.access) deniedTenant.access.canReadTenant = false;
  assertNotFound(() => projectGoogleProfileSnapshot(deniedTenant, BUSINESS_ID, LOCATION_ID));
});

test("Google Profile connection states and capability recovery reasons fail closed", () => {
  const cases = [
    { status: "Connected", tone: "success" as const, expected: "connected", reason: /approved and proven in a controlled pilot/u },
    { status: "Disconnected", tone: "success" as const, expected: "disconnected", reason: /Reconnect the selected Google Business Profile location first/u },
    { status: "Permission revoked", tone: "success" as const, expected: "disconnected", reason: /Reconnect the selected Google Business Profile location first/u },
    { status: "Permission loss detected", tone: "danger" as const, expected: "disconnected", reason: /Reconnect the selected Google Business Profile location first/u },
    { status: "Sync delayed", tone: "warning" as const, expected: "attention", reason: /Resolve the selected location's Google connection issue first/u },
  ] as const;

  for (const connectionCase of cases) {
    const selectedWorkspace = cloneWorkspace();
    selectedWorkspace.businesses[0]!.integrations.google = {
      status: connectionCase.status,
      tone: connectionCase.tone,
      lastEvent: "State test",
    };
    const snapshot = projectGoogleProfileSnapshot(selectedWorkspace, BUSINESS_ID, LOCATION_ID);
    assert.equal(snapshot.connection.state, connectionCase.expected, connectionCase.status);
    for (const capability of Object.values(snapshot.capabilities)) {
      assert.equal(capability.available, false);
      assert.match(capability.reason, connectionCase.reason);
    }
  }
});

test("Google Profile route binds repository reads to the actor and exact requested location", async (t) => {
  const actor = { userId: "actor-1", role: "agency_admin" } as ActorContext;
  const calls: Array<{ actor: ActorContext; businessId?: string; locationId?: string }> = [];
  let currentActor: ActorContext | undefined = actor;
  let denyBusinessAccess = false;
  let denyScopedLocation = false;
  const repository = {
    async getWorkspace(capturedActor: ActorContext, businessId?: string, locationId?: string) {
      calls.push({ actor: capturedActor, businessId, locationId });
      const result = cloneWorkspace();
      if (denyBusinessAccess && !locationId) result.businesses = [];
      if (denyScopedLocation && locationId && result.access) result.access.locationId = OTHER_LOCATION_ID;
      return result;
    },
  } as PlatformRepository;
  const app = Fastify();
  t.after(() => app.close());
  app.addHook("preHandler", async (request) => { request.actor = currentActor; });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  await registerGoogleProfileRoutes(app, { repository } as never);

  const url = `/api/v1/businesses/${BUSINESS_ID}/locations/${LOCATION_ID}/google-profile`;
  const allowed = await app.inject({ method: "GET", url });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["cache-control"], "no-store");
  assert.equal(allowed.json().data.reviews[0].id, "review-a");
  assert.deepEqual(calls.map(({ actor: capturedActor, businessId, locationId }) => ({ sameActor: capturedActor === actor, businessId, locationId })), [
    { sameActor: true, businessId: BUSINESS_ID, locationId: undefined },
    { sameActor: true, businessId: BUSINESS_ID, locationId: LOCATION_ID },
  ]);

  currentActor = undefined;
  const unauthenticated = await app.inject({ method: "GET", url });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.headers["cache-control"], "no-store");

  currentActor = actor;
  denyBusinessAccess = true;
  calls.length = 0;
  const forbidden = await app.inject({ method: "GET", url });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.headers["cache-control"], "no-store");

  denyBusinessAccess = false;
  denyScopedLocation = true;
  calls.length = 0;
  const denied = await app.inject({ method: "GET", url });
  assert.equal(denied.statusCode, 404);
  assert.equal(denied.headers["cache-control"], "no-store");
  assert.equal(denied.json().error.code, "GOOGLE_PROFILE_NOT_FOUND");
  assert.doesNotMatch(denied.body, /Visible review/u);
});
