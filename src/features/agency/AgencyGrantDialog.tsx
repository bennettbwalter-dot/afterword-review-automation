import { useState } from "react";
import { platformApi } from "../../platform/api";
import type { AgencyGrantPermission } from "../../platform/domain";

const permissions: AgencyGrantPermission[] = ["content.create", "content.submit", "content.approve", "content.schedule"];
export function AgencyGrantDialog({ agencyId, onIssued }: { agencyId: string; onIssued?: (claimUrl: string) => void }) {
  const [email, setEmail] = useState("");
  const [claimUrl, setClaimUrl] = useState<string>();
  const [error, setError] = useState<string>();
  async function issue() {
    setError(undefined);
    try { const result = await platformApi.issueAgencyClientAccessClaim(agencyId, email, permissions); setClaimUrl(result); onIssued?.(result); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The client claim could not be created."); }
  }
  return <section aria-label="Client approval claim"><label>Client owner email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="button" disabled={!email} onClick={() => void issue()}>Create client approval link</button>{claimUrl && <output aria-live="polite">{claimUrl}</output>}{error && <p role="alert">{error}</p>}</section>;
}
