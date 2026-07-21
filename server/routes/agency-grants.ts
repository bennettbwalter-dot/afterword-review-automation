import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { AgencyGrantPermission } from "../agency/types.js";
import { ApiError, requireActor, requireSameOrigin, sendData } from "./shared.js";

const permission = z.enum(["content.create", "content.submit", "content.approve", "content.self_approve", "content.schedule", "content.publish", "video.spend"]);
const requestSchema = z.object({ agencyId: z.string().uuid(), businessId: z.string().uuid(), locationId: z.string().uuid(), permissions: z.array(permission).min(1).max(7), selfApproverUserId: z.string().uuid().optional(), videoSoftMonthlyCap: z.number().int().nonnegative().optional(), videoHardMonthlyCap: z.number().int().nonnegative().optional(), expiresAt: z.string().datetime().optional() }).strict().superRefine((value, context) => {
  if (value.permissions.includes("content.self_approve") !== Boolean(value.selfApproverUserId)) context.addIssue({ code: "custom", path: ["selfApproverUserId"], message: "Self approval requires one named agency user." });
  if (value.videoHardMonthlyCap !== undefined && value.videoSoftMonthlyCap !== undefined && value.videoHardMonthlyCap < value.videoSoftMonthlyCap) context.addIssue({ code: "custom", path: ["videoHardMonthlyCap"], message: "The hard cap must not be below the soft cap." });
});
const idSchema = z.object({ id: z.string().uuid() }).strict();

function correlationId(request: { headers: Record<string, string | string[] | undefined> }) {
  const supplied = request.headers["x-correlation-id"];
  return typeof supplied === "string" && z.string().uuid().safeParse(supplied).success ? supplied : randomUUID();
}
function unavailable(): never { throw new ApiError(503, "AGENCY_GRANTS_UNAVAILABLE", "Agency grants are not available."); }

export async function registerAgencyGrantRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.post("/api/v1/agency-grants", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request); if (actor.supportSessionId) throw new ApiError(403, "SUPPORT_SESSION_READ_ONLY", "Support sessions cannot change agency grants.");
    const body = requestSchema.parse(request.body); const command = options.repository.requestAgencyClientGrant; if (!command) unavailable();
    return sendData(reply, await command(actor, { ...body, permissions: [...new Set(body.permissions)] as AgencyGrantPermission[], correlationId: correlationId(request) }), 201);
  });
  for (const [path, method] of [["accept", "acceptAgencyClientGrant"], ["reject", "rejectAgencyClientGrant"], ["revoke", "revokeAgencyClientGrant"]] as const) {
    app.post(`/api/v1/agency-grants/:id/${path}`, async (request, reply) => {
      requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
      const actor = requireActor(request); if (actor.supportSessionId) throw new ApiError(403, "SUPPORT_SESSION_READ_ONLY", "Support sessions cannot change agency grants.");
      const command = options.repository[method]; if (!command) unavailable();
      return sendData(reply, await command(actor, idSchema.parse(request.params).id, correlationId(request)));
    });
  }
}
