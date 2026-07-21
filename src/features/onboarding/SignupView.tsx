import { useState, type FormEvent } from "react";
import { platformApi } from "../../platform/api";
import type { OnboardingAccountType } from "./onboarding-domain";

export function SignupView({ onSubmitted }: { onSubmitted: (email: string) => void }) {
  const [accountType, setAccountType] = useState<OnboardingAccountType>("business"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(""); try { await platformApi.startSignup(String(data.get("email")), String(data.get("displayName")), accountType); onSubmitted(String(data.get("email"))); } catch (cause) { setError(cause instanceof Error ? cause.message : "Signup could not be started."); } finally { setBusy(false); } }
  return <main className="workspace-auth-shell"><section className="workspace-auth-card"><span className="eyebrow">Get started</span><h1>Set up your Review Anchor account.</h1><p>Choose the workspace that matches how you manage reviews.</p><form onSubmit={submit}><label>Work email<input required type="email" name="email" autoComplete="email" /></label><label>Your name<input required name="displayName" autoComplete="name" /></label><fieldset><legend>Account type</legend><label><input type="radio" checked={accountType === "business"} onChange={() => setAccountType("business")} /> Direct business</label><label><input type="radio" checked={accountType === "agency"} onChange={() => setAccountType("agency")} /> Agency</label></fieldset>{error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "Sending…" : "Send verification link"}</button></form></section></main>;
}
