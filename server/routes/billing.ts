import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildAppOptions } from "../app.js";
import type { BusinessSummary } from "../types.js";
import { ApiError, requireActor, requireBusinessAccess, requireSameOrigin, sendData } from "./shared.js";

const businessParamsSchema = z.object({ businessId: z.string().uuid() }).strict();
const checkoutSchema = z.object({ attemptId: z.string().uuid(), locationId: z.string().uuid().optional() }).strict();
const portalSchema = z.object({ locationId: z.string().uuid().optional() }).strict();

function requireBusinessLocation(business: BusinessSummary, locationId: string) {
  const available = business.locationId === locationId
    || business.locationReports.some((location) => location.id === locationId);
  if (!available) {
    throw new ApiError(404, "LOCATION_NOT_FOUND", "This location is not available in the selected business workspace.");
  }
}

function billingReturnUrl(
  appOrigin: string,
  businessId: string,
  locationId: string | undefined,
  result: { checkout?: "success" | "cancelled"; billing?: "return" },
) {
  const url = new URL("/app/team-billing", appOrigin);
  url.searchParams.set("business", businessId);
  if (locationId) url.searchParams.set("location", locationId);
  if (result.checkout) url.searchParams.set("checkout", result.checkout);
  if (result.billing) url.searchParams.set("billing", result.billing);
  return url.toString();
}

function requireRepositoryMethod<T extends (...parameters: never[]) => unknown>(operation: T | undefined): T {
  if (typeof operation !== "function") {
    throw new ApiError(503, "STRIPE_PERSISTENCE_UNAVAILABLE", "Stripe billing persistence is not configured.");
  }
  return operation as T;
}

function checkoutError(reason: string): never {
  if (reason === "access_denied") {
    throw new ApiError(403, "BILLING_ACCESS_DENIED", "You do not have permission to manage billing for this business.");
  }
  if (reason === "subscription_active" || reason === "subscription_past_due") {
    throw new ApiError(409, "BILLING_PORTAL_REQUIRED", "Use the billing portal to manage this subscription.");
  }
  throw new ApiError(409, "CHECKOUT_UNAVAILABLE", "Stripe Checkout is not available for this billing account.");
}

export async function registerBillingRoutes(app: FastifyInstance, options: BuildAppOptions) {
  app.post("/api/v1/businesses/:businessId/billing/checkout", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    const { businessId } = businessParamsSchema.parse(request.params);
    const { attemptId, locationId } = checkoutSchema.parse(request.body);
    const business = await requireBusinessAccess(options.repository, actor, businessId);
    if (locationId) requireBusinessLocation(business, locationId);
    if (!options.config.STRIPE_CHECKOUT_ENABLED || !options.stripeBilling) {
      throw new ApiError(503, "STRIPE_CHECKOUT_DISABLED", "Stripe Checkout is not enabled for this environment.");
    }

    const correlationId = randomUUID();
    const prepare = requireRepositoryMethod(options.repository.prepareStripeCheckout)?.bind(options.repository);
    const prepared = await prepare(actor, businessId, attemptId, correlationId);
    if (!prepared.allowed
      || !prepared.planKey
      || !prepared.billingCycle
      || prepared.subscriptionPricePence === undefined
      || prepared.setupFeePence === undefined) {
      checkoutError(prepared.reason);
    }

    const session = await options.stripeBilling.createSubscriptionCheckout({
      attemptId,
      businessId,
      businessName: business.name,
      email: actor.email,
      planKey: prepared.planKey,
      billingCycle: prepared.billingCycle,
      subscriptionPricePence: prepared.subscriptionPricePence,
      setupFeePence: prepared.setupFeePence,
      customerId: prepared.customerId,
      successUrl: `${billingReturnUrl(options.config.APP_ORIGIN, businessId, locationId, { checkout: "success" })}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: billingReturnUrl(options.config.APP_ORIGIN, businessId, locationId, { checkout: "cancelled" }),
    });
    const bindSession = requireRepositoryMethod(options.repository.bindStripeCheckoutSession)?.bind(options.repository);
    await bindSession(
      actor,
      businessId,
      attemptId,
      session.id,
      session.customerId,
      session.livemode,
      correlationId,
    );
    reply.header("cache-control", "no-store");
    return sendData(reply, { url: session.url }, 201);
  });

  app.post("/api/v1/businesses/:businessId/billing/portal", async (request, reply) => {
    requireSameOrigin(request, options.config.APP_ORIGIN, options.config.NODE_ENV === "production");
    const actor = requireActor(request);
    const { businessId } = businessParamsSchema.parse(request.params);
    const { locationId } = portalSchema.parse(request.body);
    const business = await requireBusinessAccess(options.repository, actor, businessId);
    if (locationId) requireBusinessLocation(business, locationId);
    if (!options.stripeBilling) {
      throw new ApiError(503, "STRIPE_PORTAL_DISABLED", "Stripe billing management is not configured.");
    }
    const correlationId = randomUUID();
    const getCustomer = requireRepositoryMethod(options.repository.getStripeBillingCustomer)?.bind(options.repository);
    const customer = await getCustomer(actor, businessId, correlationId);
    if (!customer.allowed) checkoutError(customer.reason);
    if (!customer.customerId) {
      throw new ApiError(409, "STRIPE_CUSTOMER_MISSING", "Complete Stripe Checkout before opening the billing portal.");
    }
    const session = await options.stripeBilling.createCustomerPortal(
      customer.customerId,
      billingReturnUrl(options.config.APP_ORIGIN, businessId, locationId, { billing: "return" }),
    );
    reply.header("cache-control", "no-store");
    return sendData(reply, { url: session.url }, 201);
  });
}
