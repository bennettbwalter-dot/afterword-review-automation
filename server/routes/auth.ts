import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import { createSessionToken, hashOpaqueToken, verifyPassword } from "../security/crypto.js";
import { ApiError, redactActor, requireActor, requireSameOrigin, sendData } from "./shared.js";

const loginSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
}).strict();

const dummyPasswordHash = [
  "scrypt", "16384", "8", "1",
  Buffer.alloc(16).toString("base64url"),
  Buffer.alloc(64).toString("base64url"),
].join("$");

function compactUserAgent(value: string | undefined) {
  if (!value) return undefined;
  const knownFamily = value.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/i)?.[0];
  return (knownFamily ?? "Other browser").slice(0, 80);
}

async function passwordMatches(password: string, passwordHash: string) {
  try {
    return await verifyPassword(password, passwordHash);
  } catch {
    return false;
  }
}

export async function registerAuthRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.post("/api/v1/auth/login", {
    config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const body = loginSchema.parse(request.body);
    const credential = await options.repository.findCredentialByEmail(body.email);
    const matches = await passwordMatches(body.password, credential?.passwordHash ?? dummyPasswordHash);
    if (!credential || !matches || credential.disabled) {
      await options.repository.recordLoginResult?.(body.email, false);
      throw new ApiError(401, "INVALID_CREDENTIALS", "The email address or password is incorrect.");
    }
    if (credential.mfaRequired) {
      throw new ApiError(403, "MFA_REQUIRED", "Multi-factor verification is required for this account.");
    }

    const token = createSessionToken();
    const tokenHash = hashOpaqueToken(token, options.config.SESSION_PEPPER);
    const idleExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const absoluteExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const ipHash = createHmac("sha256", options.config.SESSION_PEPPER)
      .update(request.ip, "utf8")
      .digest();
    const sessionId = await options.repository.createLoginSession({
      userId: credential.userId,
      tokenHash,
      idleExpiresAt,
      absoluteExpiresAt,
      ipHash,
      userAgentFamily: compactUserAgent(request.headers["user-agent"]),
    });
    const actor = await options.repository.resolveLoginSession(tokenHash);
    if (!actor) {
      await options.repository.revokeLoginSession(sessionId, tokenHash);
      throw new ApiError(500, "SESSION_CREATION_FAILED", "The secure session could not be created.");
    }
    await options.repository.recordLoginResult?.(body.email, true);

    reply.setCookie(options.config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: options.config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    reply.header("cache-control", "no-store");
    return sendData(reply, {
      session: redactActor(actor),
      idleExpiresAt: idleExpiresAt.toISOString(),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
    });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    await options.repository.revokeLoginSession(actor.sessionId, actor.sessionTokenHash);
    reply.clearCookie(options.config.SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: options.config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
    reply.header("cache-control", "no-store");
    return sendData(reply, { signedOut: true });
  });

  app.get("/api/v1/session", async (request, reply) => {
    const actor = requireActor(request);
    reply.header("cache-control", "no-store");
    return sendData(reply, { session: redactActor(actor) });
  });
}
