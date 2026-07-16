import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseUrl, loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { loadLocalEnvironment } from "./load-env.js";
import { createDeliveryProviders, type DeliveryProviderMap } from "./providers/delivery.js";
import { GoogleHttpClient, synchronizeDueGoogleConnections, validateGoogleReviewUri, type GoogleBusinessProfileClient } from "./providers/google.js";
import { PostgresRepository } from "./repository/postgres.js";
import { decryptField } from "./security/crypto.js";
import type { MessagePayload, PlatformRepository } from "./types.js";

export interface DeliveryCycleOptions {
  repository: PlatformRepository;
  providers: DeliveryProviderMap;
  encryptionKey: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}

export interface DeliveryCycleResult {
  claimed: number;
  accepted: number;
  failed: number;
  unknown: number;
  deferred: number;
  blocked: number;
}

export interface GoogleTokenRevocationCycleResult {
  claimed: number;
  completed: number;
  failed: number;
}

export async function runGoogleTokenRevocationCycle(options: {
  repository: PlatformRepository;
  googleClient: Pick<GoogleBusinessProfileClient, "revokeToken">;
  encryptionKey: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}): Promise<GoogleTokenRevocationCycleResult> {
  const result = { claimed: 0, completed: 0, failed: 0 };
  if (!options.repository.claimGoogleTokenRevocations || !options.repository.finishGoogleTokenRevocation) {
    return result;
  }
  const jobs = await options.repository.claimGoogleTokenRevocations(
    options.workerId,
    options.limit ?? 20,
    options.leaseSeconds ?? 120,
  );
  result.claimed = jobs.length;
  for (const job of jobs) {
    let succeeded = false;
    let failure: string | undefined;
    try {
      if (job.keyVersion !== 1) throw new Error(`Unsupported encrypted token key version ${job.keyVersion}.`);
      if (!options.googleClient.revokeToken) throw new Error("Google token revocation is unavailable.");
      const token = decryptField(
        job.token,
        options.encryptionKey,
        `${job.businessId}:google-oauth-${job.tokenKind}`,
      );
      await options.googleClient.revokeToken(token);
      succeeded = true;
    } catch (error) {
      failure = error instanceof Error ? error.message.slice(0, 500) : "Google token revocation failed.";
    }
    await options.repository.finishGoogleTokenRevocation(
      job.revocationId,
      options.workerId,
      job.leaseToken,
      succeeded,
      failure,
    );
    if (succeeded) result.completed += 1;
    else result.failed += 1;
  }
  return result;
}

function renderReviewMessage(payload: MessagePayload) {
  const reviewUri = validateGoogleReviewUri(payload.reviewUri);
  if (!payload.body.includes("{{review_link}}")) {
    throw new Error("The approved template does not contain the required review-link placeholder.");
  }
  const body = payload.body.replaceAll("{{review_link}}", reviewUri);
  if (body.includes("{{review_link}}")) throw new Error("The review-link placeholder was not fully rendered.");
  return body;
}

export async function runDeliveryCycle(options: DeliveryCycleOptions): Promise<DeliveryCycleResult> {
  const result: DeliveryCycleResult = {
    claimed: 0,
    accepted: 0,
    failed: 0,
    unknown: 0,
    deferred: 0,
    blocked: 0,
  };
  const jobs = await options.repository.claimMessageJobs(
    options.workerId,
    options.limit ?? 25,
    options.leaseSeconds ?? 120,
  );
  result.claimed = jobs.length;
  for (const job of jobs) {
    try {
      const authorization = await options.repository.authorizeMessageDispatch(job.id, options.workerId, job.leaseToken);
      if (!authorization.allowed) {
        if (authorization.nextAllowedAt) {
          await options.repository.deferMessageJob(
            job.id,
            options.workerId,
            job.leaseToken,
            authorization.nextAllowedAt,
            authorization.reason,
          );
          result.deferred += 1;
        } else {
          result.blocked += 1;
        }
        continue;
      }

      const payload = await options.repository.getMessagePayload(job.id, options.workerId, job.leaseToken);
      let deliveryResult: "accepted" | "failed" | "unknown" = "failed";
      let providerMessageId: string | undefined;
      let responseCode: string | undefined;
      let errorCode: string | undefined;
      try {
        if (payload.businessId !== job.businessId || payload.channel !== job.channel) {
          throw new Error("The leased payload does not match the claimed message job.");
        }
        const provider = options.providers[job.channel];
        if (!provider?.isConfigured()) {
          throw new Error(`${job.channel.toUpperCase()} delivery is not configured.`);
        }
        const destination = decryptField(
          payload.destination,
          options.encryptionKey,
          `${job.businessId}:message-destination`,
        );
        const providerResult = await provider.send({
          jobId: job.id,
          attemptId: payload.messageAttemptId,
          destination,
          subject: payload.subject,
          body: renderReviewMessage(payload),
          idempotencyKey: payload.idempotencyKey,
        });
        deliveryResult = providerResult.result;
        providerMessageId = providerResult.providerMessageId;
        responseCode = providerResult.responseCode;
        errorCode = providerResult.errorCode;
      } catch (error) {
        deliveryResult = "failed";
        errorCode = error instanceof Error ? error.message.slice(0, 240) : "DELIVERY_PREPARATION_FAILED";
      }
      await options.repository.finishMessageAttempt({
        messageAttemptId: payload.messageAttemptId,
        jobId: job.id,
        workerId: options.workerId,
        leaseToken: job.leaseToken,
        result: deliveryResult,
        providerMessageId,
        responseCode,
        errorCode,
      });
      result[deliveryResult] += 1;
    } catch {
      // The lease expires naturally. Other jobs in the batch can still progress.
      result.unknown += 1;
    }
  }
  return result;
}

async function main() {
  loadLocalEnvironment();
  const config = loadConfig(process.env, ["worker"]);
  const requireSsl = config.DATABASE_SSL === "require";
  const workerPool = createPool(databaseUrl(config, "worker"), requireSsl, "afterword-worker");
  const repository = new PostgresRepository({
    workerPool,
    config,
  });
  const providers = createDeliveryProviders(config, config.EXTERNAL_WEBHOOK_BASE_URL);
  const googleClient = new GoogleHttpClient(config);
  const workerId = `delivery-${process.pid}-${randomUUID()}`;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let nextGoogleSyncAt = 0;
  let nextGoogleRevocationAt = 0;
  while (!stopping) {
    const delivery = await runDeliveryCycle({
      repository,
      providers,
      encryptionKey: config.FIELD_ENCRYPTION_KEY,
      workerId,
    });
    if (googleClient.isConfigured() && Date.now() >= nextGoogleSyncAt) {
      await synchronizeDueGoogleConnections(repository, googleClient, config.FIELD_ENCRYPTION_KEY, 20);
      nextGoogleSyncAt = Date.now() + 5 * 60 * 1_000;
    }
    if (Date.now() >= nextGoogleRevocationAt) {
      await runGoogleTokenRevocationCycle({
        repository,
        googleClient,
        encryptionKey: config.FIELD_ENCRYPTION_KEY,
        workerId,
      });
      nextGoogleRevocationAt = Date.now() + 30 * 1_000;
    }
    if (process.env.WORKER_ONCE === "true") break;
    if (delivery.claimed === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await workerPool.end();
}

const isEntrypoint = Boolean(process.argv[1])
  && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isEntrypoint) {
  main().catch((error: unknown) => {
    process.stderr.write(`Afterword worker stopped: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  });
}
