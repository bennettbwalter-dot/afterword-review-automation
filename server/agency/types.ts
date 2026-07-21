export type AgencyGrantPermission =
  | "content.create"
  | "content.submit"
  | "content.approve"
  | "content.self_approve"
  | "content.schedule"
  | "content.publish"
  | "video.spend";

export type AgencyGrantStatus = "requested" | "active" | "rejected" | "revoked";

export interface AgencyGrant {
  id: string;
  agencyId: string;
  businessId: string;
  locationId: string;
  status: AgencyGrantStatus;
  permissions: AgencyGrantPermission[];
  selfApproverUserId?: string;
  expiresAt?: string;
  videoSoftMonthlyCap?: number;
  videoHardMonthlyCap?: number;
}

export interface AgencyGrantRequest extends Omit<AgencyGrant, "id" | "status"> {
  correlationId: string;
}

export interface AgencyGrantClaimScope {
  grantId: string;
  businessId: string;
  locationId: string;
  status: Extract<AgencyGrantStatus, "requested" | "active">;
  permissions: AgencyGrantPermission[];
  expiresAt?: string;
}

export function hasAgencyGrantPermission(
  grant: AgencyGrant,
  permission: AgencyGrantPermission,
  locationId: string,
  selfApproverUserId?: string,
  now = new Date(),
) {
  return grant.status === "active"
    && grant.locationId === locationId
    && (!grant.expiresAt || new Date(grant.expiresAt) > now)
    && grant.permissions.includes(permission)
    && (permission !== "content.self_approve" || Boolean(selfApproverUserId && grant.selfApproverUserId === selfApproverUserId));
}
