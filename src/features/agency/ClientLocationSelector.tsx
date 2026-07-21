import { useEffect, useState } from "react";
import { platformApi, type AgencyGrantClaimScope } from "../../platform/api";

export function ClientLocationSelector({ claimToken, onSelect }: { claimToken?: string; onSelect: (scope: AgencyGrantClaimScope) => void }) {
  const [scopes, setScopes] = useState<AgencyGrantClaimScope[]>([]);
  const [error, setError] = useState<string>();
  const token = claimToken ?? new URLSearchParams(window.location.search).get("claim") ?? "";
  useEffect(() => { if (!token) { setError("This client claim is unavailable."); return; } void platformApi.listAgencyGrantClaimLocations(token).then(setScopes).catch((caught) => setError(caught instanceof Error ? caught.message : "This client claim is unavailable.")); }, [token]);
  if (error) return <p role="alert">{error}</p>;
  const selected = new URLSearchParams(window.location.search).get("location") ?? "";
  return <label>Approved location<select value={selected} onChange={(event) => { const scope = scopes.find((candidate) => candidate.locationId === event.target.value); if (scope) { const url = new URL(window.location.href); url.searchParams.set("location", scope.locationId); window.history.replaceState(null, "", url); onSelect(scope); } }}><option value="" disabled>Select a client-approved location</option>{scopes.map((scope) => <option key={scope.locationId} value={scope.locationId}>{scope.locationId}</option>)}</select></label>;
}
