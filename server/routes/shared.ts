import type { FastifyReply, FastifyRequest } from "fastify";
import type { ActorContext, BusinessSummary, PlatformRepository } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext;
    rawBody?: Buffer;
  }
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function requireActor(request: FastifyRequest): ActorContext {
  if (!request.actor) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  }
  return request.actor;
}

export function requireSameOrigin(request: FastifyRequest, expectedOrigin: string, production = false): void {
  const origin = request.headers.origin;
  if (!origin) {
    if (production) {
      throw new ApiError(403, "ORIGIN_REQUIRED", "A valid request origin is required.");
    }
    return;
  }

  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new ApiError(403, "ORIGIN_INVALID", "The request origin is invalid.");
  }
  if (normalized !== new URL(expectedOrigin).origin) {
    throw new ApiError(403, "ORIGIN_MISMATCH", "The request origin is not allowed.");
  }
}

export async function requireBusinessAccess(
  repository: PlatformRepository,
  actor: ActorContext,
  businessId: string,
): Promise<BusinessSummary> {
  if (actor.role === "business_owner" && actor.businessId && actor.businessId !== businessId) {
    throw new ApiError(403, "BUSINESS_ACCESS_DENIED", "You do not have access to this business.");
  }
  const workspace = await repository.getWorkspace(actor, businessId);
  const business = workspace.businesses.find((candidate) => candidate.id === businessId);
  if (!business) {
    throw new ApiError(403, "BUSINESS_ACCESS_DENIED", "You do not have access to this business.");
  }
  return business;
}

export function sendData<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.code(statusCode).send({ data });
}

export function redactActor(actor: ActorContext) {
  return {
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
  };
}
