import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { isProduction } from "./config.js";
import type { GoogleBusinessProfileClient } from "./providers/google.js";
import type { WebhookSecurity } from "./providers/webhook-security.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGoogleRoutes } from "./routes/google.js";
import { registerPublicReviewRoutes } from "./routes/public-review.js";
import { registerSupportRoutes } from "./routes/support.js";
import { ApiError } from "./routes/shared.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { hashOpaqueToken } from "./security/crypto.js";
import type { PlatformRepository } from "./types.js";

export interface BuildAppOptions {
  config: AppConfig;
  repository: PlatformRepository;
  surface?: "application" | "ingress" | "all";
  googleClient?: GoogleBusinessProfileClient;
  webhookSecurity?: WebhookSecurity;
  externalWebhookBaseUrl?: string;
}

function safeJsonParse(value: Buffer) {
  if (value.length === 0) return {};
  return JSON.parse(value.toString("utf8")) as unknown;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const surface = options.surface ?? "all";
  const app = Fastify({
    logger: isProduction(options.config)
      ? { level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password"] }
      : { level: "warn" },
    bodyLimit: 256 * 1024,
    trustProxy: options.config.TRUST_PROXY_HOPS === 0 ? false : options.config.TRUST_PROXY_HOPS,
    requestIdHeader: "x-request-id",
  });

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    global: true,
    max: 180,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again shortly.",
        retryAfterSeconds: Math.ceil(context.ttl / 1000),
      },
    }),
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    try {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      request.rawBody = rawBody;
      done(null, safeJsonParse(rawBody));
    } catch {
      done(new ApiError(400, "INVALID_JSON", "The request body is not valid JSON."), undefined);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    const fields: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(rawBody.toString("utf8"))) {
      const current = fields[key];
      fields[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
    }
    done(null, fields);
  });

  if (surface !== "ingress") app.addHook("preHandler", async (request) => {
    const token = request.cookies[options.config.SESSION_COOKIE_NAME];
    if (!token || token.length > 256) return;
    const actor = await options.repository.resolveLoginSession(
      hashOpaqueToken(token, options.config.SESSION_PEPPER),
    );
    if (!actor) return;
    const supportSessionHeader = request.headers["x-support-session-id"];
    if (supportSessionHeader !== undefined) {
      if (typeof supportSessionHeader !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supportSessionHeader)) {
        throw new ApiError(400, "SUPPORT_SESSION_INVALID", "The support session identifier is invalid.");
      }
      if (actor.role !== "agency_admin") {
        throw new ApiError(403, "SUPPORT_SESSION_FORBIDDEN", "This account cannot use support sessions.");
      }
      actor.supportSessionId = supportSessionHeader;
    }
    request.actor = actor;
  });

  app.get("/api/v1/health", async (_request, reply) => reply.send({
    data: { status: "ok", service: surface === "ingress" ? "afterword-ingress" : "afterword-api", time: new Date().toISOString() },
  }));

  if (surface !== "ingress") {
    await registerAuthRoutes(app, options);
    await registerWorkspaceRoutes(app, options);
    await registerGoogleRoutes(app, options);
    await registerSupportRoutes(app, options);
  }
  if (surface !== "application") {
    await registerPublicReviewRoutes(app, options);
    await registerWebhookRoutes(app, options);
  }

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: "NOT_FOUND", message: "The requested API resource was not found.", requestId: request.id },
  }));

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, requestId: request.id },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "The request did not pass validation.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
          requestId: request.id,
        },
      });
    }
    const possibleError = error as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof possibleError.statusCode === "number" && possibleError.statusCode < 500
      ? possibleError.statusCode
      : 500;
    request.log.error({ err: error, requestId: request.id }, "request failed");
    return reply.code(statusCode).send({
      error: {
        code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
        message: statusCode === 500
          ? "The server could not complete the request."
          : String(possibleError.message ?? "The request could not be completed."),
        requestId: request.id,
      },
    });
  });

  return app;
}
