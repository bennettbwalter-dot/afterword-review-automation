import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { AgencyGrantPermission } from "../agency/types.js";
import { ApiError, requireActor, requireSameOrigin, sendData } from "./shared.js";
import { createSessionToken, hashOpaqueToken } from "../security/crypto.js";

const permission = z.enum(["content.create", "content.submit", "content.approve", "content.self_approve", "content.schedule", "content.publish", "video.spend"]);
const requestSchema = z.object({ agencyId: z.string().uuid(), businessId: z.string().uuid(), locationId: z.string().uuid(), permissions: z.array(permission).min(1).max(7), selfApproverUserId: z.string().uuid().optional(), videoSoftMonthlyCap: z.number().int().nonnegative().optional(), videoHardMonthlyCap: z.number().int().nonnegative().optional(), expiresAt: z.string().datetime().optional() }).strict().superRefine((value, context) => {
  if (value.permissions.includes("content.self_approve") !== Boolean(value.selfApproverUserId)) context.addIssue({ code: "custom", path: ["selfApproverUserId"], message: "Self approval requires one named agency user." });
  if (value.videoHardMonthlyCap !== undefined && value.videoSoftMonthlyCap !== undefined && value.videoHardMonthlyCap < value.videoSoftMonthlyCap) context.addIssue({ code: "custom", path: ["videoHardMonthlyCap"], message: "The hard cap must not be below the soft cap." });
});
const idSchema = z.object({ id: z.string().uuid() }).strict();
const agencyScopeSchema = z.object({ agencyId: z.string().uuid() }).strict();
const claimIssueSchema = z.object({ email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()), expiresInMinutes: z.number().int().min(10).max(10_080).default(1_440) }).strict();
const claimTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }).strict();
const accessClaimSchema = z.object({ agencyId: z.string().uuid(), email: z.string().trim().email().max(320), permissions: z.array(permission).min(1) }).strict();
const accessSelectSchema = claimTokenSchema.extend({ locationId: z.string().uuid() }).strict();

function correlationId(request: { headers: Record<string, string | string[] | undefined> }) {
  const supplied = request.headers["x-correlation-id"];
  return typeof supplied === "string" && z.string().uuid().safeParse(supplied).success ? supplied : randomUUID();
}
function unavailable(): never { throw new ApiError(503, "AGENCY_GRANTS_UNAVAILABLE", "Agency grants are not available."); }

export async function registerAgencyGrantRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.post("/api/v1/agency-grants/active", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    if (actor.supportSessionId) throw new ApiError(403, "SUPPORT_SESSION_READ_ONLY", "Support sessions cannot read agency grant controls.");
    const command = options.repository.listActiveAgencyClientGrants; if (!command) unavailable();
    return sendData(reply, { grants: await command(actor, agencyScopeSchema.parse(request.body).agencyId) });
  });
  app.post("/api/v1/agency-client-claims", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production"); const actor = requireActor(request); const body = accessClaimSchema.parse(request.body); const command = options.repository.issueAgencyClientAccessClaim; if (!command) unavailable();
    const token = createSessionToken(); const expiresAt = new Date(Date.now() + 24 * 60 * 60_000); await command(actor, body.agencyId, body.email, body.permissions, hashOpaqueToken(token, options.config.SESSION_PEPPER), expiresAt, correlationId(request));
    const url = new URL("/app/agency-grant", options.config.APP_ORIGIN); url.searchParams.set("claim", token); reply.header("cache-control", "no-store"); return sendData(reply, { claimUrl: url.toString(), expiresAt: expiresAt.toISOString() }, 201);
  });
  app.post("/api/v1/agency-client-claims/consume", async (request, reply) => { requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production"); const actor=requireActor(request); const command=options.repository.consumeAgencyClientAccessClaim; if(!command) unavailable(); if(!await command(actor,hashOpaqueToken(claimTokenSchema.parse(request.body).token,options.config.SESSION_PEPPER))) throw new ApiError(404,"AGENCY_CLAIM_UNAVAILABLE","This claim is unavailable."); return sendData(reply,{consumed:true}); });
  app.post("/api/v1/agency-client-claims/locations", async (request, reply) => { requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production"); const actor=requireActor(request); const command=options.repository.listAgencyClientAccessLocations; if(!command) unavailable(); return sendData(reply,{locations:await command(actor,hashOpaqueToken(claimTokenSchema.parse(request.body).token,options.config.SESSION_PEPPER))}); });
  app.post("/api/v1/agency-client-claims/select", async (request, reply) => { requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production"); const actor=requireActor(request); const body=accessSelectSchema.parse(request.body); const command=options.repository.selectAgencyClientAccessLocation; if(!command) unavailable(); return sendData(reply,await command(actor,hashOpaqueToken(body.token,options.config.SESSION_PEPPER),body.locationId,correlationId(request))); });
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
  app.post("/api/v1/agency-grants/:id/claims", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request); if (actor.supportSessionId) throw new ApiError(403, "SUPPORT_SESSION_READ_ONLY", "Support sessions cannot change agency grants.");
    const command = options.repository.issueAgencyClientGrantClaim; if (!command) unavailable();
    const body = claimIssueSchema.parse(request.body); const token = createSessionToken(); const expiresAt = new Date(Date.now() + body.expiresInMinutes * 60_000);
    await command(actor, idSchema.parse(request.params).id, body.email, hashOpaqueToken(token, options.config.SESSION_PEPPER), expiresAt, correlationId(request));
    reply.header("cache-control", "no-store");
    const claimUrl = new URL("/app/agency-grant", options.config.APP_ORIGIN); claimUrl.searchParams.set("claim", token);
    return sendData(reply, { claimUrl: claimUrl.toString(), expiresAt: expiresAt.toISOString() }, 201);
  });
  app.post("/api/v1/agency-grant-claims/consume", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request); if (actor.supportSessionId) throw new ApiError(403, "SUPPORT_SESSION_READ_ONLY", "Support sessions cannot use client claims.");
    const command = options.repository.consumeAgencyClientGrantClaim; if (!command) unavailable();
    const scope = await command(actor, hashOpaqueToken(claimTokenSchema.parse(request.body).token, options.config.SESSION_PEPPER));
    if (!scope) throw new ApiError(404, "AGENCY_GRANT_CLAIM_NOT_FOUND", "This client grant claim is unavailable.");
    reply.header("cache-control", "no-store"); return sendData(reply, { scope });
  });
  app.post("/api/v1/agency-grant-claims/locations", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request); if (actor.supportSessionId) throw new ApiError(403, "SUPPORT_SESSION_READ_ONLY", "Support sessions cannot use client claims.");
    const command = options.repository.listAgencyClientGrantClaimLocations; if (!command) unavailable();
    const scopes = await command(actor, hashOpaqueToken(claimTokenSchema.parse(request.body).token, options.config.SESSION_PEPPER));
    reply.header("cache-control", "no-store"); return sendData(reply, { scopes });
  });
}
