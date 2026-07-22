export interface TransactionalEmailProvider { sendAccountVerification(input: { to: string; displayName: string; verificationUrl: string; expiresAt: Date }): Promise<void>; }

export function createTransactionalEmailProvider(config: { SENDGRID_API_KEY?: string; SENDGRID_FROM_EMAIL?: string }): TransactionalEmailProvider {
  return { async sendAccountVerification(input) {
    if (!config.SENDGRID_API_KEY || !config.SENDGRID_FROM_EMAIL) return;
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", { method: "POST", headers: { authorization: `Bearer ${config.SENDGRID_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ personalizations: [{ to: [{ email: input.to }] }], from: { email: config.SENDGRID_FROM_EMAIL }, subject: "Verify your Review Anchor account", content: [{ type: "text/plain", value: `Hello ${input.displayName},\n\nVerify your account: ${input.verificationUrl}\n\nThis security link expires at ${input.expiresAt.toISOString()}.` }] }) });
    if (!response.ok) throw new Error(`Transactional verification email was rejected (${response.status}).`);
  } };
}
