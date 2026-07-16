import { buildApp } from "./app.js";
import { databaseUrl, loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { loadLocalEnvironment } from "./load-env.js";
import { createWebhookSecurity } from "./providers/webhook-security.js";
import { PostgresRepository } from "./repository/postgres.js";

async function main() {
  loadLocalEnvironment();
  const config = loadConfig(process.env, ["ingress"]);
  const ingressPool = createPool(
    databaseUrl(config, "ingress"),
    config.DATABASE_SSL === "require",
    "afterword-ingress",
  );
  const repository = new PostgresRepository({ ingressPool, config });
  const webhookSecurity = createWebhookSecurity({
    twilioAuthToken: config.TWILIO_AUTH_TOKEN,
    sendGridVerificationKey: config.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY,
    googlePubSubAudience: config.GOOGLE_PUBSUB_AUDIENCE,
    googlePubSubServiceAccount: config.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL,
  });
  const app = await buildApp({
    config,
    repository,
    surface: "ingress",
    webhookSecurity,
    externalWebhookBaseUrl: config.EXTERNAL_WEBHOOK_BASE_URL,
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await ingressPool.end();
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });

  try {
    await app.listen({ host: config.INGRESS_HOST, port: config.INGRESS_PORT });
  } catch (error) {
    await close();
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Afterword ingress failed to start: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
});
