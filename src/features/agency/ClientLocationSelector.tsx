import { useEffect, useState } from "react";
import { platformApi, type AgencyClientLocation } from "../../platform/api";

export function ClientLocationSelector({ claimToken, onSelect }: { claimToken?: string; onSelect: (scope: AgencyClientLocation) => void }) {
  const [scopes, setScopes] = useState<AgencyClientLocation[]>([]);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState<AgencyClientLocation>();
  const [activeGrant, setActiveGrant] = useState<{ id: string; businessId: string }>();
  const token = claimToken ?? new URLSearchParams(window.location.search).get("claim") ?? "";
  useEffect(() => { if (!token) { setError("This client claim is unavailable."); return; } void platformApi.consumeAgencyClientAccessClaim(token).then(() => platformApi.listAgencyClientAccessLocations(token)).then(setScopes).catch((caught) => setError(caught instanceof Error ? caught.message : "This client claim is unavailable.")); }, [token]);
  useEffect(() => { if (scopes.length === 1) { setSelected(scopes[0]!.locationId); setPending(scopes[0]!); } }, [scopes]);
  if (error) return <p role="alert">{error}</p>;
  const revoke = async () => {
    if (!activeGrant) return;
    try { await platformApi.revokeAgencyGrantAsCurrentClient(activeGrant.id, activeGrant.businessId); setActiveGrant(undefined); setPending(undefined); setError("Agency access was revoked."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The grant could not be revoked."); }
  };
  return <section><label>Approved location<select value={selected} disabled={scopes.length === 1 || Boolean(activeGrant)} onChange={(event) => { const scope = scopes.find((candidate) => candidate.locationId === event.target.value); if (scope) { setSelected(scope.locationId); setPending(scope); } }}><option value="" disabled>Select a client-approved location</option>{scopes.map((scope) => <option key={scope.locationId} value={scope.locationId}>{scope.businessName} — {scope.locationName}</option>)}</select></label>{pending && !activeGrant && <div><h2>Confirm agency permissions</h2><p>{pending.businessName} — {pending.locationName}</p><ul>{pending.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul><button type="button" onClick={() => void platformApi.selectAgencyClientAccessLocation(token, pending.locationId).then((grant) => setActiveGrant({ id: grant.id, businessId: grant.businessId })).catch((caught) => setError(caught instanceof Error ? caught.message : "The grant could not be activated."))}>Confirm agency access</button></div>}{activeGrant && <div><p role="status">Agency access is active for this location.</p><button type="button" onClick={() => void revoke()}>Revoke agency access</button><button type="button" onClick={() => onSelect(pending ?? scopes.find((scope) => scope.locationId === selected)!)}>Continue to workspace</button></div>}</section>;
}
