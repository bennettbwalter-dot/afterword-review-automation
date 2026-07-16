import { buildApp } from "./app.js";
import { databaseUrl, loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { loadLocalEnvironment } from "./load-env.js";
import { GoogleHttpClient } from "./providers/google.js";
import { createWebhookSecurity } from "./providers/webhook-security.js";
import { PostgresRepository } from "./repository/postgres.js";

async function main() {
  loadLocalEnvironment();
  const config = loadConfig(process.env, ["auth", "runtime"]);
  const requireSsl = config.DATABASE_SSL === "require";
  const authPool = createPool(databaseUrl(config, "auth"), requireSsl, "afterword-auth-api");
  const runtimePool = createPool(databaseUrl(config, "runtime"), requireSsl, "afterword-runtime-api");
  const repository = new PostgresRepository({ authPool, runtimePool, config });
  const googleClient = new GoogleHttpClient(config);
  const webhookSecurity = createWebhookSecurity({
    twilioAuthToken: config.TWILIO_AUTH_TOKEN,
    sendGridVerificationKey: config.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY,
    googlePubSubAudience: config.GOOGLE_PUBSUB_AUDIENCE,
    googlePubSubServiceAccount: config.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL,
  });
  const app = await buildApp({
    config,
    repository,
    surface: "application",
    googleClient,
    webhookSecurity,
    externalWebhookBaseUrl: config.EXTERNAL_WEBHOOK_BASE_URL,
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await Promise.all([authPool.end(), runtimePool.end()]);
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
  } catch (error) {
    await close();
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Afterword API failed to start: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
});
