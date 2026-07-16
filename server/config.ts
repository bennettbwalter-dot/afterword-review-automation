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
  DATABASE_URL: z.string().min(1).optional(),
  AUTH_DATABASE_URL: z.string().min(1).optional(),
  RUNTIME_DATABASE_URL: z.string().min(1).optional(),
  INGRESS_DATABASE_URL: z.string().min(1).optional(),
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(["disable", "require"]).default("disable"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:4173"),
  EXTERNAL_WEBHOOK_BASE_URL: z.string().url().optional(),
  PUBLIC_REVIEW_BASE_URL: z.string().url().optional(),
  SESSION_COOKIE_NAME: z.string().default("afterword_session"),
  SESSION_PEPPER: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(43).refine(isThirtyTwoByteBase64Url, {
    message: "FIELD_ENCRYPTION_KEY must be a canonical base64url-encoded 32-byte key.",
  }),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_PUBSUB_AUDIENCE: z.string().url().optional(),
  GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  SENDGRID_ASM_GROUP_ID: z.coerce.number().int().positive().optional(),
  SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY: z.string().optional(),
});

const databaseEnvironmentKeys = {
  auth: "AUTH_DATABASE_URL",
  runtime: "RUNTIME_DATABASE_URL",
  ingress: "INGRESS_DATABASE_URL",
  worker: "WORKER_DATABASE_URL",
} as const;

export type DatabaseCapability = keyof typeof databaseEnvironmentKeys;
const allDatabaseCapabilities = Object.keys(databaseEnvironmentKeys) as DatabaseCapability[];

function environmentSchema(requiredCapabilities: readonly DatabaseCapability[]) {
  return baseEnvironmentSchema.superRefine((value, context) => {
  const missingCapabilities = requiredCapabilities.filter((capability) => !value[databaseEnvironmentKeys[capability]]);
  if (value.NODE_ENV === "production" && missingCapabilities.length > 0) {
    const requiredNames = requiredCapabilities.map((capability) => databaseEnvironmentKeys[capability]).join(", ");
    context.addIssue({
      code: "custom",
      message: `Production requires ${requiredNames} with separate least-privilege PostgreSQL logins for this process.`,
      path: [databaseEnvironmentKeys[missingCapabilities[0]]],
    });
  }
  if (value.NODE_ENV === "production" && missingCapabilities.length === 0) {
    const connections = requiredCapabilities.map((capability) => value[databaseEnvironmentKeys[capability]]!);
    try {
      const identities = connections.map(databaseLoginIdentity);
      if (new Set(connections).size !== connections.length || new Set(identities).size !== identities.length) {
        context.addIssue({
          code: "custom",
          message: `Production database URLs must use ${connections.length === 4 ? "four " : ""}distinct least-privilege login identities.`,
          path: [databaseEnvironmentKeys[requiredCapabilities[0]]],
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
      message: `Set DATABASE_URL for local development, or provide ${requiredCapabilities.map((capability) => databaseEnvironmentKeys[capability]).join(", ")}.`,
      path: ["DATABASE_URL"],
    });
  }
  });
}

export type AppConfig = z.infer<typeof baseEnvironmentSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  requiredCapabilities: readonly DatabaseCapability[] = allDatabaseCapabilities,
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
