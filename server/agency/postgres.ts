import type { Pool } from "pg";
import { withActorTransaction } from "../db.js";
import type { ActorContext } from "../types.js";
import type { AgencyGrant, AgencyGrantPermission, AgencyGrantRequest } from "./types.js";

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
  private async transition(actor: ActorContext, command: "accept_agency_client_grant" | "reject_agency_client_grant" | "revoke_agency_client_grant", grantId: string, correlationId: string) {
    return withActorTransaction(this.runtimePool, actor, async (client) => grant((await client.query(`select * from app_private.${command}($1,$2)`, [grantId, correlationId])).rows[0] as Record<string, unknown>));
  }
}
