export type TransactionalEmailAvailability =
  | { available: true }
  | { available: false; reason: "disabled" | "incomplete_configuration" };

export interface AccountVerificationEmail {
  to: string;
  displayName: string;
  verificationUrl: string;
  expiresAt: Date;
}

export interface TransactionalEmailProvider {
  availability(): TransactionalEmailAvailability;
  sendAccountVerification(input: AccountVerificationEmail): Promise<{ providerMessageId: string }>;
}

export class TransactionalEmailDeliveryError extends Error {
  constructor(public readonly kind: "timeout" | "rejected" | "invalid_response") {
    super("Transactional email delivery failed.");
    this.name = "TransactionalEmailDeliveryError";
  }
}

export interface RenderedAccountVerificationEmail {
  version: "account-verification-v1";
  subject: "Verify your Review Anchor account";
  html: string;
  text: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function renderAccountVerificationEmail(
  input: Pick<AccountVerificationEmail, "displayName" | "verificationUrl" | "expiresAt">,
): RenderedAccountVerificationEmail {
  const expiresAt = input.expiresAt.toISOString();
  const displayName = escapeHtml(input.displayName);
  const verificationUrl = escapeHtml(input.verificationUrl);
  return {
    version: "account-verification-v1",
    subject: "Verify your Review Anchor account",
    html: `<!doctype html><html lang="en"><body><p>Hello ${displayName},</p><p>Verify your Review Anchor account to continue.</p><p><a href="${verificationUrl}">Verify your account</a></p><p>This security link expires at ${expiresAt}.</p></body></html>`,
    text: `Hello ${input.displayName},\n\nVerify your Review Anchor account to continue:\n${input.verificationUrl}\n\nThis security link expires at ${expiresAt}.`,
  };
}
