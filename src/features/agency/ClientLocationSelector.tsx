import { useEffect, useState } from "react";
import { platformApi, type AgencyClientLocation } from "../../platform/api";

export function ClientLocationSelector({ claimToken, onSelect }: { claimToken?: string; onSelect: (scope: AgencyClientLocation) => void }) {
  const [scopes, setScopes] = useState<AgencyClientLocation[]>([]);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState("");
  const token = claimToken ?? new URLSearchParams(window.location.search).get("claim") ?? "";
  useEffect(() => { if (!token) { setError("This client claim is unavailable."); return; } void platformApi.consumeAgencyClientAccessClaim(token).then(() => platformApi.listAgencyClientAccessLocations(token)).then(setScopes).catch((caught) => setError(caught instanceof Error ? caught.message : "This client claim is unavailable.")); }, [token]);
  if (error) return <p role="alert">{error}</p>;
  return <label>Approved location<select value={selected} onChange={(event) => { const scope = scopes.find((candidate) => candidate.locationId === event.target.value); if (scope) { void platformApi.selectAgencyClientAccessLocation(token,scope.locationId).then(() => { const url = new URL(window.location.href); url.searchParams.set("location", scope.locationId); window.history.replaceState(null, "", url); setSelected(scope.locationId); onSelect(scope); }).catch((caught) => setError(caught instanceof Error ? caught.message : "The grant could not be requested.")); } }}><option value="" disabled>Select a client-approved location</option>{scopes.map((scope) => <option key={scope.locationId} value={scope.locationId}>{scope.businessName} — {scope.locationName}</option>)}</select></label>;
}
