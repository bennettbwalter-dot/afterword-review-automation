import { useState } from "react";
import { platformApi } from "../../platform/api";

export function AgencyGrantDialog({ grantId, onIssued }: { grantId: string; onIssued?: (claimUrl: string) => void }) {
  const [email, setEmail] = useState("");
  const [claimUrl, setClaimUrl] = useState<string>();
  const [error, setError] = useState<string>();
  async function issue() {
    setError(undefined);
    try { const result = await platformApi.issueAgencyGrantClaim(grantId, email); setClaimUrl(result.claimUrl); onIssued?.(result.claimUrl); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The client claim could not be created."); }
  }
  return <section aria-label="Client approval claim"><label>Client owner email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="button" disabled={!email} onClick={() => void issue()}>Create client approval link</button>{claimUrl && <output aria-live="polite">{claimUrl}</output>}{error && <p role="alert">{error}</p>}</section>;
}
