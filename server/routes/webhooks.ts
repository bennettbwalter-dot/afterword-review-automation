import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { PlatformRepository } from "../types.js";
import { ApiError } from "./shared.js";

interface WebhookPersistenceRepository extends PlatformRepository {
  recordTwilioStatusWebhook?(input: {
    eventId: string;
    providerMessageId: string;
    status: string;
    errorCode?: string;
    occurredAt: Date;
    rawBody: Buffer;
  }): Promise<void>;
  recordTwilioSuppressionWebhook?(input: {
    integrationId: string;
    eventId: string;
    destination: string;
    action: "suppress" | "lift";
    keyword: string;
    providerMessageId?: string;
    receivingAddress?: string;
    messagingServiceSid?: string;
    occurredAt: Date;
    rawBody: Buffer;
  }): Promise<void>;
  recordSendGridWebhookEvents?(events: SendGridEvent[], rawBody: Buffer): Promise<void>;
  recordGoogleReviewNotification?(input: {
    eventId: string;
    subscription?: string;
    publishedAt?: Date;
    attributes: Record<string, string>;
    notification: unknown;
    rawBody: Buffer;
  }): Promise<void>;
}

interface SendGridEvent {
  eventId: string;
  providerMessageId?: string;
  attemptId?: string;
  event: string;
  occurredAt: Date;
  email?: string;
  reason?: string;
  response?: string;
}

const twilioSchema = z.object({
  MessageSid: z.string().min(1).max(80).optional(),
  SmsSid: z.string().min(1).max(80).optional(),
  MessageStatus: z.string().min(1).max(80).optional(),
  SmsStatus: z.string().min(1).max(80).optional(),
  ErrorCode: z.string().max(80).optional(),
  From: z.string().min(1).max(64).optional(),
  Body: z.string().max(2_000).optional(),
  OptOutType: z.string().max(40).optional(),
  To: z.string().max(64).optional(),
  MessagingServiceSid: z.string().max(80).optional(),
  OriginalRepliedMessageSid: z.string().max(80).optional(),
}).passthrough();

const twilioIntegrationParamsSchema = z.object({ integrationId: z.string().uuid() }).strict();

const sendGridEventSchema = z.object({
  sg_event_id: z.string().min(1).max(240),
  sg_message_id: z.string().max(240).optional(),
  event: z.string().min(1).max(80),
  timestamp: z.number().int().positive(),
  email: z.string().email().max(320).optional(),
  reason: z.string().max(2_000).optional(),
  response: z.string().max(2_000).optional(),
  delivery_attempt_id: z.string().uuid().optional(),
}).passthrough();

const sendGridSchema = z.array(sendGridEventSchema).max(1_000);

const pubSubSchema = z.object({
  subscription: z.string().max(500).optional(),
  message: z.object({
    messageId: z.string().min(1).max(240),
    data: z.string().max(1_000_000).optional(),
    publishTime: z.string().datetime({ offset: true }).optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  }).strict(),
}).strict();

function webhookUrl(baseUrl: string | undefined, requestUrl: string) {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/$/, "")}${requestUrl}`;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requireWebhookPersistence<T extends (...parameters: never[]) => unknown>(
  repository: WebhookPersistenceRepository,
  operation: T | undefined,
): T {
  if (typeof operation !== "function") {
    throw new ApiError(503, "WEBHOOK_PERSISTENCE_UNAVAILABLE", "Webhook persistence is not configured.");
  }
  return operation.bind(repository) as T;
}

export async function registerWebhookRoutes(app: FastifyInstance, options: BuildAppOptions) {
  const repository = options.repository as WebhookPersistenceRepository;

  app.post("/webhooks/twilio/status", async (request, reply) => {
    const url = webhookUrl(options.externalWebhookBaseUrl, request.url);
    if (!url || !options.webhookSecurity?.twilioConfigured) {
      throw new ApiError(503, "TWILIO_WEBHOOK_NOT_CONFIGURED", "Twilio webhook verification is not configured.");
    }
    const fields = asRecord(request.body);
    if (!options.webhookSecurity.verifyTwilio({
      signature: request.headers["x-twilio-signature"] as string | undefined,
      url,
      fields,
    })) {
      throw new ApiError(401, "WEBHOOK_SIGNATURE_INVALID", "The webhook signature is invalid.");
    }
    const event = twilioSchema.parse(fields);
    const providerMessageId = event.MessageSid ?? event.SmsSid;
    const status = event.MessageStatus ?? event.SmsStatus;
    if (!providerMessageId || !status) {
      throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "The Twilio status payload is incomplete.");
    }
    const persist = requireWebhookPersistence(repository, repository.recordTwilioStatusWebhook);
    await persist({
      eventId: `${providerMessageId}:${status}`,
      providerMessageId,
      status,
      errorCode: event.ErrorCode,
      occurredAt: new Date(),
      rawBody: request.rawBody ?? Buffer.alloc(0),
    });
    return reply.code(204).send();
  });

  app.post("/webhooks/twilio/inbound/:integrationId", async (request, reply) => {
    const url = webhookUrl(options.externalWebhookBaseUrl, request.url);
    if (!url || !options.webhookSecurity?.twilioConfigured) {
      throw new ApiError(503, "TWILIO_WEBHOOK_NOT_CONFIGURED", "Twilio webhook verification is not configured.");
    }
    const fields = asRecord(request.body);
    if (!options.webhookSecurity.verifyTwilio({
      signature: request.headers["x-twilio-signature"] as string | undefined,
      url,
      fields,
    })) {
      throw new ApiError(401, "WEBHOOK_SIGNATURE_INVALID", "The webhook signature is invalid.");
    }
    const event = twilioSchema.parse(fields);
    const { integrationId } = twilioIntegrationParamsSchema.parse(request.params);
    const eventId = event.MessageSid ?? event.SmsSid;
    if (!eventId) {
      throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "The Twilio inbound message identifier is missing.");
    }
    const optOutType = event.OptOutType?.toUpperCase();
    const keyword = event.Body?.trim().toUpperCase() ?? optOutType ?? "";
    const stopKeywords = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
    const startKeywords = new Set(["START", "UNSTOP", "YES"]);
    const action = optOutType === "START" || startKeywords.has(keyword)
      ? "lift"
      : optOutType === "STOP" || stopKeywords.has(keyword)
        ? "suppress"
        : undefined;
    if (action && event.From) {
      const persist = requireWebhookPersistence(repository, repository.recordTwilioSuppressionWebhook);
      await persist({
        integrationId,
        eventId,
        destination: event.From,
        action,
        keyword,
        providerMessageId: event.OriginalRepliedMessageSid,
        receivingAddress: event.To,
        messagingServiceSid: event.MessagingServiceSid,
        occurredAt: new Date(),
        rawBody: request.rawBody ?? Buffer.alloc(0),
      });
    }
    return reply.type("application/xml").send("<Response></Response>");
  });

  app.post("/webhooks/sendgrid/events", async (request, reply) => {
    if (!options.webhookSecurity?.sendGridConfigured) {
      throw new ApiError(503, "SENDGRID_WEBHOOK_NOT_CONFIGURED", "SendGrid webhook verification is not configured.");
    }
    if (!options.webhookSecurity.verifySendGrid({
      signature: request.headers["x-twilio-email-event-webhook-signature"] as string | undefined,
      timestamp: request.headers["x-twilio-email-event-webhook-timestamp"] as string | undefined,
      rawBody: request.rawBody,
    })) {
      throw new ApiError(401, "WEBHOOK_SIGNATURE_INVALID", "The webhook signature is invalid.");
    }
    const payload = sendGridSchema.parse(request.body);
    const persist = requireWebhookPersistence(repository, repository.recordSendGridWebhookEvents);
    await persist(payload.map((event) => ({
      eventId: event.sg_event_id,
      providerMessageId: event.sg_message_id,
      attemptId: event.delivery_attempt_id,
      event: event.event,
      occurredAt: new Date(event.timestamp * 1_000),
      email: event.email,
      reason: event.reason,
      response: event.response,
    })), request.rawBody ?? Buffer.alloc(0));
    return reply.code(204).send();
  });

  app.post("/webhooks/google-business-profile/reviews", async (request, reply) => {
    const audienceUrl = webhookUrl(options.externalWebhookBaseUrl, request.url);
    if (!audienceUrl || !options.webhookSecurity?.googlePubSubConfigured) {
      throw new ApiError(503, "GOOGLE_PUBSUB_NOT_CONFIGURED", "Google Pub/Sub verification is not configured.");
    }
    const verified = await options.webhookSecurity.verifyGooglePubSub({
      authorization: request.headers.authorization,
      audienceUrl,
    });
    if (!verified) {
      throw new ApiError(401, "WEBHOOK_IDENTITY_INVALID", "The Pub/Sub push identity is invalid.");
    }
    const envelope = pubSubSchema.parse(request.body);
    let notification: unknown = {};
    if (envelope.message.data) {
      try {
        notification = JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")) as unknown;
      } catch {
        throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "The Pub/Sub message data is invalid.");
      }
    }
    const persist = requireWebhookPersistence(repository, repository.recordGoogleReviewNotification);
    await persist({
      eventId: envelope.message.messageId,
      subscription: envelope.subscription,
      publishedAt: envelope.message.publishTime ? new Date(envelope.message.publishTime) : undefined,
      attributes: envelope.message.attributes ?? {},
      notification,
      rawBody: request.rawBody ?? Buffer.alloc(0),
    });
    return reply.code(204).send();
  });
}
