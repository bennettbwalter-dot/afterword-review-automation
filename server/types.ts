export type PlatformRole = "business_owner" | "agency_admin";
export type SupportScope = "view" | "configuration";

export interface ActorContext {
  userId: string;
  userName: string;
  email: string;
  role: PlatformRole;
  businessId?: string;
  agencyId?: string;
  mfaVerified: boolean;
  stepUpVerifiedAt?: string;
  sessionId: string;
  sessionTokenHash: Buffer;
  supportSessionId?: string;
}

export interface AuthCredential {
  userId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  mfaRequired: boolean;
  disabled: boolean;
}

export interface BusinessSummary {
  id: string;
  agencyId: string;
  locationId?: string;
  name: string;
  locationName: string;
  initials: string;
  country: "GB" | "US";
  timezone: string;
  health: string;
  healthTone: "success" | "warning" | "danger" | "muted" | "accent";
  automationState: "Live" | "Auto-paused" | "Paused" | "Protected";
  integrationSummary: string;
  lastSuccess: string;
  affectedCount: number;
  plan: "Starter" | "Professional" | "Multi-location";
  seedRequestCount: number;
  metrics: {
    completedJobs: number;
    eligibleCustomers: number;
    delivered: number;
    uniqueClicks: number;
    reviewsDetected: number;
    rating: number;
    totalReviews: number;
  };
  teamMembers: Array<{ initials: string; name: string; role: string }>;
  integrations: Record<"google" | "messaging" | "jobIntake", { status: string; tone: "success" | "warning" | "danger" | "muted" | "accent"; lastEvent: string }>;
}

export interface WorkspacePayload {
  session: Omit<ActorContext, "sessionId" | "sessionTokenHash">;
  businesses: BusinessSummary[];
  requestsByBusiness: Record<string, unknown[]>;
  reviewsByBusiness: Record<string, unknown[]>;
  qrCodesByBusiness: Record<string, unknown>;
  exceptions: unknown[];
  auditEvents: unknown[];
}

export interface CompletedJobInput {
  // The route always overwrites this with its authorised path tenant.
  businessId: string;
  locationId: string;
  externalJobId: string;
  externalCustomerId?: string;
  serviceLabel: string;
  occurredAt: string;
  firstName: string;
  phone?: string;
  email?: string;
  preferredChannel: "SMS" | "Email";
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

export interface PlatformRepository {
  findCredentialByEmail(email: string): Promise<AuthCredential | null>;
  recordLoginResult?(email: string, succeeded: boolean): Promise<void>;
  createLoginSession(input: {
    userId: string;
    tokenHash: Buffer;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    ipHash?: Buffer;
    userAgentFamily?: string;
  }): Promise<string>;
  resolveLoginSession(tokenHash: Buffer): Promise<ActorContext | null>;
  revokeLoginSession(sessionId: string, tokenHash: Buffer): Promise<void>;
  getWorkspace(actor: ActorContext, selectedBusinessId?: string): Promise<WorkspacePayload>;
  startSupportSession(actor: ActorContext, input: StartSupportSessionInput): Promise<string>;
  endSupportSession(actor: ActorContext, supportSessionId: string, reason: string): Promise<boolean>;
  createCompletedJob(actor: ActorContext, input: CompletedJobInput): Promise<{ requestId: string; status: "Queued" | "Blocked"; duplicate: boolean }>;
  beginGoogleOAuth(actor: ActorContext, businessId: string, locationId: string, stateHash: Buffer, codeVerifier: EncryptedPayload, expiresAt: Date): Promise<void>;
  consumeGoogleOAuthState(stateHash: Buffer): Promise<{ actorUserId: string; businessId: string; locationId: string; codeVerifier: EncryptedPayload } | null>;
  saveGoogleConnection(input: GoogleConnectionInput): Promise<void>;
  listDueGoogleConnections(limit: number): Promise<GoogleConnectionRecord[]>;
  upsertGoogleReviews(connection: GoogleConnectionRecord, reviews: GoogleReviewInput[]): Promise<number>;
  finishGoogleReviewSync?(
    connection: GoogleConnectionRecord,
    succeeded: boolean,
    error: string | undefined,
    seenReviewIds: string[] | undefined,
  ): Promise<void>;
  claimGoogleTokenRevocations?(workerId: string, limit: number, leaseSeconds: number): Promise<GoogleTokenRevocationJob[]>;
  finishGoogleTokenRevocation?(
    revocationId: string,
    workerId: string,
    leaseToken: string,
    succeeded: boolean,
    error?: string,
  ): Promise<void>;
  claimMessageJobs(workerId: string, limit: number, leaseSeconds: number): Promise<MessageJob[]>;
  authorizeMessageDispatch(jobId: string, workerId: string, leaseToken: string): Promise<DispatchAuthorization>;
  getMessagePayload(jobId: string, workerId: string, leaseToken: string): Promise<MessagePayload>;
  finishMessageAttempt(input: FinishMessageAttemptInput): Promise<void>;
  deferMessageJob(jobId: string, workerId: string, leaseToken: string, runAt: Date, reason: string): Promise<void>;
  resolvePublicReviewFlow(publicToken: string): Promise<PublicReviewFlow | null>;
  recordPublicQrScan(input: PublicQrScanInput): Promise<{ scanId: string; destinationUrl: string }>;
  markPublicQrContinue(scanId: string): Promise<void>;
}

export interface StartSupportSessionInput {
  businessId: string;
  scope: SupportScope;
  reason: string;
  durationMinutes: 15 | 30;
}

export interface PublicReviewFlow {
  qrCodeId: string;
  businessId: string;
  locationId: string;
  businessName?: string;
  locationName?: string;
  destinationUrl: string;
}

export interface PublicQrScanInput {
  publicToken: string;
  anonymousVisitorHash: Buffer;
  placementKey?: string;
  referrerHost?: string;
  deviceFamily?: string;
  countryCode?: string;
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export interface GoogleConnectionInput {
  actorUserId: string;
  businessId: string;
  locationId: string;
  accountName: string;
  locationName: string;
  reviewUri: string;
  accessToken: EncryptedPayload;
  refreshToken?: EncryptedPayload;
  expiresAt: Date;
  grantedScopes: string[];
}

export interface GoogleConnectionRecord extends Omit<GoogleConnectionInput, "actorUserId"> {
  integrationId: string;
  syncWorkerId: string;
  syncLeaseToken: string;
}

export interface GoogleTokenRevocationJob {
  revocationId: string;
  integrationId: string;
  businessId: string;
  tokenKind: "access" | "refresh";
  token: EncryptedPayload;
  keyVersion: number;
  leaseToken: string;
}

export interface GoogleReviewInput {
  providerReviewId: string;
  reviewerName: string;
  rating: number;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  replyBody?: string;
}

export interface MessageJob {
  id: string;
  businessId: string;
  locationId: string;
  channel: "sms" | "email";
  provider: string;
  leaseToken: string;
}

export interface DispatchAuthorization {
  allowed: boolean;
  reason: string;
  nextAllowedAt?: Date;
}

export interface MessagePayload {
  messageAttemptId: string;
  businessId: string;
  channel: "sms" | "email";
  reviewUri: string;
  destination: EncryptedPayload;
  subject?: string;
  body: string;
  idempotencyKey: string;
}

export interface FinishMessageAttemptInput {
  messageAttemptId: string;
  jobId: string;
  workerId: string;
  leaseToken: string;
  result: "accepted" | "failed" | "unknown";
  providerMessageId?: string;
  responseCode?: string;
  errorCode?: string;
}
