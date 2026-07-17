import type {
  AuditEvent,
  BusinessAccount,
  Channel,
  ConsentStatus,
  PlatformException,
  QrCodeRecord,
  RequestRecord,
  ReviewRecord,
  SessionContext,
  SmsOveragePolicy,
} from "./domain";

export const IS_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
let activeSupportSessionId: string | undefined;

export interface AuthenticatedSession extends SessionContext {
  email?: string;
  agencyId?: string;
  supportSessionId?: string;
}

export interface WorkspacePayload {
  session: AuthenticatedSession;
  businesses: BusinessAccount[];
  requestsByBusiness: Record<string, RequestRecord[]>;
  reviewsByBusiness: Record<string, ReviewRecord[]>;
  qrCodesByBusiness: Record<string, QrCodeRecord>;
  exceptions: PlatformException[];
  auditEvents: AuditEvent[];
}

export interface CompletedJobDraft {
  locationId?: string;
  externalJobId: string;
  externalCustomerId?: string;
  serviceLabel: string;
  occurredAt: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  preferredChannel: Channel;
  consent: {
    status: "granted" | "withdrawn" | "unknown";
    wording: string;
    wordingVersion: string;
    purpose: string;
    capturedAt: string;
    source: string;
    transactionReference: string;
    evidenceReference?: string;
  };
}

export interface CompletedJobResult {
  requestId: string;
  status: "Queued" | "Blocked";
  duplicate: boolean;
}

export interface PublicReviewFlowPayload {
  provider: "google";
  businessName?: string;
  locationName?: string;
  destinationUrl: string;
}

export interface GoogleProfileSelectionPayload {
  businessId: string;
  locationId: string;
  profiles: Array<{
    profileIndex: number;
    accountDisplayName: string;
    locationTitle: string;
    reviewDestinationAvailable: boolean;
  }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapData(payload: unknown): unknown {
  return isRecord(payload) && "data" in payload ? payload.data : payload;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (activeSupportSessionId) headers.set("X-Support-Session-Id", activeSupportSessionId);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
    const message = isRecord(errorPayload) && typeof errorPayload.message === "string"
      ? errorPayload.message
      : isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status}).`;
    const code = isRecord(errorPayload) && typeof errorPayload.code === "string" ? errorPayload.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  return payload as T;
}

function unwrapSession(payload: unknown): AuthenticatedSession {
  const unwrapped = unwrapData(payload);
  const candidate = isRecord(unwrapped) && isRecord(unwrapped.session) ? unwrapped.session : unwrapped;
  if (
    !isRecord(candidate)
    || typeof candidate.userId !== "string"
    || typeof candidate.userName !== "string"
    || (candidate.role !== "business_owner" && candidate.role !== "agency_admin")
  ) {
    throw new ApiError("The server returned an invalid session.", 502, "INVALID_SESSION");
  }
  return candidate as unknown as AuthenticatedSession;
}

function normalizeWorkspace(payload: unknown): WorkspacePayload {
  const unwrapped = unwrapData(payload);
  const candidate = isRecord(unwrapped) && isRecord(unwrapped.workspace) ? unwrapped.workspace : unwrapped;
  if (!isRecord(candidate) || !Array.isArray(candidate.businesses)) {
    throw new ApiError("The server returned an invalid workspace.", 502, "INVALID_WORKSPACE");
  }

  return {
    session: unwrapSession(candidate.session),
    businesses: candidate.businesses as BusinessAccount[],
    requestsByBusiness: isRecord(candidate.requestsByBusiness)
      ? candidate.requestsByBusiness as Record<string, RequestRecord[]>
      : {},
    reviewsByBusiness: isRecord(candidate.reviewsByBusiness)
      ? candidate.reviewsByBusiness as Record<string, ReviewRecord[]>
      : {},
    qrCodesByBusiness: isRecord(candidate.qrCodesByBusiness)
      ? candidate.qrCodesByBusiness as Record<string, QrCodeRecord>
      : {},
    exceptions: Array.isArray(candidate.exceptions) ? candidate.exceptions as PlatformException[] : [],
    auditEvents: Array.isArray(candidate.auditEvents) ? candidate.auditEvents as AuditEvent[] : [],
  };
}

export const platformApi = {
  async login(email: string, password: string) {
    await request<unknown>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async logout() {
    await request<unknown>("/api/v1/auth/logout", { method: "POST" });
    activeSupportSessionId = undefined;
  },

  async getSession() {
    return unwrapSession(await request<unknown>("/api/v1/session"));
  },

  async getWorkspace(businessId?: string) {
    const query = businessId ? `?businessId=${encodeURIComponent(businessId)}` : "";
    return normalizeWorkspace(await request<unknown>(`/api/v1/workspace${query}`));
  },

  async createCompletedJob(businessId: string, draft: CompletedJobDraft) {
    const payload = await request<unknown>(`/api/v1/businesses/${encodeURIComponent(businessId)}/completed-jobs`, {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        preferredChannel: draft.preferredChannel,
        phone: draft.phone || undefined,
        email: draft.email || undefined,
      }),
    });
    const result = unwrapData(payload);
    if (!isRecord(result) || typeof result.requestId !== "string" || (result.status !== "Queued" && result.status !== "Blocked")) {
      throw new ApiError("The server returned an invalid completed-job result.", 502, "INVALID_JOB_RESPONSE");
    }
    return result as unknown as CompletedJobResult;
  },

  async updateSmsOveragePolicy(businessId: string, policy: SmsOveragePolicy) {
    const payload = unwrapData(await request<unknown>(
      `/api/v1/businesses/${encodeURIComponent(businessId)}/billing/sms-policy`,
      { method: "PATCH", body: JSON.stringify({ policy }) },
    ));
    if (!isRecord(payload) || (payload.policy !== "pause_sms" && payload.policy !== "auto_top_up")) {
      throw new ApiError("The server returned an invalid SMS billing policy.", 502, "INVALID_SMS_POLICY_RESPONSE");
    }
    return payload.policy as SmsOveragePolicy;
  },

  async startStripeCheckout(businessId: string, attemptId: string) {
    const payload = unwrapData(await request<unknown>(
      `/api/v1/businesses/${encodeURIComponent(businessId)}/billing/checkout`,
      { method: "POST", body: JSON.stringify({ attemptId }) },
    ));
    if (!isRecord(payload) || typeof payload.url !== "string") {
      throw new ApiError("The server returned an invalid Stripe Checkout URL.", 502, "INVALID_CHECKOUT_RESPONSE");
    }
    return payload.url;
  },

  async openStripeBillingPortal(businessId: string) {
    const payload = unwrapData(await request<unknown>(
      `/api/v1/businesses/${encodeURIComponent(businessId)}/billing/portal`,
      { method: "POST", body: JSON.stringify({}) },
    ));
    if (!isRecord(payload) || typeof payload.url !== "string") {
      throw new ApiError("The server returned an invalid Stripe billing portal URL.", 502, "INVALID_PORTAL_RESPONSE");
    }
    return payload.url;
  },

  async startGoogleOAuth(businessId: string, locationId: string) {
    const payload = await request<unknown>(
      `/api/v1/businesses/${encodeURIComponent(businessId)}/locations/${encodeURIComponent(locationId)}/integrations/google/oauth/start`,
      { method: "POST" },
    );
    const candidate = unwrapData(payload);
    if (!isRecord(candidate) || typeof candidate.authorizationUrl !== "string") {
      throw new ApiError("Google authorization could not be started.", 502, "INVALID_OAUTH_RESPONSE");
    }
    return candidate.authorizationUrl;
  },

  async getGoogleProfileSelection(selectionToken: string) {
    const payload = unwrapData(await request<unknown>(
      `/api/v1/integrations/google/oauth/selections/${encodeURIComponent(selectionToken)}`,
    ));
    if (!isRecord(payload) || typeof payload.businessId !== "string" || !Array.isArray(payload.profiles)) {
      throw new ApiError("The server returned an invalid Google profile selection.", 502, "INVALID_GOOGLE_SELECTION");
    }
    return payload as unknown as GoogleProfileSelectionPayload;
  },

  async completeGoogleProfileSelection(selectionToken: string, profileIndex: number) {
    await request<unknown>(
      `/api/v1/integrations/google/oauth/selections/${encodeURIComponent(selectionToken)}`,
      { method: "POST", body: JSON.stringify({ profileIndex }) },
    );
  },

  async getPublicReviewFlow(publicToken: string) {
    const payload = unwrapData(await request<unknown>(
      `/api/v1/public/review-flows/${encodeURIComponent(publicToken)}`,
    ));
    if (!isRecord(payload) || payload.provider !== "google" || typeof payload.destinationUrl !== "string") {
      throw new ApiError("This review link is unavailable.", 502, "INVALID_REVIEW_FLOW");
    }
    return payload as unknown as PublicReviewFlowPayload;
  },

  async recordPublicReviewScan(publicToken: string, placementKey?: string) {
    const payload = unwrapData(await request<unknown>(
      `/api/v1/public/review-flows/${encodeURIComponent(publicToken)}/scans`,
      {
        method: "POST",
        body: JSON.stringify(placementKey ? { placementKey } : {}),
      },
    ));
    if (!isRecord(payload) || typeof payload.scanId !== "string" || typeof payload.destinationUrl !== "string") {
      throw new ApiError("The review visit could not be recorded.", 502, "INVALID_REVIEW_SCAN");
    }
    return payload as unknown as { scanId: string; destinationUrl: string };
  },

  async markPublicReviewContinue(scanId: string) {
    await request<unknown>(`/api/v1/public/review-scans/${encodeURIComponent(scanId)}/continue`, {
      method: "POST",
    });
  },

  async startSupportSession(input: { businessId: string; scope: "view" | "configuration"; reason: string; durationMinutes: 15 | 30 }) {
    const payload = unwrapData(await request<unknown>("/api/v1/support-sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }));
    if (!isRecord(payload) || typeof payload.id !== "string" || typeof payload.expiresAt !== "string") {
      throw new ApiError("The server returned an invalid support session.", 502, "INVALID_SUPPORT_SESSION");
    }
    activeSupportSessionId = payload.id;
    return payload as unknown as { id: string; businessId: string; scope: "view" | "configuration"; expiresAt: string };
  },

  async endSupportSession(supportSessionId: string, reason: string) {
    try {
      await request<unknown>(`/api/v1/support-sessions/${encodeURIComponent(supportSessionId)}`, {
        method: "DELETE",
        body: JSON.stringify({ reason }),
      });
    } finally {
      if (activeSupportSessionId === supportSessionId) activeSupportSessionId = undefined;
    }
  },
};

export function consentStatusForDraft(status: CompletedJobDraft["consent"]["status"]): ConsentStatus {
  if (status === "granted") return "Verified";
  if (status === "withdrawn") return "Withdrawn";
  return "Missing";
}
