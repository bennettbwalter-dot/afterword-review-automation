import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { WorkspacePayload } from "../types.js";
import { ApiError, requireActor, requireBusinessAccess, sendData } from "./shared.js";

const paramsSchema = z.object({
  businessId: z.string().uuid(),
  locationId: z.string().uuid(),
}).strict();

type Row = Record<string, unknown>;

function asRows(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is Row => typeof entry === "object" && entry !== null) : [];
}

function locationMatches(value: Row, locationId: string) {
  return value.locationId === locationId;
}

export interface GoogleProfileSnapshot {
  businessId: string;
  locationId: string;
  connection: { state: "connected" | "attention" | "disconnected"; lastSyncedAt?: string };
  profile: null;
  reviews: Row[];
  requests: Row[];
  qr: Row | null;
  workflow: WorkspacePayload["workflowsByLocation"][string] | null;
  capabilities: Record<"profileFields" | "services" | "attributes" | "reviewReplies" | "posts" | "images" | "videos", { available: false; reason: string }>;
}

function googleConnectionState(google: WorkspacePayload["businesses"][number]["integrations"]["google"]): GoogleProfileSnapshot["connection"]["state"] {
  const evidence = `${google.status} ${google.lastEvent}`.toLowerCase();
  if (/(?:disconnect|reconnect required|revoked|permission[ _-](?:loss|lost|denied)|authentication[ _-]required|disabled)/u.test(evidence)) {
    return "disconnected";
  }
  return google.tone === "success" ? "connected" : "attention";
}

function unavailableCapabilityFor(state: GoogleProfileSnapshot["connection"]["state"]) {
  const reason = state === "connected"
    ? "Unavailable until the Google capability is approved and proven in a controlled pilot."
    : state === "disconnected"
      ? "Reconnect the selected Google Business Profile location first."
      : "Resolve the selected location's Google connection issue first.";
  return { available: false as const, reason };
}

export function projectGoogleProfileSnapshot(workspace: WorkspacePayload, businessId: string, locationId: string): GoogleProfileSnapshot {
  const business = workspace.businesses.find((candidate) => candidate.id === businessId);
  const locationKnown = business?.locationId === locationId || business?.locationReports.some((location) => location.id === locationId);
  if (
    !business
    || !locationKnown
    || workspace.access?.businessId !== businessId
    || workspace.access.locationId !== locationId
    || workspace.access.canReadTenant !== true
  ) {
    throw new ApiError(404, "GOOGLE_PROFILE_NOT_FOUND", "This Google Profile location is not available in the current workspace.");
  }

  const google = business.integrations.google;
  const state = googleConnectionState(google);
  const unavailableCapability = unavailableCapabilityFor(state);
  const reviews = asRows(workspace.reviewsByBusiness[businessId]).filter((review) => locationMatches(review, locationId));
  const requests = asRows(workspace.requestsByBusiness[businessId]).filter((request) => locationMatches(request, locationId));
  const candidateQr = workspace.qrCodesByBusiness[businessId];
  const qr = candidateQr && typeof candidateQr === "object" && candidateQr !== null && (candidateQr as Row).locationId === locationId
    ? candidateQr as Row
    : null;
  const candidateWorkflow = workspace.workflowsByLocation[locationId];
  const workflow = candidateWorkflow?.businessId === businessId && candidateWorkflow.locationId === locationId
    ? candidateWorkflow
    : null;

  return {
    businessId,
    locationId,
    connection: { state, lastSyncedAt: google.lastEvent.startsWith("Last sync ") ? google.lastEvent.slice("Last sync ".length) : undefined },
    profile: null,
    reviews,
    requests,
    qr,
    workflow,
    capabilities: {
      profileFields: unavailableCapability,
      services: unavailableCapability,
      attributes: unavailableCapability,
      reviewReplies: unavailableCapability,
      posts: unavailableCapability,
      images: unavailableCapability,
      videos: unavailableCapability,
    },
  };
}

export async function registerGoogleProfileRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.get("/api/v1/businesses/:businessId/locations/:locationId/google-profile", async (request, reply) => {
    const actor = requireActor(request);
    const { businessId, locationId } = paramsSchema.parse(request.params);
    await requireBusinessAccess(options.repository, actor, businessId);
    const workspace = await options.repository.getWorkspace(actor, businessId, locationId);
    reply.header("cache-control", "no-store");
    return sendData(reply, projectGoogleProfileSnapshot(workspace, businessId, locationId));
  });
}
