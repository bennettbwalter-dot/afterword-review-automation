import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import {
  googleBusinessManageScope,
  GoogleProviderError,
  validateGoogleReviewUri,
} from "../providers/google.js";
import { encryptField, decryptField, hashOpaqueToken } from "../security/crypto.js";
import { ApiError, requireActor, requireBusinessAccess, requireSameOrigin, sendData } from "./shared.js";
import type { ActorContext, PlatformRepository } from "../types.js";

interface GoogleCommandRepository extends PlatformRepository {
  storeGoogleProfileSelection?(
    actorUserId: string,
    businessId: string,
    locationId: string,
    tokenHash: Buffer,
    payload: { ciphertext: Buffer; nonce: Buffer; tag: Buffer },
    expiresAt: Date,
  ): Promise<void>;
  peekGoogleProfileSelection?(
    actor: ActorContext,
    tokenHash: Buffer,
  ): Promise<{ businessId: string; locationId: string; payload: { ciphertext: Buffer; nonce: Buffer; tag: Buffer } } | null>;
  consumeGoogleProfileSelection?(
    actor: ActorContext,
    tokenHash: Buffer,
  ): Promise<{ businessId: string; locationId: string; payload: { ciphertext: Buffer; nonce: Buffer; tag: Buffer } } | null>;
  requestGoogleReviewSync?(actor: ActorContext, businessId: string): Promise<number>;
  disconnectGoogleConnection?(
    actor: ActorContext,
    businessId: string,
    locationId: string,
  ): Promise<{ revocationId: string }>;
}

const oauthParamsSchema = z.object({
  businessId: z.string().uuid(),
  locationId: z.string().uuid(),
}).strict();

const callbackQuerySchema = z.object({
  state: z.string().min(20).max(512),
  code: z.string().min(1).max(4_096).optional(),
  error: z.string().max(200).optional(),
}).passthrough();

const syncBodySchema = z.object({
  businessId: z.string().uuid(),
}).strict();

const oauthVerifierPayloadSchema = z.object({
  verifier: z.string().min(32).max(256),
  actorUserId: z.string().uuid(),
}).strict();

const googleProfileSchema = z.object({
  accountName: z.string().regex(/^accounts\/[A-Za-z0-9_-]+$/),
  accountDisplayName: z.string().min(1).max(500),
  locationName: z.string().regex(/^(?:accounts\/[A-Za-z0-9_-]+\/)?locations\/[A-Za-z0-9_-]+$/),
  locationTitle: z.string().min(1).max(500),
  newReviewUri: z.string().url().max(2_048).optional(),
}).strict();

const profileSelectionPayloadSchema = z.object({
  actorUserId: z.string().uuid(),
  accessToken: z.string().min(1).max(32_768),
  refreshToken: z.string().min(1).max(32_768),
  expiresAt: z.string().datetime({ offset: true }),
  scopes: z.array(z.string().max(500)).min(1).max(100),
  profiles: z.array(googleProfileSchema).min(2).max(500),
}).strict();

const selectionParamsSchema = z.object({
  selectionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

const selectionBodySchema = z.object({ profileIndex: z.number().int().min(0).max(499) }).strict();

function appRedirect(origin: string, values: Record<string, string>) {
  const url = new URL("/app/integrations", origin);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function selectionContext(businessId: string, locationId: string) {
  return `${businessId}:${locationId}:google-profile-selection`;
}

function decodeSelectionPayload(
  state: { businessId: string; locationId: string; payload: { ciphertext: Buffer; nonce: Buffer; tag: Buffer } },
  encryptionKey: string,
) {
  const plaintext = decryptField(state.payload, encryptionKey, selectionContext(state.businessId, state.locationId));
  return profileSelectionPayloadSchema.parse(JSON.parse(plaintext) as unknown);
}

function googleUnavailable(options: BuildAppOptions) {
  if (!options.googleClient?.isConfigured()) {
    throw new ApiError(503, "GOOGLE_NOT_CONFIGURED", "Google Business Profile OAuth is not configured.");
  }
  return options.googleClient;
}

export async function registerGoogleRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.post(
    "/api/v1/businesses/:businessId/locations/:locationId/integrations/google/oauth/start",
    async (request, reply) => {
      requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
      const actor = requireActor(request);
      if (actor.supportSessionId) {
        throw new ApiError(
          403,
          "GOOGLE_OWNER_REQUIRED",
          "Google Business Profile must be connected by a direct business owner or administrator session.",
        );
      }
      const { businessId, locationId } = oauthParamsSchema.parse(request.params);
      await requireBusinessAccess(options.repository, actor, businessId);
      const googleClient = googleUnavailable(options);

      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
      const encryptedVerifier = encryptField(
        JSON.stringify({ verifier, actorUserId: actor.userId }),
        options.config.FIELD_ENCRYPTION_KEY,
        `${businessId}:${locationId}:google-oauth-state`,
      );
      await options.repository.beginGoogleOAuth(
        actor,
        businessId,
        locationId,
        hashOpaqueToken(state, options.config.SESSION_PEPPER),
        encryptedVerifier,
        expiresAt,
      );
      reply.header("cache-control", "no-store");
      return sendData(reply, {
        authorizationUrl: googleClient.authorizationUrl({ state, codeChallenge: pkceChallenge(verifier) }),
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  app.get("/api/v1/integrations/google/oauth/callback", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const query = callbackQuerySchema.parse(request.query);
    const storedState = await options.repository.consumeGoogleOAuthState(
      hashOpaqueToken(query.state, options.config.SESSION_PEPPER),
    );
    if (!storedState) {
      throw new ApiError(400, "OAUTH_STATE_INVALID", "The Google authorization request is invalid or expired.");
    }
    if (query.error || !query.code) {
      return reply.redirect(appRedirect(options.config.APP_ORIGIN, {
        google: "error",
        reason: query.error ?? "authorization_cancelled",
        business: storedState.businessId,
        location: storedState.locationId,
      }));
    }

    try {
      const googleClient = googleUnavailable(options);
      const verifier = decryptField(
        storedState.codeVerifier,
        options.config.FIELD_ENCRYPTION_KEY,
        `${storedState.businessId}:${storedState.locationId}:google-oauth-state`,
      );
      const verifierPayload = oauthVerifierPayloadSchema.parse(JSON.parse(verifier) as unknown);
      if (verifierPayload.actorUserId !== storedState.actorUserId) {
        throw new GoogleProviderError("The Google authorization actor did not match the stored OAuth state.");
      }
      const tokens = await googleClient.exchangeCode(query.code, verifierPayload.verifier);
      if (!tokens.scopes.includes(googleBusinessManageScope)) {
        throw new GoogleProviderError("The required Google Business Profile permission was not granted.");
      }
      if (!tokens.refreshToken) {
        throw new GoogleProviderError("Google did not grant durable offline access. Reconnect and approve access again.");
      }
      const profiles = await googleClient.listProfiles(tokens.accessToken);
      if (profiles.length === 0) {
        throw new GoogleProviderError("No Google Business Profile location was available for this account.");
      }
      if (profiles.length > 1) {
        const selectionRepository = options.repository as GoogleCommandRepository;
        if (!selectionRepository.storeGoogleProfileSelection) {
          throw new GoogleProviderError("Secure Google profile selection is not configured.");
        }
        const selectionToken = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
        const selectionPayload = profileSelectionPayloadSchema.parse({
          actorUserId: verifierPayload.actorUserId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt.toISOString(),
          scopes: tokens.scopes,
          profiles,
        });
        await selectionRepository.storeGoogleProfileSelection(
          verifierPayload.actorUserId,
          storedState.businessId,
          storedState.locationId,
          hashOpaqueToken(selectionToken, options.config.SESSION_PEPPER),
          encryptField(
            JSON.stringify(selectionPayload),
            options.config.FIELD_ENCRYPTION_KEY,
            selectionContext(storedState.businessId, storedState.locationId),
          ),
          expiresAt,
        );
        return reply.redirect(appRedirect(options.config.APP_ORIGIN, {
          google: "selection_required",
          selection: selectionToken,
          business: storedState.businessId,
          location: storedState.locationId,
        }));
      }
      const profile = profiles[0];
      const reviewUri = validateGoogleReviewUri(profile.newReviewUri);
      await options.repository.saveGoogleConnection({
        actorUserId: verifierPayload.actorUserId,
        businessId: storedState.businessId,
        locationId: storedState.locationId,
        accountName: profile.accountName,
        locationName: profile.locationName,
        accessToken: encryptField(
          tokens.accessToken,
          options.config.FIELD_ENCRYPTION_KEY,
          `${storedState.businessId}:google-oauth-access`,
        ),
        refreshToken: encryptField(
          tokens.refreshToken,
          options.config.FIELD_ENCRYPTION_KEY,
          `${storedState.businessId}:google-oauth-refresh`,
        ),
        expiresAt: tokens.expiresAt,
        grantedScopes: tokens.scopes,
        reviewUri,
      });
      return reply.redirect(appRedirect(options.config.APP_ORIGIN, {
        google: "connected",
        business: storedState.businessId,
        location: storedState.locationId,
      }));
    } catch (error) {
      request.log.warn({ err: error, requestId: request.id }, "google oauth callback failed");
      return reply.redirect(appRedirect(options.config.APP_ORIGIN, {
        google: "error",
        reason: "connection_failed",
        business: storedState.businessId,
        location: storedState.locationId,
      }));
    }
  });

  app.get("/api/v1/integrations/google/oauth/selections/:selectionToken", async (request, reply) => {
    const actor = requireActor(request);
    const { selectionToken } = selectionParamsSchema.parse(request.params);
    const repository = options.repository as GoogleCommandRepository;
    if (!repository.peekGoogleProfileSelection) {
      throw new ApiError(503, "GOOGLE_SELECTION_UNAVAILABLE", "Secure Google profile selection is not configured.");
    }
    const state = await repository.peekGoogleProfileSelection(
      actor,
      hashOpaqueToken(selectionToken, options.config.SESSION_PEPPER),
    );
    if (!state) throw new ApiError(404, "GOOGLE_SELECTION_EXPIRED", "This Google profile selection is invalid or expired.");
    await requireBusinessAccess(options.repository, actor, state.businessId);
    const payload = decodeSelectionPayload(state, options.config.FIELD_ENCRYPTION_KEY);
    reply.header("cache-control", "no-store");
    return sendData(reply, {
      businessId: state.businessId,
      locationId: state.locationId,
      profiles: payload.profiles.map((profile, profileIndex) => ({
        profileIndex,
        accountDisplayName: profile.accountDisplayName,
        locationTitle: profile.locationTitle,
        reviewDestinationAvailable: Boolean(profile.newReviewUri),
      })),
    });
  });

  app.post("/api/v1/integrations/google/oauth/selections/:selectionToken", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    const { selectionToken } = selectionParamsSchema.parse(request.params);
    const { profileIndex } = selectionBodySchema.parse(request.body);
    const repository = options.repository as GoogleCommandRepository;
    if (!repository.peekGoogleProfileSelection || !repository.consumeGoogleProfileSelection) {
      throw new ApiError(503, "GOOGLE_SELECTION_UNAVAILABLE", "Secure Google profile selection is not configured.");
    }
    const tokenHash = hashOpaqueToken(selectionToken, options.config.SESSION_PEPPER);
    const pending = await repository.peekGoogleProfileSelection(actor, tokenHash);
    if (!pending) throw new ApiError(404, "GOOGLE_SELECTION_EXPIRED", "This Google profile selection is invalid or expired.");
    await requireBusinessAccess(options.repository, actor, pending.businessId);
    const state = await repository.consumeGoogleProfileSelection(actor, tokenHash);
    if (!state || state.businessId !== pending.businessId || state.locationId !== pending.locationId) {
      throw new ApiError(409, "GOOGLE_SELECTION_ALREADY_USED", "This Google profile selection has already been completed.");
    }
    const payload = decodeSelectionPayload(state, options.config.FIELD_ENCRYPTION_KEY);
    if (payload.actorUserId !== actor.userId) {
      throw new ApiError(403, "GOOGLE_SELECTION_FORBIDDEN", "This Google profile selection belongs to another user.");
    }
    const profile = payload.profiles[profileIndex];
    if (!profile) throw new ApiError(400, "GOOGLE_PROFILE_INVALID", "Select an available Google Business Profile location.");
    const reviewUri = validateGoogleReviewUri(profile.newReviewUri);
    await options.repository.saveGoogleConnection({
      actorUserId: payload.actorUserId,
      businessId: state.businessId,
      locationId: state.locationId,
      accountName: profile.accountName,
      locationName: profile.locationName,
      reviewUri,
      accessToken: encryptField(payload.accessToken, options.config.FIELD_ENCRYPTION_KEY, `${state.businessId}:google-oauth-access`),
      refreshToken: encryptField(payload.refreshToken, options.config.FIELD_ENCRYPTION_KEY, `${state.businessId}:google-oauth-refresh`),
      expiresAt: new Date(payload.expiresAt),
      grantedScopes: payload.scopes,
    });
    return sendData(reply, { connected: true, businessId: state.businessId, locationId: state.locationId });
  });

  const syncHandler = async (request: FastifyRequest, reply: FastifyReply, pathBusinessId?: string) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    const businessId = pathBusinessId ?? syncBodySchema.parse(request.body).businessId;
    await requireBusinessAccess(options.repository, actor, businessId);
    googleUnavailable(options);
    const syncRepository = options.repository as GoogleCommandRepository;
    if (!syncRepository.requestGoogleReviewSync) {
      throw new ApiError(503, "GOOGLE_SYNC_COMMAND_UNAVAILABLE", "Durable Google sync commands are not configured.");
    }
    const scheduledConnections = await syncRepository.requestGoogleReviewSync(actor, businessId);
    return sendData(reply, { accepted: true, scheduledConnections }, 202);
  };

  app.post("/api/v1/integrations/google/reviews/sync", (request, reply) => syncHandler(request, reply));
  app.post("/api/v1/businesses/:businessId/integrations/google/reviews/sync", (request, reply) => {
    const { businessId } = z.object({ businessId: z.string().uuid() }).parse(request.params);
    return syncHandler(request, reply, businessId);
  });

  app.delete(
    "/api/v1/businesses/:businessId/locations/:locationId/integrations/google",
    async (request, reply) => {
      requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
      const actor = requireActor(request);
      const { businessId, locationId } = oauthParamsSchema.parse(request.params);
      await requireBusinessAccess(options.repository, actor, businessId);
      const repository = options.repository as GoogleCommandRepository;
      if (!repository.disconnectGoogleConnection) {
        throw new ApiError(503, "GOOGLE_DISCONNECT_UNAVAILABLE", "Google disconnect is not configured.");
      }
      const command = await repository.disconnectGoogleConnection(actor, businessId, locationId);
      return sendData(reply, {
        disconnected: true,
        revocationId: command.revocationId,
      }, 202);
    },
  );
}
