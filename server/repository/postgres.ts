import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { inTransaction, setActorContext } from "../db.js";
import { AgencyGrantPostgres } from "../agency/postgres.js";
import type { AgencyGrantRequest } from "../agency/types.js";
import { decryptField, encryptField, hashDestination } from "../security/crypto.js";
import type {
  ActorContext,
  AgencyRole,
  AuthCredential,
  BusinessRole,
  CompletedJobInput,
  DispatchAuthorization,
  EncryptedPayload,
  FinishMessageAttemptInput,
  GoogleConnectionInput,
  GoogleConnectionRecord,
  GoogleReviewInput,
  GoogleTokenRevocationJob,
  MessageJob,
  MessagePayload,
  PlatformRepository,
  PlatformRole,
  ProductRole,
  PublicQrScanInput,
  PublicReviewFlow,
  ReserveSmsSegmentsInput,
  SmsOveragePolicy,
  SmsSegmentReservation,
  StripeBillingWebhookInput,
  StripeCheckoutPreparation,
  HoldSmsMessageInput,
  StartSupportSessionInput,
  WorkspacePayload,
} from "../types.js";
import type { RegistrationInput, SignupIntentInput, VerifiedSignup } from "../onboarding/types.js";

interface PostgresRepositoryOptions {
  authPool?: Pool;
  runtimePool?: Pool;
  ingressPool?: Pool;
  workerPool?: Pool;
  config: Pick<AppConfig, "FIELD_ENCRYPTION_KEY" | "SESSION_PEPPER">;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function displayTime(value: unknown) {
  if (!value) return "No activity yet";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
}

function displayDate(value: unknown) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(String(value)));
}

function pounds(pence: unknown) {
  return `£${(Number(pence) / 100).toFixed(Number(pence) % 100 === 0 ? 0 : 2)}`;
}

function googleIntegrationState(health: unknown) {
  const value = String(health ?? "");
  if (value === "connected" || value === "healthy") return { status: "Connected", tone: "success" as const };
  if (value === "delayed" || value === "rate_limited") return { status: "Sync delayed", tone: "warning" as const };
  if (value === "authentication_required" || value === "permission_revoked") return { status: "Reconnect required", tone: "danger" as const };
  if (value === "provider_unavailable" || value === "failing") return { status: "Sync failing", tone: "danger" as const };
  if (value === "disabled") return { status: "Disconnected", tone: "muted" as const };
  return { status: "Configuration required", tone: "warning" as const };
}

const PLATFORM_ROLES = new Set<PlatformRole>(["business_owner", "agency_admin", "agency_user"]);
const PRODUCT_ROLES = new Set<ProductRole>(["owner", "staff", "client_approver"]);
const AGENCY_ROLES = new Set<AgencyRole>(["owner", "admin", "operator", "support"]);
const BUSINESS_ROLES = new Set<BusinessRole>(["owner", "admin", "operator", "approver", "viewer", "billing"]);

function asKnownRole<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined {
  return typeof value === "string" && allowed.has(value as T) ? value as T : undefined;
}

function isUnknownNonNullRole(value: unknown, parsed: string | undefined) {
  return value !== null && value !== undefined && !parsed;
}

function projectBusinessProductRole(role: BusinessRole | undefined): ProductRole | undefined {
  if (role === "owner" || role === "admin") return "owner";
  if (role === "operator") return "staff";
  if (role === "approver") return "client_approver";
  return undefined;
}

const GOOGLE_DISPATCH_BLOCKED_HEALTH = new Set([
  "authentication_required",
  "permission_revoked",
  "disabled",
]);

export function isGoogleReviewDestinationDispatchable(evidence: {
  runtimeReviewUri: unknown;
  runtimeReviewUriAllowed: unknown;
  connectionHealth: unknown;
  connectionDisabledAt: unknown;
}) {
  const health = String(evidence.connectionHealth ?? "");
  return Boolean(
    evidence.runtimeReviewUri
      && evidence.runtimeReviewUriAllowed === true
      && health
      && !GOOGLE_DISPATCH_BLOCKED_HEALTH.has(health)
      && !evidence.connectionDisabledAt,
  );
}

function webhookEvidence(value: unknown, rawBody: Buffer, encryptionKey: string, context: string) {
  const serialized = Buffer.from(JSON.stringify(value), "utf8");
  const exactBody = rawBody.length > 0 ? rawBody : serialized;
  const encrypted = encryptField(exactBody.toString("base64"), encryptionKey, context);
  return {
    payloadHash: createHash("sha256").update(serialized).digest(),
    encryptedPayload: Buffer.concat([encrypted.nonce, encrypted.tag, encrypted.ciphertext]),
  };
}

export class PostgresRepository implements PlatformRepository {
  readonly authPool?: Pool;
  readonly runtimePool?: Pool;
  readonly ingressPool?: Pool;
  readonly workerPool?: Pool;
  readonly config: PostgresRepositoryOptions["config"];

  constructor(options: PostgresRepositoryOptions) {
    this.authPool = options.authPool;
    this.runtimePool = options.runtimePool;
    this.ingressPool = options.ingressPool;
    this.workerPool = options.workerPool;
    this.config = options.config;
  }

  private requirePool(pool: Pool | undefined, capability: string) {
    if (!pool) throw new Error(`The ${capability} database capability is not available in this process.`);
    return pool;
  }

  private auth() { return this.requirePool(this.authPool, "authentication"); }
  private runtime() { return this.requirePool(this.runtimePool, "tenant runtime"); }
  private ingress() { return this.requirePool(this.ingressPool, "public ingress"); }
  private worker() { return this.requirePool(this.workerPool, "background worker"); }

  private async asActor<T>(actor: ActorContext, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.runtime().connect();
    try {
      return await inTransaction(client, async () => {
        await setActorContext(client, actor);
        return operation(client);
      });
    } finally {
      client.release();
    }
  }

  async findCredentialByEmail(email: string): Promise<AuthCredential | null> {
    const result = await this.auth().query("select * from app_private.lookup_login_credential($1)", [email]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      passwordHash: row.password_hash,
      mfaRequired: row.mfa_required,
      disabled: row.disabled,
    };
  }

  async createSignupIntent(input: SignupIntentInput) {
    const result = await this.auth().query("select * from app_private.create_signup_intent($1,$2,$3,$4,$5)", [input.email, input.displayName, input.accountType, input.tokenHash, input.expiresAt]);
    return { accepted: Boolean(result.rows[0]?.accepted), shouldSendEmail: Boolean(result.rows[0]?.should_send_email) };
  }

  async consumeSignupIntent(tokenHash: Buffer): Promise<VerifiedSignup | null> {
    const result = await this.auth().query("select * from app_private.consume_signup_intent($1)", [tokenHash]);
    const row = result.rows[0];
    return row ? { verifiedSignupId: row.verified_signup_id, email: row.email, displayName: row.display_name, accountType: row.account_type } : null;
  }

  async registerVerifiedSignup(input: RegistrationInput) {
    const result = await this.auth().query("select * from app_private.register_verified_signup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [input.verifiedSignupId, input.passwordHash, input.agencyName ?? null, input.businessName ?? null, input.locationName ?? null, input.country ?? null, input.timezone ?? null, input.directContainer, input.sessionTokenHash, input.idleExpiresAt, input.absoluteExpiresAt, input.ipHash ?? null, input.userAgentFamily ?? null]);
    const row = result.rows[0];
    if (!row) throw new Error("Verified signup registration was not created.");
    return { userId: row.user_id, sessionId: row.session_id, agencyId: row.agency_id, businessId: row.business_id ?? undefined, locationId: row.location_id ?? undefined, onboardingStep: row.onboarding_step };
  }

  async requestAgencyClientGrant(actor: ActorContext, input: AgencyGrantRequest) {
    return new AgencyGrantPostgres(this.runtime()).request(actor, input);
  }

  async acceptAgencyClientGrant(actor: ActorContext, grantId: string, correlationId: string) {
    return new AgencyGrantPostgres(this.runtime()).accept(actor, grantId, correlationId);
  }

  async rejectAgencyClientGrant(actor: ActorContext, grantId: string, correlationId: string) {
    return new AgencyGrantPostgres(this.runtime()).reject(actor, grantId, correlationId);
  }

  async revokeAgencyClientGrant(actor: ActorContext, grantId: string, correlationId: string) {
    return new AgencyGrantPostgres(this.runtime()).revoke(actor, grantId, correlationId);
  }

  async recordLoginResult(email: string, succeeded: boolean) {
    await this.auth().query("select app_private.record_login_result($1,$2)", [email, succeeded]);
  }

  async createLoginSession(input: {
    userId: string;
    tokenHash: Buffer;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    ipHash?: Buffer;
    userAgentFamily?: string;
  }) {
    const result = await this.auth().query(
      "select app_private.issue_auth_session($1, $2, $3, $4, $5, $6) as id",
      [input.userId, input.tokenHash, input.idleExpiresAt, input.absoluteExpiresAt, input.ipHash ?? null, input.userAgentFamily ?? null],
    );
    return String(result.rows[0].id);
  }

  async resolveLoginSession(tokenHash: Buffer): Promise<ActorContext | null> {
    const result = await this.auth().query("select * from app_private.resolve_auth_session_with_role($1)", [tokenHash]);
    const row = result.rows[0];
    if (!row) return null;
    const role = asKnownRole(row.platform_role, PLATFORM_ROLES);
    if (!role) return null;
    const agencyRole = asKnownRole(row.agency_role, AGENCY_ROLES);
    const businessRole = asKnownRole(row.business_role, BUSINESS_ROLES);
    const productRole = asKnownRole(row.product_role, PRODUCT_ROLES);
    if (
      isUnknownNonNullRole(row.agency_role, agencyRole)
      || isUnknownNonNullRole(row.business_role, businessRole)
      || isUnknownNonNullRole(row.product_role, productRole)
    ) return null;
    return {
      userId: row.user_id,
      userName: row.display_name,
      email: row.email,
      role,
      productRole,
      agencyRole,
      businessRole,
      businessId: row.business_id ?? undefined,
      agencyId: row.agency_id ?? undefined,
      mfaVerified: Boolean(row.mfa_verified_at),
      stepUpVerifiedAt: row.step_up_verified_at?.toISOString(),
      sessionId: row.session_id,
      sessionTokenHash: tokenHash,
    };
  }

  async revokeLoginSession(sessionId: string, tokenHash: Buffer) {
    await this.auth().query("select app_private.revoke_auth_session($1, $2, $3)", [sessionId, tokenHash, "User logout"]);
  }

  async getWorkspace(actor: ActorContext, selectedBusinessId?: string, selectedLocationId?: string): Promise<WorkspacePayload> {
    return this.asActor(actor, async (client) => {
      const targetBusinessId = selectedBusinessId ?? actor.businessId;
      const businessesResult = await client.query(`
        select business.id, business.agency_id, business.name, business.default_timezone,
          business.country_code, business.lifecycle_status,
          location.id as location_id, location.name as location_name,
          location.timezone, location.status as location_status,
          google.health as google_health, google.last_sync_at as google_last_sync_at,
          google.last_event_at as google_last_event_at,
          coalesce(policy.messaging_ready, false) as messaging_ready,
          coalesce(job_stats.completed_jobs, 0) as completed_jobs,
          coalesce(job_stats.eligible_customers, 0) as eligible_customers,
          coalesce(delivery_stats.delivered, 0) as delivered,
          delivery_stats.last_accepted_at,
          coalesce(qr_stats.unique_clicks, 0) as unique_clicks,
          coalesce(review_stats.reviews_detected, 0) as reviews_detected,
          coalesce(review_stats.rating, 0) as rating,
          coalesce(exception_stats.affected_count, 0) as affected_count,
          billing.plan_key, billing.subscription_status, billing.billing_cycle,
          billing.subscription_price_pence, billing.setup_fee_pence,
          billing.sms_base_allowance, billing.sms_overage_policy,
          billing.current_period_start, billing.current_period_end,
          billing.stripe_customer_ready, billing.stripe_subscription_ready,
          billing.setup_fee_paid,
          coalesce(bundle_stats.bundle_segments, 0) as bundle_segments,
          coalesce(sms_stats.used_segments, 0) as sms_used_segments,
          coalesce(sms_stats.pending_segments, 0) as sms_pending_segments,
          coalesce(alert_stats.reached_thresholds, '{}'::smallint[]) as reached_thresholds
        from public.businesses business
        left join lateral (
          select candidate.* from public.locations candidate
          where candidate.business_id = business.id and candidate.status <> 'archived'
          order by
            case when business.id = $1::uuid and candidate.id = $2::uuid then 0 else 1 end,
            candidate.created_at
          limit 1
        ) location on true
        left join lateral (
          select integration.health, integration.last_sync_at, integration.last_event_at
          from public.integration_connections integration
          where integration.business_id = business.id and integration.location_id = location.id
            and integration.provider = 'google'
          order by integration.created_at desc limit 1
        ) google on true
        left join lateral (
          select bool_or(messaging_policy.enabled) as messaging_ready
          from public.location_messaging_policies messaging_policy
          where messaging_policy.business_id = business.id and messaging_policy.location_id = location.id
        ) policy on true
        left join lateral (
          select count(*)::integer as completed_jobs,
            count(*) filter (where completed_job.status in ('eligible', 'enrolled'))::integer as eligible_customers
          from public.completed_jobs completed_job
          where completed_job.business_id = business.id and completed_job.location_id = location.id
        ) job_stats on true
        left join lateral (
          select count(*) filter (where outbox.status = 'accepted')::integer as delivered,
            max(outbox.accepted_at) filter (where outbox.status = 'accepted') as last_accepted_at
          from public.message_jobs message_job
          join public.message_outbox outbox
            on outbox.business_id = message_job.business_id and outbox.message_job_id = message_job.id
          where message_job.business_id = business.id and message_job.location_id = location.id
        ) delivery_stats on true
        left join lateral (
          select count(distinct scan.anonymous_visitor_hash) filter (where scan.continued_to_provider_at is not null)::integer as unique_clicks
          from public.qr_codes code
          join public.qr_scan_events scan
            on scan.business_id = code.business_id and scan.qr_code_id = code.id
          where code.business_id = business.id and code.location_id = location.id
        ) qr_stats on true
        left join lateral (
          select count(*)::integer as reviews_detected, avg(review.rating)::numeric(4,2) as rating
          from public.review_records review
          where review.business_id = business.id and review.location_id = location.id
            and review.cache_expires_at > statement_timestamp()
        ) review_stats on true
        left join lateral (
          select (
            count(*) filter (where request.status in ('blocked', 'failed'))
            + (select count(*) from public.message_outbox outbox where outbox.business_id = business.id and outbox.status in ('unknown', 'failed'))
          )::integer as affected_count
          from public.review_requests request where request.business_id = business.id
        ) exception_stats on true
        left join public.billing_account_status billing on billing.business_id = business.id
        left join lateral (
          select coalesce(sum(bundle.segments), 0)::integer as bundle_segments
          from public.sms_allowance_bundles bundle
          where bundle.business_id = business.id
            and bundle.period_start = billing.current_period_start
            and bundle.period_end = billing.current_period_end
            and bundle.status = 'paid'
        ) bundle_stats on true
        left join lateral (
          select
            coalesce(sum(reservation.segments) filter (where reservation.status in ('accepted', 'unknown')), 0)::integer as used_segments,
            coalesce(sum(reservation.segments) filter (where reservation.status = 'reserved'), 0)::integer as pending_segments
          from public.sms_usage_reservations reservation
          where reservation.business_id = business.id
            and reservation.period_start = billing.current_period_start
            and reservation.period_end = billing.current_period_end
        ) sms_stats on true
        left join lateral (
          select coalesce(array_agg(alert.threshold order by alert.threshold), '{}'::smallint[]) as reached_thresholds
          from public.sms_usage_alerts alert
          where alert.business_id = business.id
            and alert.period_start = billing.current_period_start
        ) alert_stats on true
        order by business.name
      `, [targetBusinessId ?? null, selectedLocationId ?? null]);
      const businessIds = businessesResult.rows.map((row) => row.id);
      const locationStatsResult = businessIds.length === 0 ? { rows: [] } : await client.query(`
        select location.id, location.business_id, location.name,
          coalesce(job_stats.completed_jobs, 0) as completed_jobs,
          coalesce(delivery_stats.delivered, 0) as delivered,
          coalesce(qr_stats.unique_clicks, 0) as unique_clicks,
          coalesce(review_stats.reviews_detected, 0) as reviews_detected,
          coalesce(review_stats.rating, 0) as rating,
          coalesce(sms_stats.used_segments, 0) as sms_segments,
          coalesce(sms_stats.pending_segments, 0) as sms_pending_segments
        from public.locations location
        left join public.billing_account_status billing on billing.business_id = location.business_id
        left join lateral (
          select count(*)::integer as completed_jobs
          from public.completed_jobs job
          where job.business_id = location.business_id and job.location_id = location.id
        ) job_stats on true
        left join lateral (
          select count(*) filter (where outbox.status = 'accepted')::integer as delivered
          from public.message_jobs job
          join public.message_outbox outbox
            on outbox.business_id = job.business_id and outbox.message_job_id = job.id
          where job.business_id = location.business_id and job.location_id = location.id
        ) delivery_stats on true
        left join lateral (
          select count(distinct scan.anonymous_visitor_hash)
            filter (where scan.continued_to_provider_at is not null)::integer as unique_clicks
          from public.qr_scan_events scan
          join public.qr_codes scan_code
            on scan_code.business_id = scan.business_id and scan_code.id = scan.qr_code_id
          where scan.business_id = location.business_id and scan_code.location_id = location.id
        ) qr_stats on true
        left join lateral (
          select count(*)::integer as reviews_detected, avg(review.rating)::numeric(4,2) as rating
          from public.review_records review
          where review.business_id = location.business_id and review.location_id = location.id
            and review.cache_expires_at > statement_timestamp()
        ) review_stats on true
        left join lateral (
          select
            coalesce(sum(reservation.segments) filter (where reservation.status in ('accepted', 'unknown')), 0)::integer as used_segments,
            coalesce(sum(reservation.segments) filter (where reservation.status = 'reserved'), 0)::integer as pending_segments
          from public.sms_usage_reservations reservation
          where reservation.business_id = location.business_id and reservation.location_id = location.id
            and reservation.period_start = billing.current_period_start
            and reservation.period_end = billing.current_period_end
        ) sms_stats on true
        where location.business_id = any($1::uuid[]) and location.status <> 'archived'
        order by location.business_id, location.name
      `, [businessIds]);
      const locationsByBusiness = new Map<string, typeof locationStatsResult.rows>();
      for (const row of locationStatsResult.rows) {
        const current = locationsByBusiness.get(row.business_id) ?? [];
        current.push(row);
        locationsByBusiness.set(row.business_id, current);
      }
      const requestedBusinessId = targetBusinessId ?? businessesResult.rows[0]?.id;
      const requestedBusinessLocations = requestedBusinessId ? locationsByBusiness.get(requestedBusinessId) ?? [] : [];
      const requestedBusinessRow = businessesResult.rows.find((row) => row.id === requestedBusinessId);
      const requestedLocationId = selectedLocationId ?? requestedBusinessRow?.location_id ?? requestedBusinessLocations[0]?.id;
      const requestsByBusiness: Record<string, unknown[]> = {};
      const reviewsByBusiness: Record<string, unknown[]> = {};
      const qrCodesByBusiness: Record<string, unknown> = {};
      const workflowsByLocation: WorkspacePayload["workflowsByLocation"] = {};
      let workspaceAccess: WorkspacePayload["access"];
      let selectedBusinessRole: BusinessRole | undefined;

      if (requestedBusinessId) {
        const accessResult = await client.query(`
          select
            app_private.current_business_role($1::uuid)::text as business_role,
            app_private.can_read_tenant_data($1::uuid, $2::uuid) as can_read_tenant,
            app_private.can_manage_business($1::uuid) as can_manage_business,
            app_private.current_user_enabled() and (
              app_private.has_business_role($1::uuid, array['owner','admin','billing']::public.business_role[])
              or app_private.has_active_support_session($1::uuid, 'view')
            ) as can_read_billing,
            app_private.current_user_enabled() and (
              app_private.has_business_role($1::uuid, array['owner','admin','billing']::public.business_role[])
              or app_private.has_active_support_session($1::uuid, 'configuration')
            ) as can_manage_billing,
            app_private.current_user_enabled()
              and app_private.current_support_session_id() is null
              and app_private.has_business_role($1::uuid, array['owner','admin','billing']::public.business_role[])
              as can_manage_stripe_billing
        `, [requestedBusinessId, requestedLocationId ?? null]);
        const accessRow = accessResult.rows[0];
        selectedBusinessRole = asKnownRole(accessRow?.business_role, BUSINESS_ROLES);
        workspaceAccess = {
          businessId: requestedBusinessId,
          locationId: requestedLocationId ?? undefined,
          canReadTenant: Boolean(accessRow?.can_read_tenant),
          canManageBusiness: Boolean(accessRow?.can_manage_business),
          canReadBilling: Boolean(accessRow?.can_read_billing),
          canManageBilling: Boolean(accessRow?.can_manage_billing),
          canManageStripeBilling: Boolean(accessRow?.can_manage_stripe_billing),
        };
      }

      if (requestedBusinessId && requestedLocationId) {
        const requests = await client.query(`
          select request.id, request.business_id, job.location_id,
            job.service_label, request.channel, request.status, request.created_at,
            consent.source as consent_basis, consent.status as consent_status,
            consent.transaction_reference, consent.captured_at, consent.wording_version
          from public.review_requests request
          join public.completed_jobs job on job.business_id = request.business_id and job.id = request.completed_job_id
          join public.customer_contacts contact on contact.business_id = request.business_id and contact.id = request.customer_id
          join public.consent_records consent on consent.business_id = request.business_id and consent.id = request.consent_record_id
          where request.business_id = $1 and job.location_id = $2
          order by request.created_at desc limit 100
        `, [requestedBusinessId, requestedLocationId]);
        requestsByBusiness[requestedBusinessId] = requests.rows.map((row) => ({
          id: row.id,
          businessId: row.business_id,
          locationId: row.location_id,
          customer: "Protected customer",
          job: row.service_label,
          channel: row.channel === "sms" ? "SMS" : "Email",
          destination: "Protected",
          status: ({ scheduled: "Queued", active: "Delivered", converted: "Reviewed", stopped: "Opted out", blocked: "Blocked", failed: "Blocked" } as Record<string, string>)[row.status] ?? "Queued",
          createdAt: displayTime(row.created_at),
          consentBasis: row.consent_basis,
          consentStatus: row.consent_status === "granted" ? "Verified" : row.consent_status === "withdrawn" ? "Withdrawn" : "Missing",
          consentReference: row.transaction_reference ?? "Not supplied",
          consentCapturedAt: displayTime(row.captured_at),
          consentWordingVersion: row.wording_version,
        }));

        const reviews = await client.query(`
          select id, business_id, location_id, reviewer_display_name, rating, provider_created_at,
            body, reply_body from public.review_records
          where business_id = $1 and location_id = $2 and cache_expires_at > statement_timestamp()
          order by provider_created_at desc limit 100
        `, [requestedBusinessId, requestedLocationId]);
        reviewsByBusiness[requestedBusinessId] = reviews.rows.map((row) => ({
          id: row.id,
          businessId: row.business_id,
          locationId: row.location_id,
          name: row.reviewer_display_name,
          rating: row.rating,
          date: displayTime(row.provider_created_at),
          body: row.body,
          replied: Boolean(row.reply_body),
        }));

        const qr = await client.query(`
          select code.business_id, code.location_id, code.public_token, code.artwork_revision,
            code.artwork_generated_at, destination.destination_url,
            destination.verified_at,
            count(scan.id)::integer as total_scans,
            count(distinct scan.anonymous_visitor_hash)::integer as unique_scans,
            count(distinct conversion.id)::integer as conversions,
            max(scan.scanned_at) as last_scan_at
          from public.qr_codes code
          join public.review_destinations destination on destination.business_id = code.business_id and destination.id = code.review_destination_id
          left join public.qr_scan_events scan on scan.business_id = code.business_id and scan.qr_code_id = code.id
          left join public.qr_review_conversions conversion on conversion.business_id = code.business_id and conversion.qr_code_id = code.id
          where code.business_id = $1 and code.location_id = $2 and code.status = 'active'
          group by code.business_id, code.location_id, code.public_token, code.artwork_revision,
            code.artwork_generated_at, destination.destination_url, destination.verified_at
        `, [requestedBusinessId, requestedLocationId]);
        if (qr.rows[0]) {
          const row = qr.rows[0];
          qrCodesByBusiness[requestedBusinessId] = {
            businessId: row.business_id,
            locationId: row.location_id,
            publicToken: row.public_token,
            destinationUrl: row.destination_url,
            destinationVerified: Boolean(row.verified_at),
            artworkRevision: row.artwork_revision,
            generatedAt: displayTime(row.artwork_generated_at),
            totalScans: row.total_scans,
            uniqueScans: row.unique_scans,
            reviewConversions: row.conversions,
            lastScanAt: displayTime(row.last_scan_at),
            placements: [],
          };
        }

        const [policyResult, destinationResult] = await Promise.all([
          client.query(`
            select policy.business_id, policy.location_id, policy.channel::text as channel,
              policy.enabled, policy.timezone, policy.allowed_weekdays,
              policy.send_window_start::text as send_window_start,
              policy.send_window_end::text as send_window_end,
              policy.max_messages_per_request,
              extract(epoch from policy.minimum_gap)::integer as minimum_gap_seconds,
              policy.rule_version,
              template.id as template_id, template.template_key, template.version as template_version,
              template.body as template_body, template.subject as template_subject,
              template.includes_business_identity, template.includes_unsubscribe,
              template.approved_at
            from public.location_messaging_policies policy
            left join lateral (
              select candidate.*
              from public.message_template_versions candidate
              where candidate.business_id = policy.business_id
                and candidate.location_id = policy.location_id
                and candidate.channel = policy.channel
                and candidate.retired_at is null
              order by candidate.version desc, candidate.approved_at desc nulls last, candidate.id desc
              limit 1
            ) template on true
            where policy.business_id = $1 and policy.location_id = $2
              and policy.channel in ('sms', 'email')
            order by policy.channel
          `, [requestedBusinessId, requestedLocationId]),
          client.query(`
            select destination.destination_url as qr_destination_url,
              destination.verified_at as destination_verified_at,
              runtime_google.review_uri as runtime_review_uri,
              runtime_google.connection_health,
              runtime_google.connection_disabled_at,
              runtime_google.runtime_review_uri_allowed
            from public.locations location
            left join lateral (
              select review_destination.destination_url, review_destination.verified_at
              from public.review_destinations review_destination
              where review_destination.business_id = location.business_id
                and review_destination.location_id = location.id
                and review_destination.provider = 'google'
                and review_destination.active
                and review_destination.verified_at is not null
              order by review_destination.updated_at desc, review_destination.id desc
              limit 1
            ) destination on true
            left join lateral (
              select profile.review_uri, connection.health::text as connection_health,
                connection.disabled_at as connection_disabled_at,
                app_private.is_allowed_google_review_url(profile.review_uri) as runtime_review_uri_allowed
              from public.google_profile_locations profile
              join public.integration_connections connection
                on connection.business_id = profile.business_id
                and connection.id = profile.integration_id
                and connection.provider = 'google'
              where profile.business_id = location.business_id and profile.location_id = location.id
              order by profile.updated_at desc, profile.id desc
              limit 1
            ) runtime_google on true
            where location.business_id = $1 and location.id = $2 and location.status <> 'archived'
          `, [requestedBusinessId, requestedLocationId]),
        ]);
        const destinationRow = destinationResult.rows[0];
        const runtimeUrl = destinationRow && isGoogleReviewDestinationDispatchable({
          runtimeReviewUri: destinationRow.runtime_review_uri,
          runtimeReviewUriAllowed: destinationRow.runtime_review_uri_allowed,
          connectionHealth: destinationRow.connection_health,
          connectionDisabledAt: destinationRow.connection_disabled_at,
        })
          ? String(destinationRow.runtime_review_uri)
          : undefined;
        const qrUrl = destinationRow?.qr_destination_url ? String(destinationRow.qr_destination_url) : undefined;
        workflowsByLocation[requestedLocationId] = {
          businessId: requestedBusinessId,
          locationId: requestedLocationId,
          channels: policyResult.rows.map((row) => ({
            channel: row.channel === "email" ? "email" as const : "sms" as const,
            enabled: Boolean(row.enabled),
            timezone: String(row.timezone),
            allowedWeekdays: (row.allowed_weekdays as unknown[] ?? []).map(Number),
            sendWindowStart: String(row.send_window_start),
            sendWindowEnd: String(row.send_window_end),
            maxMessages: Number(row.max_messages_per_request),
            minimumGapSeconds: Number(row.minimum_gap_seconds),
            ruleVersion: String(row.rule_version),
            template: row.template_id ? {
              id: String(row.template_id),
              key: String(row.template_key),
              version: Number(row.template_version),
              body: String(row.template_body),
              subject: row.template_subject ? String(row.template_subject) : undefined,
              includesBusinessIdentity: Boolean(row.includes_business_identity),
              includesUnsubscribe: Boolean(row.includes_unsubscribe),
              approvedAt: displayTime(row.approved_at),
            } : null,
          })),
          reviewDestination: destinationRow ? {
            runtimeUrl,
            qrUrl,
            verifiedAt: destinationRow.destination_verified_at ? displayTime(destinationRow.destination_verified_at) : undefined,
            connectionHealth: destinationRow.connection_health ? String(destinationRow.connection_health) : undefined,
            matchesRuntime: Boolean(runtimeUrl && qrUrl && runtimeUrl === qrUrl),
          } : null,
        };
      }

      const teamMembersByBusiness = new Map<string, Array<{ initials: string; name: string; role: string }>>();
      if (requestedBusinessId && actor.role === "business_owner") {
        const teamResult = await client.query(`
          select membership.business_id, app_user.display_name, membership.role::text as role
          from public.business_memberships membership
          join public.users app_user on app_user.id = membership.user_id
          where membership.business_id = $1 and membership.status = 'active'
          order by app_user.display_name
        `, [requestedBusinessId]);
        teamMembersByBusiness.set(requestedBusinessId, teamResult.rows.map((member) => ({
          initials: initials(String(member.display_name)),
          name: String(member.display_name),
          role: ({ owner: "Owner", admin: "Administrator", operator: "Operator", viewer: "Viewer", billing: "Billing" } as Record<string, string>)[String(member.role)] ?? "Member",
        })));
      }

      const businessRows: WorkspacePayload["businesses"] = businessesResult.rows.map((row) => {
        const google = googleIntegrationState(row.google_health);
        const locationRows = locationsByBusiness.get(row.id) ?? [];
        const operational = row.lifecycle_status === "active"
          && Boolean(row.location_id)
          && Boolean(row.messaging_ready)
          && ["connected", "healthy"].includes(String(row.google_health ?? ""));
        const lastActivity = row.google_last_sync_at ?? row.last_accepted_at ?? row.google_last_event_at;
        const billing = row.plan_key ? {
          billingCycle: row.billing_cycle === "annual" ? "Annual" as const : "Monthly" as const,
          subscriptionStatus: ({ inactive: "Inactive", pilot: "Pilot", active: "Active", past_due: "Past due", cancelled: "Cancelled" } as const)[row.subscription_status as "inactive" | "pilot" | "active" | "past_due" | "cancelled"],
          subscriptionPrice: `${pounds(row.subscription_price_pence)}/${row.billing_cycle === "annual" ? "year" : "month"}`,
          setupFee: `${pounds(row.setup_fee_pence)} one-off`,
          renewalDate: displayDate(row.current_period_end),
          smsAllowance: Number(row.sms_base_allowance) + Number(row.bundle_segments),
          smsUsed: Number(row.sms_used_segments),
          smsPending: Number(row.sms_pending_segments),
          smsOveragePolicy: row.sms_overage_policy as SmsOveragePolicy,
          stripeCustomerReady: Boolean(row.stripe_customer_ready),
          stripeSubscriptionReady: Boolean(row.stripe_subscription_ready),
          setupFeePaid: Boolean(row.setup_fee_paid),
          smsUsageByLocation: locationRows.map((location) => ({
            locationName: String(location.name),
            used: Number(location.sms_segments),
            pending: Number(location.sms_pending_segments),
          })),
          reachedThresholds: (row.reached_thresholds as unknown[]).map(Number),
        } : undefined;
        return {
        id: row.id,
        agencyId: row.agency_id,
        locationId: row.location_id ?? undefined,
        name: row.name,
        locationName: row.location_name ?? "Managed account",
        initials: initials(row.name),
        country: row.country_code === "US" ? "US" : "GB",
        timezone: row.timezone ?? row.default_timezone,
        health: operational ? "Healthy" : google.status === "Connected" ? "Messaging setup required" : google.status,
        healthTone: operational ? "success" as const : google.tone === "success" ? "warning" as const : google.tone,
        automationState: operational ? "Live" as const : "Protected" as const,
        integrationSummary: operational ? "Google and messaging ready" : "Setup incomplete; unsafe sends remain blocked",
        lastSuccess: displayTime(lastActivity),
        affectedCount: Number(row.affected_count),
        plan: row.plan_key === "multi_monthly" ? "Reputation Multi" as const : "Reputation Pro" as const,
        billing,
        locationReports: locationRows.map((location) => ({
          id: String(location.id),
          name: String(location.name),
          completedJobs: Number(location.completed_jobs),
          delivered: Number(location.delivered),
          uniqueClicks: Number(location.unique_clicks),
          reviewsDetected: Number(location.reviews_detected),
          rating: Number(location.rating),
          totalReviews: Number(location.reviews_detected),
          smsSegments: Number(location.sms_segments),
        })),
        seedRequestCount: 0,
        metrics: {
          completedJobs: Number(row.completed_jobs),
          eligibleCustomers: Number(row.eligible_customers),
          delivered: Number(row.delivered),
          uniqueClicks: Number(row.unique_clicks),
          reviewsDetected: Number(row.reviews_detected),
          rating: Number(row.rating),
          totalReviews: Number(row.reviews_detected),
        },
        teamMembers: teamMembersByBusiness.get(row.id) ?? [],
        integrations: {
          google: { ...google, lastEvent: row.google_last_sync_at ? `Last sync ${displayTime(row.google_last_sync_at)}` : "No successful sync yet" },
          messaging: row.messaging_ready
            ? { status: row.delivered > 0 ? "Delivery active" : "Policy ready", tone: row.delivered > 0 ? "success" as const : "accent" as const, lastEvent: row.last_accepted_at ? `Last accepted ${displayTime(row.last_accepted_at)}` : "No provider receipt yet" }
            : { status: "Configuration required", tone: "warning" as const, lastEvent: "Messaging policy is disabled or missing" },
          jobIntake: { status: "Manual API ready", tone: "accent" as const, lastEvent: "Signed CRM ingress is not configured" },
        },
      };
      });

      const audit = await client.query(`
        select id, occurred_at, actor_user_id, actor_type, effective_business_id,
          action, target_id, outcome, support_session_id, correlation_id
        from public.audit_events
        where effective_business_id is null or effective_business_id = $1
        order by occurred_at desc limit 100
      `, [requestedBusinessId ?? null]);

      const safeSession: WorkspacePayload["session"] = {
        userId: actor.userId,
        userName: actor.userName,
        email: actor.email,
        role: actor.role,
        productRole: actor.role === "business_owner"
          ? projectBusinessProductRole(selectedBusinessRole)
          : actor.productRole,
        agencyRole: actor.agencyRole,
        businessRole: actor.role === "business_owner" ? selectedBusinessRole : actor.businessRole,
        businessId: actor.role === "business_owner" ? requestedBusinessId : actor.businessId,
        agencyId: actor.agencyId,
        mfaVerified: actor.mfaVerified,
        stepUpVerifiedAt: actor.stepUpVerifiedAt,
        supportSessionId: actor.supportSessionId,
      };
      return {
        session: safeSession,
        businesses: businessRows,
        requestsByBusiness,
        reviewsByBusiness,
        qrCodesByBusiness,
        workflowsByLocation,
        access: workspaceAccess,
        exceptions: [],
        auditEvents: audit.rows.map((row) => ({
          id: row.id,
          occurredAt: displayTime(row.occurred_at),
          actor: row.actor_user_id ?? "System",
          actorType: row.actor_type,
          businessId: row.effective_business_id ?? undefined,
          action: row.action,
          resource: row.target_id ?? "Platform",
          outcome: row.outcome === "blocked" ? "Blocked" : row.outcome === "allowed" ? "Allowed" : "Completed",
          supportSessionId: row.support_session_id ?? undefined,
          correlationId: row.correlation_id,
        })),
      } as WorkspacePayload;
    });
  }

  async updateSmsOveragePolicy(
    actor: ActorContext,
    businessId: string,
    policy: SmsOveragePolicy,
    correlationId: string,
  ) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select * from app_private.set_sms_overage_policy($1,$2,$3)",
        [businessId, policy, correlationId],
      );
      const row = result.rows[0];
      return {
        updated: Boolean(row?.updated),
        policy: row?.policy ? row.policy as SmsOveragePolicy : undefined,
        reason: String(row?.reason ?? "billing_unavailable"),
      };
    });
  }

  async prepareStripeCheckout(
    actor: ActorContext,
    businessId: string,
    attemptId: string,
    correlationId: string,
  ): Promise<StripeCheckoutPreparation> {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select * from app_private.prepare_stripe_checkout($1,$2,$3)",
        [businessId, attemptId, correlationId],
      );
      const row = result.rows[0];
      return {
        allowed: Boolean(row?.allowed),
        reason: String(row?.reason ?? "billing_unavailable"),
        attemptId,
        businessId,
        planKey: row?.plan_key ?? undefined,
        billingCycle: row?.billing_cycle ?? undefined,
        subscriptionPricePence: row?.subscription_price_pence === undefined
          ? undefined
          : Number(row.subscription_price_pence),
        setupFeePence: row?.setup_fee_pence === undefined ? undefined : Number(row.setup_fee_pence),
        customerId: row?.stripe_customer_id ?? undefined,
      };
    });
  }

  async bindStripeCheckoutSession(
    actor: ActorContext,
    businessId: string,
    attemptId: string,
    sessionId: string,
    customerId: string | undefined,
    livemode: boolean,
    correlationId: string,
  ) {
    await this.asActor(actor, async (client) => {
      await client.query(
        "select app_private.bind_stripe_checkout_session($1,$2,$3,$4,$5,$6)",
        [businessId, attemptId, sessionId, customerId ?? null, livemode, correlationId],
      );
    });
  }

  async getStripeBillingCustomer(actor: ActorContext, businessId: string, correlationId: string) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select * from app_private.get_stripe_billing_customer($1,$2)",
        [businessId, correlationId],
      );
      const row = result.rows[0];
      return {
        allowed: Boolean(row?.allowed),
        reason: String(row?.reason ?? "billing_unavailable"),
        customerId: row?.stripe_customer_id ?? undefined,
      };
    });
  }

  async startSupportSession(actor: ActorContext, input: StartSupportSessionInput) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select app_private.start_support_session($1,$2,$3,$4,$5) as id",
        [input.businessId, input.scope, input.reason, input.durationMinutes, randomUUID()],
      );
      return String(result.rows[0].id);
    });
  }

  async getActiveSupportSession(actor: ActorContext) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(`
        select support_session.id, support_session.business_id, support_session.scope,
          support_session.started_at, support_session.expires_at
        from public.support_sessions support_session
        join public.businesses business
          on business.id = support_session.business_id
         and business.archived_at is null
        join public.agency_memberships membership
          on membership.agency_id = support_session.agency_id
         and membership.user_id = support_session.actor_user_id
         and membership.status = 'active'
        join public.users app_user
          on app_user.id = support_session.actor_user_id
         and app_user.disabled_at is null
        where support_session.actor_user_id = $1
          and support_session.ended_at is null
          and support_session.revoked_at is null
          and support_session.started_at <= statement_timestamp()
          and support_session.expires_at > statement_timestamp()
          and support_session.last_activity_at > statement_timestamp() - interval '15 minutes'
          and support_session.last_activity_at <= statement_timestamp() + interval '1 minute'
          and (
            membership.role in ('owner', 'admin')
            or (membership.role = 'support' and support_session.scope = 'view')
          )
        order by support_session.started_at desc
        limit 1
      `, [actor.userId]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        businessId: String(row.business_id),
        scope: row.scope as "view" | "configuration",
        startedAt: new Date(row.started_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString(),
      };
    });
  }

  async endSupportSession(actor: ActorContext, supportSessionId: string, reason: string) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select app_private.end_support_session($1,$2,$3) as ended",
        [supportSessionId, reason, randomUUID()],
      );
      return Boolean(result.rows[0].ended);
    });
  }

  async createCompletedJob(actor: ActorContext, input: CompletedJobInput) {
    return this.asActor(actor, async (client) => {
      const templateResult = await client.query(`
        select business.name as business_name, template.id as template_version_id,
          template.body as template_body, template.subject as template_subject, template.includes_business_identity,
          template.includes_unsubscribe
        from public.businesses business
        join public.locations location on location.business_id = business.id and location.id = $2
        left join lateral (
          select candidate.* from public.message_template_versions candidate
          where candidate.business_id = business.id and candidate.location_id = location.id
            and candidate.channel = $3::public.channel_kind and candidate.retired_at is null
          order by candidate.version desc, candidate.approved_at desc nulls last, candidate.id desc limit 1
        ) template on true
        where business.id = $1
      `, [input.businessId, input.locationId, input.preferredChannel.toLowerCase()]);
      const selectedTemplate = templateResult.rows[0];
      if (!selectedTemplate) throw new Error("The completed-job location does not belong to this business.");
      const context = `${input.businessId}:customer-pii`;
      const firstName = encryptField(input.firstName, this.config.FIELD_ENCRYPTION_KEY, context);
      const phone = input.phone ? encryptField(input.phone, this.config.FIELD_ENCRYPTION_KEY, context) : undefined;
      const email = input.email ? encryptField(input.email, this.config.FIELD_ENCRYPTION_KEY, context) : undefined;
      const destination = input.preferredChannel === "SMS" ? input.phone : input.email;
      if (!destination) throw new Error(`A ${input.preferredChannel} destination is required.`);
      const destinationHash = hashDestination(destination, this.config.SESSION_PEPPER);
      const customerReference = input.externalCustomerId
        ? `external:${input.externalCustomerId}`
        : `destination:${destinationHash.toString("hex")}`;
      const encryptedDestination = encryptField(destination, this.config.FIELD_ENCRYPTION_KEY, `${input.businessId}:message-destination`);
      const body = String(selectedTemplate.template_body ?? "")
        .replaceAll("{{first_name}}", input.firstName)
        .replaceAll("{{business_name}}", String(selectedTemplate.business_name));
      const subject = selectedTemplate.template_subject === null || selectedTemplate.template_subject === undefined
        ? undefined
        : String(selectedTemplate.template_subject)
          .replaceAll("{{first_name}}", input.firstName)
          .replaceAll("{{business_name}}", String(selectedTemplate.business_name));
      if (selectedTemplate.template_version_id) {
        if (!selectedTemplate.includes_business_identity || !selectedTemplate.includes_unsubscribe) {
          throw new Error("The selected immutable message template is not approved for review requests.");
        }
        if (!body.includes("{{review_link}}")) throw new Error("The approved template must contain {{review_link}}.");
        if (/five[ -]?star|5[ -]?star|discount|reward|only if|if (?:you(?:'re| are)? )?happy|contact us first/i.test(`${subject ?? ""}\n${body}`)) {
          throw new Error("The approved template violates the neutral review-request policy.");
        }
        if (input.preferredChannel === "SMS" && !/\bSTOP\b/i.test(body)) {
          throw new Error("The approved SMS template must contain STOP instructions.");
        }
        if (input.preferredChannel === "Email" && !body.includes("{{unsubscribe_link}}")) {
          throw new Error("The approved email template must contain {{unsubscribe_link}}.");
        }
        if (input.preferredChannel === "Email" && !subject) {
          throw new Error("The approved email template must contain an immutable subject.");
        }
      }
      const encryptedBody = encryptField(body, this.config.FIELD_ENCRYPTION_KEY, `${input.businessId}:message-body`);
      const encryptedSubject = subject
        ? encryptField(subject, this.config.FIELD_ENCRYPTION_KEY, `${input.businessId}:message-subject`)
        : undefined;
      const params = [
        input.businessId, input.locationId, input.externalJobId, input.serviceLabel, input.occurredAt,
        customerReference, firstName.ciphertext, firstName.nonce, firstName.tag,
        phone?.ciphertext ?? null, phone?.nonce ?? null, phone?.tag ?? null, input.phone ? hashDestination(input.phone, this.config.SESSION_PEPPER) : null,
        email?.ciphertext ?? null, email?.nonce ?? null, email?.tag ?? null, input.email ? hashDestination(input.email, this.config.SESSION_PEPPER) : null,
        input.preferredChannel.toLowerCase(), destinationHash, selectedTemplate.template_version_id ?? null, input.consent.status,
        input.consent.wording, input.consent.wordingVersion, input.consent.purpose, input.consent.capturedAt,
        input.consent.source, input.consent.transactionReference, input.consent.evidenceReference ?? null,
        encryptedDestination.ciphertext, encryptedDestination.nonce, encryptedDestination.tag,
        encryptedBody.ciphertext, encryptedBody.nonce, encryptedBody.tag,
        encryptedSubject?.ciphertext ?? null, encryptedSubject?.nonce ?? null, encryptedSubject?.tag ?? null,
        randomUUID(),
      ];
      const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
      const result = await client.query(`select * from app_private.create_manual_completed_job(${placeholders})`, params);
      const row = result.rows[0];
      const status: "Blocked" | "Queued" = row.request_status === "blocked" ? "Blocked" : "Queued";
      return { requestId: row.review_request_id, status, duplicate: Boolean(row.duplicate) };
    });
  }

  async beginGoogleOAuth(actor: ActorContext, businessId: string, locationId: string, stateHash: Buffer, codeVerifier: EncryptedPayload, expiresAt: Date) {
    await this.asActor(actor, (client) => client.query(
      "select app_private.store_google_oauth_state($1,$2,$3,$4,$5,$6,$7)",
      [businessId, locationId, stateHash, codeVerifier.ciphertext, codeVerifier.nonce, codeVerifier.tag, expiresAt],
    ).then(() => undefined));
  }

  async consumeGoogleOAuthState(stateHash: Buffer) {
    const result = await this.auth().query("select * from app_private.consume_google_oauth_state($1)", [stateHash]);
    const row = result.rows[0];
    return row ? { actorUserId: row.actor_user_id, businessId: row.business_id, locationId: row.location_id, codeVerifier: { ciphertext: row.verifier_ciphertext, nonce: row.verifier_nonce, tag: row.verifier_tag } } : null;
  }

  async saveGoogleConnection(input: GoogleConnectionInput) {
    await this.auth().query("select app_private.save_google_connection_for_actor($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", [
      input.actorUserId, input.businessId, input.locationId, input.accountName, input.locationName, input.reviewUri,
      input.accessToken.ciphertext, input.accessToken.nonce, input.accessToken.tag,
      input.refreshToken?.ciphertext ?? null, input.refreshToken?.nonce ?? null, input.refreshToken?.tag ?? null,
      input.expiresAt, input.grantedScopes,
    ]);
  }

  async storeGoogleProfileSelection(
    actorUserId: string,
    businessId: string,
    locationId: string,
    tokenHash: Buffer,
    payload: EncryptedPayload,
    expiresAt: Date,
  ) {
    await this.auth().query(
      "select app_private.store_google_profile_selection_state_for_actor($1,$2,$3,$4,$5,$6,$7,$8)",
      [actorUserId, businessId, locationId, tokenHash, payload.ciphertext, payload.nonce, payload.tag, expiresAt],
    );
  }

  async peekGoogleProfileSelection(actor: ActorContext, tokenHash: Buffer) {
    return this.asActor(actor, async (client) => {
      const result = await client.query("select * from app_private.peek_google_profile_selection_state($1)", [tokenHash]);
      const row = result.rows[0];
      return row ? {
        businessId: row.business_id,
        locationId: row.location_id,
        payload: {
          ciphertext: row.candidates_ciphertext,
          nonce: row.candidates_nonce,
          tag: row.candidates_tag,
        },
      } : null;
    });
  }

  async consumeGoogleProfileSelection(actor: ActorContext, tokenHash: Buffer) {
    return this.asActor(actor, async (client) => {
      const result = await client.query("select * from app_private.consume_google_profile_selection_state($1)", [tokenHash]);
      const row = result.rows[0];
      return row ? {
        businessId: row.business_id,
        locationId: row.location_id,
        payload: {
          ciphertext: row.candidates_ciphertext,
          nonce: row.candidates_nonce,
          tag: row.candidates_tag,
        },
      } : null;
    });
  }

  async saveRefreshedGoogleToken(input: {
    integrationId: string;
    workerId: string;
    leaseToken: string;
    accessToken: EncryptedPayload;
    refreshToken?: EncryptedPayload;
    expiresAt: Date;
    grantedScopes: string[];
  }) {
    await this.worker().query(
      "select app_private.save_refreshed_google_token($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        input.integrationId,
        input.workerId, input.leaseToken,
        input.accessToken.ciphertext, input.accessToken.nonce, input.accessToken.tag,
        input.refreshToken?.ciphertext ?? null, input.refreshToken?.nonce ?? null, input.refreshToken?.tag ?? null,
        input.expiresAt, input.grantedScopes,
      ],
    );
  }

  async requestGoogleReviewSync(actor: ActorContext, businessId: string) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select app_private.request_google_review_sync($1,$2) as scheduled_connections",
        [businessId, randomUUID()],
      );
      return Number(result.rows[0].scheduled_connections);
    });
  }

  async disconnectGoogleConnection(actor: ActorContext, businessId: string, locationId: string) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select * from app_private.disconnect_google_connection($1,$2,$3)",
        [businessId, locationId, randomUUID()],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Google connection was not found.");
      return { revocationId: String(row.revocation_id), integrationId: String(row.integration_id) };
    });
  }

  async listDueGoogleConnections(limit: number): Promise<GoogleConnectionRecord[]> {
    const result = await this.worker().query("select * from app_private.claim_google_review_sync($1,$2)", [`google-sync-${process.pid}`, limit]);
    return result.rows.map((row) => ({
      integrationId: row.integration_id, businessId: row.business_id, locationId: row.location_id,
      accountName: row.account_resource_name, locationName: row.location_resource_name, reviewUri: row.review_uri,
      accessToken: { ciphertext: row.access_token_ciphertext, nonce: row.access_token_nonce, tag: row.access_token_tag },
      refreshToken: row.refresh_token_ciphertext ? { ciphertext: row.refresh_token_ciphertext, nonce: row.refresh_token_nonce, tag: row.refresh_token_tag } : undefined,
      expiresAt: row.token_expires_at, grantedScopes: row.granted_scopes,
      syncWorkerId: row.sync_worker_id, syncLeaseToken: row.sync_lease_token,
    }));
  }

  async upsertGoogleReviews(connection: GoogleConnectionRecord, reviews: GoogleReviewInput[]) {
    let count = 0;
    for (const review of reviews) {
      await this.worker().query("select app_private.upsert_google_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
        connection.businessId, connection.locationId, connection.integrationId,
        review.providerReviewId, review.reviewerName, review.rating, review.body,
        review.createdAt, review.updatedAt, review.replyBody ?? null,
      ]);
      count += 1;
    }
    return count;
  }

  async finishGoogleReviewSync(
    connection: GoogleConnectionRecord,
    succeeded: boolean,
    error: string | undefined,
    seenReviewIds: string[] | undefined,
  ) {
    await this.worker().query(
      "select app_private.finish_google_review_sync($1,$2,$3,$4,$5,$6)",
      [
        connection.integrationId,
        connection.syncWorkerId,
        connection.syncLeaseToken,
        succeeded,
        error ?? null,
        seenReviewIds ?? null,
      ],
    );
  }

  async claimGoogleTokenRevocations(workerId: string, limit: number, leaseSeconds: number): Promise<GoogleTokenRevocationJob[]> {
    const result = await this.worker().query(
      "select * from app_private.claim_google_token_revocations($1,$2,$3)",
      [workerId, limit, leaseSeconds],
    );
    return result.rows.map((row) => ({
      revocationId: row.revocation_id,
      integrationId: row.integration_id,
      businessId: row.business_id,
      tokenKind: row.token_kind,
      token: { ciphertext: row.token_ciphertext, nonce: row.token_nonce, tag: row.token_tag },
      keyVersion: Number(row.key_version),
      leaseToken: row.lease_token,
    }));
  }

  async finishGoogleTokenRevocation(
    revocationId: string,
    workerId: string,
    leaseToken: string,
    succeeded: boolean,
    error?: string,
  ) {
    await this.worker().query(
      "select app_private.finish_google_token_revocation($1,$2,$3,$4,$5)",
      [revocationId, workerId, leaseToken, succeeded, error ?? null],
    );
  }

  async claimMessageJobs(workerId: string, limit: number, leaseSeconds: number): Promise<MessageJob[]> {
    const result = await this.worker().query("select * from app_private.claim_message_jobs($1,$2,$3)", [workerId, limit, leaseSeconds]);
    return result.rows.map((row) => ({ id: row.id, businessId: row.business_id, locationId: row.location_id, channel: row.channel, provider: row.provider, leaseToken: row.lease_token }));
  }

  async authorizeMessageDispatch(jobId: string, workerId: string, leaseToken: string): Promise<DispatchAuthorization> {
    const result = await this.worker().query("select * from app_private.evaluate_message_dispatch($1,$2,$3)", [jobId, workerId, leaseToken]);
    const row = result.rows[0];
    return { allowed: row.decision === "allow", reason: row.reason, nextAllowedAt: row.next_allowed_at ?? undefined };
  }

  async getMessagePayload(jobId: string, workerId: string, leaseToken: string): Promise<MessagePayload> {
    const result = await this.worker().query("select * from app_private.get_message_dispatch_payload($1,$2,$3)", [jobId, workerId, leaseToken]);
    const row = result.rows[0];
    return {
      messageAttemptId: row.message_attempt_id,
      businessId: row.business_id,
      channel: row.channel,
      reviewUri: row.review_uri,
      destination: { ciphertext: row.destination_ciphertext, nonce: row.destination_nonce, tag: row.destination_tag },
      subject: row.subject_ciphertext ? decryptField({ ciphertext: row.subject_ciphertext, nonce: row.subject_nonce, tag: row.subject_tag }, this.config.FIELD_ENCRYPTION_KEY, `${row.business_id}:message-subject`) : undefined,
      body: decryptField({ ciphertext: row.body_ciphertext, nonce: row.body_nonce, tag: row.body_tag }, this.config.FIELD_ENCRYPTION_KEY, `${row.business_id}:message-body`),
      idempotencyKey: row.provider_idempotency_key,
    };
  }

  async reserveSmsSegments(input: ReserveSmsSegmentsInput): Promise<SmsSegmentReservation> {
    const result = await this.worker().query(
      "select * from app_private.reserve_sms_segments($1,$2,$3,$4)",
      [input.messageAttemptId, input.workerId, input.leaseToken, input.segments],
    );
    const row = result.rows[0];
    return {
      allowed: Boolean(row?.allowed),
      reason: String(row?.reason ?? "sms_billing_missing"),
      retryAt: row?.retry_at ? new Date(row.retry_at) : undefined,
    };
  }

  async holdMessageForSmsAllowance(input: HoldSmsMessageInput) {
    const result = await this.worker().query(
      "select app_private.hold_message_for_sms_allowance($1,$2,$3,$4,$5,$6) as retry_at",
      [
        input.messageAttemptId,
        input.workerId,
        input.leaseToken,
        input.reason,
        input.retryAt ?? null,
        input.correlationId,
      ],
    );
    return new Date(result.rows[0].retry_at);
  }

  async finishMessageAttempt(input: FinishMessageAttemptInput) {
    await this.worker().query("select app_private.finish_message_attempt($1,$2,$3,$4,$5,$6,$7)", [
      input.messageAttemptId, input.workerId, input.leaseToken, input.result,
      input.providerMessageId ?? null, input.responseCode ?? null, input.errorCode ?? null,
    ]);
  }

  async deferMessageJob(jobId: string, workerId: string, leaseToken: string, runAt: Date, reason: string) {
    await this.worker().query("select app_private.defer_message_job($1,$2,$3,$4,$5)", [jobId, workerId, leaseToken, runAt, reason]);
  }

  async rollPilotBillingPeriods(limit: number) {
    const result = await this.worker().query(
      "select app_private.roll_pilot_billing_periods($1) as rolled",
      [limit],
    );
    return Number(result.rows[0]?.rolled ?? 0);
  }

  async resolvePublicReviewFlow(publicToken: string): Promise<PublicReviewFlow | null> {
    const result = await this.ingress().query("select * from app_private.resolve_qr_review_flow($1)", [publicToken]);
    const row = result.rows[0];
    return row ? {
      qrCodeId: row.qr_code_id,
      businessId: row.business_id,
      locationId: row.location_id,
      businessName: row.business_name ?? undefined,
      locationName: row.location_name ?? undefined,
      destinationUrl: row.destination_url,
    } : null;
  }

  async recordPublicQrScan(input: PublicQrScanInput) {
    const result = await this.ingress().query(
      "select * from app_private.record_qr_scan($1,$2,$3,$4,$5,$6)",
      [
        input.publicToken,
        input.anonymousVisitorHash,
        input.placementKey ?? null,
        input.referrerHost ?? null,
        input.deviceFamily ?? null,
        input.countryCode ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("QR review flow is unavailable.");
    return { scanId: row.scan_event_id, destinationUrl: row.destination_url };
  }

  async markPublicQrContinue(scanId: string) {
    await this.ingress().query("select app_private.mark_qr_provider_continue($1)", [scanId]);
  }

  async recordTwilioStatusWebhook(input: {
    eventId: string;
    providerMessageId: string;
    status: string;
    errorCode?: string;
    occurredAt: Date;
    rawBody: Buffer;
  }) {
    const evidence = webhookEvidence(input.rawBody.toString("base64"), input.rawBody, this.config.FIELD_ENCRYPTION_KEY, `webhook:twilio:${input.eventId}`);
    await this.ingress().query(
      "select * from app_private.record_message_provider_webhook($1,$2,$3,$4,$5,$6)",
      ["twilio", input.eventId, input.providerMessageId, input.status, evidence.payloadHash, evidence.encryptedPayload],
    );
  }

  async recordStripeBillingWebhook(input: StripeBillingWebhookInput) {
    const evidence = webhookEvidence(
      input.rawBody.toString("base64"),
      input.rawBody,
      this.config.FIELD_ENCRYPTION_KEY,
      `webhook:stripe:${input.eventId}`,
    );
    const result = await this.ingress().query(
      "select * from app_private.apply_stripe_billing_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
      [
        input.eventId,
        input.eventType,
        input.eventCreatedAt,
        input.apiVersion ?? null,
        input.livemode,
        input.businessId,
        input.attemptId ?? null,
        input.checkoutSessionId ?? null,
        input.customerId ?? null,
        input.subscriptionId ?? null,
        input.checkoutState ?? null,
        input.setupPaid ?? false,
        input.subscriptionState ?? null,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        evidence.payloadHash,
        evidence.encryptedPayload,
      ],
    );
    return { duplicate: Boolean(result.rows[0]?.duplicate) };
  }

  async purgeExpiredStripeWebhookPayloads(limit: number) {
    const result = await this.worker().query(
      "select app_private.purge_expired_stripe_webhook_payloads($1) as purged",
      [limit],
    );
    return Number(result.rows[0]?.purged ?? 0);
  }

  async recordTwilioSuppressionWebhook(input: {
    integrationId: string;
    eventId: string;
    destination: string;
    action: "suppress" | "lift";
    keyword: string;
    providerMessageId?: string;
    receivingAddress?: string;
    messagingServiceSid?: string;
    occurredAt: Date;
    rawBody: Buffer;
  }) {
    const evidence = webhookEvidence(
      input.rawBody.toString("base64"),
      input.rawBody,
      this.config.FIELD_ENCRYPTION_KEY,
      `webhook:twilio:${input.eventId}`,
    );
    await this.ingress().query(
      "select * from app_private.record_integration_suppression_webhook($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        "twilio", input.eventId, input.integrationId, "sms",
        hashDestination(input.destination, this.config.SESSION_PEPPER), 1,
        `inbound_${input.keyword.toLowerCase()}`, input.action,
        input.keyword, evidence.payloadHash, evidence.encryptedPayload,
      ],
    );
  }

  async recordSendGridWebhookEvents(events: Array<{
    eventId: string;
    providerMessageId?: string;
    attemptId?: string;
    event: string;
    occurredAt: Date;
    email?: string;
    reason?: string;
    response?: string;
  }>, rawBody: Buffer) {
    const suppressionEvents = new Set(["bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"]);
    for (const event of events) {
      const eventType = event.event.toLowerCase();
      const action = eventType === "group_resubscribe" ? "lift" : suppressionEvents.has(eventType) ? "suppress" : undefined;
      const evidence = webhookEvidence(
        { ...event, email: event.email ? "[redacted]" : undefined },
        rawBody,
        this.config.FIELD_ENCRYPTION_KEY,
        `webhook:sendgrid:${event.eventId}`,
      );
      if (!event.attemptId && !event.providerMessageId) {
        throw new Error("SendGrid event has no Review Anchor attempt or provider message identity.");
      }
      if (action) {
        const sql = event.attemptId
          ? "select * from app_private.record_message_suppression_webhook_by_attempt($1,$2,$3,$4,$5,$6,$7,$8)"
          : "select * from app_private.record_message_suppression_webhook($1,$2,$3,$4,$5,$6,$7,$8)";
        await this.ingress().query(sql, [
          "sendgrid", event.eventId, event.attemptId ?? event.providerMessageId,
          eventType, action, event.reason ?? event.response ?? eventType,
          evidence.payloadHash, evidence.encryptedPayload,
        ]);
      } else {
        const sql = event.attemptId
          ? "select * from app_private.record_message_provider_webhook_by_attempt($1,$2,$3,$4,$5,$6)"
          : "select * from app_private.record_message_provider_webhook($1,$2,$3,$4,$5,$6)";
        await this.ingress().query(sql, [
          "sendgrid", event.eventId, event.attemptId ?? event.providerMessageId,
          eventType, evidence.payloadHash, evidence.encryptedPayload,
        ]);
      }
    }
  }

  async recordGoogleReviewNotification(input: {
    eventId: string;
    subscription?: string;
    publishedAt?: Date;
    attributes: Record<string, string>;
    notification: unknown;
    rawBody: Buffer;
  }) {
    const notification = input.notification && typeof input.notification === "object"
      ? input.notification as Record<string, unknown>
      : {};
    const eventType = String(
      input.attributes.notificationType ?? notification.notificationType ?? notification.type ?? "",
    ).toUpperCase();
    const resource = String(
      input.attributes.locationName ?? notification.locationName ?? notification.reviewName ?? "",
    );
    const locationName = resource.match(/(?:^|\/)locations\/[^/]+/)?.[0]?.replace(/^\//, "");
    if (!locationName || !["NEW_REVIEW", "UPDATED_REVIEW"].includes(eventType)) {
      throw new Error("Google review notification has no supported type or location identity.");
    }
    const evidence = webhookEvidence(input.rawBody.toString("base64"), input.rawBody, this.config.FIELD_ENCRYPTION_KEY, `webhook:google:${input.eventId}`);
    await this.ingress().query(
      "select * from app_private.record_google_pubsub_event($1,$2,$3,$4,$5)",
      [input.eventId, locationName, eventType, evidence.payloadHash, evidence.encryptedPayload],
    );
  }
}
