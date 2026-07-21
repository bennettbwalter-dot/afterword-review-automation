import { useEffect, useState } from "react";
import { platformApi } from "../../platform/api";
import type { OnboardingAccountType } from "./onboarding-domain";

export function VerifyEmailView({ token, onVerified }: { token: string | null; onVerified: (type: OnboardingAccountType) => void }) {
  const [error, setError] = useState(""); useEffect(() => { if (!token) { setError("This verification link is incomplete."); return; } void platformApi.verifySignup(token).then((result) => onVerified(result.accountType)).catch((cause) => setError(cause instanceof Error ? cause.message : "Verification failed.")); }, [token, onVerified]);
  return <main className="workspace-auth-shell"><section className="workspace-auth-card"><h1>{error ? "Verification unavailable" : "Verifying your email…"}</h1><p role={error ? "alert" : "status"}>{error || "Please keep this window open."}</p></section></main>;
}
