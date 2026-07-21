import { useEffect, useState } from "react";
import { platformApi, type AgencyClientLocation } from "../../platform/api";

export function ClientLocationSelector({ claimToken, onSelect }: { claimToken?: string; onSelect: (scope: AgencyClientLocation) => void }) {
  const [scopes, setScopes] = useState<AgencyClientLocation[]>([]);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState<AgencyClientLocation>();
  const token = claimToken ?? new URLSearchParams(window.location.search).get("claim") ?? "";
  useEffect(() => { if (!token) { setError("This client claim is unavailable."); return; } void platformApi.consumeAgencyClientAccessClaim(token).then(() => platformApi.listAgencyClientAccessLocations(token)).then(setScopes).catch((caught) => setError(caught instanceof Error ? caught.message : "This client claim is unavailable.")); }, [token]);
  if (error) return <p role="alert">{error}</p>;
  return <section><label>Approved location<select value={selected} onChange={(event) => { const scope = scopes.find((candidate) => candidate.locationId === event.target.value); if (scope) { setSelected(scope.locationId); setPending(scope); } }}><option value="" disabled>Select a client-approved location</option>{scopes.map((scope) => <option key={scope.locationId} value={scope.locationId}>{scope.businessName} — {scope.locationName}</option>)}</select></label>{pending && <div><h2>Confirm agency permissions</h2><p>{pending.businessName} — {pending.locationName}</p><ul>{pending.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul><button type="button" onClick={() => void platformApi.selectAgencyClientAccessLocation(token,pending.locationId).then(() => { const url = new URL(window.location.href); url.searchParams.set("location", pending.locationId); window.history.replaceState(null, "", url); onSelect(pending); }).catch((caught) => setError(caught instanceof Error ? caught.message : "The grant could not be activated."))}>Confirm agency access</button></div>}</section>;
}
