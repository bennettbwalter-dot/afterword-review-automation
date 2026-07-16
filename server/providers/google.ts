import type { AppConfig } from "../config.js";
import { decryptField, encryptField } from "../security/crypto.js";
import type {
  EncryptedPayload,
  GoogleConnectionRecord,
  GoogleReviewInput,
  PlatformRepository,
} from "../types.js";

interface GoogleTokenRefreshRepository extends PlatformRepository {
  saveRefreshedGoogleToken?(input: {
    integrationId: string;
    workerId: string;
    leaseToken: string;
    accessToken: EncryptedPayload;
    refreshToken?: EncryptedPayload;
    expiresAt: Date;
    grantedScopes: string[];
  }): Promise<void>;
}

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ACCOUNTS_ENDPOINT = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const BUSINESS_INFORMATION_ENDPOINT = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_ENDPOINT = "https://mybusiness.googleapis.com/v4";

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

export interface GoogleProfile {
  accountName: string;
  accountDisplayName: string;
  locationName: string;
  locationTitle: string;
  newReviewUri?: string;
}

export function validateGoogleReviewUri(value: string | undefined) {
  if (!value) throw new GoogleProviderError("Google did not return a review destination for this location.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleProviderError("Google returned an invalid review destination.");
  }
  const host = url.hostname.toLowerCase();
  const allowedDestination = host === "g.page"
    ? /^\/r\/[a-z0-9_-]+\/review\/?$/i.test(url.pathname)
    : host === "search.google.com"
      ? url.pathname === "/local/writereview" && Boolean(url.searchParams.get("placeid"))
      : host === "www.google.com"
        ? /^\/maps\/place\/[^/]+/i.test(url.pathname)
        : host === "maps.app.goo.gl"
          ? /^\/[a-z0-9_-]+\/?$/i.test(url.pathname)
          : false;
  if (url.protocol !== "https:" || !allowedDestination || url.username || url.password) {
    throw new GoogleProviderError("Google returned an untrusted review destination.");
  }
  return url.toString();
}

export interface GoogleBusinessProfileClient {
  isConfigured(): boolean;
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet>;
  listProfiles(accessToken: string): Promise<GoogleProfile[]>;
  listReviews(accessToken: string, accountName: string, locationName: string): Promise<GoogleReviewInput[]>;
  revokeToken?(token: string): Promise<void>;
}

interface GoogleApiErrorBody {
  error?: string | { message?: string; status?: string };
  error_description?: string;
}

export class GoogleProviderError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable?: boolean; statusCode?: number } = {}) {
    super(message);
    this.name = "GoogleProviderError";
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function providerMessage(value: unknown) {
  const body = value as GoogleApiErrorBody;
  if (typeof body.error === "string") return body.error_description ?? body.error;
  return body.error?.message ?? body.error?.status ?? "Google Business Profile request failed.";
}

async function googleFetch(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GoogleProviderError("Google Business Profile could not be reached.", { retryable: true });
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new GoogleProviderError(providerMessage(body), {
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status,
    });
  }
  return body;
}

function bearer(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}`, accept: "application/json" };
}

function tokenExpiry(expiresIn: unknown) {
  const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  return new Date(Date.now() + (Number.isFinite(seconds) ? Math.max(60, seconds) : 3_600) * 1_000);
}

function tokenSet(body: unknown): GoogleTokenSet {
  const value = body as Record<string, unknown>;
  if (typeof value.access_token !== "string") {
    throw new GoogleProviderError("Google did not return an access token.");
  }
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
    expiresAt: tokenExpiry(value.expires_in),
    scopes: typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : [GOOGLE_SCOPE],
  };
}

export class GoogleHttpClient implements GoogleBusinessProfileClient {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;

  constructor(config: Pick<AppConfig, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI">) {
    this.clientId = config.GOOGLE_CLIENT_ID;
    this.clientSecret = config.GOOGLE_CLIENT_SECRET;
    this.redirectUri = config.GOOGLE_REDIRECT_URI;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri);
  }

  private requireConfiguration() {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new GoogleProviderError("Google Business Profile OAuth is not configured.");
    }
    return { clientId: this.clientId, clientSecret: this.clientSecret, redirectUri: this.redirectUri };
  }

  authorizationUrl(input: { state: string; codeChallenge: string }) {
    const config = this.requireConfiguration();
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPE,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string) {
    const config = this.requireConfiguration();
    const body = await googleFetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
      }),
    });
    return tokenSet(body);
  }

  async refreshAccessToken(refreshToken: string) {
    const config = this.requireConfiguration();
    const body = await googleFetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    return tokenSet(body);
  }

  async revokeToken(token: string) {
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GoogleProviderError("Google token revocation could not be reached.", { retryable: true });
    }
    if (response.ok || response.status === 400) return;
    throw new GoogleProviderError("Google token revocation failed.", {
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status,
    });
  }

  async listProfiles(accessToken: string): Promise<GoogleProfile[]> {
    const accountsBody = await googleFetch(ACCOUNTS_ENDPOINT, { headers: bearer(accessToken) }) as {
      accounts?: Array<{ name?: string; accountName?: string }>;
    };
    const profiles: GoogleProfile[] = [];
    for (const account of accountsBody.accounts ?? []) {
      if (!account.name) continue;
      let pageToken: string | undefined;
      let pageCount = 0;
      const seenPageTokens = new Set<string>();
      do {
        const url = new URL(`${BUSINESS_INFORMATION_ENDPOINT}/${account.name}/locations`);
        url.searchParams.set("readMask", "name,title,metadata");
        url.searchParams.set("pageSize", "100");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const locationsBody = await googleFetch(url.toString(), { headers: bearer(accessToken) }) as {
          locations?: Array<{ name?: string; title?: string; metadata?: { newReviewUri?: string } }>;
          nextPageToken?: string;
        };
        for (const location of locationsBody.locations ?? []) {
          if (!location.name) continue;
          const locationResourceName = location.name.match(/(?:^|\/)locations\/[A-Za-z0-9_-]+$/)?.[0]?.replace(/^\//, "");
          if (!locationResourceName) continue;
          profiles.push({
            accountName: account.name,
            accountDisplayName: account.accountName ?? account.name,
            locationName: locationResourceName,
            locationTitle: location.title ?? location.name,
            newReviewUri: location.metadata?.newReviewUri,
          });
        }
        pageCount += 1;
        if (locationsBody.nextPageToken) {
          if (pageCount >= 5 || seenPageTokens.has(locationsBody.nextPageToken)) {
            throw new GoogleProviderError("Google returned more profile locations than can be selected safely in one authorization.");
          }
          seenPageTokens.add(locationsBody.nextPageToken);
        }
        pageToken = locationsBody.nextPageToken;
      } while (pageToken);
    }
    return profiles;
  }

  async listReviews(accessToken: string, accountName: string, locationName: string): Promise<GoogleReviewInput[]> {
    const reviews: GoogleReviewInput[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const seenPageTokens = new Set<string>();
    do {
      const url = new URL(`${REVIEWS_ENDPOINT}/${accountName}/${locationName}/reviews`);
      url.searchParams.set("pageSize", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = await googleFetch(url.toString(), { headers: bearer(accessToken) }) as {
        reviews?: Array<{
          reviewId?: string;
          reviewer?: { displayName?: string };
          starRating?: string;
          comment?: string;
          createTime?: string;
          updateTime?: string;
          reviewReply?: { comment?: string };
        }>;
        nextPageToken?: string;
      };
      const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
      for (const review of body.reviews ?? []) {
        if (!review.reviewId || !review.createTime) {
          throw new GoogleProviderError("Google returned a review without its canonical identity or creation time.");
        }
        const rating = ratingMap[review.starRating ?? ""];
        if (!rating) throw new GoogleProviderError("Google returned a review with an unsupported rating value.");
        const createdAt = new Date(review.createTime);
        const updatedAt = new Date(review.updateTime ?? review.createTime);
        if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
          throw new GoogleProviderError("Google returned a review with an invalid timestamp.");
        }
        reviews.push({
          providerReviewId: review.reviewId,
          reviewerName: review.reviewer?.displayName ?? "Google user",
          rating,
          body: review.comment ?? "",
          createdAt,
          updatedAt,
          replyBody: review.reviewReply?.comment,
        });
      }
      pageCount += 1;
      if (body.nextPageToken) {
        if (pageCount >= 200 || seenPageTokens.has(body.nextPageToken)) {
          throw new GoogleProviderError("Google review pagination exceeded the safe canonical reconciliation bound.");
        }
        seenPageTokens.add(body.nextPageToken);
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return reviews;
  }
}

export interface GoogleSyncResult {
  integrationId: string;
  businessId: string;
  imported: number;
  error?: string;
}

async function accessTokenForConnection(
  repository: PlatformRepository,
  client: GoogleBusinessProfileClient,
  connection: GoogleConnectionRecord,
  encryptionKey: string,
) {
  const accessContext = `${connection.businessId}:google-oauth-access`;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptField(connection.accessToken, encryptionKey, accessContext);
  }
  if (!connection.refreshToken) {
    throw new GoogleProviderError("Google authorization expired and no refresh token is available.");
  }
  const refreshContext = `${connection.businessId}:google-oauth-refresh`;
  const refreshToken = decryptField(connection.refreshToken, encryptionKey, refreshContext);
  const refreshed = await client.refreshAccessToken(refreshToken);
  const refreshRepository = repository as GoogleTokenRefreshRepository;
  if (!refreshRepository.saveRefreshedGoogleToken) {
    throw new GoogleProviderError("Durable Google token refresh persistence is unavailable.", { retryable: true });
  }
  await refreshRepository.saveRefreshedGoogleToken({
    integrationId: connection.integrationId,
    workerId: connection.syncWorkerId,
    leaseToken: connection.syncLeaseToken,
    accessToken: encryptField(refreshed.accessToken, encryptionKey, accessContext),
    refreshToken: refreshed.refreshToken
      ? encryptField(refreshed.refreshToken, encryptionKey, refreshContext)
      : undefined,
    expiresAt: refreshed.expiresAt,
    grantedScopes: refreshed.scopes,
  });
  return refreshed.accessToken;
}

export async function synchronizeDueGoogleConnections(
  repository: PlatformRepository,
  client: GoogleBusinessProfileClient,
  encryptionKey: string,
  limit = 20,
): Promise<GoogleSyncResult[]> {
  if (!client.isConfigured()) throw new GoogleProviderError("Google Business Profile OAuth is not configured.");
  if (!repository.finishGoogleReviewSync) {
    throw new GoogleProviderError("Durable Google review-sync completion is unavailable.", { retryable: true });
  }
  const connections = await repository.listDueGoogleConnections(limit);
  const results: GoogleSyncResult[] = [];
  for (const connection of connections) {
    let imported = 0;
    let reviews: GoogleReviewInput[] | undefined;
    let syncError: string | undefined;
    try {
      const accessToken = await accessTokenForConnection(repository, client, connection, encryptionKey);
      reviews = await client.listReviews(accessToken, connection.accountName, connection.locationName);
      imported = await repository.upsertGoogleReviews(connection, reviews);
    } catch (error) {
      syncError = error instanceof Error ? error.message : "Google review sync failed.";
    }
    try {
      await repository.finishGoogleReviewSync(
        connection,
        syncError === undefined,
        syncError,
        reviews?.map((review) => review.providerReviewId),
      );
    } catch (error) {
      syncError = error instanceof Error
        ? `Google review sync completion could not be persisted: ${error.message}`
        : "Google review sync completion could not be persisted.";
    }
    results.push({
      integrationId: connection.integrationId,
      businessId: connection.businessId,
      imported,
      error: syncError,
    });
  }
  return results;
}

export const googleBusinessManageScope = GOOGLE_SCOPE;
