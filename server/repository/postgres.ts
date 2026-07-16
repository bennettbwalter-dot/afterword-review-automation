import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { inTransaction, setActorContext } from "../db.js";
import { decryptField, encryptField, hashDestination } from "../security/crypto.js";
import type {
  ActorContext,
  AuthCredential,
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
  PublicQrScanInput,
  PublicReviewFlow,
  StartSupportSessionInput,
  WorkspacePayload,
} from "../types.js";

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

function googleIntegrationState(health: unknown) {
  const value = String(health ?? "");
  if (value === "connected" || value === "healthy") return { status: "Connected", tone: "success" as const };
  if (value === "delayed" || value === "rate_limited") return { status: "Sync delayed", tone: "warning" as const };
  if (value === "authentication_required" || value === "permission_revoked") return { status: "Reconnect required", tone: "danger" as const };
  if (value === "provider_unavailable" || value === "failing") return { status: "Sync failing", tone: "danger" as const };
  if (value === "disabled") return { status: "Disconnected", tone: "muted" as const };
  return { status: "Configuration required", tone: "warning" as const };
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
    const result = await this.auth().query("select * from app_private.resolve_auth_session($1)", [tokenHash]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      userName: row.display_name,
      email: row.email,
      role: row.platform_role,
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

  async getWorkspace(actor: ActorContext, selectedBusinessId?: string): Promise<WorkspacePayload> {
    return this.asActor(actor, async (client) => {
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
          coalesce(exception_stats.affected_count, 0) as affected_count
        from public.businesses business
        left join lateral (
          select candidate.* from public.locations candidate
          where candidate.business_id = business.id and candidate.status <> 'archived'
          order by candidate.created_at limit 1
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
          from public.completed_jobs completed_job where completed_job.business_id = business.id
        ) job_stats on true
        left join lateral (
          select count(*) filter (where outbox.status = 'accepted')::integer as delivered,
            max(outbox.accepted_at) filter (where outbox.status = 'accepted') as last_accepted_at
          from public.message_outbox outbox where outbox.business_id = business.id
        ) delivery_stats on true
        left join lateral (
          select count(distinct scan.anonymous_visitor_hash) filter (where scan.continued_to_provider_at is not null)::integer as unique_clicks
          from public.qr_scan_events scan where scan.business_id = business.id
        ) qr_stats on true
        left join lateral (
          select count(*)::integer as reviews_detected, avg(review.rating)::numeric(4,2) as rating
          from public.review_records review
          where review.business_id = business.id and review.cache_expires_at > statement_timestamp()
        ) review_stats on true
        left join lateral (
          select (
            count(*) filter (where request.status in ('blocked', 'failed'))
            + (select count(*) from public.message_outbox outbox where outbox.business_id = business.id and outbox.status in ('unknown', 'failed'))
          )::integer as affected_count
          from public.review_requests request where request.business_id = business.id
        ) exception_stats on true
        order by business.name
      `);
      const requestedBusinessId = selectedBusinessId ?? actor.businessId ?? businessesResult.rows[0]?.id;
      const requestsByBusiness: Record<string, unknown[]> = {};
      const reviewsByBusiness: Record<string, unknown[]> = {};
      const qrCodesByBusiness: Record<string, unknown> = {};

      if (requestedBusinessId) {
        const requests = await client.query(`
          select request.id, request.business_id,
            job.service_label, request.channel, request.status, request.created_at,
            consent.source as consent_basis, consent.status as consent_status,
            consent.transaction_reference, consent.captured_at, consent.wording_version
          from public.review_requests request
          join public.completed_jobs job on job.business_id = request.business_id and job.id = request.completed_job_id
          join public.customer_contacts contact on contact.business_id = request.business_id and contact.id = request.customer_id
          join public.consent_records consent on consent.business_id = request.business_id and consent.id = request.consent_record_id
          where request.business_id = $1
          order by request.created_at desc limit 100
        `, [requestedBusinessId]);
        requestsByBusiness[requestedBusinessId] = requests.rows.map((row) => ({
          id: row.id,
          businessId: row.business_id,
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
          select id, business_id, reviewer_display_name, rating, provider_created_at,
            body, reply_body from public.review_records
          where business_id = $1 and cache_expires_at > statement_timestamp()
          order by provider_created_at desc limit 100
        `, [requestedBusinessId]);
        reviewsByBusiness[requestedBusinessId] = reviews.rows.map((row) => ({
          id: row.id,
          businessId: row.business_id,
          name: row.reviewer_display_name,
          rating: row.rating,
          date: displayTime(row.provider_created_at),
          body: row.body,
          replied: Boolean(row.reply_body),
        }));

        const qr = await client.query(`
          select code.business_id, code.public_token, code.artwork_revision,
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
          where code.business_id = $1 and code.status = 'active'
          group by code.business_id, code.public_token, code.artwork_revision,
            code.artwork_generated_at, destination.destination_url, destination.verified_at
        `, [requestedBusinessId]);
        if (qr.rows[0]) {
          const row = qr.rows[0];
          qrCodesByBusiness[requestedBusinessId] = {
            businessId: row.business_id,
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
      }

      const businessRows: WorkspacePayload["businesses"] = businessesResult.rows.map((row) => {
        const google = googleIntegrationState(row.google_health);
        const operational = row.lifecycle_status === "active"
          && Boolean(row.location_id)
          && Boolean(row.messaging_ready)
          && ["connected", "healthy"].includes(String(row.google_health ?? ""));
        const lastActivity = row.google_last_sync_at ?? row.last_accepted_at ?? row.google_last_event_at;
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
        plan: "Professional" as const,
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
        teamMembers: [],
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
        businessId: actor.businessId,
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

  async startSupportSession(actor: ActorContext, input: StartSupportSessionInput) {
    return this.asActor(actor, async (client) => {
      const result = await client.query(
        "select app_private.start_support_session($1,$2,$3,$4,$5) as id",
        [input.businessId, input.scope, input.reason, input.durationMinutes, randomUUID()],
      );
      return String(result.rows[0].id);
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
          order by candidate.version desc limit 1
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

  async finishMessageAttempt(input: FinishMessageAttemptInput) {
    await this.worker().query("select app_private.finish_message_attempt($1,$2,$3,$4,$5,$6,$7)", [
      input.messageAttemptId, input.workerId, input.leaseToken, input.result,
      input.providerMessageId ?? null, input.responseCode ?? null, input.errorCode ?? null,
    ]);
  }

  async deferMessageJob(jobId: string, workerId: string, leaseToken: string, runAt: Date, reason: string) {
    await this.worker().query("select app_private.defer_message_job($1,$2,$3,$4,$5)", [jobId, workerId, leaseToken, runAt, reason]);
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
        throw new Error("SendGrid event has no Afterword attempt or provider message identity.");
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
