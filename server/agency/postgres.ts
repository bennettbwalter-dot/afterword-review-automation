import type { Pool } from "pg";
import { withActorTransaction } from "../db.js";
import type { ActorContext } from "../types.js";
import type { AgencyClientClaimLocation, AgencyGrant, AgencyGrantClaimScope, AgencyGrantPermission, AgencyGrantRequest } from "./types.js";

function grant(row: Record<string, unknown>): AgencyGrant {
  return {
    id: String(row.id), agencyId: String(row.agency_id), businessId: String(row.business_id), locationId: String(row.location_id),
    status: row.status as AgencyGrant["status"], permissions: row.permissions as AgencyGrantPermission[],
    selfApproverUserId: row.self_approver_user_id ? String(row.self_approver_user_id) : undefined,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : undefined,
    videoSoftMonthlyCap: row.video_soft_monthly_cap === null ? undefined : Number(row.video_soft_monthly_cap),
    videoHardMonthlyCap: row.video_hard_monthly_cap === null ? undefined : Number(row.video_hard_monthly_cap),
  };
}

function claimScope(row: Record<string, unknown>): AgencyGrantClaimScope {
  return { grantId: String(row.grant_id), businessId: String(row.business_id), locationId: String(row.location_id), status: row.status as AgencyGrantClaimScope["status"], permissions: row.permissions as AgencyGrantPermission[], expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : undefined };
}

export class AgencyGrantPostgres {
  constructor(private readonly runtimePool: Pool) {}
  async request(actor: ActorContext, input: AgencyGrantRequest) {
    return withActorTransaction(this.runtimePool, actor, async (client) => {
      const result = await client.query("select * from app_private.request_agency_client_grant($1,$2,$3,$4,$5,$6,$7,$8,$9)", [input.agencyId, input.businessId, input.locationId, input.permissions, input.selfApproverUserId ?? null, input.videoSoftMonthlyCap ?? null, input.videoHardMonthlyCap ?? null, input.expiresAt ?? null, input.correlationId]);
      return grant(result.rows[0] as Record<string, unknown>);
    });
  }
  async accept(actor: ActorContext, grantId: string, correlationId: string) { return this.transition(actor, "accept_agency_client_grant", grantId, correlationId); }
  async reject(actor: ActorContext, grantId: string, correlationId: string) { return this.transition(actor, "reject_agency_client_grant", grantId, correlationId); }
  async revoke(actor: ActorContext, grantId: string, correlationId: string) { return this.transition(actor, "revoke_agency_client_grant", grantId, correlationId); }
  async revokeInAgency(actor: ActorContext, grantId: string, agencyId: string, correlationId: string) {
    return withActorTransaction(this.runtimePool, actor, async (client) => grant((await client.query("select * from app_private.revoke_current_agency_client_grant($1,$2,$3)", [grantId, agencyId, correlationId])).rows[0] as Record<string, unknown>));
  }
  async revokeAsClient(actor: ActorContext, grantId: string, businessId: string, correlationId: string) {
    return withActorTransaction(this.runtimePool, actor, async (client) => grant((await client.query("select * from app_private.revoke_current_client_agency_grant($1,$2,$3)", [grantId, businessId, correlationId])).rows[0] as Record<string, unknown>));
  }
  async listActive(actor: ActorContext, agencyId: string): Promise<AgencyGrant[]> {
    return withActorTransaction(this.runtimePool, actor, async (client) =>
      (await client.query("select * from app_private.list_active_agency_client_grants($1)", [agencyId])).rows.map((row) => grant({ ...row, agency_id: agencyId, status: "active" } as Record<string, unknown>)),
    );
  }
  async issueClaim(actor: ActorContext, grantId: string, email: string, tokenHash: Buffer, expiresAt: Date, correlationId: string) {
    await withActorTransaction(this.runtimePool, actor, (client) => client.query("select app_private.issue_agency_client_grant_claim($1,$2,$3,$4,$5)", [grantId, email, tokenHash, expiresAt, correlationId]).then(() => undefined));
  }
  async consumeClaim(actor: ActorContext, tokenHash: Buffer): Promise<AgencyGrantClaimScope | null> {
    return withActorTransaction(this.runtimePool, actor, async (client) => {
      const row = (await client.query("select * from app_private.consume_agency_client_grant_claim($1)", [tokenHash])).rows[0];
      return row ? claimScope(row as Record<string, unknown>) : null;
    });
  }
  async listClaimLocations(actor: ActorContext, tokenHash: Buffer): Promise<AgencyGrantClaimScope[]> {
    return withActorTransaction(this.runtimePool, actor, async (client) => (await client.query("select * from app_private.list_agency_client_grant_claim_locations($1)", [tokenHash])).rows.map((row) => claimScope(row as Record<string, unknown>)));
  }
  async issueAccessClaim(actor: ActorContext, agencyId: string, email: string, permissions: AgencyGrantPermission[], tokenHash: Buffer, expiresAt: Date, correlationId: string) { await withActorTransaction(this.runtimePool, actor, (client) => client.query("select app_private.issue_agency_client_access_claim($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [agencyId, email, permissions, null, null, null, null, tokenHash, expiresAt, correlationId]).then(() => undefined)); }
  async consumeAccessClaim(actor: ActorContext, tokenHash: Buffer) { return withActorTransaction(this.runtimePool, actor, async (client) => Boolean((await client.query("select app_private.consume_agency_client_access_claim($1) as consumed", [tokenHash])).rows[0]?.consumed)); }
  async listAccessLocations(actor: ActorContext, tokenHash: Buffer): Promise<AgencyClientClaimLocation[]> { return withActorTransaction(this.runtimePool, actor, async (client) => (await client.query("select * from app_private.list_agency_client_claim_locations($1)", [tokenHash])).rows.map((row) => ({ businessId: String(row.business_id), businessName: String(row.business_name), locationId: String(row.location_id), locationName: String(row.location_name), permissions: row.permissions as AgencyGrantPermission[] }))); }
  async selectAccessLocation(actor: ActorContext, tokenHash: Buffer, locationId: string, correlationId: string) { return withActorTransaction(this.runtimePool, actor, async (client) => grant((await client.query("select * from app_private.select_agency_client_claim_location($1,$2,$3)", [tokenHash, locationId, correlationId])).rows[0] as Record<string, unknown>)); }
  private async transition(actor: ActorContext, command: "accept_agency_client_grant" | "reject_agency_client_grant" | "revoke_agency_client_grant", grantId: string, correlationId: string) {
    return withActorTransaction(this.runtimePool, actor, async (client) => grant((await client.query(`select * from app_private.${command}($1,$2)`, [grantId, correlationId])).rows[0] as Record<string, unknown>));
  }
}
