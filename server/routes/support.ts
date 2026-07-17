import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { ActorContext } from "../types.js";
import { ApiError, requireActor, requireBusinessAccess, requireSameOrigin, sendData } from "./shared.js";

const startSchema = z.object({
  businessId: z.string().uuid(),
  scope: z.enum(["view", "configuration"]),
  reason: z.string().trim().min(10).max(1_000),
  durationMinutes: z.union([z.literal(15), z.literal(30)]),
}).strict();

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const endSchema = z.object({ reason: z.string().trim().min(10).max(1_000) }).strict();

function requireAgencyAdmin(actor: ActorContext) {
  if (actor.role !== "agency_admin") {
    throw new ApiError(403, "AGENCY_ADMIN_REQUIRED", "Agency administrator access is required.");
  }
}

export async function registerSupportRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.post("/api/v1/support-sessions", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    requireAgencyAdmin(actor);
    const body = startSchema.parse(request.body);
    await requireBusinessAccess(options.repository, actor, body.businessId);
    const sessionId = await options.repository.startSupportSession(actor, body);
    return sendData(reply, {
      id: sessionId,
      businessId: body.businessId,
      scope: body.scope,
      expiresAt: new Date(Date.now() + body.durationMinutes * 60 * 1_000).toISOString(),
    }, 201);
  });

  app.delete("/api/v1/support-sessions/:id", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    requireAgencyAdmin(actor);
    const { id } = idParamsSchema.parse(request.params);
    const { reason } = endSchema.parse(request.body);
    const ended = await options.repository.endSupportSession(actor, id, reason);
    if (!ended) throw new ApiError(404, "SUPPORT_SESSION_NOT_FOUND", "The support session is not active.");
    return reply.code(204).send();
  });
}
