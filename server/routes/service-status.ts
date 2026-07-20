import type { FastifyInstance } from "fastify";
import type { BuildAppOptions } from "../app.js";
import { requireActor, sendData } from "./shared.js";

export type ServiceKey =
  | "google"
  | "sms"
  | "email"
  | "whatsapp"
  | "stripeCheckout"
  | "stripeBillingPortal"
  | "reviewSync";

export interface ServiceStatus {
  key: ServiceKey;
  label: string;
  configured: boolean;
  /** Human-readable provider requirements. Never contains secret values. */
  requires: string[];
  detail: string;
}

/**
 * Reports which external providers this deployment can actually use.
 *
 * The response contains booleans and provider names only: no credential
 * values, no environment variable contents. It exists so the interface can
 * mark a feature unavailable up front instead of failing when a user clicks.
 */
export function describeServiceStatus(config: BuildAppOptions["config"]): ServiceStatus[] {
  const googleConfigured = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI);
  const smsConfigured = Boolean(
    config.TWILIO_ACCOUNT_SID
    && config.TWILIO_AUTH_TOKEN
    && (config.TWILIO_FROM_NUMBER || config.TWILIO_MESSAGING_SERVICE_SID),
  );
  const emailConfigured = Boolean(config.SENDGRID_API_KEY && config.SENDGRID_FROM_EMAIL);
  const pubSubConfigured = Boolean(config.GOOGLE_PUBSUB_AUDIENCE && config.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL);
  const checkoutConfigured = Boolean(
    config.STRIPE_CHECKOUT_ENABLED
    && config.STRIPE_API_KEY
    && config.STRIPE_PRICE_PRO_MONTHLY
    && config.STRIPE_PRICE_PRO_ANNUAL
    && config.STRIPE_PRICE_MULTI_MONTHLY
    && config.STRIPE_PRICE_SETUP_PRO
    && config.STRIPE_PRICE_SETUP_MULTI_2_3
    && config.STRIPE_PRICE_SETUP_MULTI_4_5,
  );

  return [
    {
      key: "google",
      label: "Google Business Profile",
      configured: googleConfigured,
      requires: ["Google OAuth client ID", "Google OAuth client secret", "Approved Business Profile API access"],
      detail: googleConfigured
        ? "Owners can connect a verified location and set the review destination."
        : "Connecting a Google location is unavailable until this deployment has approved Business Profile OAuth credentials.",
    },
    {
      key: "reviewSync",
      label: "Google review monitoring",
      configured: googleConfigured && pubSubConfigured,
      requires: ["Google Business Profile connection", "Pub/Sub push audience", "Pub/Sub service account"],
      detail: googleConfigured && pubSubConfigured
        ? "New reviews are reconciled from Google on a schedule and on notification."
        : "Review monitoring is unavailable until Google OAuth and Pub/Sub notifications are configured.",
    },
    {
      key: "sms",
      label: "SMS delivery",
      configured: smsConfigured,
      requires: ["Twilio account SID", "Twilio auth token", "A registered sending number or messaging service"],
      detail: smsConfigured
        ? "SMS review requests can be delivered and delivery receipts recorded."
        : "SMS requests cannot be sent until a compliant Twilio number is configured for this deployment.",
    },
    {
      key: "email",
      label: "Email delivery",
      configured: emailConfigured,
      requires: ["SendGrid API key", "Verified sender address"],
      detail: emailConfigured
        ? "Email review requests can be delivered and engagement events recorded."
        : "Email requests cannot be sent until an email provider and verified sender are configured.",
    },
    {
      key: "whatsapp",
      label: "WhatsApp delivery",
      configured: false,
      requires: ["WhatsApp Business Platform approval", "An approved message template"],
      detail: "WhatsApp is not implemented in this release. Review requests support SMS, email and QR codes.",
    },
    {
      key: "stripeCheckout",
      label: "Stripe Checkout",
      configured: checkoutConfigured,
      requires: ["Stripe API key", "Subscription and setup Prices", "Checkout enabled for this deployment"],
      detail: checkoutConfigured
        ? "Owners, admins and billing members can start hosted Checkout."
        : "Checkout is disabled for this deployment. Billing state remains read-only until it is enabled.",
    },
    {
      key: "stripeBillingPortal",
      label: "Stripe billing portal",
      configured: Boolean(config.STRIPE_API_KEY),
      requires: ["Stripe API key", "A billing portal configuration"],
      detail: config.STRIPE_API_KEY
        ? "Customers with a Stripe customer record can open the hosted portal."
        : "The billing portal is unavailable until Stripe API access is configured.",
    },
  ];
}

export async function registerServiceStatusRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.get("/api/v1/service-status", async (request, reply) => {
    requireActor(request);
    reply.header("cache-control", "no-store");
    return sendData(reply, { services: describeServiceStatus(options.config) });
  });
}
