import type { AppConfig } from "../config.js";

export interface DeliveryInput {
  jobId: string;
  attemptId: string;
  destination: string;
  subject?: string;
  body: string;
  idempotencyKey: string;
}

export interface DeliveryResult {
  result: "accepted" | "failed" | "unknown";
  providerMessageId?: string;
  responseCode?: string;
  errorCode?: string;
}

export interface DeliveryProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: DeliveryInput): Promise<DeliveryResult>;
}

export type DeliveryProviderMap = Partial<Record<"sms" | "email", DeliveryProvider>>;

async function providerFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    return undefined;
  }
}

async function safeResponseBody(response: Response) {
  try {
    const text = await response.text();
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export class TwilioSmsProvider implements DeliveryProvider {
  readonly name = "twilio";
  readonly accountSid?: string;
  readonly authToken?: string;
  readonly fromNumber?: string;
  readonly messagingServiceSid?: string;
  readonly statusCallbackUrl?: string;

  constructor(
    config: Pick<AppConfig, "TWILIO_ACCOUNT_SID" | "TWILIO_AUTH_TOKEN" | "TWILIO_FROM_NUMBER" | "TWILIO_MESSAGING_SERVICE_SID">,
    statusCallbackUrl?: string,
  ) {
    this.accountSid = config.TWILIO_ACCOUNT_SID;
    this.authToken = config.TWILIO_AUTH_TOKEN;
    this.fromNumber = config.TWILIO_FROM_NUMBER;
    this.messagingServiceSid = config.TWILIO_MESSAGING_SERVICE_SID;
    this.statusCallbackUrl = statusCallbackUrl;
  }

  isConfigured() {
    return Boolean(this.accountSid && this.authToken && (this.fromNumber || this.messagingServiceSid));
  }

  async send(input: DeliveryInput): Promise<DeliveryResult> {
    if (!this.accountSid || !this.authToken || (!this.fromNumber && !this.messagingServiceSid)) {
      return { result: "failed", errorCode: "TWILIO_NOT_CONFIGURED" };
    }
    const body = new URLSearchParams({ To: input.destination, Body: input.body });
    if (this.messagingServiceSid) body.set("MessagingServiceSid", this.messagingServiceSid);
    else if (this.fromNumber) body.set("From", this.fromNumber);
    if (this.statusCallbackUrl) body.set("StatusCallback", this.statusCallbackUrl);
    const response = await providerFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          "x-afterword-idempotency-key": input.idempotencyKey,
        },
        body,
      },
    );
    if (!response) return { result: "unknown", errorCode: "NETWORK_OUTCOME_UNKNOWN" };
    const responseBody = await safeResponseBody(response);
    if (!responseBody) {
      return { result: response.ok ? "unknown" : "failed", responseCode: String(response.status), errorCode: "RESPONSE_UNREADABLE" };
    }
    if (response.ok && typeof responseBody.sid === "string") {
      return { result: "accepted", providerMessageId: responseBody.sid, responseCode: String(response.status) };
    }
    const errorCode = responseBody.code === undefined ? `HTTP_${response.status}` : String(responseBody.code);
    return {
      result: response.status >= 500 ? "unknown" : "failed",
      responseCode: String(response.status),
      errorCode,
    };
  }
}

export class SendGridEmailProvider implements DeliveryProvider {
  readonly name = "sendgrid";
  readonly apiKey?: string;
  readonly fromEmail?: string;
  readonly unsubscribeGroupId?: number;

  constructor(config: Pick<AppConfig, "SENDGRID_API_KEY" | "SENDGRID_FROM_EMAIL">, unsubscribeGroupId?: number) {
    this.apiKey = config.SENDGRID_API_KEY;
    this.fromEmail = config.SENDGRID_FROM_EMAIL;
    this.unsubscribeGroupId = unsubscribeGroupId;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.fromEmail && this.unsubscribeGroupId);
  }

  async send(input: DeliveryInput): Promise<DeliveryResult> {
    if (!this.apiKey || !this.fromEmail || !this.unsubscribeGroupId) {
      return { result: "failed", errorCode: "SENDGRID_NOT_CONFIGURED" };
    }
    if (!input.body.includes("{{unsubscribe_link}}")) {
      return { result: "failed", errorCode: "EMAIL_UNSUBSCRIBE_LINK_MISSING" };
    }
    const compliantBody = input.body.replaceAll(
      "{{unsubscribe_link}}",
      "<%asm_group_unsubscribe_raw_url%>",
    );
    const response = await providerFetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: input.destination }],
          custom_args: { delivery_attempt_id: input.attemptId },
        }],
        from: { email: this.fromEmail },
        subject: input.subject ?? "A quick request from a business you used",
        content: [{ type: "text/plain", value: compliantBody }],
        asm: { group_id: this.unsubscribeGroupId, groups_to_display: [this.unsubscribeGroupId] },
      }),
    });
    if (!response) return { result: "unknown", errorCode: "NETWORK_OUTCOME_UNKNOWN" };
    if (response.status === 202) {
      return {
        result: "accepted",
        providerMessageId: response.headers.get("x-message-id") ?? undefined,
        responseCode: String(response.status),
      };
    }
    return {
      result: response.status >= 500 ? "unknown" : "failed",
      responseCode: String(response.status),
      errorCode: `HTTP_${response.status}`,
    };
  }
}

export function createDeliveryProviders(config: AppConfig, externalWebhookBaseUrl?: string): DeliveryProviderMap {
  const baseUrl = externalWebhookBaseUrl?.replace(/\/$/, "");
  return {
    sms: new TwilioSmsProvider(config, baseUrl ? `${baseUrl}/webhooks/twilio/status` : undefined),
    email: new SendGridEmailProvider(
      config,
      config.SENDGRID_ASM_GROUP_ID,
    ),
  };
}
