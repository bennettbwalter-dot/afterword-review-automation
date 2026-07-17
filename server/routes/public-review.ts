import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import { validateGoogleReviewUri } from "../providers/google.js";
import { ApiError, requireSameOrigin, sendData } from "./shared.js";

const tokenParamsSchema = z.object({
  token: z.string().min(12).max(160).regex(/^[a-z0-9_-]+$/i),
}).strict();

const scanParamsSchema = z.object({
  scanId: z.string().uuid(),
}).strict();

const scanBodySchema = z.object({
  placementKey: z.string().trim().min(1).max(120).regex(/^[a-z0-9_-]+$/i).optional(),
}).strict();

function referrerHost(request: FastifyRequest) {
  if (!request.headers.referer) return undefined;
  try {
    return new URL(request.headers.referer).hostname.toLowerCase().slice(0, 253);
  } catch {
    return undefined;
  }
}

function deviceFamily(userAgent: string | undefined) {
  if (!userAgent) return "unknown";
  if (/bot|crawler|spider/i.test(userAgent)) return "bot";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|android|iphone/i.test(userAgent)) return "mobile";
  return "desktop";
}

function rotatingVisitorHash(request: FastifyRequest, pepper: string) {
  const rotation = new Date().toISOString().slice(0, 10);
  const dailyKey = createHmac("sha256", pepper).update(`qr-visitor:${rotation}`, "utf8").digest();
  return createHmac("sha256", dailyKey)
    .update(`${request.ip}\n${request.headers["user-agent"] ?? ""}`, "utf8")
    .digest();
}

export async function registerPublicReviewRoutes(app: FastifyInstance, options: BuildAppOptions) {
  const publicReviewOrigin = options.config.PUBLIC_REVIEW_BASE_URL ?? options.config.APP_ORIGIN;
  app.get("/api/v1/public/review-flows/:token", {
    config: { rateLimit: { max: 90, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const flow = await options.repository.resolvePublicReviewFlow(token);
    if (!flow) throw new ApiError(404, "REVIEW_FLOW_NOT_FOUND", "This review link is unavailable.");
    return sendData(reply, {
      provider: "google",
      businessName: flow.businessName,
      locationName: flow.locationName,
      destinationUrl: validateGoogleReviewUri(flow.destinationUrl),
    });
  });

  app.post("/api/v1/public/review-flows/:token/scans", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    requireSameOrigin(request, publicReviewOrigin, options.config.NODE_ENV === "production");
    const { token } = tokenParamsSchema.parse(request.params);
    const body = scanBodySchema.parse(request.body ?? {});
    const countryHeader = request.headers["cf-ipcountry"];
    const countryCode = typeof countryHeader === "string" && /^[A-Z]{2}$/.test(countryHeader)
      ? countryHeader
      : undefined;
    const scan = await options.repository.recordPublicQrScan({
      publicToken: token,
      anonymousVisitorHash: rotatingVisitorHash(request, options.config.SESSION_PEPPER),
      placementKey: body.placementKey,
      referrerHost: referrerHost(request),
      deviceFamily: deviceFamily(request.headers["user-agent"]),
      countryCode,
    });
    return sendData(reply, {
      scanId: scan.scanId,
      destinationUrl: validateGoogleReviewUri(scan.destinationUrl),
    }, 201);
  });

  app.post("/api/v1/public/review-scans/:scanId/continue", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    requireSameOrigin(request, publicReviewOrigin, options.config.NODE_ENV === "production");
    const { scanId } = scanParamsSchema.parse(request.params);
    await options.repository.markPublicQrContinue(scanId);
    return reply.code(204).send();
  });
}
