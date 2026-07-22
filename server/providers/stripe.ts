import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import type { AppConfig } from "../config.js";

export type StripePlanKey = "pro_monthly" | "pro_annual" | "multi_monthly";
export type StripeSubscriptionState = "inactive" | "active" | "past_due" | "cancelled";

export interface StripeCheckoutContext {
  attemptId: string;
  businessId: string;
  businessName: string;
  email: string;
  planKey: StripePlanKey;
  billingCycle: "monthly" | "annual";
  subscriptionPricePence: number;
  setupFeePence: number;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  customerId?: string;
  livemode: boolean;
}

export interface StripeBillingClient {
  createSubscriptionCheckout(context: StripeCheckoutContext): Promise<StripeCheckoutSessionResult>;
  createCustomerPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
}

export interface StripeCheckoutWebhookEvent {
  kind: "checkout";
  eventId: string;
  eventType: string;
  eventCreatedAt: Date;
  apiVersion?: string;
  livemode: boolean;
  businessId: string;
  attemptId: string;
  checkoutSessionId: string;
  customerId?: string;
  subscriptionId?: string;
  state: "completed" | "expired" | "failed";
  setupPaid: boolean;
}

export interface StripeSubscriptionWebhookEvent {
  kind: "subscription";
  eventId: string;
  eventType: string;
  eventCreatedAt: Date;
  apiVersion?: string;
  livemode: boolean;
  businessId: string;
  attemptId?: string;
  customerId: string;
  subscriptionId: string;
  subscriptionState: StripeSubscriptionState;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface IgnoredStripeWebhookEvent {
  kind: "ignored";
  eventId: string;
  eventType: string;
}

export type VerifiedStripeWebhookEvent =
  | StripeCheckoutWebhookEvent
  | StripeSubscriptionWebhookEvent
  | IgnoredStripeWebhookEvent;

export interface StripeWebhookVerifier {
  verify(rawBody: Buffer, signature: string): VerifiedStripeWebhookEvent;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const planKeys = new Set<StripePlanKey>(["pro_monthly", "pro_annual", "multi_monthly"]);

function objectId(value: string | { id: string } | null | undefined) {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

function metadataIdentity(metadata: Stripe.Metadata | null | undefined) {
  if (metadata?.integration !== "review_anchor") return undefined;
  const businessId = metadata.business_id;
  const attemptId = metadata.checkout_attempt_id;
  const planKey = metadata.plan_key;
  if (!businessId || !uuidPattern.test(businessId)) return undefined;
  if (attemptId && !uuidPattern.test(attemptId)) return undefined;
  if (planKey && !planKeys.has(planKey as StripePlanKey)) return undefined;
  return { businessId, attemptId, planKey: planKey as StripePlanKey | undefined };
}

function subscriptionState(status: Stripe.Subscription.Status): StripeSubscriptionState {
  if (status === "active" || status === "trialing") return "active";
  if (status === "canceled" || status === "incomplete_expired") return "cancelled";
  if (status === "past_due" || status === "unpaid" || status === "incomplete" || status === "paused") {
    return "past_due";
  }
  return "inactive";
}

function randomLetters(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

function priceIds(config: AppConfig, context: StripeCheckoutContext) {
  const subscription = context.planKey === "pro_monthly"
    ? config.STRIPE_PRICE_PRO_MONTHLY
    : context.planKey === "pro_annual"
      ? config.STRIPE_PRICE_PRO_ANNUAL
      : config.STRIPE_PRICE_MULTI_MONTHLY;
  const setup = context.planKey !== "multi_monthly"
    ? config.STRIPE_PRICE_SETUP_PRO
    : context.setupFeePence === 24900
      ? config.STRIPE_PRICE_SETUP_MULTI_2_3
      : context.setupFeePence === 34900
        ? config.STRIPE_PRICE_SETUP_MULTI_4_5
        : undefined;
  if (!subscription || !setup) {
    throw new Error("Stripe Price configuration does not match this server-owned billing plan.");
  }
  return { subscription, setup };
}

function assertPrice(
  price: Stripe.Price,
  expected: { amount: number; recurring: boolean; interval?: "month" | "year" },
) {
  if (!price.active || price.currency !== "gbp" || price.unit_amount !== expected.amount) {
    throw new Error("A configured Stripe Price does not match the server-owned GBP amount.");
  }
  if (expected.recurring) {
    if (price.type !== "recurring" || price.recurring?.interval !== expected.interval) {
      throw new Error("A configured Stripe subscription Price has the wrong billing interval.");
    }
  } else if (price.type !== "one_time") {
    throw new Error("A configured Stripe setup Price must be one-time.");
  }
}

export class StripeSdkBillingClient implements StripeBillingClient {
  private readonly stripe: Stripe;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    if (!config.STRIPE_API_KEY) throw new Error("Stripe API access is not configured.");
    this.config = config;
    this.stripe = new Stripe(config.STRIPE_API_KEY, {
      apiVersion: "2026-06-24.dahlia",
      appInfo: { name: "Review Anchor", version: "0.1.0" },
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
    });
  }

  async createSubscriptionCheckout(context: StripeCheckoutContext) {
    const ids = priceIds(this.config, context);
    const [subscriptionPrice, setupPrice] = await Promise.all([
      this.stripe.prices.retrieve(ids.subscription),
      this.stripe.prices.retrieve(ids.setup),
    ]);
    assertPrice(subscriptionPrice, {
      amount: context.subscriptionPricePence,
      recurring: true,
      interval: context.billingCycle === "annual" ? "year" : "month",
    });
    assertPrice(setupPrice, { amount: context.setupFeePence, recurring: false });

    const metadata = {
      integration: "review_anchor",
      business_id: context.businessId,
      checkout_attempt_id: context.attemptId,
      plan_key: context.planKey,
    };
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: context.attemptId,
      customer: context.customerId,
      customer_email: context.customerId ? undefined : context.email,
      line_items: [
        { price: ids.subscription, quantity: 1 },
        { price: ids.setup, quantity: 1 },
      ],
      metadata,
      subscription_data: { metadata },
      integration_identifier: `review_anchor_${randomLetters(8)}`,
      success_url: context.successUrl,
      cancel_url: context.cancelUrl,
    }, {
      idempotencyKey: `review-anchor-checkout-${context.attemptId}`,
    });
    if (!session.url) throw new Error("Stripe did not return a hosted Checkout URL.");
    return {
      id: session.id,
      url: session.url,
      customerId: objectId(session.customer),
      livemode: session.livemode,
    };
  }

  async createCustomerPortal(customerId: string, returnUrl: string) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: this.config.STRIPE_PORTAL_CONFIGURATION_ID,
      return_url: returnUrl,
    });
    return { url: session.url };
  }
}

export class StripeSdkWebhookVerifier implements StripeWebhookVerifier {
  private readonly stripe = new Stripe("rk_test_webhook_verification_only", {
    apiVersion: "2026-06-24.dahlia",
    maxNetworkRetries: 0,
    telemetry: false,
  });
  private readonly endpointSecret: string;

  constructor(endpointSecret: string) {
    this.endpointSecret = endpointSecret;
  }

  verify(rawBody: Buffer, signature: string): VerifiedStripeWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.endpointSecret);
    const ignored = (): IgnoredStripeWebhookEvent => ({
      kind: "ignored",
      eventId: event.id,
      eventType: event.type,
    });

    if ([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const identity = metadataIdentity(session.metadata);
      if (!identity?.attemptId) return ignored();
      const expired = event.type === "checkout.session.expired";
      const failed = event.type === "checkout.session.async_payment_failed";
      return {
        kind: "checkout",
        eventId: event.id,
        eventType: event.type,
        eventCreatedAt: new Date(event.created * 1_000),
        apiVersion: event.api_version ?? undefined,
        livemode: event.livemode,
        businessId: identity.businessId,
        attemptId: identity.attemptId,
        checkoutSessionId: session.id,
        customerId: objectId(session.customer),
        subscriptionId: objectId(session.subscription),
        state: expired ? "expired" : failed ? "failed" : "completed",
        setupPaid: !expired && !failed && session.payment_status === "paid",
      };
    }

    if ([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(event.type)) {
      const subscription = event.data.object as Stripe.Subscription;
      const identity = metadataIdentity(subscription.metadata);
      if (!identity) return ignored();
      const periodStarts = subscription.items.data.map((item) => item.current_period_start);
      const periodEnds = subscription.items.data.map((item) => item.current_period_end);
      return {
        kind: "subscription",
        eventId: event.id,
        eventType: event.type,
        eventCreatedAt: new Date(event.created * 1_000),
        apiVersion: event.api_version ?? undefined,
        livemode: event.livemode,
        businessId: identity.businessId,
        attemptId: identity.attemptId,
        customerId: objectId(subscription.customer)!,
        subscriptionId: subscription.id,
        subscriptionState: subscriptionState(subscription.status),
        periodStart: periodStarts.length > 0 ? new Date(Math.min(...periodStarts) * 1_000) : undefined,
        periodEnd: periodEnds.length > 0 ? new Date(Math.max(...periodEnds) * 1_000) : undefined,
      };
    }

    return ignored();
  }
}
