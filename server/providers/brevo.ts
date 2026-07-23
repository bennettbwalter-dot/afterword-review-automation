import type { AppConfig } from "../config.js";
import {
  renderAccountVerificationEmail,
  TransactionalEmailDeliveryError,
  type AccountVerificationEmail,
  type TransactionalEmailAvailability,
  type TransactionalEmailProvider,
} from "../onboarding/signup-email.js";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createBrevoTransactionalEmailProvider(
  config: Pick<AppConfig, "SIGNUP_EMAIL_ENABLED" | "TRANSACTIONAL_EMAIL_PROVIDER" | "BREVO_API_KEY" | "BREVO_ACCOUNT_SENDER_EMAIL" | "BREVO_ACCOUNT_SENDER_NAME">,
  request: Fetch = fetch,
): TransactionalEmailProvider {
  const availability = (): TransactionalEmailAvailability => {
    if (!config.SIGNUP_EMAIL_ENABLED) return { available: false, reason: "disabled" };
    if (config.TRANSACTIONAL_EMAIL_PROVIDER !== "brevo"
      || !config.BREVO_API_KEY
      || !config.BREVO_ACCOUNT_SENDER_EMAIL
      || !config.BREVO_ACCOUNT_SENDER_NAME) {
      return { available: false, reason: "incomplete_configuration" };
    }
    return { available: true };
  };

  return {
    availability,
    async sendAccountVerification(input: AccountVerificationEmail) {
      const status = availability();
      if (!status.available) throw new TransactionalEmailDeliveryError("invalid_response");
      const apiKey = config.BREVO_API_KEY!;
      const senderEmail = config.BREVO_ACCOUNT_SENDER_EMAIL!;
      const senderName = config.BREVO_ACCOUNT_SENDER_NAME!;
      const rendered = renderAccountVerificationEmail(input);
      const timeout = AbortSignal.timeout(8_000);
      let response: Response;
      try {
        response = await request("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          signal: timeout,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            sender: { email: senderEmail, name: senderName },
            to: [{ email: input.to }],
            subject: rendered.subject,
            htmlContent: rendered.html,
            textContent: rendered.text,
          }),
        });
      } catch (error) {
        if (timeout.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
          throw new TransactionalEmailDeliveryError("timeout");
        }
        throw new TransactionalEmailDeliveryError("rejected");
      }
      if (!response.ok) throw new TransactionalEmailDeliveryError("rejected");
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new TransactionalEmailDeliveryError("invalid_response");
      }
      if (!body || typeof body !== "object" || typeof (body as { messageId?: unknown }).messageId !== "string" || !(body as { messageId: string }).messageId) {
        throw new TransactionalEmailDeliveryError("invalid_response");
      }
      return { providerMessageId: (body as { messageId: string }).messageId };
    },
  };
}
