import { z } from "zod";

const exampleSessionPepper = "replace-with-at-least-32-random-characters";
const exampleFieldEncryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function isThirtyTwoByteBase64Url(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value.replace(/=+$/, "");
  } catch {
    return false;
  }
}

function optionalEnvironmentValue<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

function databaseLoginIdentity(connectionString: string) {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Database URLs must use the postgres or postgresql protocol.");
  }
  if (!parsed.username) throw new Error("Database URLs must include a login identity.");
  return decodeURIComponent(parsed.username).toLowerCase();
}

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4174),
  INGRESS_HOST: z.string().default("127.0.0.1"),
  INGRESS_PORT: z.coerce.number().int().min(1).max(65535).default(4175),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  DATABASE_URL: optionalEnvironmentValue(z.string().min(1)),
  AUTH_DATABASE_URL: optionalEnvironmentValue(z.string().min(1)),
  RUNTIME_DATABASE_URL: optionalEnvironmentValue(z.string().min(1)),
  INGRESS_DATABASE_URL: optionalEnvironmentValue(z.string().min(1)),
  WORKER_DATABASE_URL: optionalEnvironmentValue(z.string().min(1)),
  DATABASE_SSL: z.enum(["disable", "require"]).default("disable"),
  DATABASE_CA_CERT_PATH: optionalEnvironmentValue(z.string().min(1)),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:4173"),
  EXTERNAL_WEBHOOK_BASE_URL: optionalEnvironmentValue(z.string().url()),
  PUBLIC_REVIEW_BASE_URL: optionalEnvironmentValue(z.string().url()),
  SESSION_COOKIE_NAME: z.string().default("afterword_session"),
  SIGNUP_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(30).default(15),
  SESSION_PEPPER: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(43).refine(isThirtyTwoByteBase64Url, {
    message: "FIELD_ENCRYPTION_KEY must be a canonical base64url-encoded 32-byte key.",
  }),
  GOOGLE_CLIENT_ID: optionalEnvironmentValue(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optionalEnvironmentValue(z.string().min(1)),
  GOOGLE_REDIRECT_URI: optionalEnvironmentValue(z.string().url()),
  GOOGLE_PUBSUB_AUDIENCE: optionalEnvironmentValue(z.string().url()),
  GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: optionalEnvironmentValue(z.string().email()),
  TWILIO_ACCOUNT_SID: optionalEnvironmentValue(z.string().min(1)),
  TWILIO_AUTH_TOKEN: optionalEnvironmentValue(z.string().min(1)),
  TWILIO_FROM_NUMBER: optionalEnvironmentValue(z.string().min(1)),
  TWILIO_MESSAGING_SERVICE_SID: optionalEnvironmentValue(z.string().min(1)),
  SENDGRID_API_KEY: optionalEnvironmentValue(z.string().min(1)),
  SENDGRID_FROM_EMAIL: optionalEnvironmentValue(z.string().email()),
  SIGNUP_EMAIL_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SENDGRID_ASM_GROUP_ID: optionalEnvironmentValue(z.coerce.number().int().positive()),
  SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY: optionalEnvironmentValue(z.string().min(1)),
  STRIPE_CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STRIPE_API_KEY: optionalEnvironmentValue(z.string().min(20).regex(/^(?:sk|rk)_(?:test|live)_/)),
  STRIPE_WEBHOOK_SECRET: optionalEnvironmentValue(z.string().min(20).regex(/^whsec_/)),
  STRIPE_PRICE_PRO_MONTHLY: optionalEnvironmentValue(z.string().regex(/^price_/)),
  STRIPE_PRICE_PRO_ANNUAL: optionalEnvironmentValue(z.string().regex(/^price_/)),
  STRIPE_PRICE_MULTI_MONTHLY: optionalEnvironmentValue(z.string().regex(/^price_/)),
  STRIPE_PRICE_SETUP_PRO: optionalEnvironmentValue(z.string().regex(/^price_/)),
  STRIPE_PRICE_SETUP_MULTI_2_3: optionalEnvironmentValue(z.string().regex(/^price_/)),
  STRIPE_PRICE_SETUP_MULTI_4_5: optionalEnvironmentValue(z.string().regex(/^price_/)),
  STRIPE_PORTAL_CONFIGURATION_ID: optionalEnvironmentValue(z.string().regex(/^bpc_/)),
});

const databaseEnvironmentKeys = {
  auth: "AUTH_DATABASE_URL",
  runtime: "RUNTIME_DATABASE_URL",
  ingress: "INGRESS_DATABASE_URL",
  worker: "WORKER_DATABASE_URL",
} as const;

export type DatabaseCapability = keyof typeof databaseEnvironmentKeys;
const allDatabaseCapabilities = Object.keys(databaseEnvironmentKeys) as DatabaseCapability[];
export type ProviderCapability = "stripeCheckout" | "stripeWebhook";
export type ProcessCapability = DatabaseCapability | ProviderCapability;

function environmentSchema(requiredCapabilities: readonly ProcessCapability[]) {
  return baseEnvironmentSchema.superRefine((value, context) => {
  const requiredDatabaseCapabilities = requiredCapabilities.filter(
    (capability): capability is DatabaseCapability => capability in databaseEnvironmentKeys,
  );
  const missingCapabilities = requiredDatabaseCapabilities.filter((capability) => !value[databaseEnvironmentKeys[capability]]);
  if (value.NODE_ENV === "production" && missingCapabilities.length > 0) {
    const requiredNames = requiredDatabaseCapabilities.map((capability) => databaseEnvironmentKeys[capability]).join(", ");
    context.addIssue({
      code: "custom",
      message: `Production requires ${requiredNames} with separate least-privilege PostgreSQL logins for this process.`,
      path: [databaseEnvironmentKeys[missingCapabilities[0]]],
    });
  }
  if (value.NODE_ENV === "production" && missingCapabilities.length === 0) {
    const connections = requiredDatabaseCapabilities.map((capability) => value[databaseEnvironmentKeys[capability]]!);
    try {
      const identities = connections.map(databaseLoginIdentity);
      if (new Set(connections).size !== connections.length || new Set(identities).size !== identities.length) {
        context.addIssue({
          code: "custom",
          message: `Production database URLs must use ${connections.length === 4 ? "four " : ""}distinct least-privilege login identities.`,
          path: [databaseEnvironmentKeys[requiredDatabaseCapabilities[0]]],
        });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "The production database URLs are invalid.",
        path: ["AUTH_DATABASE_URL"],
      });
    }
  }
  if (value.NODE_ENV === "production" && value.SESSION_PEPPER === exampleSessionPepper) {
    context.addIssue({
      code: "custom",
      message: "Production cannot use the example SESSION_PEPPER.",
      path: ["SESSION_PEPPER"],
    });
  }
  if (value.NODE_ENV === "production" && value.FIELD_ENCRYPTION_KEY === exampleFieldEncryptionKey) {
    context.addIssue({
      code: "custom",
      message: "Production cannot use the example FIELD_ENCRYPTION_KEY.",
      path: ["FIELD_ENCRYPTION_KEY"],
    });
  }
  if (value.NODE_ENV === "production" && new URL(value.APP_ORIGIN).protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "Production APP_ORIGIN must use HTTPS.",
      path: ["APP_ORIGIN"],
    });
  }
  if (value.NODE_ENV !== "production" && !value.DATABASE_URL && missingCapabilities.length > 0) {
    context.addIssue({
      code: "custom",
      message: `Set DATABASE_URL for local development, or provide ${requiredDatabaseCapabilities.map((capability) => databaseEnvironmentKeys[capability]).join(", ")}.`,
      path: ["DATABASE_URL"],
    });
  }
  if (value.DATABASE_SSL === "require" && !value.DATABASE_CA_CERT_PATH) {
    context.addIssue({
      code: "custom",
      message: "DATABASE_CA_CERT_PATH is required when DATABASE_SSL=require.",
      path: ["DATABASE_CA_CERT_PATH"],
    });
  }
  if (value.STRIPE_MODE === "live" && value.NODE_ENV !== "production") {
    context.addIssue({
      code: "custom",
      message: "Live Stripe mode is allowed only in a production process.",
      path: ["STRIPE_MODE"],
    });
  }
  if (value.STRIPE_API_KEY) {
    const keyMode = /^(?:sk|rk)_live_/.test(value.STRIPE_API_KEY) ? "live" : "test";
    if (keyMode !== value.STRIPE_MODE) {
      context.addIssue({
        code: "custom",
        message: `The Stripe API key does not match STRIPE_MODE=${value.STRIPE_MODE}.`,
        path: ["STRIPE_API_KEY"],
      });
    }
  }
  if (value.NODE_ENV === "production" && value.SIGNUP_EMAIL_ENABLED && (!value.SENDGRID_API_KEY || !value.SENDGRID_FROM_EMAIL)) {
    context.addIssue({ code: "custom", message: "Production signup email requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.", path: ["SENDGRID_API_KEY"] });
  }
  if (value.STRIPE_CHECKOUT_ENABLED && requiredCapabilities.includes("stripeCheckout")) {
    const requiredStripeKeys = [
      "STRIPE_API_KEY",
      "STRIPE_PRICE_PRO_MONTHLY",
      "STRIPE_PRICE_PRO_ANNUAL",
      "STRIPE_PRICE_MULTI_MONTHLY",
      "STRIPE_PRICE_SETUP_PRO",
      "STRIPE_PRICE_SETUP_MULTI_2_3",
      "STRIPE_PRICE_SETUP_MULTI_4_5",
    ] as const;
    const missingStripeKey = requiredStripeKeys.find((key) => !value[key]);
    if (missingStripeKey) {
      context.addIssue({
        code: "custom",
        message: `Stripe Checkout is enabled but ${missingStripeKey} is missing for the application process.`,
        path: [missingStripeKey],
      });
    }
  }
  if (value.STRIPE_CHECKOUT_ENABLED && requiredCapabilities.includes("stripeWebhook") && !value.STRIPE_WEBHOOK_SECRET) {
    context.addIssue({
      code: "custom",
      message: "Stripe Checkout is enabled but STRIPE_WEBHOOK_SECRET is missing for the ingress process.",
      path: ["STRIPE_WEBHOOK_SECRET"],
    });
  }
  });
}

export type AppConfig = z.infer<typeof baseEnvironmentSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  requiredCapabilities: readonly ProcessCapability[] = allDatabaseCapabilities,
): AppConfig {
  return environmentSchema(requiredCapabilities).parse(environment);
}

export function isProduction(config: AppConfig) {
  return config.NODE_ENV === "production";
}

export function databaseUrl(config: AppConfig, capability: DatabaseCapability) {
  const localFallback = config.NODE_ENV === "production" ? undefined : config.DATABASE_URL;
  const value = config[databaseEnvironmentKeys[capability]] ?? localFallback;
  if (!value) throw new Error(`${databaseEnvironmentKeys[capability]} is unavailable in this process.`);
  return value;
}
