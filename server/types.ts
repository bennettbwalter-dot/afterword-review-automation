export type PlatformRole = "business_owner" | "agency_admin" | "agency_user";
export type ProductRole = "owner" | "staff" | "client_approver";
export type AgencyRole = "owner" | "admin" | "operator" | "support";
export type BusinessRole = "owner" | "admin" | "operator" | "approver" | "viewer" | "billing";
export type SupportScope = "view" | "configuration";
export type SmsOveragePolicy = "auto_top_up" | "pause_sms";

export interface BillingSummary {
  billingCycle: "Monthly" | "Annual";
  subscriptionStatus: "Inactive" | "Pilot" | "Active" | "Past due" | "Cancelled";
  subscriptionPrice: string;
  setupFee: string;
  renewalDate: string;
  smsAllowance: number;
  smsUsed: number;
  smsPending: number;
  smsOveragePolicy: SmsOveragePolicy;
  stripeCustomerReady: boolean;
  stripeSubscriptionReady: boolean;
  setupFeePaid: boolean;
  smsUsageByLocation: Array<{ locationName: string; used: number; pending: number }>;
  reachedThresholds: number[];
}

export interface LocationReportSummary {
  id: string;
  name: string;
  completedJobs: number;
  delivered: number;
  uniqueClicks: number;
  reviewsDetected: number;
  rating: number;
  totalReviews: number;
  smsSegments: number;
}

export interface LocationWorkflowSummary {
  businessId: string;
  locationId: string;
  channels: Array<{
    channel: "sms" | "email";
    enabled: boolean;
    timezone: string;
    allowedWeekdays: number[];
    sendWindowStart: string;
    sendWindowEnd: string;
    maxMessages: number;
    minimumGapSeconds: number;
    ruleVersion: string;
    template: {
      id: string;
      key: string;
      version: number;
      body: string;
      subject?: string;
      includesBusinessIdentity: boolean;
      includesUnsubscribe: boolean;
      approvedAt: string;
    } | null;
  }>;
  reviewDestination: {
    runtimeUrl?: string;
    qrUrl?: string;
    verifiedAt?: string;
    connectionHealth?: string;
    matchesRuntime: boolean;
  } | null;
}

export interface ActorContext {
  userId: string;
  userName: string;
  email: string;
  role: PlatformRole;
  productRole?: ProductRole;
  agencyRole?: AgencyRole;
  businessRole?: BusinessRole;
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
  plan: "Reputation Pro" | "Reputation Multi";
  billing?: BillingSummary;
  locationReports: LocationReportSummary[];
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
  workflowsByLocation: Record<string, LocationWorkflowSummary>;
  access?: {
    businessId: string;
    locationId?: string;
    canReadTenant: boolean;
    canManageBusiness: boolean;
    canReadBilling: boolean;
    canManageBilling: boolean;
    canManageStripeBilling: boolean;
  };
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

export interface StripeCheckoutPreparation {
  allowed: boolean;
  reason: string;
  attemptId: string;
  businessId: string;
  planKey?: "pro_monthly" | "pro_annual" | "multi_monthly";
  billingCycle?: "monthly" | "annual";
  subscriptionPricePence?: number;
  setupFeePence?: number;
  customerId?: string;
}

export interface StripeBillingWebhookInput {
  eventId: string;
  eventType: string;
  eventCreatedAt: Date;
  apiVersion?: string;
  livemode: boolean;
  businessId: string;
  attemptId?: string;
  checkoutSessionId?: string;
  customerId?: string;
  subscriptionId?: string;
  checkoutState?: "completed" | "expired" | "failed";
  setupPaid?: boolean;
  subscriptionState?: "inactive" | "active" | "past_due" | "cancelled";
  periodStart?: Date;
  periodEnd?: Date;
  rawBody: Buffer;
}

export interface PlatformRepository {
  requestAgencyClientGrant?(actor: ActorContext, input: import("./agency/types.js").AgencyGrantRequest): Promise<import("./agency/types.js").AgencyGrant>;
  acceptAgencyClientGrant?(actor: ActorContext, grantId: string, correlationId: string): Promise<import("./agency/types.js").AgencyGrant>;
  rejectAgencyClientGrant?(actor: ActorContext, grantId: string, correlationId: string): Promise<import("./agency/types.js").AgencyGrant>;
  revokeAgencyClientGrant?(actor: ActorContext, grantId: string, correlationId: string): Promise<import("./agency/types.js").AgencyGrant>;
  revokeCurrentAgencyClientGrant?(actor: ActorContext, grantId: string, agencyId: string, correlationId: string): Promise<import("./agency/types.js").AgencyGrant>;
  revokeCurrentClientAgencyGrant?(actor: ActorContext, grantId: string, businessId: string, correlationId: string): Promise<import("./agency/types.js").AgencyGrant>;
  listActiveAgencyClientGrants?(actor: ActorContext, agencyId: string): Promise<import("./agency/types.js").AgencyGrant[]>;
  issueAgencyClientGrantClaim?(actor: ActorContext, grantId: string, email: string, tokenHash: Buffer, expiresAt: Date, correlationId: string): Promise<void>;
  consumeAgencyClientGrantClaim?(actor: ActorContext, tokenHash: Buffer): Promise<import("./agency/types.js").AgencyGrantClaimScope | null>;
  listAgencyClientGrantClaimLocations?(actor: ActorContext, tokenHash: Buffer): Promise<import("./agency/types.js").AgencyGrantClaimScope[]>;
  issueAgencyClientAccessClaim?(actor: ActorContext, agencyId: string, email: string, permissions: import("./agency/types.js").AgencyGrantPermission[], tokenHash: Buffer, expiresAt: Date, correlationId: string): Promise<void>;
  consumeAgencyClientAccessClaim?(actor: ActorContext, tokenHash: Buffer): Promise<boolean>;
  listAgencyClientAccessLocations?(actor: ActorContext, tokenHash: Buffer): Promise<import("./agency/types.js").AgencyClientClaimLocation[]>;
  selectAgencyClientAccessLocation?(actor: ActorContext, tokenHash: Buffer, locationId: string, correlationId: string): Promise<import("./agency/types.js").AgencyGrant>;
  createSignupIntent?(input: import("./onboarding/types.js").SignupIntentInput): Promise<{ accepted: boolean; shouldSendEmail: boolean }>;
  consumeSignupIntent?(tokenHash: Buffer): Promise<import("./onboarding/types.js").VerifiedSignup | null>;
  registerVerifiedSignup?(input: import("./onboarding/types.js").RegistrationInput): Promise<import("./onboarding/types.js").RegistrationResult>;
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
  getWorkspace(actor: ActorContext, selectedBusinessId?: string, selectedLocationId?: string): Promise<WorkspacePayload>;
  updateSmsOveragePolicy(actor: ActorContext, businessId: string, policy: SmsOveragePolicy, correlationId: string): Promise<{ updated: boolean; policy?: SmsOveragePolicy; reason: string }>;
  prepareStripeCheckout?(actor: ActorContext, businessId: string, attemptId: string, correlationId: string): Promise<StripeCheckoutPreparation>;
  bindStripeCheckoutSession?(actor: ActorContext, businessId: string, attemptId: string, sessionId: string, customerId: string | undefined, livemode: boolean, correlationId: string): Promise<void>;
  getStripeBillingCustomer?(actor: ActorContext, businessId: string, correlationId: string): Promise<{ allowed: boolean; reason: string; customerId?: string }>;
  recordStripeBillingWebhook?(input: StripeBillingWebhookInput): Promise<{ duplicate: boolean }>;
  purgeExpiredStripeWebhookPayloads?(limit: number): Promise<number>;
  startSupportSession(actor: ActorContext, input: StartSupportSessionInput): Promise<string>;
  getActiveSupportSession(actor: ActorContext): Promise<ActiveSupportSession | null>;
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
  reserveSmsSegments(input: ReserveSmsSegmentsInput): Promise<SmsSegmentReservation>;
  holdMessageForSmsAllowance(input: HoldSmsMessageInput): Promise<Date>;
  finishMessageAttempt(input: FinishMessageAttemptInput): Promise<void>;
  deferMessageJob(jobId: string, workerId: string, leaseToken: string, runAt: Date, reason: string): Promise<void>;
  rollPilotBillingPeriods(limit: number): Promise<number>;
  resolvePublicReviewFlow(publicToken: string): Promise<PublicReviewFlow | null>;
  recordPublicQrScan(input: PublicQrScanInput): Promise<{ scanId: string; destinationUrl: string }>;
  markPublicQrContinue(scanId: string): Promise<void>;
}

export interface ActiveSupportSession {
  id: string;
  businessId: string;
  scope: SupportScope;
  startedAt: string;
  expiresAt: string;
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

export interface ReserveSmsSegmentsInput {
  messageAttemptId: string;
  workerId: string;
  leaseToken: string;
  segments: number;
}

export interface SmsSegmentReservation {
  allowed: boolean;
  reason: string;
  retryAt?: Date;
}

export interface HoldSmsMessageInput {
  messageAttemptId: string;
  workerId: string;
  leaseToken: string;
  reason: "sms_billing_missing" | "sms_billing_inactive" | "sms_allowance_exhausted" | "sms_top_up_required";
  retryAt?: Date;
  correlationId: string;
}
