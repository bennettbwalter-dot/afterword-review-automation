import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { RegistrationInput, SignupAccountType } from "../onboarding/types.js";
import { createTransactionalEmailProvider } from "../providers/transactional-email.js";
import { createSessionToken, hashOpaqueToken, hashPassword } from "../security/crypto.js";
import { ApiError, requireSameOrigin, sendData } from "./shared.js";

const genericResponse = { accepted: true, message: "If that address can be used, we have sent a verification link." };
const signupSchema = z.object({ email: z.string().trim().email().max(320).transform((v) => v.toLowerCase()), displayName: z.string().trim().min(1).max(120), accountType: z.enum(["business", "agency"]) }).strict();
const verifySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }).strict();
const registrationSchema = z.object({ password: z.string().min(12).max(1024), accountType: z.enum(["business", "agency"]), agencyName: z.string().trim().min(1).max(120).optional(), businessName: z.string().trim().min(1).max(120).optional(), locationName: z.string().trim().min(1).max(120).optional(), country: z.enum(["GB", "US"]).optional(), timezone: z.string().trim().min(1).max(80).optional() }).strict().superRefine((value, context) => {
  if (value.accountType === "business") for (const field of ["businessName", "locationName", "country", "timezone"] as const) if (!value[field]) context.addIssue({ code: "custom", path: [field], message: "Required for direct business setup." });
  if (value.accountType === "agency" && !value.agencyName) context.addIssue({ code: "custom", path: ["agencyName"], message: "Required for agency setup." });
});

function verifiedCookieName(config: BuildAppOptions["config"]) { return `${config.SESSION_COOKIE_NAME}_signup_verified`; }
function signVerifiedSignup(id: string, pepper: string) { return createHmac("sha256", pepper).update(`signup:${id}`, "utf8").digest("base64url"); }
function readVerifiedSignup(value: string | undefined, pepper: string): string | null {
  const [id, signature] = value?.split(".") ?? [];
  if (!id || !signature || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = signVerifiedSignup(id, pepper);
  const supplied = Buffer.from(signature); const actual = Buffer.from(expected);
  return supplied.length === actual.length && timingSafeEqual(supplied, actual) ? id : null;
}
function userAgent(value: string | undefined) { return value?.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/i)?.[0]?.slice(0, 80) ?? undefined; }

export async function registerOnboardingRoutes(app: FastifyInstance, options: BuildAppOptions) {
  const email = options.transactionalEmail ?? createTransactionalEmailProvider(options.config);
  app.post("/api/v1/auth/signup-intents", { config: { rateLimit: { max: 4, timeWindow: "15 minutes" } } }, async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const body = signupSchema.parse(request.body);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + options.config.SIGNUP_VERIFICATION_TTL_MINUTES * 60 * 1000);
    const created = await options.repository.createSignupIntent?.({ ...body, tokenHash: hashOpaqueToken(token, options.config.SESSION_PEPPER), expiresAt });
    if (!created) throw new ApiError(503, "SIGNUP_UNAVAILABLE", "Signup is not available.");
    if (created.shouldSendEmail) {
      const url = new URL("/signup/verify", options.config.APP_ORIGIN); url.searchParams.set("token", token);
      await email.sendAccountVerification({ to: body.email, displayName: body.displayName, verificationUrl: url.toString(), expiresAt });
    }
    reply.header("cache-control", "no-store");
    return sendData(reply, options.config.NODE_ENV === "test" ? { ...genericResponse, debugToken: token } : genericResponse, 202);
  });

  app.post("/api/v1/auth/signup-intents/verify", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const body = verifySchema.parse(request.body);
    const verified = await options.repository.consumeSignupIntent?.(hashOpaqueToken(body.token, options.config.SESSION_PEPPER));
    if (!verified) throw new ApiError(400, "SIGNUP_TOKEN_INVALID", "This verification link is invalid or has expired.");
    reply.setCookie(verifiedCookieName(options.config), `${verified.verifiedSignupId}.${signVerifiedSignup(verified.verifiedSignupId, options.config.SESSION_PEPPER)}`, { httpOnly: true, secure: options.config.NODE_ENV === "production", sameSite: "strict", path: "/api/v1/auth/register", maxAge: options.config.SIGNUP_VERIFICATION_TTL_MINUTES * 60 });
    reply.header("cache-control", "no-store");
    return sendData(reply, { verified: true, accountType: verified.accountType });
  });

  app.post("/api/v1/auth/register", { config: { rateLimit: { max: 4, timeWindow: "15 minutes" } } }, async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const verifiedSignupId = readVerifiedSignup(request.cookies[verifiedCookieName(options.config)], options.config.SESSION_PEPPER);
    if (!verifiedSignupId) throw new ApiError(401, "SIGNUP_VERIFICATION_REQUIRED", "Verify your email before registering.");
    const body = registrationSchema.parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const sessionToken = createSessionToken();
    const registration = await options.repository.registerVerifiedSignup?.({ verifiedSignupId, email: "", displayName: "", accountType: body.accountType as SignupAccountType, passwordHash, agencyName: body.agencyName, businessName: body.businessName, locationName: body.locationName, country: body.country, timezone: body.timezone, directContainer: body.accountType === "business", sessionTokenHash: hashOpaqueToken(sessionToken, options.config.SESSION_PEPPER), idleExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), ipHash: createHmac("sha256", options.config.SESSION_PEPPER).update(request.ip).digest(), userAgentFamily: userAgent(request.headers["user-agent"]) } satisfies RegistrationInput);
    if (!registration) throw new ApiError(503, "SIGNUP_UNAVAILABLE", "Signup is not available.");
    reply.clearCookie(verifiedCookieName(options.config), { httpOnly: true, secure: options.config.NODE_ENV === "production", sameSite: "strict", path: "/api/v1/auth/register" });
    reply.setCookie(options.config.SESSION_COOKIE_NAME, sessionToken, { httpOnly: true, secure: options.config.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 12 * 60 * 60 });
    reply.header("cache-control", "no-store");
    return sendData(reply, { onboardingStep: registration.onboardingStep, businessId: registration.businessId, locationId: registration.locationId, agencyId: registration.agencyId }, 201);
  });
}
