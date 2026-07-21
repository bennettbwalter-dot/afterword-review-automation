import { useState } from "react";
import { platformApi } from "../../platform/api";
import type { AgencyGrantPermission } from "../../platform/domain";

const permissionOptions: Array<{ value: AgencyGrantPermission; label: string }> = [
  { value: "content.create", label: "Create content" }, { value: "content.submit", label: "Submit content" },
  { value: "content.approve", label: "Approve content" }, { value: "content.schedule", label: "Schedule content" },
  { value: "content.publish", label: "Publish content" }, { value: "video.spend", label: "Spend video budget" },
];
export function AgencyGrantDialog({ agencyId, onIssued }: { agencyId: string; onIssued?: (claimUrl: string) => void }) {
  const [email, setEmail] = useState("");
  const [claimUrl, setClaimUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [permissions, setPermissions] = useState<AgencyGrantPermission[]>(["content.create"]);
  const [reviewing, setReviewing] = useState(false);
  async function issue() {
    setError(undefined);
    try { const result = await platformApi.issueAgencyClientAccessClaim(agencyId, email, permissions); setClaimUrl(result); onIssued?.(result); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The client claim could not be created."); }
  }
  return <section aria-label="Client approval claim"><label>Client owner email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><fieldset><legend>Requested permissions</legend>{permissionOptions.map((option) => <label key={option.value}><input type="checkbox" checked={permissions.includes(option.value)} onChange={() => setPermissions((current) => current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value])} />{option.label}</label>)}</fieldset>{reviewing ? <div><strong>Review requested permissions</strong><p>{permissions.join(", ")}</p><button type="button" disabled={!email || permissions.length === 0} onClick={() => void issue()}>Confirm and create client approval link</button><button type="button" onClick={() => setReviewing(false)}>Back</button></div> : <button type="button" disabled={!email || permissions.length === 0} onClick={() => setReviewing(true)}>Review requested permissions</button>}{claimUrl && <output aria-live="polite">{claimUrl}</output>}{error && <p role="alert">{error}</p>}</section>;
}
