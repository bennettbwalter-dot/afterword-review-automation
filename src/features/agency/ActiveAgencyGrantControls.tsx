import { useEffect, useState } from "react";
import { platformApi } from "../../platform/api";
import type { AgencyGrantPermission } from "../../platform/domain";

interface ActiveGrant {
  id: string;
  businessId: string;
  locationId: string;
  permissions: AgencyGrantPermission[];
  expiresAt?: string;
}

export function ActiveAgencyGrantControls({ agencyId, canRevoke }: { agencyId: string; canRevoke: boolean }) {
  const [grants, setGrants] = useState<ActiveGrant[]>([]);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("agencyGrant") ?? "");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError(undefined);
    try {
      const active = await platformApi.listActiveAgencyClientGrants(agencyId);
      setGrants(active); setSelectedId((current) => {
        const next = active.some((grant) => grant.id === current) ? current : active[0]?.id ?? "";
        const url = new URL(window.location.href); if (next) url.searchParams.set("agencyGrant", next); else url.searchParams.delete("agencyGrant"); window.history.replaceState(null, "", url);
        return next;
      });
    } catch (caught) { setGrants([]); setSelectedId(""); setError(caught instanceof Error ? caught.message : "Unable to load active client access."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [agencyId]);
  const selected = grants.find((grant) => grant.id === selectedId);
  const revoke = async () => {
    if (!selected || !window.confirm("Revoke this agency access now? The agency will immediately lose this location scope.")) return;
    try { await platformApi.revokeAgencyGrantInCurrentAgency(selected.id, agencyId); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to revoke client access."); }
  };
  return <section className="panel agency-grant-controls" aria-label="Active client access">
    <header className="panel__head"><div><h2>Active client access</h2><p>Select an approved client location or revoke its agency scope.</p></div></header>
    {loading ? <p>Loading approved client access…</p> : grants.length === 0 ? <p>No active client-approved locations.</p> : <div className="agency-grant-controls__body">
      <label>Client location<select value={selectedId} onChange={(event) => { const next = event.target.value; setSelectedId(next); const url = new URL(window.location.href); url.searchParams.set("agencyGrant", next); window.history.replaceState(null, "", url); }}>{grants.map((grant) => <option key={grant.id} value={grant.id}>{grant.businessId} · {grant.locationId}</option>)}</select></label>
      {selected && <><p><strong>Permissions:</strong> {selected.permissions.join(", ")}</p>{selected.expiresAt && <p><strong>Expires:</strong> {new Date(selected.expiresAt).toLocaleString()}</p>}{canRevoke && <button type="button" className="button button--danger" onClick={() => void revoke()}>Revoke access</button>}</>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
