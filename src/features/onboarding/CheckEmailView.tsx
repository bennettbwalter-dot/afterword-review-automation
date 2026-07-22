export function CheckEmailView({ email }: { email: string | null }) {
  return <main className="workspace-auth-shell"><section className="workspace-auth-card"><span className="eyebrow">Check your inbox</span><h1>Verify your email to continue.</h1><p>We sent a short-lived verification link{email ? ` to ${email}` : ""}. For security, the link can be used once.</p></section></main>;
}
