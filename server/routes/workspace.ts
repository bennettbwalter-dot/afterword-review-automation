import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import { ApiError, requireActor, requireBusinessAccess, requireSameOrigin, sendData } from "./shared.js";

const workspaceQuerySchema = z.object({
  businessId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
}).strict();

const businessParamsSchema = z.object({
  businessId: z.string().uuid(),
}).strict();

const smsPolicySchema = z.object({
  policy: z.enum(["pause_sms", "auto_top_up"]),
}).strict();

const completedJobSchema = z.object({
  locationId: z.string().uuid(),
  externalJobId: z.string().trim().min(1).max(160),
  externalCustomerId: z.string().trim().min(1).max(160).optional(),
  serviceLabel: z.string().trim().min(1).max(160),
  occurredAt: z.string().datetime({ offset: true }),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(7).max(32).regex(/^[+0-9().\-\s]+$/).optional(),
  email: z.string().trim().toLowerCase().email().max(320).optional(),
  preferredChannel: z.enum(["SMS", "Email"]),
  consent: z.object({
    status: z.enum(["granted", "withdrawn", "unknown"]),
    wording: z.string().trim().min(1).max(4_000),
    wordingVersion: z.string().trim().min(1).max(120),
    purpose: z.string().trim().min(1).max(160),
    capturedAt: z.string().datetime({ offset: true }),
    source: z.string().trim().min(1).max(160),
    transactionReference: z.string().trim().min(1).max(240),
    evidenceReference: z.string().trim().min(1).max(500).optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.preferredChannel === "SMS" && !value.phone) {
    context.addIssue({ code: "custom", path: ["phone"], message: "A phone number is required for SMS." });
  }
  if (value.preferredChannel === "Email" && !value.email) {
    context.addIssue({ code: "custom", path: ["email"], message: "An email address is required for email." });
  }
});

function normalizePhone(value: string | undefined, country: "GB" | "US") {
  if (!value) return undefined;
  let compact = value.replace(/[().\-\s]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if (country === "GB") {
    if (compact.startsWith("0")) compact = `+44${compact.slice(1)}`;
    else if (/^44\d+$/.test(compact)) compact = `+${compact}`;
  } else if (country === "US") {
    if (/^\d{10}$/.test(compact)) compact = `+1${compact}`;
    else if (/^1\d{10}$/.test(compact)) compact = `+${compact}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw new ApiError(400, "PHONE_INVALID", "The phone number must be a valid international number.");
  }
  return compact;
}

export async function registerWorkspaceRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.get("/api/v1/workspace", async (request, reply) => {
    const actor = requireActor(request);
    const query = workspaceQuerySchema.parse(request.query);
    if (query.businessId) {
      await requireBusinessAccess(options.repository, actor, query.businessId);
    }
    const workspace = await options.repository.getWorkspace(actor, query.businessId, query.locationId);
    if (query.locationId) {
      const selectedBusinessId = query.businessId ?? actor.businessId;
      const selectedBusiness = workspace.businesses.find((business) => business.id === selectedBusinessId);
      const locationAllowed = selectedBusiness?.locationId === query.locationId
        || selectedBusiness?.locationReports.some((location) => location.id === query.locationId);
      if (!locationAllowed) {
        throw new ApiError(404, "LOCATION_NOT_FOUND", "This location is not available in the selected business workspace.");
      }
    }
    reply.header("cache-control", "no-store");
    return sendData(reply, workspace);
  });

  app.post("/api/v1/businesses/:businessId/completed-jobs", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    const { businessId } = businessParamsSchema.parse(request.params);
    const body = completedJobSchema.parse(request.body);
    const business = await requireBusinessAccess(options.repository, actor, businessId);
    const phone = normalizePhone(body.phone, business.country);

    const result = await options.repository.createCompletedJob(actor, {
      businessId,
      locationId: body.locationId,
      externalJobId: body.externalJobId,
      externalCustomerId: body.externalCustomerId,
      serviceLabel: body.serviceLabel,
      occurredAt: body.occurredAt,
      firstName: body.firstName,
      phone,
      email: body.email,
      preferredChannel: body.preferredChannel,
      consent: body.consent,
    });
    return sendData(reply, result, result.duplicate ? 200 : 201);
  });

  app.patch("/api/v1/businesses/:businessId/billing/sms-policy", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    const { businessId } = businessParamsSchema.parse(request.params);
    const { policy } = smsPolicySchema.parse(request.body);
    await requireBusinessAccess(options.repository, actor, businessId);
    const result = await options.repository.updateSmsOveragePolicy(
      actor,
      businessId,
      policy,
      randomUUID(),
    );
    if (!result.updated) {
      if (result.reason === "access_denied") {
        throw new ApiError(403, "BILLING_ACCESS_DENIED", "You do not have permission to change SMS billing controls.");
      }
      throw new ApiError(409, "BILLING_UNAVAILABLE", "SMS billing is not configured for this business.");
    }
    return sendData(reply, { policy: result.policy });
  });
}
