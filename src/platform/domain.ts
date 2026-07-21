export type PlatformRole = "business_owner" | "agency_admin" | "agency_user";
// Retain this alias until presentation callers can adopt the platform name.
export type ActorRole = PlatformRole;
export type ProductRole = "owner" | "staff" | "client_approver";
export type AgencyRole = "owner" | "admin" | "operator" | "support";
export type BusinessRole = "owner" | "admin" | "operator" | "approver" | "viewer" | "billing";
export type SupportScope = "view" | "configuration";
export type AgencyGrantPermission = "content.create" | "content.submit" | "content.approve" | "content.self_approve" | "content.schedule" | "content.publish" | "video.spend";
export type Channel = "SMS" | "Email";
export type RequestStatus = "Queued" | "Delivered" | "Clicked" | "Reviewed" | "Opted out" | "Blocked";
export type ConsentStatus = "Verified" | "Missing" | "Withdrawn";
export type ClientView = "overview" | "requests" | "automation" | "reviews" | "qr-codes" | "reports" | "integrations" | "team-billing";
export type AgencyView = "agency-overview" | "clients" | "exceptions" | "audit";
export type WorkspaceView = ClientView | AgencyView;
export type ProductView = "home" | "google-profile" | "content" | "reports" | "settings-billing" | "agency" | "operations-exceptions" | "operations-audit";
export type GoogleProfileTab = "profile" | "reviews" | "requests-qr" | "posts-media";
export type ContentTab = "create" | "uploads" | "approvals" | "scheduled" | "published" | "failed";
export type HealthTone = "success" | "warning" | "danger" | "muted" | "accent";
export type Permission =
  | "portfolio.read"
  | "tenant.read"
  | "tenant.manage"
  | "automation.manage"
  | "automation.pause"
  | "integration.manage"
  | "billing.manage"
  | "team.manage"
  | "audit.read"
  | "support.start"
  | "support.configure";

export interface SessionContext {
  agencyId?: string;
  userId: string;
  userName: string;
  role: ActorRole;
  productRole?: ProductRole;
  agencyRole?: AgencyRole;
  businessRole?: BusinessRole;
  businessId?: string;
  mfaVerified: boolean;
  stepUpVerifiedAt?: string;
}

export interface SupportSession {
  id: string;
  actorUserId: string;
  actorName: string;
  businessId: string;
  reason: string;
  scope: SupportScope;
  startedAt: string;
  expiresAt: string;
}

export interface TenantMetrics {
  completedJobs: number;
  eligibleCustomers: number;
  delivered: number;
  uniqueClicks: number;
  reviewsDetected: number;
  rating: number;
  totalReviews: number;
}

export interface TenantMemberSummary {
  initials: string;
  name: string;
  role: string;
}

export interface IntegrationState {
  status: string;
  tone: HealthTone;
  lastEvent: string;
}

export type PlanName = "Reputation Pro" | "Reputation Multi";
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

export interface BusinessAccount {
  id: string;
  locationId?: string;
  agencyId: string;
  name: string;
  locationName: string;
  initials: string;
  country: "GB" | "US";
  timezone: string;
  health: string;
  healthTone: HealthTone;
  automationState: "Live" | "Auto-paused" | "Paused" | "Protected";
  integrationSummary: string;
  lastSuccess: string;
  affectedCount: number;
  plan: PlanName;
  billing?: BillingSummary;
  locationReports?: LocationReportSummary[];
  seedRequestCount: number;
  metrics: TenantMetrics;
  teamMembers: TenantMemberSummary[];
  integrations: {
    google: IntegrationState;
    messaging: IntegrationState;
    jobIntake: IntegrationState;
  };
}

export interface RequestRecord {
  id: string;
  businessId: string;
  locationId?: string;
  customer: string;
  job: string;
  channel: Channel;
  destination: string;
  status: RequestStatus;
  createdAt: string;
  consentBasis: string;
  consentStatus: ConsentStatus;
  consentReference: string;
  consentCapturedAt: string;
  consentWordingVersion: string;
}

export interface ReviewRecord {
  id: string;
  businessId: string;
  locationId?: string;
  name: string;
  rating: number;
  date: string;
  body: string;
  replied: boolean;
}

export interface QrCodeRecord {
  businessId: string;
  locationId?: string;
  publicToken: string;
  destinationUrl: string;
  destinationVerified: boolean;
  artworkRevision: number;
  generatedAt: string;
  totalScans: number;
  uniqueScans: number;
  reviewConversions: number;
  lastScanAt: string;
  placements: Array<{ label: string; scans: number }>;
}

export interface PlatformException {
  id: string;
  businessId: string;
  category: "Critical" | "Compliance" | "Security" | "Warning" | "Delayed" | "Dead letter";
  title: string;
  startedAt: string;
  affectedLabel: string;
  protectedAction: string;
  paused: boolean;
  clientNotified: boolean;
  resolution: string;
  owner: string;
  tone: HealthTone;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  actorType: "user" | "system";
  businessId?: string;
  action: string;
  resource: string;
  outcome: "Allowed" | "Blocked" | "Completed";
  supportSessionId?: string;
  correlationId: string;
  reason?: string;
}

const ROLE_PERMISSIONS: Record<ActorRole, ReadonlySet<Permission>> = {
  business_owner: new Set([
    "tenant.read",
    "tenant.manage",
    "automation.manage",
    "automation.pause",
    "integration.manage",
    "billing.manage",
    "team.manage",
    "audit.read",
  ]),
  agency_admin: new Set([
    "portfolio.read",
    "automation.pause",
    "audit.read",
    "support.start",
    "support.configure",
  ]),
  agency_user: new Set(),
};

const BUSINESS_ROLE_PERMISSIONS: Record<BusinessRole, ReadonlySet<Permission>> = {
  owner: ROLE_PERMISSIONS.business_owner,
  admin: ROLE_PERMISSIONS.business_owner,
  operator: new Set(["tenant.read"]),
  approver: new Set(),
  viewer: new Set(["tenant.read"]),
  billing: new Set(["billing.manage"]),
};

export function projectProductRole(input: { businessRole?: BusinessRole; agencyRole?: AgencyRole }): ProductRole | undefined {
  if (input.agencyRole) {
    if (input.agencyRole === "owner" || input.agencyRole === "admin") return "owner";
    if (input.agencyRole === "operator") return "staff";
    return undefined;
  }
  if (input.businessRole === "owner" || input.businessRole === "admin") return "owner";
  if (input.businessRole === "operator") return "staff";
  if (input.businessRole === "approver") return "client_approver";
  return undefined;
}

export function hasPermission(session: SessionContext, permission: Permission) {
  if (session.role === "business_owner") {
    if (!session.businessRole) return permission === "tenant.read";
    return BUSINESS_ROLE_PERMISSIONS[session.businessRole].has(permission);
  }
  return ROLE_PERMISSIONS[session.role].has(permission);
}

export function canManageBilling(actor: SessionContext, businessId: string) {
  return actor.role === "business_owner"
    && actor.businessId === businessId
    && hasPermission(actor, "billing.manage");
}

export function isSupportSessionActive(session: SupportSession | null, now = new Date()) {
  if (!session) return false;
  const nowTime = now.getTime();
  const startedAt = new Date(session.startedAt).getTime();
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(startedAt) && Number.isFinite(expiresAt) && startedAt <= nowTime && expiresAt > nowTime;
}

export function canReadTenantData(
  actor: SessionContext,
  businessId: string,
  supportSession: SupportSession | null,
  now = new Date(),
) {
  if (actor.role === "business_owner") {
    return actor.businessId === businessId && hasPermission(actor, "tenant.read");
  }
  return Boolean(
    isSupportSessionActive(supportSession, now)
    && supportSession?.actorUserId === actor.userId
    && supportSession.businessId === businessId,
  );
}

export function canConfigureTenant(
  actor: SessionContext,
  businessId: string,
  supportSession: SupportSession | null,
  now = new Date(),
) {
  if (actor.role === "business_owner") return actor.businessId === businessId && hasPermission(actor, "tenant.manage");
  const stepUpAt = actor.stepUpVerifiedAt ? new Date(actor.stepUpVerifiedAt).getTime() : Number.NaN;
  const nowTime = now.getTime();
  const freshStepUp = Number.isFinite(stepUpAt)
    && stepUpAt > nowTime - 15 * 60 * 1_000
    && stepUpAt <= nowTime + 5 * 60 * 1_000;
  return Boolean(
    canReadTenantData(actor, businessId, supportSession, now)
    && supportSession?.scope === "configuration"
    && freshStepUp,
  );
}

export function startSupportSession(
  actor: SessionContext,
  input: { businessId: string; reason: string; scope: SupportScope; durationMinutes: 15 | 30 | 60 },
  now = new Date(),
): SupportSession {
  const canStartSupport = actor.agencyRole === "owner"
    || actor.agencyRole === "admin"
    || actor.agencyRole === "support";
  if (!canStartSupport) {
    throw new Error("Only an agency administrator or support member can start a support session.");
  }
  if (!actor.mfaVerified) throw new Error("Agency MFA is required.");
  if (input.reason.trim().length < 12) throw new Error("Add a support reason or ticket reference.");
  if (input.scope === "configuration") {
    const verifiedAt = actor.stepUpVerifiedAt ? new Date(actor.stepUpVerifiedAt).getTime() : 0;
    const verificationAge = now.getTime() - verifiedAt;
    if (!Number.isFinite(verifiedAt) || verificationAge < 0 || verificationAge > 10 * 60 * 1000) {
      throw new Error("Configuration access requires recent step-up verification.");
    }
  }
  const startedAt = now.toISOString();
  return {
    id: `SUP-${now.getTime().toString(36).slice(-6).toUpperCase()}`,
    actorUserId: actor.userId,
    actorName: actor.userName,
    businessId: input.businessId,
    reason: input.reason.trim(),
    scope: input.scope,
    startedAt,
    expiresAt: new Date(now.getTime() + input.durationMinutes * 60 * 1000).toISOString(),
  };
}

export function validateNeutralReviewTemplate(template: string) {
  const issues: string[] = [];
  const normalized = template.toLowerCase();

  if (!template.includes("{{business_name}}")) issues.push("Include the business-name merge field.");
  if (!template.includes("{{review_link}}")) issues.push("Include the direct review-link merge field.");
  if (!/(reply\s+stop|unsubscribe|opt[ -]?out)/i.test(template)) issues.push("Include clear opt-out instructions.");
  if (/\b(5|five)[ -]?star\b|\bpositive review\b|\bgreat review\b/i.test(template)) {
    issues.push("Do not request a particular rating or a positive review.");
  }
  if (/\b(discount|coupon|reward|gift|incentive)\b|enter(?:ed)?\s+(?:to|into)\s+(?:win|a draw)/i.test(template)) {
    issues.push("Do not offer an incentive for a review.");
  }
  if (
    /(?:if|when)\s+(?:you(?:['’]re| are)?\s+)?(?:not\s+)?(?:happy|satisfied)/i.test(template)
    || /are you (?:happy|satisfied)|how (?:did we do|was your experience)|rate your experience|contact us first|before leaving (?:a|your) review/i.test(normalized)
  ) {
    issues.push("Remove sentiment screening or private-feedback diversion.");
  }

  return issues;
}

export function makeAuditEvent(input: Omit<AuditEvent, "id" | "correlationId">, now = new Date()): AuditEvent {
  const suffix = now.getTime().toString(36).slice(-7).toUpperCase();
  return {
    ...input,
    id: `AUD-${suffix}`,
    correlationId: `COR-${suffix}`,
  };
}

const proBilling = (locationName: string, smsUsed: number, annual = false): BillingSummary => ({
  billingCycle: annual ? "Annual" : "Monthly",
  subscriptionStatus: "Pilot",
  subscriptionPrice: annual ? "£390/year" : "£39/month",
  setupFee: "£149 one-off",
  renewalDate: "1 Aug 2026",
  smsAllowance: 100,
  smsUsed,
  smsPending: 0,
  smsOveragePolicy: "pause_sms",
  stripeCustomerReady: false,
  stripeSubscriptionReady: false,
  setupFeePaid: false,
  smsUsageByLocation: [{ locationName, used: smsUsed, pending: 0 }],
  reachedThresholds: smsUsed >= 90 ? [75, 90] : smsUsed >= 75 ? [75] : [],
});

const multiBilling: BillingSummary = {
  billingCycle: "Monthly",
  subscriptionStatus: "Pilot",
  subscriptionPrice: "£79/month",
  setupFee: "£349 for four locations",
  renewalDate: "1 Aug 2026",
  smsAllowance: 300,
  smsUsed: 242,
  smsPending: 3,
  smsOveragePolicy: "auto_top_up",
  stripeCustomerReady: false,
  stripeSubscriptionReady: false,
  setupFeePaid: false,
  smsUsageByLocation: [
    { locationName: "Bath", used: 80, pending: 1 },
    { locationName: "Bristol", used: 40, pending: 0 },
    { locationName: "Trowbridge", used: 72, pending: 2 },
    { locationName: "Wells", used: 50, pending: 0 },
  ],
  reachedThresholds: [75],
};

export const BUSINESSES: BusinessAccount[] = [
  {
    id: "business_123",
    locationId: "location_123_bristol",
    agencyId: "agency_afterword",
    name: "Harbour & Hearth",
    locationName: "Bristol",
    initials: "H",
    country: "GB",
    timezone: "Europe/London",
    health: "Healthy",
    healthTone: "success",
    automationState: "Live",
    integrationSummary: "Google, messaging and job intake healthy",
    lastSuccess: "4 min ago",
    affectedCount: 0,
    plan: "Reputation Pro",
    billing: proBilling("Bristol", 68),
    seedRequestCount: 4,
    metrics: { completedJobs: 142, eligibleCustomers: 133, delivered: 121, uniqueClicks: 18, reviewsDetected: 11, rating: 4.8, totalReviews: 126 },
    teamMembers: [{ initials: "SC", name: "Sarah Collins", role: "Business owner · MFA active" }, { initials: "OG", name: "Oliver Grant", role: "Location manager · Bristol" }],
    integrations: { google: { status: "Demo connected", tone: "success", lastEvent: "3 review records checked · 8 min ago" }, messaging: { status: "Simulated", tone: "success", lastEvent: "Delivery receipt received · 6 min ago" }, jobIntake: { status: "Listening", tone: "success", lastEvent: "REQ-1048 received · 4 min ago" } },
  },
  {
    id: "business_201",
    locationId: "location_201_leeds",
    agencyId: "agency_afterword",
    name: "Northline Electrical",
    locationName: "Leeds",
    initials: "N",
    country: "GB",
    timezone: "Europe/London",
    health: "Authentication required",
    healthTone: "danger",
    automationState: "Auto-paused",
    integrationSummary: "Messaging credentials rejected",
    lastSuccess: "2 h ago",
    affectedCount: 42,
    plan: "Reputation Pro",
    billing: proBilling("Leeds", 91),
    seedRequestCount: 2,
    metrics: { completedJobs: 96, eligibleCustomers: 91, delivered: 74, uniqueClicks: 12, reviewsDetected: 7, rating: 4.7, totalReviews: 84 },
    teamMembers: [{ initials: "LT", name: "Leah Thompson", role: "Business owner · MFA active" }, { initials: "JW", name: "Jamie Wood", role: "Location manager · Leeds" }],
    integrations: { google: { status: "Demo connected", tone: "success", lastEvent: "Review sync completed · 2 h ago" }, messaging: { status: "Credentials rejected", tone: "danger", lastEvent: "Authentication failed · 42 messages held" }, jobIntake: { status: "Listening", tone: "success", lastEvent: "REQ-2202 received · 2 h ago" } },
  },
  {
    id: "business_202",
    locationId: "location_202_austin",
    agencyId: "agency_afterword",
    name: "Bright Smile Dental",
    locationName: "Austin",
    initials: "B",
    country: "US",
    timezone: "America/Chicago",
    health: "Compliance blocked",
    healthTone: "danger",
    automationState: "Protected",
    integrationSummary: "23 CSV records missing consent evidence",
    lastSuccess: "Yesterday",
    affectedCount: 23,
    plan: "Reputation Pro",
    billing: proBilling("Austin", 43),
    seedRequestCount: 1,
    metrics: { completedJobs: 88, eligibleCustomers: 64, delivered: 58, uniqueClicks: 9, reviewsDetected: 5, rating: 4.9, totalReviews: 203 },
    teamMembers: [{ initials: "MP", name: "Maya Patel", role: "Business owner · MFA active" }, { initials: "AR", name: "Avery Reed", role: "Location manager · Austin" }],
    integrations: { google: { status: "Demo connected", tone: "success", lastEvent: "Review sync completed · Yesterday" }, messaging: { status: "Protected", tone: "warning", lastEvent: "No sends attempted for blocked records" }, jobIntake: { status: "Consent blocked", tone: "danger", lastEvent: "23 CSV rows rejected before enrolment" } },
  },
  {
    id: "business_203",
    locationId: "location_203_bath",
    agencyId: "agency_afterword",
    name: "Elm & Stone Landscaping",
    locationName: "Bath",
    initials: "E",
    country: "GB",
    timezone: "Europe/London",
    health: "Provider rate limited",
    healthTone: "warning",
    automationState: "Live",
    integrationSummary: "78 messages delayed; retry scheduled",
    lastSuccess: "18 min ago",
    affectedCount: 78,
    plan: "Reputation Multi",
    billing: multiBilling,
    locationReports: [
      { id: "location_203_bath", name: "Bath", completedJobs: 46, delivered: 38, uniqueClicks: 6, reviewsDetected: 4, rating: 4.7, totalReviews: 28, smsSegments: 80 },
      { id: "location_203_bristol", name: "Bristol", completedJobs: 44, delivered: 37, uniqueClicks: 5, reviewsDetected: 3, rating: 4.6, totalReviews: 24, smsSegments: 40 },
      { id: "location_203_trowbridge", name: "Trowbridge", completedJobs: 45, delivered: 36, uniqueClicks: 5, reviewsDetected: 3, rating: 4.5, totalReviews: 23, smsSegments: 72 },
      { id: "location_203_wells", name: "Wells", completedJobs: 39, delivered: 32, uniqueClicks: 5, reviewsDetected: 3, rating: 4.6, totalReviews: 22, smsSegments: 50 },
    ],
    seedRequestCount: 1,
    metrics: { completedJobs: 174, eligibleCustomers: 168, delivered: 143, uniqueClicks: 21, reviewsDetected: 13, rating: 4.6, totalReviews: 97 },
    teamMembers: [{ initials: "MH", name: "Megan Hughes", role: "Business owner · MFA active" }, { initials: "TB", name: "Tom Baker", role: "Location manager · Bath" }],
    integrations: { google: { status: "Demo connected", tone: "success", lastEvent: "Review sync completed · 11 min ago" }, messaging: { status: "Rate limited", tone: "warning", lastEvent: "78 messages delayed · backoff active" }, jobIntake: { status: "Listening", tone: "success", lastEvent: "REQ-4101 received · 18 min ago" } },
  },
  {
    id: "business_204",
    locationId: "location_204_glasgow",
    agencyId: "agency_afterword",
    name: "Ember Heating",
    locationName: "Glasgow",
    initials: "E",
    country: "GB",
    timezone: "Europe/London",
    health: "Webhook protected",
    healthTone: "warning",
    automationState: "Protected",
    integrationSummary: "14 invalid signatures rejected",
    lastSuccess: "31 min ago",
    affectedCount: 14,
    plan: "Reputation Pro",
    billing: proBilling("Glasgow", 76, true),
    seedRequestCount: 1,
    metrics: { completedJobs: 61, eligibleCustomers: 58, delivered: 55, uniqueClicks: 8, reviewsDetected: 4, rating: 4.8, totalReviews: 62 },
    teamMembers: [{ initials: "CF", name: "Callum Fraser", role: "Business owner · MFA active" }, { initials: "FM", name: "Fiona McKay", role: "Location manager · Glasgow" }],
    integrations: { google: { status: "Demo connected", tone: "success", lastEvent: "Review sync completed · 31 min ago" }, messaging: { status: "Simulated", tone: "success", lastEvent: "Delivery receipt received · 34 min ago" }, jobIntake: { status: "Signature protected", tone: "warning", lastEvent: "14 invalid webhook signatures rejected" } },
  },
  {
    id: "business_205",
    locationId: "location_205_tampa",
    agencyId: "agency_afterword",
    name: "Coastline Air",
    locationName: "Tampa",
    initials: "C",
    country: "US",
    timezone: "America/New_York",
    health: "Google permission revoked",
    healthTone: "warning",
    automationState: "Live",
    integrationSummary: "Review monitoring paused; outbound healthy",
    lastSuccess: "2 h ago",
    affectedCount: 1,
    plan: "Reputation Pro",
    billing: proBilling("Tampa", 54),
    seedRequestCount: 1,
    metrics: { completedJobs: 119, eligibleCustomers: 110, delivered: 101, uniqueClicks: 15, reviewsDetected: 8, rating: 4.7, totalReviews: 151 },
    teamMembers: [{ initials: "EC", name: "Elena Cruz", role: "Business owner · MFA active" }, { initials: "MH", name: "Marcus Hill", role: "Location manager · Tampa" }],
    integrations: { google: { status: "Reconnect required", tone: "warning", lastEvent: "Owner permission revoked · 2 h ago" }, messaging: { status: "Simulated", tone: "success", lastEvent: "Delivery receipt received · 7 min ago" }, jobIntake: { status: "Listening", tone: "success", lastEvent: "REQ-6101 received · 2 h ago" } },
  },
];

const request = (
  businessId: string,
  id: string,
  customer: string,
  job: string,
  channel: Channel,
  destination: string,
  status: RequestStatus,
  createdAt: string,
  consentBasis: string,
  consentStatus: ConsentStatus = "Verified",
): RequestRecord => ({
  businessId,
  locationId: BUSINESSES.find((business) => business.id === businessId)?.locationId,
  id,
  customer,
  job,
  channel,
  destination,
  status,
  createdAt,
  consentBasis,
  consentStatus,
  consentReference: consentStatus === "Missing" ? "Not supplied" : `${id}-JOB`,
  consentCapturedAt: consentStatus === "Missing" ? "Not supplied" : createdAt,
  consentWordingVersion: consentStatus === "Missing" ? "Not supplied" : "review_request_v2",
});

export const INITIAL_REQUESTS_BY_BUSINESS: Record<string, RequestRecord[]> = {
  business_123: [
    request("business_123", "REQ-1048", "Amelia Carter", "Boiler service", "SMS", "•••• 4821", "Reviewed", "Today · 09:42", "Existing customer evidence"),
    request("business_123", "REQ-1047", "Priya Shah", "Emergency call-out", "SMS", "•••• 1926", "Clicked", "Today · 08:16", "Booking form v2"),
    request("business_123", "REQ-1046", "Martin Evans", "Radiator installation", "Email", "m•••@mail.co.uk", "Delivered", "Yesterday · 16:05", "Service update consent"),
    request("business_123", "REQ-1045", "Noah Williams", "Leak repair", "SMS", "•••• 7714", "Opted out", "Yesterday · 13:28", "Booking form v2", "Withdrawn"),
  ],
  business_201: [
    request("business_201", "REQ-2202", "Daniel Foster", "Consumer unit check", "SMS", "•••• 4450", "Blocked", "Today · 10:02", "Booking form v3"),
    request("business_201", "REQ-2201", "Grace Hall", "Lighting installation", "Email", "g•••@mail.co.uk", "Delivered", "Yesterday · 15:11", "Explicit email consent"),
  ],
  business_202: [request("business_202", "REQ-3101", "Jordan Lee", "Dental check-up", "Email", "j•••@mail.com", "Blocked", "Today · 08:34", "Evidence missing", "Missing")],
  business_203: [request("business_203", "REQ-4101", "Megan Reed", "Garden maintenance", "SMS", "•••• 7812", "Queued", "Today · 09:14", "Booking form v1")],
  business_204: [request("business_204", "REQ-5101", "Fiona Ross", "Boiler inspection", "SMS", "•••• 9032", "Delivered", "Yesterday · 17:06", "Existing customer evidence")],
  business_205: [request("business_205", "REQ-6101", "Alex Morgan", "AC service", "Email", "a•••@mail.com", "Clicked", "Today · 11:27", "Service consent v2")],
};

export const REVIEWS_BY_BUSINESS: Record<string, ReviewRecord[]> = Object.fromEntries(
  BUSINESSES.map((business, index) => [business.id, [{
    id: `REV-${311 + index}`,
    businessId: business.id,
    locationId: business.locationId,
    name: ["Amelia C.", "Grace H.", "Jordan L.", "Megan R.", "Fiona R.", "Alex M."][index],
    rating: index === 3 ? 4 : 5,
    date: index === 0 ? "Today · 10:18" : `${15 - index} Jul · 11:20`,
    body: [
      "Clear arrival time, tidy work and the boiler was explained properly before they left.",
      "Everything was checked carefully and the options were explained before the work started.",
      "Friendly team, clear reminders and a straightforward appointment.",
      "The garden was left tidy and the follow-up notes were useful.",
      "The engineer arrived when promised and explained the safety check clearly.",
      "Good communication from booking through to the completed service.",
    ][index],
    replied: index !== 0,
  }]]),
);

const qrRecord = (
  businessId: string,
  publicToken: string,
  businessName: string,
  locationName: string,
  totalScans: number,
  uniqueScans: number,
  reviewConversions: number,
): QrCodeRecord => ({
  businessId,
  locationId: BUSINESSES.find((business) => business.id === businessId)?.locationId,
  publicToken,
  destinationUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${businessName} ${locationName}`)}`,
  destinationVerified: false,
  artworkRevision: 1,
  generatedAt: "16 Jul 2026 · 16:42",
  totalScans,
  uniqueScans,
  reviewConversions,
  lastScanAt: totalScans ? "Today · 14:08" : "No scans yet",
  placements: [
    { label: "Business cards", scans: Math.round(totalScans * 0.45) },
    { label: "Leave-behind flyers", scans: Math.round(totalScans * 0.34) },
    { label: "Marketing packs", scans: Math.max(0, totalScans - Math.round(totalScans * 0.45) - Math.round(totalScans * 0.34)) },
  ],
});

export const INITIAL_QR_CODES_BY_BUSINESS: Record<string, QrCodeRecord> = Object.fromEntries(
  BUSINESSES.map((business, index) => {
    const tokens = ["hh-bristol-7f3m9q2k", "ne-leeds-4p8x2c6v", "bsd-austin-9r2k7m4w", "es-bath-6t3n8q5j", "eh-glasgow-2m7v4p9x", "ca-tampa-8k5r3w6n"];
    const scans = [184, 96, 73, 142, 58, 121][index];
    const unique = [161, 83, 64, 126, 51, 108][index];
    const conversions = [38, 17, 19, 31, 12, 24][index];
    return [business.id, qrRecord(business.id, tokens[index], business.name, business.locationName, scans, unique, conversions)];
  }),
);

export function getQrCodeByToken(publicToken: string) {
  return Object.values(INITIAL_QR_CODES_BY_BUSINESS).find((record) => record.publicToken === publicToken);
}

export const PLATFORM_EXCEPTIONS: PlatformException[] = [
  { id: "EXC-104", businessId: "business_201", category: "Critical", title: "Messaging credentials rejected", startedAt: "Today · 09:58", affectedLabel: "42 messages held", protectedAction: "Sending auto-paused; queued work retained", paused: true, clientNotified: true, resolution: "Reconnect the messaging provider and run pre-flight checks", owner: "Maya Chen", tone: "danger" },
  { id: "EXC-103", businessId: "business_202", category: "Compliance", title: "Consent evidence missing", startedAt: "Today · 08:31", affectedLabel: "23 CSV records blocked", protectedAction: "No customers enrolled and no messages sent", paused: false, clientNotified: false, resolution: "Upload source evidence or remove ineligible rows", owner: "Unassigned", tone: "danger" },
  { id: "EXC-102", businessId: "business_204", category: "Security", title: "Repeated webhook signature failures", startedAt: "Yesterday · 22:14", affectedLabel: "14 events rejected", protectedAction: "Payloads rejected before tenant processing", paused: false, clientNotified: true, resolution: "Rotate the client secret and inspect the sending source", owner: "Ravi Shah", tone: "warning" },
  { id: "EXC-101", businessId: "business_205", category: "Warning", title: "Google permission revoked", startedAt: "Today · 07:42", affectedLabel: "Review sync stopped", protectedAction: "Monitoring paused; outbound requests unaffected", paused: false, clientNotified: true, resolution: "Ask the business owner to reconnect Google", owner: "Maya Chen", tone: "warning" },
  { id: "EXC-100", businessId: "business_203", category: "Delayed", title: "Provider rate limit reached", startedAt: "Today · 10:16", affectedLabel: "78 messages delayed", protectedAction: "Backoff applied; no burst retry", paused: false, clientNotified: false, resolution: "Monitor automatic retry at 14:20", owner: "System", tone: "muted" },
];

export const INITIAL_AUDIT_EVENTS: AuditEvent[] = [
  { id: "AUD-901", occurredAt: "Today · 10:01", actor: "System", actorType: "system", businessId: "business_201", action: "automation.pause", resource: "Northline SMS", outcome: "Completed", correlationId: "COR-A81F", reason: "Five consecutive provider authentication failures" },
  { id: "AUD-900", occurredAt: "Today · 09:44", actor: "Maya Chen", actorType: "user", businessId: "business_123", action: "support.session.end", resource: "SUP-184", outcome: "Completed", supportSessionId: "SUP-184", correlationId: "COR-A816", reason: "Google reconnection verified" },
  { id: "AUD-899", occurredAt: "Yesterday · 22:14", actor: "System", actorType: "system", businessId: "business_204", action: "webhook.reject", resource: "EVT-8832", outcome: "Blocked", correlationId: "COR-A7FF", reason: "Invalid signature; request body not retained" },
  { id: "AUD-898", occurredAt: "14 Jul · 16:32", actor: "Sarah Collins", actorType: "user", businessId: "business_123", action: "template.update", resource: "review-request v7 → v8", outcome: "Completed", correlationId: "COR-A712", reason: "Client-approved wording change" },
];

export const OWNER_SESSION: SessionContext = {
  userId: "user_owner_123",
  userName: "Sarah Collins",
  role: "business_owner",
  businessRole: "owner",
  businessId: "business_123",
  mfaVerified: true,
};

export const ADMIN_SESSION: SessionContext = {
  userId: "user_admin_001",
  userName: "Maya Chen",
  role: "agency_admin",
  agencyRole: "admin",
  productRole: "owner",
  mfaVerified: true,
  stepUpVerifiedAt: "2026-07-16T11:55:00.000Z",
};

export function getBusiness(businessId: string) {
  const business = BUSINESSES.find((item) => item.id === businessId);
  if (!business) throw new Error("Unknown business account.");
  return business;
}

export function isAgencyView(view: WorkspaceView): view is AgencyView {
  return ["agency-overview", "clients", "exceptions", "audit"].includes(view);
}
