import { execFile } from "node:child_process";
import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { access, link, lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { hostname as nodeHostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CAPACITY_THRESHOLD,
  DIRECT_DATABASE_HOST,
  EXPECTED_DATABASE_ROLES,
  ROTATION_SENSITIVE_TABLES,
  STAGING_PROJECT_REF,
  validateCapacityEnvironment,
  type CapacityEvidence,
  type HyperdriveOrigin,
} from "./assert-free-capacity.js";

type DatabaseBinding = "AUTH_DB" | "RUNTIME_DB" | "INGRESS_DB" | "WORKER_DB";
type RuntimeName = "application" | "compatibility" | "ingress" | "jobs";

export const HYPERDRIVE_SPECS = [
  {
    binding: "AUTH_DB",
    config: "application",
    configName: "review-anchor-staging",
    name: "review-anchor-staging-auth",
  },
  {
    binding: "RUNTIME_DB",
    config: "application",
    configName: "review-anchor-staging",
    name: "review-anchor-staging-runtime",
  },
  {
    binding: "INGRESS_DB",
    config: "ingress",
    configName: "review-anchor-staging-ingress",
    name: "review-anchor-staging-ingress",
  },
  {
    binding: "WORKER_DB",
    config: "jobs",
    configName: "review-anchor-staging-jobs",
    name: "review-anchor-staging-worker",
  },
] as const;

export type HyperdriveSpec = typeof HYPERDRIVE_SPECS[number];

const EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
const EVIDENCE_FUTURE_SKEW_MS = 60 * 1000;

export interface SanitizedHyperdriveDescriptor {
  binding: DatabaseBinding;
  cachingDisabled: true;
  database: string;
  host: string;
  name: string;
  originConnectionLimit: 5;
  port: 5432;
  sslmode: "require";
  user: string;
}

export interface HyperdriveOperationEntry {
  attempted: boolean;
  descriptor: SanitizedHyperdriveDescriptor;
  disposition?: "created" | "reused";
  id?: string;
  runId: string;
  state: "pending" | "resolved";
}

export interface HyperdriveOperation {
  resources: Record<DatabaseBinding, HyperdriveOperationEntry>;
  runId: string;
  startedAt: string;
  status: "pending" | "complete";
}

export interface AccountEvidence {
  accountId: string;
  accountVerified: true;
  checkedAt: string;
  freePlanVerified: true;
  hyperdriveAvailableWithoutUpgrade: true;
  monthlyRecurringCostUsd: 0;
  projectRef: typeof STAGING_PROJECT_REF;
  queuesAvailableWithoutUpgrade: true;
  version: 1;
  workersDevSubdomain: string;
  hyperdriveOperation?: HyperdriveOperation;
}

export interface WorkersDevOrigins {
  application: string;
  ingress: string;
}

export interface SecretPayloads {
  application: {
    DATA_HASH_PEPPER: string;
    FIELD_ENCRYPTION_KEY: string;
    SESSION_PEPPER: string;
  };
  compatibility: { COMPAT_GATE_TOKEN: string };
  ingress: {
    DATA_HASH_PEPPER: string;
    FIELD_ENCRYPTION_KEY: string;
  };
  jobs: { FIELD_ENCRYPTION_KEY: string };
}

export interface PreparationPaths {
  accountEvidence: string;
  capacityEvidence: string;
  configs: {
    application: string;
    ingress: string;
  };
  environment: string;
  preRotationSecrets: string;
  secretFiles: Record<RuntimeName, string>;
  transactionJournal: string;
}

export interface PrepareStagingOptions {
  confirmations: WorkersDevOrigins;
  confirmedEmptyStagingData: boolean;
  paths: PreparationPaths;
  randomBytes?: (size: number) => Uint8Array;
  rotate: boolean;
  preparationLock?: {
    afterRecoveryCleanupElectionCandidateLinked?: (candidatePath: string, ownerPath: string) => Promise<void> | void;
    afterRecoveryCleanupElection?: (ownerPath: string, claimantOwnerId: string) => Promise<void> | void;
    afterRecoveryCleanupJournalCandidateLinked?: (candidatePath: string, journalPath: string) => Promise<void> | void;
    afterRecoveryCleanupJournalCasInstalled?: (journalPath: string, nextPath: string) => Promise<void> | void;
    afterRecoveryCleanupJournalCasNextCreated?: (nextPath: string, journalPath: string) => Promise<void> | void;
    afterRecoveryCleanupJournalCasPriorLinked?: (priorPath: string, journalPath: string) => Promise<void> | void;
    afterRecoveryCleanupJournalCasReady?: (
      journalPath: string,
      priorPath: string,
      nextPath: string,
    ) => Promise<void> | void;
    afterRecoveryCleanupJournalUpdate?: (
      kind: "artifact" | "claim",
      filePath: string,
    ) => Promise<void> | void;
    afterRecoveryCleanupUnlinkBeforeJournalUpdate?: (
      kind: "artifact" | "claim",
      filePath: string,
    ) => Promise<void> | void;
    afterRecoveryClaimAcquired?: () => Promise<void> | void;
    afterRecoveryClaimQuarantined?: (quarantinePath: string) => Promise<void> | void;
    afterRecoveryTransitionCandidateLinked?: (candidatePath: string, ownerPath: string) => Promise<void> | void;
    beforeExistingRecoveryQuarantineCleanup?: (quarantinePath: string) => Promise<void> | void;
    beforeRecoveryArtifactClaimUnlink?: (filePath: string, attempt: number) => Promise<void> | void;
    beforeRecoveryCleanupElectionUnlink?: (filePath: string, attempt: number) => Promise<void> | void;
    beforeRecoveryClaimCleanup?: (
      filePath: string,
      artifact: "quarantine" | "transition",
    ) => Promise<void> | void;
    isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
  };
  transactionHooks?: {
    beforeAtomicRename?: (temporaryPath: string, destination: string) => Promise<void> | void;
    beforeReplace?: (index: number, destination: string) => Promise<void> | void;
  };
}

export interface HyperdriveProvisionPaths {
  accountEvidence: string;
  capacityEvidence: string;
  configs: {
    application: string;
    ingress: string;
    jobs: string;
  };
  environment: string;
}

export interface ProvisionHyperdrivesOptions {
  cwd: string;
  now?: () => number;
  paths: HyperdriveProvisionPaths;
  runIdFactory?: () => string;
  runner?: WranglerRunner;
  wranglerVersion?: string;
}

export interface WranglerInvocation {
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  file: string;
}

export interface HyperdriveResource {
  caching: { disabled: boolean };
  id: string;
  name: string;
  origin: {
    database: string;
    host: string;
    port: number;
    scheme: string;
    user: string;
  };
  origin_connection_limit: number;
  sslmode: string;
}

export interface HyperdriveListEntry {
  caching: string;
  database: string;
  host: string;
  id: string;
  mtls: string;
  name: string;
  originConnectionLimit?: number;
  port?: number;
  scheme: string;
  user: string;
}

class SafeProvisionError extends Error {}

class RecoveryCleanupRetryExhaustedError extends SafeProvisionError {}

export interface CanonicalFilesystemIdentity {
  dev: string;
  ino: string;
  nlink: string;
}

const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;

export function canonicalFilesystemIdentity(value: {
  dev: bigint;
  ino: bigint;
  nlink: bigint;
}): CanonicalFilesystemIdentity {
  assertSafe(value.dev >= 0n && value.ino > 0n && value.nlink > 0n, "Filesystem identity is invalid.");
  return {
    dev: value.dev.toString(10),
    ino: value.ino.toString(10),
    nlink: value.nlink.toString(10),
  };
}

export function validateCanonicalFilesystemIdentity(
  value: unknown,
  description = "Filesystem identity",
): CanonicalFilesystemIdentity {
  assertSafe(
    isObject(value)
      && typeof value.dev === "string"
      && CANONICAL_UNSIGNED_DECIMAL.test(value.dev)
      && typeof value.ino === "string"
      && /^[1-9][0-9]*$/.test(value.ino)
      && typeof value.nlink === "string"
      && /^[1-9][0-9]*$/.test(value.nlink),
    `${description} must use canonical non-negative decimal string evidence.`,
  );
  return { dev: value.dev, ino: value.ino, nlink: value.nlink };
}

export function sameFilesystemObject(
  left: CanonicalFilesystemIdentity,
  right: CanonicalFilesystemIdentity,
) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameExactFilesystemIdentity(
  left: CanonicalFilesystemIdentity,
  right: CanonicalFilesystemIdentity,
) {
  return sameFilesystemObject(left, right) && left.nlink === right.nlink;
}

function assertSafe(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SafeProvisionError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRunId(value: unknown): asserts value is string {
  assertSafe(
    typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    "The provisioning operation run ID is invalid.",
  );
}

function validateCheckedAt(value: unknown, now: number, description: "account" | "capacity") {
  assertSafe(typeof value === "string", `${description} evidence checkedAt is missing or invalid.`);
  const checkedAt = Date.parse(value);
  assertSafe(Number.isFinite(checkedAt), `${description} evidence checkedAt is missing or invalid.`);
  assertSafe(checkedAt <= now + EVIDENCE_FUTURE_SKEW_MS, `${description} evidence checkedAt is unreasonably in the future.`);
  assertSafe(now - checkedAt <= EVIDENCE_MAX_AGE_MS, `${description} evidence is stale.`);
}

function expectedDescriptor(spec: HyperdriveSpec, origin?: HyperdriveOrigin): SanitizedHyperdriveDescriptor {
  const role = EXPECTED_DATABASE_ROLES.get(spec.binding);
  assertSafe(role, "An unexpected Hyperdrive binding was selected.");
  return {
    binding: spec.binding,
    name: spec.name,
    host: origin?.host ?? DIRECT_DATABASE_HOST,
    database: origin?.database ?? "postgres",
    user: origin?.user ?? role,
    port: 5432,
    sslmode: "require",
    cachingDisabled: true,
    originConnectionLimit: 5,
  };
}

function validateDescriptor(value: unknown, spec: HyperdriveSpec) {
  assertSafe(isObject(value), `The ${spec.binding} Hyperdrive descriptor is invalid.`);
  const expected = expectedDescriptor(spec);
  assertSafe(
    exactKeys(value, Object.keys(expected))
      && Object.entries(expected).every(([name, expectedValue]) => value[name] === expectedValue),
    `The ${spec.binding} Hyperdrive descriptor does not match the exact sanitized staging resource.`,
  );
}

function validateHyperdriveOperation(value: unknown): HyperdriveOperation {
  assertSafe(isObject(value), "Recorded Hyperdrive operation provenance is invalid.");
  assertRunId(value.runId);
  assertSafe(typeof value.startedAt === "string" && Number.isFinite(Date.parse(value.startedAt)), "Recorded Hyperdrive operation start time is invalid.");
  assertSafe(value.status === "pending" || value.status === "complete", "Recorded Hyperdrive operation status is invalid.");
  assertSafe(isObject(value.resources), "Recorded Hyperdrive operation resources are invalid.");
  assertSafe(
    JSON.stringify(Object.keys(value.resources).sort())
      === JSON.stringify(HYPERDRIVE_SPECS.map(({ binding }) => binding).sort()),
    "Recorded Hyperdrive operation must contain the four exact staging bindings.",
  );
  let resolved = 0;
  for (const spec of HYPERDRIVE_SPECS) {
    const entry = value.resources[spec.binding];
    assertSafe(isObject(entry), `Recorded ${spec.binding} Hyperdrive provenance is invalid.`);
    assertSafe(entry.runId === value.runId, `Recorded ${spec.binding} Hyperdrive provenance belongs to a foreign run.`);
    assertSafe(typeof entry.attempted === "boolean", `Recorded ${spec.binding} Hyperdrive attempt state is invalid.`);
    validateDescriptor(entry.descriptor, spec);
    if (entry.state === "pending") {
      assertSafe(entry.id === undefined && entry.disposition === undefined, `Pending ${spec.binding} provenance cannot contain a resource result.`);
    } else {
      assertSafe(entry.state === "resolved", `Recorded ${spec.binding} Hyperdrive state is invalid.`);
      assertResourceId(entry.id);
      assertSafe(entry.disposition === "created" || entry.disposition === "reused", `Recorded ${spec.binding} disposition is invalid.`);
      assertSafe(entry.disposition !== "created" || entry.attempted === true, `Created ${spec.binding} provenance must record a mutation attempt.`);
      resolved += 1;
    }
  }
  assertSafe(
    (value.status === "complete") === (resolved === HYPERDRIVE_SPECS.length),
    "Recorded Hyperdrive operation completion state is inconsistent.",
  );
  return value as unknown as HyperdriveOperation;
}

export function validateAccountEvidence(value: unknown, now = Date.now()): AccountEvidence {
  assertSafe(isObject(value), "Authenticated Cloudflare account evidence is invalid.");
  assertSafe(value.version === 1, "Authenticated Cloudflare account evidence has an unsupported version.");
  assertSafe(value.projectRef === STAGING_PROJECT_REF, "Cloudflare evidence is not bound to the staging project.");
  assertSafe(
    typeof value.accountId === "string" && /^[0-9a-f]{32}$/i.test(value.accountId),
    "The authenticated Cloudflare account identifier is invalid.",
  );
  assertSafe(
    typeof value.workersDevSubdomain === "string"
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value.workersDevSubdomain),
    "The account Workers.dev subdomain must be exactly one DNS label.",
  );
  assertSafe(value.accountVerified === true, "The Cloudflare account has not been authenticated and verified.");
  assertSafe(value.freePlanVerified === true, "The Cloudflare Workers Free plan has not been verified.");
  assertSafe(
    value.hyperdriveAvailableWithoutUpgrade === true,
    "Hyperdrive availability without an upgrade has not been verified.",
  );
  assertSafe(
    value.queuesAvailableWithoutUpgrade === true,
    "Queues availability without an upgrade has not been verified.",
  );
  assertSafe(value.monthlyRecurringCostUsd === 0, "The staging resource evidence does not prove zero monthly cost.");
  validateCheckedAt(value.checkedAt, now, "account");
  assertSafe(value.hyperdrives === undefined, "Legacy Hyperdrive ID evidence without provenance was refused.");
  if (value.hyperdriveOperation !== undefined) validateHyperdriveOperation(value.hyperdriveOperation);
  return value as unknown as AccountEvidence;
}

export function validateCapacityEvidence(value: unknown, now = Date.now()): CapacityEvidence {
  assertSafe(isObject(value) && value.version === 1 && value.passed === true, "Capacity evidence is missing or invalid.");
  assertSafe(value.projectRef === STAGING_PROJECT_REF, "Capacity evidence is not bound to the staging project.");
  validateCheckedAt(value.checkedAt, now, "capacity");
  assertSafe(
    Number.isSafeInteger(value.maxConnections) && (value.maxConnections as number) >= 0
      && Number.isSafeInteger(value.activeConnections) && (value.activeConnections as number) >= 0
      && Number.isSafeInteger(value.availableConnections) && (value.availableConnections as number) >= 0,
    "Capacity evidence connection arithmetic contains invalid values.",
  );
  assertSafe(
    (value.maxConnections as number) - (value.activeConnections as number) === value.availableConnections,
    "Capacity evidence connection arithmetic is inconsistent.",
  );
  assertSafe(
    value.threshold === CAPACITY_THRESHOLD
      && typeof value.availableConnections === "number"
      && value.availableConnections >= CAPACITY_THRESHOLD,
    `Capacity evidence must prove at least ${CAPACITY_THRESHOLD} available direct connections.`,
  );
  assertSafe(Array.isArray(value.roles), "Capacity evidence does not contain exact role results.");
  assertSafe(
    JSON.stringify(value.roles) === JSON.stringify([...EXPECTED_DATABASE_ROLES.values()]),
    "Capacity evidence does not contain the four exact staging roles.",
  );
  assertSafe(isObject(value.tableCounts), "Capacity evidence does not contain table counts.");
  const nonEmpty: string[] = [];
  for (const table of ROTATION_SENSITIVE_TABLES) {
    const count = value.tableCounts[table];
    assertSafe(Number.isSafeInteger(count) && (count as number) >= 0, `${table} has an invalid capacity count.`);
    if (count !== 0) nonEmpty.push(`${table}=${String(count)}`);
  }
  assertSafe(nonEmpty.length === 0, `Rotation-sensitive staging tables are not empty: ${nonEmpty.join(", ")}.`);
  return value as unknown as CapacityEvidence;
}

export function validateMutationPreflight(accountValue: unknown, capacityValue: unknown, now = Date.now()) {
  return {
    account: validateAccountEvidence(accountValue, now),
    capacity: validateCapacityEvidence(capacityValue, now),
  };
}

export function deriveWorkersDevOrigins(
  evidenceValue: unknown,
  confirmations: WorkersDevOrigins,
): WorkersDevOrigins {
  const evidence = validateAccountEvidence(evidenceValue);
  const expected = {
    application: `https://review-anchor-staging.${evidence.workersDevSubdomain.toLowerCase()}.workers.dev`,
    ingress: `https://review-anchor-staging-ingress.${evidence.workersDevSubdomain.toLowerCase()}.workers.dev`,
  };
  assertSafe(
    confirmations.application === expected.application && confirmations.ingress === expected.ingress,
    "The explicit Workers.dev origin confirmation does not match the authenticated account.",
  );
  return expected;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function opaqueSecret(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function verifySecretPayloads(value: unknown): SecretPayloads {
  assertSafe(isObject(value), "The staging secret payload set is invalid.");
  const compatibility = value.compatibility;
  const application = value.application;
  const ingress = value.ingress;
  const jobs = value.jobs;
  assertSafe(isObject(compatibility) && exactKeys(compatibility, ["COMPAT_GATE_TOKEN"]), "The compatibility secret payload violates least-privilege boundaries.");
  assertSafe(isObject(application) && exactKeys(application, ["SESSION_PEPPER", "DATA_HASH_PEPPER", "FIELD_ENCRYPTION_KEY"]), "The application secret payload violates least-privilege boundaries.");
  assertSafe(isObject(ingress) && exactKeys(ingress, ["DATA_HASH_PEPPER", "FIELD_ENCRYPTION_KEY"]), "The ingress secret payload violates least-privilege boundaries.");
  assertSafe(isObject(jobs) && exactKeys(jobs, ["FIELD_ENCRYPTION_KEY"]), "The jobs secret payload violates least-privilege boundaries.");
  const allValues = [
    compatibility.COMPAT_GATE_TOKEN,
    application.SESSION_PEPPER,
    application.DATA_HASH_PEPPER,
    application.FIELD_ENCRYPTION_KEY,
    ingress.DATA_HASH_PEPPER,
    ingress.FIELD_ENCRYPTION_KEY,
    jobs.FIELD_ENCRYPTION_KEY,
  ];
  assertSafe(allValues.every(opaqueSecret), "A staging secret payload contains an invalid generated value.");
  assertSafe(application.SESSION_PEPPER !== application.DATA_HASH_PEPPER, "Session and data-hash peppers must differ.");
  assertSafe(application.DATA_HASH_PEPPER === ingress.DATA_HASH_PEPPER, "Application and ingress data-hash peppers must match.");
  assertSafe(
    application.FIELD_ENCRYPTION_KEY === ingress.FIELD_ENCRYPTION_KEY
      && application.FIELD_ENCRYPTION_KEY === jobs.FIELD_ENCRYPTION_KEY,
    "Application, ingress, and jobs encryption keys must match.",
  );
  return value as unknown as SecretPayloads;
}

export function createSecretMaterial(
  generate: (size: number) => Uint8Array = nodeRandomBytes,
) {
  const values = {
    COMPAT_GATE_TOKEN: Buffer.from(generate(32)).toString("base64url"),
    SESSION_PEPPER: Buffer.from(generate(32)).toString("base64url"),
    DATA_HASH_PEPPER: Buffer.from(generate(32)).toString("base64url"),
    FIELD_ENCRYPTION_KEY: Buffer.from(generate(32)).toString("base64url"),
  };
  assertSafe(new Set(Object.values(values)).size === 4, "Generated staging secrets are not independent.");
  const payloads: SecretPayloads = {
    compatibility: { COMPAT_GATE_TOKEN: values.COMPAT_GATE_TOKEN },
    application: {
      SESSION_PEPPER: values.SESSION_PEPPER,
      DATA_HASH_PEPPER: values.DATA_HASH_PEPPER,
      FIELD_ENCRYPTION_KEY: values.FIELD_ENCRYPTION_KEY,
    },
    ingress: {
      DATA_HASH_PEPPER: values.DATA_HASH_PEPPER,
      FIELD_ENCRYPTION_KEY: values.FIELD_ENCRYPTION_KEY,
    },
    jobs: { FIELD_ENCRYPTION_KEY: values.FIELD_ENCRYPTION_KEY },
  };
  verifySecretPayloads(payloads);
  return { payloads, values };
}

export function patchEnvironmentText(
  source: string,
  replacements: Record<"DATA_HASH_PEPPER" | "FIELD_ENCRYPTION_KEY" | "SESSION_PEPPER", string>,
) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  for (const [name, replacement] of Object.entries(replacements)) {
    assertSafe(replacement.length > 0 && !/[\r\n=]/.test(replacement), `${name} has an invalid replacement value.`);
    const indexes = lines.flatMap((line, index) => line.startsWith(`${name}=`) ? [index] : []);
    assertSafe(indexes.length <= 1, `The staging environment contains a duplicate ${name} entry.`);
    if (indexes.length === 1) lines[indexes[0] as number] = `${name}=${replacement}`;
    else lines.push(`${name}=${replacement}`);
  }
  return `${lines.join(eol)}${eol}`;
}

function parseWranglerConfig(source: string, expectedName: string) {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(source) as Record<string, unknown>;
  } catch {
    throw new SafeProvisionError("A tracked Wrangler config is not strict JSON and cannot be patched safely.");
  }
  assertSafe(isObject(config), "A tracked Wrangler config is invalid.");
  assertSafe(config.name === expectedName && expectedName.includes("staging"), "The config is not the exact staging Worker.");
  return config;
}

function serializeConfig(config: Record<string, unknown>) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function patchOriginConfigs(
  sources: { application: string; ingress: string },
  origins: WorkersDevOrigins,
) {
  const application = parseWranglerConfig(sources.application, "review-anchor-staging");
  const ingress = parseWranglerConfig(sources.ingress, "review-anchor-staging-ingress");
  assertSafe(isObject(application.vars) && application.vars.PROVIDER_DELIVERY_ENABLED === "false", "Application provider delivery must remain disabled.");
  assertSafe(isObject(ingress.vars) && ingress.vars.PROVIDER_DELIVERY_ENABLED === "false", "Ingress provider delivery must remain disabled.");
  application.vars = {
    ...application.vars,
    APP_ORIGIN: origins.application,
    PUBLIC_REVIEW_ORIGIN: origins.application,
  };
  ingress.vars = {
    ...ingress.vars,
    APP_ORIGIN: origins.application,
    PUBLIC_REVIEW_BASE_URL: origins.application,
    EXTERNAL_WEBHOOK_BASE_URL: origins.ingress,
  };
  return { application: serializeConfig(application), ingress: serializeConfig(ingress) };
}

function assertResourceId(value: unknown): asserts value is string {
  assertSafe(typeof value === "string" && /^[0-9a-f]{32}$/i.test(value), "A Hyperdrive resource identifier is invalid.");
}

function expectedBindings(config: HyperdriveSpec["config"]) {
  return HYPERDRIVE_SPECS.filter((spec) => spec.config === config).map((spec) => spec.binding);
}

function patchConfigBindings(
  source: string,
  config: HyperdriveSpec["config"],
  ids: Readonly<Record<string, string>>,
) {
  const spec = HYPERDRIVE_SPECS.find((candidate) => candidate.config === config);
  assertSafe(spec, "An unexpected staging config was selected.");
  const document = parseWranglerConfig(source, spec.configName);
  if (document.hyperdrive !== undefined) {
    assertSafe(Array.isArray(document.hyperdrive), "A tracked Hyperdrive binding block is invalid.");
    const allowed = new Set(expectedBindings(config));
    for (const entry of document.hyperdrive) {
      assertSafe(isObject(entry) && allowed.has(entry.binding as DatabaseBinding), "A tracked config contains an unexpected Hyperdrive binding.");
    }
  }
  document.hyperdrive = expectedBindings(config).map((binding) => {
    const id = ids[binding];
    assertResourceId(id);
    return { binding, id };
  });
  return serializeConfig(document);
}

export function patchHyperdriveBindings(
  sources: { application: string; ingress: string; jobs: string },
  ids: Readonly<Record<string, string>>,
) {
  return {
    application: patchConfigBindings(sources.application, "application", ids),
    ingress: patchConfigBindings(sources.ingress, "ingress", ids),
    jobs: patchConfigBindings(sources.jobs, "jobs", ids),
  };
}

export function bindCompatibilityConfig(source: string, ids: Readonly<Record<string, string>>) {
  const config = parseWranglerConfig(source, "review-anchor-staging-compat");
  assertSafe(
    config.hyperdrive === undefined || (Array.isArray(config.hyperdrive) && config.hyperdrive.length === 0),
    "The compatibility Wrangler config must be binding-free before temporary binding.",
  );
  config.hyperdrive = HYPERDRIVE_SPECS.map(({ binding }) => {
    const id = ids[binding];
    assertResourceId(id);
    return { binding, id };
  });
  return serializeConfig(config);
}

export function restoreCompatibilityConfig(current: string, bindingFreeSnapshot: string) {
  parseWranglerConfig(current, "review-anchor-staging-compat");
  const snapshot = parseWranglerConfig(bindingFreeSnapshot, "review-anchor-staging-compat");
  assertSafe(
    snapshot.hyperdrive === undefined || (Array.isArray(snapshot.hyperdrive) && snapshot.hyperdrive.length === 0),
    "The compatibility config snapshot is not binding-free.",
  );
  return bindingFreeSnapshot;
}

function wranglerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = [
    "APPDATA",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_COMPLIANCE_REGION",
    "CLOUDFLARE_EMAIL",
    "HOME",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
    "WRANGLER_HOME",
  ];
  const environment: NodeJS.ProcessEnv = { CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" };
  for (const name of allowed) if (source[name] !== undefined) environment[name] = source[name];
  return environment;
}

function wranglerInvocation(cwd: string, args: string[]): WranglerInvocation {
  return {
    args: [path.resolve(cwd, "node_modules", "wrangler", "bin", "wrangler.js"), ...args],
    cwd,
    environment: wranglerEnvironment(),
    file: process.execPath,
  };
}

export function buildWranglerWhoamiInvocation(cwd: string) {
  return wranglerInvocation(cwd, ["whoami", "--json"]);
}

export function buildHyperdriveListInvocation(cwd: string) {
  return wranglerInvocation(cwd, ["hyperdrive", "list"]);
}

export function buildHyperdriveGetInvocation(id: string, cwd: string) {
  assertResourceId(id);
  return wranglerInvocation(cwd, ["hyperdrive", "get", id]);
}

export function validateWranglerVersion(version: string) {
  assertSafe(version === "4.112.0", `The unsupported Wrangler version ${version} was refused; expected 4.112.0.`);
  return version;
}

export function buildHyperdriveCreateInvocation(
  spec: HyperdriveSpec,
  origin: HyperdriveOrigin,
  cwd: string,
) {
  assertSafe(spec.name.includes("staging"), "A non-staging Hyperdrive name was refused.");
  assertSafe(origin.host === DIRECT_DATABASE_HOST, "Hyperdrive must use the exact direct staging database host.");
  assertSafe(!origin.user.includes("."), "A pooled Hyperdrive username was refused.");
  assertSafe(origin.sslmode === "require", "Hyperdrive must require TLS.");
  assertSafe(origin.cachingDisabled === true, "Hyperdrive caching must remain disabled.");
  assertSafe(origin.originConnectionLimit === 5, "Hyperdrive origin connection limit must remain five.");
  return wranglerInvocation(cwd, [
    "hyperdrive",
    "create",
    spec.name,
    "--host",
    origin.host,
    "--database",
    origin.database,
    "--user",
    origin.user,
    "--password",
    origin.password,
    "--port",
    String(origin.port),
    "--sslmode",
    origin.sslmode,
    "--caching-disabled",
    "--origin-connection-limit",
    String(origin.originConnectionLimit),
  ]);
}

export function redactWranglerInvocation(invocation: WranglerInvocation): WranglerInvocation {
  const args = [...invocation.args];
  const passwordIndex = args.indexOf("--password");
  if (passwordIndex >= 0 && passwordIndex + 1 < args.length) args[passwordIndex + 1] = "[REDACTED]";
  const environment = { ...invocation.environment };
  for (const name of ["CLOUDFLARE_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_EMAIL"]) {
    if (environment[name]) environment[name] = "[REDACTED]";
  }
  return { ...invocation, args, environment };
}

function validateHyperdriveResource(value: unknown): HyperdriveResource {
  assertSafe(isObject(value), "A Hyperdrive entry in Wrangler JSON is invalid.");
  assertResourceId(value.id);
  assertSafe(
    typeof value.name === "string" && /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(value.name),
    "Wrangler returned an invalid Hyperdrive name.",
  );
  assertSafe(isObject(value.origin), "Wrangler returned invalid Hyperdrive origin metadata.");
  assertSafe(
    typeof value.origin.host === "string"
      && typeof value.origin.database === "string"
      && typeof value.origin.user === "string"
      && Number.isSafeInteger(value.origin.port)
      && typeof value.origin.scheme === "string",
    "Wrangler returned invalid Hyperdrive origin metadata.",
  );
  assertSafe(isObject(value.caching) && typeof value.caching.disabled === "boolean", "Wrangler returned invalid Hyperdrive caching metadata.");
  assertSafe(typeof value.origin_connection_limit === "number", "Wrangler returned an invalid Hyperdrive connection limit.");
  assertSafe(typeof value.sslmode === "string", "Wrangler returned invalid Hyperdrive TLS metadata.");
  return value as unknown as HyperdriveResource;
}

export function parseHyperdriveGetOutput(stdout: string) {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new SafeProvisionError("Hyperdrive get did not return valid Wrangler 4.112.0 JSON metadata.");
  }
  return validateHyperdriveResource(value);
}

export function parseHyperdriveListOutput(stdout: string) {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  assertSafe(lines[0] === "📋 Listing Hyperdrive configs", "Hyperdrive listing was not a captured Wrangler 4.112.0 table.");
  if (lines.length === 1) return [];
  const borders = lines.filter((line) => /^[┌├└┬┼┴┐┤┘─]+$/.test(line));
  const rows = lines.filter((line) => line.startsWith("│") && line.endsWith("│"));
  assertSafe(
    borders.length === 3 && rows.length >= 2 && borders.length + rows.length + 1 === lines.length,
    "Hyperdrive listing was not a captured Wrangler 4.112.0 table.",
  );
  const cells = rows.map((line) => line.slice(1, -1).split("│").map((cell) => cell.trim()));
  const expectedHeader = [
    "id",
    "name",
    "user",
    "host",
    "port",
    "scheme",
    "database",
    "caching",
    "mtls",
    "origin_connection_limit",
  ];
  assertSafe(
    JSON.stringify(cells[0]) === JSON.stringify(expectedHeader),
    "Hyperdrive listing was not a captured Wrangler 4.112.0 table.",
  );
  return cells.slice(1).map((row): HyperdriveListEntry => {
    assertSafe(row.length === expectedHeader.length, "Hyperdrive listing was not a captured Wrangler 4.112.0 table.");
    const [id, name, user, host, portText, scheme, database, caching, mtls, limitText] = row;
    assertResourceId(id);
    assertSafe(Boolean(name) && /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(name), "Wrangler returned an invalid Hyperdrive name.");
    assertSafe([user, host, scheme, database, caching, mtls].every((value) => value !== undefined && !/[\r\n│]/.test(value)), "Wrangler returned invalid Hyperdrive table metadata.");
    const port = portText ? Number(portText) : undefined;
    const originConnectionLimit = limitText ? Number(limitText) : undefined;
    assertSafe(port === undefined || Number.isSafeInteger(port), "Wrangler returned an invalid Hyperdrive table port.");
    assertSafe(originConnectionLimit === undefined || Number.isSafeInteger(originConnectionLimit), "Wrangler returned an invalid Hyperdrive table connection limit.");
    return {
      id,
      name,
      user,
      host,
      port,
      scheme,
      database,
      caching,
      mtls,
      originConnectionLimit,
    };
  });
}

export function parseHyperdriveCreateOutput(stdout: string) {
  const candidates = stdout.replace(/\r\n/g, "\n").split("\n")
    .filter((line) => line.startsWith("✅ Created new Hyperdrive"));
  assertSafe(
    candidates.length === 1,
    "Hyperdrive create did not return the exact Wrangler 4.112.0 success contract: expected exactly one exact success line and ID.",
  );
  const match = /^✅ Created new Hyperdrive (PostgreSQL) config: ([0-9a-f]{32})$/.exec(candidates[0] as string);
  assertSafe(match, "Hyperdrive create did not return the exact Wrangler 4.112.0 success contract.");
  return { scheme: match[1] as string, id: match[2] as string };
}

function selectExactListEntry(
  entries: readonly HyperdriveListEntry[],
  spec: HyperdriveSpec,
  origin: HyperdriveOrigin,
) {
  const matchingName = entries.filter((entry) => entry.name === spec.name);
  assertSafe(matchingName.length <= 1, `Multiple same-name Hyperdrives exist for ${spec.name}.`);
  if (matchingName.length === 0) return undefined;
  const entry = matchingName[0] as HyperdriveListEntry;
  const exact = entry.host === origin.host
    && entry.database === origin.database
    && entry.user === origin.user
    && entry.port === origin.port
    && entry.scheme.toLowerCase() === "postgresql"
    && entry.caching === "disabled"
    && entry.mtls === ""
    && entry.originConnectionLimit === origin.originConnectionLimit;
  assertSafe(exact, `The same-name Hyperdrive does not match the sanitized staging origin: ${spec.name}.`);
  return entry;
}

export function selectReusableHyperdrive(
  resources: readonly HyperdriveResource[],
  spec: HyperdriveSpec,
  origin: HyperdriveOrigin,
) {
  const matchingName = resources.filter((resource) => resource.name === spec.name);
  assertSafe(matchingName.length <= 1, `Multiple same-name Hyperdrives exist for ${spec.name}.`);
  if (matchingName.length === 0) return undefined;
  const resource = matchingName[0] as HyperdriveResource;
  const exact = resource.origin.host === origin.host
    && resource.origin.database === origin.database
    && resource.origin.user === origin.user
    && resource.origin.port === origin.port
    && ["postgres", "postgresql"].includes(resource.origin.scheme)
    && resource.sslmode === origin.sslmode
    && resource.caching.disabled === true
    && resource.origin_connection_limit === origin.originConnectionLimit;
  assertSafe(exact, `The same-name Hyperdrive does not match the sanitized staging origin: ${spec.name}.`);
  return resource.id;
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function rmdirIfPresent(directoryPath: string) {
  try {
    await rmdir(directoryPath);
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function readJson(filePath: string, description: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new SafeProvisionError(`${description} is missing or invalid.`);
  }
}

async function writeAtomic(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.pending`;
  await writeFile(temporaryPath, contents, { mode: 0o600 });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

interface PreparationLockOwner {
  acquiredAt: string;
  hostname: string;
  ownerId: string;
  pid: number;
  version: 1;
}

interface PreparationLockHandle {
  lockDirectory: string;
  owner: PreparationLockOwner;
}

const PREPARATION_OWNER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function preparationLockDirectory(paths: PreparationPaths) {
  return path.resolve(path.dirname(paths.transactionJournal), "staging-prepare.lock");
}

function validatePreparationLockOwner(value: unknown, description = "Staging preparation lock ownership metadata") {
  assertSafe(isObject(value) && value.version === 1, `${description} is invalid.`);
  assertSafe(
    typeof value.ownerId === "string"
      && PREPARATION_OWNER_ID_PATTERN.test(value.ownerId),
    `${description} is invalid.`,
  );
  assertSafe(
    Number.isInteger(value.pid) && Number(value.pid) > 0 && Number(value.pid) <= 0x7fffffff,
    `${description} is invalid.`,
  );
  assertSafe(
    typeof value.hostname === "string" && value.hostname.length > 0 && value.hostname.length <= 255,
    `${description} is invalid.`,
  );
  assertSafe(
    typeof value.acquiredAt === "string" && Number.isFinite(Date.parse(value.acquiredAt)),
    `${description} is invalid.`,
  );
  return {
    version: 1,
    ownerId: value.ownerId,
    pid: Number(value.pid),
    hostname: value.hostname,
    acquiredAt: value.acquiredAt,
  } as PreparationLockOwner;
}

function defaultProcessLiveness(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isObject(error) && error.code === "ESRCH") return false;
    if (isObject(error) && error.code === "EPERM") return true;
    throw new SafeProvisionError("Staging preparation lock owner liveness could not be determined safely.");
  }
}

async function processIsAlive(
  pid: number,
  check: ((pid: number) => boolean | Promise<boolean>) | undefined,
) {
  try {
    const alive = await (check ?? defaultProcessLiveness)(pid);
    assertSafe(typeof alive === "boolean", "Staging preparation lock owner liveness is invalid.");
    return alive;
  } catch (error) {
    if (error instanceof SafeProvisionError) throw error;
    throw new SafeProvisionError("Staging preparation lock owner liveness could not be determined safely.");
  }
}

async function cleanupPreparationLockDirectory(directoryPath: string) {
  await unlinkIfPresent(path.join(directoryPath, "recovery-owner.json"));
  await unlinkIfPresent(path.join(directoryPath, "owner.json"));
  await rmdirIfPresent(directoryPath);
}

function samePreparationLockOwner(left: PreparationLockOwner, right: PreparationLockOwner) {
  return left.version === right.version
    && left.ownerId === right.ownerId
    && left.pid === right.pid
    && left.hostname.toLowerCase() === right.hostname.toLowerCase()
    && left.acquiredAt === right.acquiredAt;
}

function recoveryQuarantinePaths(recoveryClaim: string, staleOwnerId: string) {
  const quarantinePath = `${recoveryClaim}.${staleOwnerId}.quarantine`;
  return { quarantinePath, transitionOwnerPath: `${quarantinePath}.owner.json` };
}

interface ExistingRecoveryQuarantine {
  cleanupArtifactClaimPaths: string[];
  cleanupJournalPath?: string;
  cleanupOwnerPath?: string;
  intermediatePaths: string[];
  quarantinePath?: string;
  staleOwnerId: string;
  transitionOwnerPath?: string;
}

async function findExistingRecoveryQuarantine(recoveryClaim: string): Promise<ExistingRecoveryQuarantine | undefined> {
  const directory = path.dirname(recoveryClaim);
  const basename = path.basename(recoveryClaim);
  const names = await readdir(directory);
  const quarantinePrefix = `${basename}.`;
  const quarantineSuffix = ".quarantine";
  const transitionSuffix = ".quarantine.owner.json";
  const cleanupOwnerSuffix = ".quarantine.cleanup-owner.json";
  const cleanupJournalSuffix = ".quarantine.cleanup-journal.json";
  const quarantineNames = names.filter((name) => name.startsWith(quarantinePrefix) && name.endsWith(quarantineSuffix));
  const transitionNames = names.filter((name) => name.startsWith(quarantinePrefix) && name.endsWith(transitionSuffix));
  const cleanupOwnerNames = names.filter(
    (name) => name.startsWith(quarantinePrefix) && name.endsWith(cleanupOwnerSuffix),
  );
  const cleanupJournalNames = names.filter(
    (name) => name.startsWith(quarantinePrefix) && name.endsWith(cleanupJournalSuffix),
  );
  const cleanupArtifactClaimNames = names.filter(
    (name) => name.startsWith(quarantinePrefix) && name.includes(".cleanup-") && name.endsWith(".claimed"),
  );
  const intermediateNames = names.filter((name) => name.startsWith(quarantinePrefix) && (
    name.endsWith(".candidate")
      || name.endsWith(".pending")
      || /\.cas-[0-9a-f-]+\.(?:prior|next)$/i.test(name)
  ));
  assertSafe(
    quarantineNames.length <= 1
      && transitionNames.length <= 1
      && cleanupOwnerNames.length <= 1
      && cleanupJournalNames.length <= 1
      && cleanupArtifactClaimNames.length <= 2
      && intermediateNames.length <= 8,
    "Staging preparation lock recovery quarantine state is ambiguous.",
  );
  assertSafe(
    cleanupArtifactClaimNames.length === 0 || cleanupOwnerNames.length === 1,
    "Staging preparation lock recovery cleanup artifact claim state is ambiguous.",
  );
  if (
    quarantineNames.length === 0
      && transitionNames.length === 0
      && cleanupOwnerNames.length === 0
      && cleanupJournalNames.length === 0
      && intermediateNames.length === 0
  ) return undefined;
  const quarantineOwnerId = quarantineNames[0]?.slice(quarantinePrefix.length, -quarantineSuffix.length);
  const transitionOwnerId = transitionNames[0]?.slice(quarantinePrefix.length, -transitionSuffix.length);
  const cleanupOwnerId = cleanupOwnerNames[0]?.slice(quarantinePrefix.length, -cleanupOwnerSuffix.length);
  const cleanupJournalOwnerId = cleanupJournalNames[0]?.slice(quarantinePrefix.length, -cleanupJournalSuffix.length);
  const intermediateOwnerIds = intermediateNames.map((name) => {
    const match = name.slice(quarantinePrefix.length).match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.quarantine(?:\.|$)/i,
    );
    assertSafe(Boolean(match), "Staging preparation lock recovery intermediate name is invalid.");
    return match?.[1] as string;
  });
  assertSafe(
    (!quarantineOwnerId || PREPARATION_OWNER_ID_PATTERN.test(quarantineOwnerId))
      && (!transitionOwnerId || PREPARATION_OWNER_ID_PATTERN.test(transitionOwnerId))
      && (!cleanupOwnerId || PREPARATION_OWNER_ID_PATTERN.test(cleanupOwnerId))
      && (!cleanupJournalOwnerId || PREPARATION_OWNER_ID_PATTERN.test(cleanupJournalOwnerId)),
    "Staging preparation lock recovery quarantine name is invalid.",
  );
  assertSafe(
    [quarantineOwnerId, transitionOwnerId, cleanupOwnerId, cleanupJournalOwnerId, ...intermediateOwnerIds]
      .filter((ownerId): ownerId is string => Boolean(ownerId))
      .every((ownerId) => ownerId === (
        quarantineOwnerId ?? transitionOwnerId ?? cleanupOwnerId ?? cleanupJournalOwnerId
      )),
    "Staging preparation lock recovery quarantine state is ambiguous.",
  );
  const staleOwnerId = quarantineOwnerId
    ?? transitionOwnerId
    ?? cleanupOwnerId
    ?? cleanupJournalOwnerId
    ?? intermediateOwnerIds[0];
  assertSafe(Boolean(staleOwnerId), "Staging preparation lock recovery quarantine state is invalid.");
  return {
    staleOwnerId: staleOwnerId as string,
    cleanupArtifactClaimPaths: cleanupArtifactClaimNames.map((name) => path.join(directory, name)),
    cleanupJournalPath: cleanupJournalNames[0] ? path.join(directory, cleanupJournalNames[0]) : undefined,
    cleanupOwnerPath: cleanupOwnerNames[0] ? path.join(directory, cleanupOwnerNames[0]) : undefined,
    intermediatePaths: intermediateNames.map((name) => path.join(directory, name)),
    quarantinePath: quarantineNames[0] ? path.join(directory, quarantineNames[0]) : undefined,
    transitionOwnerPath: transitionNames[0] ? path.join(directory, transitionNames[0]) : undefined,
  };
}

async function assertHardLinkRelationship(leftPath: string, rightPath: string) {
  const [left, right] = await Promise.all([
    lstat(leftPath, { bigint: true }),
    lstat(rightPath, { bigint: true }),
  ]);
  const leftIdentity = canonicalFilesystemIdentity(left);
  const rightIdentity = canonicalFilesystemIdentity(right);
  assertSafe(
    left.isFile()
      && right.isFile()
      && sameFilesystemObject(leftIdentity, rightIdentity)
      && BigInt(leftIdentity.nlink) >= 2n
      && BigInt(rightIdentity.nlink) >= 2n,
    "Staging preparation lock recovery quarantine inode relationship is ambiguous.",
  );
}

interface RecoveryArtifactIdentity extends CanonicalFilesystemIdentity {
  owner: PreparationLockOwner;
  path: string;
}

interface RecoveryArtifactClaim extends RecoveryArtifactIdentity {
  claimedPath: string;
}

interface StoredRecoveryArtifactIdentity extends CanonicalFilesystemIdentity {
  owner: PreparationLockOwner;
}

interface RecoveryCleanupElection extends CanonicalFilesystemIdentity {
  activeClaim: PreparationLockOwner;
  artifacts: {
    quarantine?: StoredRecoveryArtifactIdentity;
    transition?: StoredRecoveryArtifactIdentity;
  };
  owner: PreparationLockOwner;
  ownerPath: string;
  staleOwnerId: string;
}

interface RecoveryCleanupElectionRecord extends PreparationLockOwner {
  recoveryCleanup: {
    activeClaim: PreparationLockOwner;
    artifacts: {
      quarantine?: StoredRecoveryArtifactIdentity;
      transition?: StoredRecoveryArtifactIdentity;
    };
    staleOwnerId: string;
    version: 1;
  };
}

type RecoveryCleanupArtifactKind = "quarantine" | "transition";
type RecoveryCleanupPhase =
  | "removing_artifacts"
  | "removing_claims"
  | "complete"
  | "installing_successor"
  | "successor_quarantined";

interface RecoveryCleanupPendingEntry {
  identity: StoredRecoveryArtifactIdentity;
  kind: RecoveryCleanupArtifactKind;
}

interface RecoveryCleanupJournalRecord {
  activeClaim: PreparationLockOwner;
  election: CanonicalFilesystemIdentity;
  owner: PreparationLockOwner;
  pendingArtifacts: RecoveryCleanupPendingEntry[];
  pendingClaims: RecoveryCleanupPendingEntry[];
  phase: RecoveryCleanupPhase;
  staleOwnerId: string;
  successorQuarantine?: StoredRecoveryArtifactIdentity;
  successorTransition?: StoredRecoveryArtifactIdentity;
  version: 1;
}

interface RecoveryCleanupJournal {
  fileIdentity: CanonicalFilesystemIdentity;
  path: string;
  record: RecoveryCleanupJournalRecord;
}

interface RecoveryCleanupHandle {
  election: RecoveryCleanupElection;
  journal: RecoveryCleanupJournal;
}

async function readRecoveryArtifactIdentity(filePath: string, description: string): Promise<RecoveryArtifactIdentity> {
  const before = await lstat(filePath, { bigint: true });
  const owner = validatePreparationLockOwner(await readJson(filePath, description), description);
  const after = await lstat(filePath, { bigint: true });
  const beforeIdentity = canonicalFilesystemIdentity(before);
  const afterIdentity = canonicalFilesystemIdentity(after);
  assertSafe(
    before.isFile()
      && after.isFile()
      && sameExactFilesystemIdentity(beforeIdentity, afterIdentity),
    `${description} inode changed during validation.`,
  );
  return { ...afterIdentity, owner, path: filePath };
}

function sameRecoveryArtifactIdentity(left: RecoveryArtifactIdentity, right: RecoveryArtifactIdentity) {
  return sameFilesystemObject(left, right)
    && samePreparationLockOwner(left.owner, right.owner);
}

function sameExactRecoveryArtifactIdentity(left: RecoveryArtifactIdentity, right: RecoveryArtifactIdentity) {
  return sameExactFilesystemIdentity(left, right)
    && samePreparationLockOwner(left.owner, right.owner);
}

async function assertRecoveryArtifactIdentity(expected: RecoveryArtifactIdentity, filePath = expected.path) {
  const current = await readRecoveryArtifactIdentity(filePath, "Staging preparation lock recovery cleanup artifact");
  assertSafe(
    sameRecoveryArtifactIdentity(current, expected),
    "Staging preparation lock recovery cleanup artifact was replaced or is ambiguous.",
  );
  return current;
}

function recoveryCleanupOwnerPath(recoveryClaim: string, staleOwnerId: string) {
  return `${recoveryClaim}.${staleOwnerId}.quarantine.cleanup-owner.json`;
}

function recoveryCleanupJournalPath(recoveryClaim: string, staleOwnerId: string) {
  return `${recoveryClaim}.${staleOwnerId}.quarantine.cleanup-journal.json`;
}

function validateStoredRecoveryArtifactIdentity(
  value: unknown,
  description: string,
): StoredRecoveryArtifactIdentity | undefined {
  if (value === undefined) return undefined;
  const identity = validateCanonicalFilesystemIdentity(value, description);
  assertSafe(isObject(value), `${description} is invalid.`);
  return {
    ...identity,
    owner: validatePreparationLockOwner(value.owner, `${description} owner`),
  };
}

function sameStoredRecoveryArtifactIdentity(
  left: StoredRecoveryArtifactIdentity | undefined,
  right: StoredRecoveryArtifactIdentity | undefined,
) {
  if (!left || !right) return left === right;
  return sameExactFilesystemIdentity(left, right)
    && samePreparationLockOwner(left.owner, right.owner);
}

function validateRecoveryCleanupPendingEntries(
  value: unknown,
  description: string,
): RecoveryCleanupPendingEntry[] {
  assertSafe(Array.isArray(value) && value.length <= 2, `${description} is invalid.`);
  const entries = value.map((entry, index) => {
    assertSafe(
      isObject(entry) && (entry.kind === "quarantine" || entry.kind === "transition"),
      `${description}[${index}] is invalid.`,
    );
    const identity = validateStoredRecoveryArtifactIdentity(entry.identity, `${description}[${index}] identity`);
    assertSafe(Boolean(identity), `${description}[${index}] identity is missing.`);
    const kind: RecoveryCleanupArtifactKind = entry.kind === "quarantine" ? "quarantine" : "transition";
    return { identity: identity as StoredRecoveryArtifactIdentity, kind };
  });
  assertSafe(new Set(entries.map((entry) => entry.kind)).size === entries.length, `${description} is ambiguous.`);
  return entries;
}

function validateRecoveryCleanupJournalRecord(
  value: unknown,
  description: string,
): RecoveryCleanupJournalRecord {
  assertSafe(
    isObject(value)
      && value.version === 1
      && (
        value.phase === "removing_artifacts"
        || value.phase === "removing_claims"
        || value.phase === "complete"
        || value.phase === "installing_successor"
        || value.phase === "successor_quarantined"
      )
      && typeof value.staleOwnerId === "string"
      && PREPARATION_OWNER_ID_PATTERN.test(value.staleOwnerId),
    `${description} is invalid.`,
  );
  const record: RecoveryCleanupJournalRecord = {
    activeClaim: validatePreparationLockOwner(value.activeClaim, `${description} active claim`),
    election: validateCanonicalFilesystemIdentity(value.election, `${description} election identity`),
    owner: validatePreparationLockOwner(value.owner, `${description} owner`),
    pendingArtifacts: validateRecoveryCleanupPendingEntries(
      value.pendingArtifacts,
      `${description} pending artifacts`,
    ),
    pendingClaims: validateRecoveryCleanupPendingEntries(value.pendingClaims, `${description} pending claims`),
    phase: value.phase,
    staleOwnerId: value.staleOwnerId,
    successorQuarantine: validateStoredRecoveryArtifactIdentity(
      value.successorQuarantine,
      `${description} successor quarantine`,
    ),
    successorTransition: validateStoredRecoveryArtifactIdentity(
      value.successorTransition,
      `${description} successor transition`,
    ),
    version: 1,
  };
  assertSafe(
    record.phase === "removing_artifacts" || record.pendingArtifacts.length === 0,
    `${description} phase and pending artifacts are inconsistent.`,
  );
  assertSafe(
    !["complete", "installing_successor", "successor_quarantined"].includes(record.phase)
      || (record.pendingArtifacts.length === 0 && record.pendingClaims.length === 0),
    `${description} completed cleanup phase still has pending work.`,
  );
  assertSafe(
    record.phase !== "successor_quarantined"
      || Boolean(record.successorQuarantine && record.successorTransition),
    `${description} successor quarantine phase is incomplete.`,
  );
  assertSafe(
    record.phase === "installing_successor"
      || record.phase === "successor_quarantined"
      || (!record.successorQuarantine && !record.successorTransition),
    `${description} successor evidence appears outside its phase.`,
  );
  return record;
}

function sameRecoveryCleanupJournalRecord(
  left: RecoveryCleanupJournalRecord,
  right: RecoveryCleanupJournalRecord,
) {
  const sameEntries = (
    leftEntries: RecoveryCleanupPendingEntry[],
    rightEntries: RecoveryCleanupPendingEntry[],
  ) => leftEntries.length === rightEntries.length
    && leftEntries.every((entry, index) => {
      const other = rightEntries[index];
      return Boolean(other)
        && entry.kind === other?.kind
        && sameStoredRecoveryArtifactIdentity(entry.identity, other.identity);
    });
  return left.version === right.version
    && left.phase === right.phase
    && left.staleOwnerId === right.staleOwnerId
    && samePreparationLockOwner(left.owner, right.owner)
    && samePreparationLockOwner(left.activeClaim, right.activeClaim)
    && sameExactFilesystemIdentity(left.election, right.election)
    && sameEntries(left.pendingArtifacts, right.pendingArtifacts)
    && sameEntries(left.pendingClaims, right.pendingClaims)
    && sameStoredRecoveryArtifactIdentity(left.successorQuarantine, right.successorQuarantine)
    && sameStoredRecoveryArtifactIdentity(left.successorTransition, right.successorTransition);
}

function sameRecoveryCleanupPendingEntries(
  left: RecoveryCleanupPendingEntry[],
  right: RecoveryCleanupPendingEntry[],
) {
  return left.length === right.length
    && left.every((entry, index) => {
      const other = right[index];
      return Boolean(other)
        && entry.kind === other?.kind
        && sameStoredRecoveryArtifactIdentity(entry.identity, other.identity);
    });
}

function sameRecoveryCleanupJournalBase(
  left: RecoveryCleanupJournalRecord,
  right: RecoveryCleanupJournalRecord,
) {
  return left.version === right.version
    && left.staleOwnerId === right.staleOwnerId
    && samePreparationLockOwner(left.owner, right.owner)
    && samePreparationLockOwner(left.activeClaim, right.activeClaim)
    && sameExactFilesystemIdentity(left.election, right.election);
}

function assertValidRecoveryCleanupJournalTransition(
  prior: RecoveryCleanupJournalRecord,
  next: RecoveryCleanupJournalRecord,
) {
  assertSafe(
    sameRecoveryCleanupJournalBase(prior, next),
    "Staging preparation lock recovery cleanup journal transition ownership is invalid.",
  );
  let valid = false;
  if (prior.phase === "removing_artifacts" && prior.pendingArtifacts.length > 0) {
    const removed = prior.pendingArtifacts[0] as RecoveryCleanupPendingEntry;
    const priorClaimIndex = prior.pendingClaims.findIndex((entry) => entry.kind === removed.kind);
    const nextClaimIndex = next.pendingClaims.findIndex((entry) => entry.kind === removed.kind);
    if (priorClaimIndex >= 0 && nextClaimIndex === priorClaimIndex) {
      const priorClaim = prior.pendingClaims[priorClaimIndex] as RecoveryCleanupPendingEntry;
      const nextClaim = next.pendingClaims[nextClaimIndex] as RecoveryCleanupPendingEntry;
      const expectedNlink = BigInt(priorClaim.identity.nlink) - 1n;
      const unchangedClaims = prior.pendingClaims.every((entry, index) => index === priorClaimIndex
        || sameRecoveryCleanupPendingEntries([entry], [next.pendingClaims[index] as RecoveryCleanupPendingEntry]));
      valid = expectedNlink > 0n
        && next.phase === "removing_artifacts"
        && sameRecoveryCleanupPendingEntries(prior.pendingArtifacts.slice(1), next.pendingArtifacts)
        && prior.pendingClaims.length === next.pendingClaims.length
        && unchangedClaims
        && nextClaim.kind === priorClaim.kind
        && sameFilesystemObject(nextClaim.identity, priorClaim.identity)
        && samePreparationLockOwner(nextClaim.identity.owner, priorClaim.identity.owner)
        && nextClaim.identity.nlink === expectedNlink.toString(10)
        && !next.successorQuarantine
        && !next.successorTransition;
    }
  } else if (prior.phase === "removing_artifacts") {
    valid = next.phase === "removing_claims"
      && next.pendingArtifacts.length === 0
      && sameRecoveryCleanupPendingEntries(prior.pendingClaims, next.pendingClaims)
      && !next.successorQuarantine
      && !next.successorTransition;
  } else if (prior.phase === "removing_claims" && prior.pendingClaims.length > 0) {
    valid = next.phase === "removing_claims"
      && next.pendingArtifacts.length === 0
      && sameRecoveryCleanupPendingEntries(prior.pendingClaims.slice(1), next.pendingClaims)
      && !next.successorQuarantine
      && !next.successorTransition;
  } else if (prior.phase === "removing_claims") {
    valid = next.phase === "complete"
      && next.pendingArtifacts.length === 0
      && next.pendingClaims.length === 0
      && !next.successorQuarantine
      && !next.successorTransition;
  } else if (prior.phase === "complete") {
    valid = next.phase === "installing_successor"
      && next.pendingArtifacts.length === 0
      && next.pendingClaims.length === 0
      && !next.successorQuarantine
      && !next.successorTransition;
  } else if (prior.phase === "installing_successor") {
    const transitionInstalled = !prior.successorTransition
      && Boolean(next.successorTransition)
      && !next.successorQuarantine
      && next.phase === "installing_successor";
    const quarantineInstalled = Boolean(next.successorTransition)
      && Boolean(next.successorQuarantine)
      && next.phase === "successor_quarantined"
      && (!prior.successorTransition
        || sameStoredRecoveryArtifactIdentity(prior.successorTransition, next.successorTransition));
    valid = next.pendingArtifacts.length === 0
      && next.pendingClaims.length === 0
      && (transitionInstalled || quarantineInstalled);
  }
  assertSafe(valid, "Staging preparation lock recovery cleanup journal transition is invalid or ambiguous.");
}

function recoveryCleanupJournalCasPaths(journalPath: string, ownerId: string) {
  return {
    nextPath: `${journalPath}.cas-${ownerId}.next`,
    priorPath: `${journalPath}.cas-${ownerId}.prior`,
  };
}

async function readRecoveryCleanupJournal(
  journalPath: string,
  description = "Staging preparation lock recovery cleanup journal",
): Promise<RecoveryCleanupJournal> {
  const before = await lstat(journalPath, { bigint: true });
  let value: unknown;
  try {
    value = JSON.parse(await readFile(journalPath, "utf8")) as unknown;
  } catch {
    throw new SafeProvisionError(`${description} is missing or invalid.`);
  }
  const record = validateRecoveryCleanupJournalRecord(value, description);
  const after = await lstat(journalPath, { bigint: true });
  const beforeIdentity = canonicalFilesystemIdentity(before);
  const afterIdentity = canonicalFilesystemIdentity(after);
  assertSafe(
    before.isFile() && after.isFile() && sameExactFilesystemIdentity(beforeIdentity, afterIdentity),
    `${description} changed during validation.`,
  );
  return { fileIdentity: afterIdentity, path: journalPath, record };
}

async function assertRecoveryCleanupJournal(journal: RecoveryCleanupJournal) {
  const current = await readRecoveryCleanupJournal(journal.path);
  assertSafe(
    sameExactFilesystemIdentity(current.fileIdentity, journal.fileIdentity)
      && sameRecoveryCleanupJournalRecord(current.record, journal.record),
    "Staging preparation lock recovery cleanup journal changed; mutation was refused.",
  );
  return current;
}

async function installRecoveryCleanupJournal(
  journalPath: string,
  record: RecoveryCleanupJournalRecord,
  options: PrepareStagingOptions["preparationLock"],
) {
  const candidatePath = `${journalPath}.${record.owner.ownerId}.candidate`;
  await writeFile(candidatePath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const candidateInitial = await readRecoveryCleanupJournal(
    candidatePath,
    "Staging preparation lock recovery cleanup journal candidate",
  );
  try {
    try {
      await link(candidatePath, journalPath);
      await options?.afterRecoveryCleanupJournalCandidateLinked?.(candidatePath, journalPath);
    } catch (error) {
      if (isObject(error) && error.code === "EEXIST") {
        throw new SafeProvisionError("Staging preparation lock recovery cleanup journal already exists.");
      }
      throw error;
    }
  } finally {
    const candidateCurrent = await readRecoveryCleanupJournal(
      candidatePath,
      "Staging preparation lock recovery cleanup journal candidate",
    );
    assertSafe(
      sameFilesystemObject(candidateCurrent.fileIdentity, candidateInitial.fileIdentity)
        && sameRecoveryCleanupJournalRecord(candidateCurrent.record, candidateInitial.record),
      "Staging preparation lock recovery cleanup journal candidate was replaced; cleanup was refused.",
    );
    await removeRecoveryCleanupJournal(candidateCurrent);
  }
  const journal = await readRecoveryCleanupJournal(journalPath);
  assertSafe(
    sameRecoveryCleanupJournalRecord(journal.record, record),
    "Staging preparation lock recovery cleanup journal changed during installation.",
  );
  return journal;
}

async function updateRecoveryCleanupJournal(
  journal: RecoveryCleanupJournal,
  record: RecoveryCleanupJournalRecord,
  options: PrepareStagingOptions["preparationLock"],
  validateContext?: (current: RecoveryCleanupJournal) => Promise<void>,
) {
  assertValidRecoveryCleanupJournalTransition(journal.record, record);
  let current = await assertRecoveryCleanupJournal(journal);
  await validateContext?.(current);
  const { nextPath, priorPath } = recoveryCleanupJournalCasPaths(journal.path, journal.record.owner.ownerId);
  try {
    await link(journal.path, priorPath);
  } catch (error) {
    if (isObject(error) && error.code === "EEXIST") {
      throw new SafeProvisionError("Staging preparation lock recovery cleanup journal CAS prior already exists.");
    }
    throw error;
  }
  let prior = await readRecoveryCleanupJournal(priorPath, "Staging preparation lock recovery cleanup journal CAS prior");
  current = await readRecoveryCleanupJournal(journal.path);
  assertSafe(
    sameFilesystemObject(current.fileIdentity, prior.fileIdentity)
      && sameRecoveryCleanupJournalRecord(current.record, journal.record)
      && sameRecoveryCleanupJournalRecord(prior.record, journal.record),
    "Staging preparation lock recovery cleanup journal CAS prior is not the exact current journal.",
  );
  const expectedCurrent = current;
  const expectedPrior = prior;
  await options?.afterRecoveryCleanupJournalCasPriorLinked?.(priorPath, journal.path);
  await writeFile(nextPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  let next = await readRecoveryCleanupJournal(nextPath, "Staging preparation lock recovery cleanup journal CAS next");
  assertSafe(
    sameRecoveryCleanupJournalRecord(next.record, record),
    "Staging preparation lock recovery cleanup journal CAS next is invalid.",
  );
  const expectedNext = next;
  await options?.afterRecoveryCleanupJournalCasNextCreated?.(nextPath, journal.path);
  await options?.afterRecoveryCleanupJournalCasReady?.(journal.path, priorPath, nextPath);

  current = await readRecoveryCleanupJournal(journal.path);
  prior = await readRecoveryCleanupJournal(priorPath, "Staging preparation lock recovery cleanup journal CAS prior");
  next = await readRecoveryCleanupJournal(nextPath, "Staging preparation lock recovery cleanup journal CAS next");
  assertSafe(
    sameExactFilesystemIdentity(current.fileIdentity, expectedCurrent.fileIdentity)
      && sameExactFilesystemIdentity(prior.fileIdentity, expectedPrior.fileIdentity)
      && sameExactFilesystemIdentity(next.fileIdentity, expectedNext.fileIdentity)
      && sameFilesystemObject(current.fileIdentity, prior.fileIdentity)
      && sameRecoveryCleanupJournalRecord(current.record, journal.record)
      && sameRecoveryCleanupJournalRecord(prior.record, journal.record)
      && sameRecoveryCleanupJournalRecord(next.record, record),
    "Staging preparation lock recovery cleanup journal changed during CAS; replacement was preserved.",
  );
  await validateContext?.(current);
  current = await readRecoveryCleanupJournal(journal.path);
  assertSafe(
    sameExactFilesystemIdentity(current.fileIdentity, expectedCurrent.fileIdentity)
      && sameFilesystemObject(current.fileIdentity, prior.fileIdentity)
      && sameRecoveryCleanupJournalRecord(current.record, journal.record),
    "Staging preparation lock recovery cleanup journal changed immediately before CAS.",
  );
  await removeRecoveryCleanupJournal(current);
  try {
    await link(nextPath, journal.path);
  } catch (error) {
    if (isObject(error) && error.code === "EEXIST") {
      throw new SafeProvisionError("Staging preparation lock recovery cleanup journal CAS destination was replaced.");
    }
    throw error;
  }
  let installed = await readRecoveryCleanupJournal(journal.path);
  next = await readRecoveryCleanupJournal(nextPath, "Staging preparation lock recovery cleanup journal CAS next");
  assertSafe(
    sameFilesystemObject(installed.fileIdentity, next.fileIdentity)
      && sameRecoveryCleanupJournalRecord(installed.record, record),
    "Staging preparation lock recovery cleanup journal CAS installation is ambiguous.",
  );
  const expectedInstalled = installed;
  const expectedInstalledNext = next;
  prior = await readRecoveryCleanupJournal(priorPath, "Staging preparation lock recovery cleanup journal CAS prior");
  await removeRecoveryCleanupJournal(prior);
  await options?.afterRecoveryCleanupJournalCasInstalled?.(journal.path, nextPath);
  installed = await assertRecoveryCleanupJournal(expectedInstalled);
  next = await assertRecoveryCleanupJournal(expectedInstalledNext);
  assertSafe(
    sameFilesystemObject(installed.fileIdentity, next.fileIdentity)
      && sameRecoveryCleanupJournalRecord(installed.record, next.record),
    "Staging preparation lock recovery cleanup journal CAS installed paths changed during cleanup.",
  );
  await removeRecoveryCleanupJournal(next);
  installed = await readRecoveryCleanupJournal(journal.path);
  return installed;
}

async function removeRecoveryCleanupJournal(journal: RecoveryCleanupJournal) {
  await assertRecoveryCleanupJournal(journal);
  await unlink(journal.path);
}

async function assertDeadSameHostRecoveryOwner(
  owner: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
  description: string,
) {
  assertSafe(
    owner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
    `${description} belongs to another host.`,
  );
  assertSafe(
    !(await processIsAlive(owner.pid, options?.isProcessAlive)),
    `A live ${description.toLowerCase()} owner already exists.`,
  );
}

function sameRecoveryCleanupElectionState(
  left: RecoveryCleanupElection,
  right: RecoveryCleanupElection,
) {
  return samePreparationLockOwner(left.owner, right.owner)
    && samePreparationLockOwner(left.activeClaim, right.activeClaim)
    && left.staleOwnerId === right.staleOwnerId
    && sameStoredRecoveryArtifactIdentity(left.artifacts.quarantine, right.artifacts.quarantine)
    && sameStoredRecoveryArtifactIdentity(left.artifacts.transition, right.artifacts.transition);
}

async function recoverRecoveryInstallationCandidate(
  candidatePath: string,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  const match = candidatePath.match(/\.([0-9a-f-]+)\.candidate$/i);
  assertSafe(Boolean(match && PREPARATION_OWNER_ID_PATTERN.test(match[1] as string)), "Recovery candidate name is invalid.");
  const ownerId = match?.[1] as string;
  const targetPath = candidatePath.slice(0, -(`.${ownerId}.candidate`.length));
  if (targetPath.endsWith(".cleanup-journal.json")) {
    let candidate = await readRecoveryCleanupJournal(candidatePath, "Staging preparation recovery journal candidate");
    assertSafe(candidate.record.owner.ownerId === ownerId, "Recovery journal candidate owner is ambiguous.");
    await assertDeadSameHostRecoveryOwner(candidate.record.owner, claimant, options, "Recovery journal candidate");
    if (await exists(targetPath)) {
      const target = await readRecoveryCleanupJournal(targetPath);
      assertSafe(
        sameFilesystemObject(candidate.fileIdentity, target.fileIdentity)
          && sameRecoveryCleanupJournalRecord(candidate.record, target.record),
        "Recovery journal candidate target was replaced or is ambiguous.",
      );
    }
    candidate = await readRecoveryCleanupJournal(candidatePath, "Staging preparation recovery journal candidate");
    await removeRecoveryCleanupJournal(candidate);
    return;
  }
  if (targetPath.endsWith(".cleanup-owner.json")) {
    let candidate = await readRecoveryCleanupElection(candidatePath, "Staging preparation recovery election candidate");
    assertSafe(candidate.owner.ownerId === ownerId, "Recovery election candidate owner is ambiguous.");
    await assertDeadSameHostRecoveryOwner(candidate.owner, claimant, options, "Recovery election candidate");
    if (await exists(targetPath)) {
      const target = await readRecoveryCleanupElection(targetPath);
      assertSafe(
        sameFilesystemObject(candidate, target) && sameRecoveryCleanupElectionState(candidate, target),
        "Recovery election candidate target was replaced or is ambiguous.",
      );
    }
    candidate = await readRecoveryCleanupElection(candidatePath, "Staging preparation recovery election candidate");
    await releaseRecoveryCleanupElection(candidate, undefined);
    return;
  }
  assertSafe(targetPath.endsWith(".quarantine.owner.json"), "Recovery candidate type is unknown.");
  let candidate = await readRecoveryArtifactIdentity(candidatePath, "Staging preparation recovery transition candidate");
  assertSafe(candidate.owner.ownerId === ownerId, "Recovery transition candidate owner is ambiguous.");
  await assertDeadSameHostRecoveryOwner(candidate.owner, claimant, options, "Recovery transition candidate");
  if (await exists(targetPath)) {
    const target = await readRecoveryArtifactIdentity(targetPath, "Staging preparation recovery transition owner");
    assertSafe(
      sameFilesystemObject(candidate, target) && samePreparationLockOwner(candidate.owner, target.owner),
      "Recovery transition candidate target was replaced or is ambiguous.",
    );
  }
  candidate = await readRecoveryArtifactIdentity(candidatePath, "Staging preparation recovery transition candidate");
  await unlinkExactOwnedRecoveryArtifact(candidate, undefined);
}

async function deriveRecoveryCleanupJournalTransition(
  prior: RecoveryCleanupJournal,
  election: RecoveryCleanupElection,
  recoveryClaim: string,
  activeClaim: PreparationLockOwner,
) {
  prior = await assertRecoveryCleanupJournal(prior);
  await assertRecoveryCleanupElection(election);
  const record = prior.record;
  let next: RecoveryCleanupJournalRecord;
  if (record.phase === "removing_artifacts" && record.pendingArtifacts.length > 0) {
    const removed = record.pendingArtifacts[0] as RecoveryCleanupPendingEntry;
    const sourcePath = recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      removed,
      false,
    );
    assertSafe(
      !(await exists(sourcePath)),
      "Recovery journal CAS prior-only artifact state is ambiguous.",
    );
    const claimIndex = record.pendingClaims.findIndex((entry) => entry.kind === removed.kind);
    assertSafe(claimIndex >= 0, "Recovery journal CAS prior-only claim is missing.");
    const priorClaim = record.pendingClaims[claimIndex] as RecoveryCleanupPendingEntry;
    const claimPath = recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      priorClaim,
      true,
    );
    const refreshedClaim = await readRecoveryArtifactIdentity(
      claimPath,
      "Recovery journal CAS prior-only remaining claim",
    );
    const expectedNlink = BigInt(priorClaim.identity.nlink) - 1n;
    assertSafe(
      expectedNlink > 0n
        && sameFilesystemObject(refreshedClaim, priorClaim.identity)
        && samePreparationLockOwner(refreshedClaim.owner, priorClaim.identity.owner)
        && refreshedClaim.nlink === expectedNlink.toString(10),
      "Recovery journal CAS prior-only remaining claim is replaced or ambiguous.",
    );
    const pendingClaims = [...record.pendingClaims];
    pendingClaims[claimIndex] = {
      identity: storedRecoveryArtifactIdentity(refreshedClaim),
      kind: priorClaim.kind,
    };
    next = {
      ...record,
      pendingArtifacts: record.pendingArtifacts.slice(1),
      pendingClaims,
    };
  } else if (record.phase === "removing_artifacts") {
    next = { ...record, pendingArtifacts: [], phase: "removing_claims" };
  } else if (record.phase === "removing_claims" && record.pendingClaims.length > 0) {
    const removed = record.pendingClaims[0] as RecoveryCleanupPendingEntry;
    const claimPath = recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      removed,
      true,
    );
    assertSafe(
      !(await exists(claimPath)),
      "Recovery journal CAS prior-only claim state is ambiguous.",
    );
    next = { ...record, pendingClaims: record.pendingClaims.slice(1) };
  } else if (record.phase === "removing_claims") {
    next = { ...record, pendingArtifacts: [], pendingClaims: [], phase: "complete" };
  } else if (record.phase === "complete") {
    next = { ...record, phase: "installing_successor" };
  } else if (record.phase === "installing_successor" && !record.successorTransition) {
    const transition = await readRecoveryArtifactIdentity(
      recoveryQuarantinePaths(recoveryClaim, election.staleOwnerId).transitionOwnerPath,
      "Recovery journal CAS prior-only successor transition",
    );
    assertSafe(
      samePreparationLockOwner(transition.owner, election.owner),
      "Recovery journal CAS prior-only successor transition is replaced or ambiguous.",
    );
    next = { ...record, successorTransition: storedRecoveryArtifactIdentity(transition) };
  } else if (record.phase === "installing_successor" && !record.successorQuarantine) {
    const quarantinePath = recoveryQuarantinePaths(recoveryClaim, election.staleOwnerId).quarantinePath;
    const quarantine = await readRecoveryArtifactIdentity(
      quarantinePath,
      "Recovery journal CAS prior-only successor quarantine",
    );
    assertSafe(
      samePreparationLockOwner(quarantine.owner, election.activeClaim),
      "Recovery journal CAS prior-only successor quarantine is replaced or ambiguous.",
    );
    if (samePreparationLockOwner(activeClaim, election.activeClaim)) {
      await assertHardLinkRelationship(recoveryClaim, quarantinePath);
    }
    next = {
      ...record,
      phase: "successor_quarantined",
      successorQuarantine: storedRecoveryArtifactIdentity(quarantine),
    };
  } else {
    throw new SafeProvisionError("Recovery journal CAS prior-only state is not recoverable.");
  }
  assertValidRecoveryCleanupJournalTransition(record, next);
  await validateRecoveryCleanupJournalFilesystem(
    { ...prior, record: next },
    election,
    recoveryClaim,
    activeClaim,
  );
  return next;
}

async function recoverRecoveryCleanupJournalCas(
  recoveryClaim: string,
  existing: ExistingRecoveryQuarantine,
  activeClaim: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  const casPaths = existing.intermediatePaths.filter((filePath) => /\.cas-[0-9a-f-]+\.(?:prior|next)$/i.test(filePath));
  const pendingPaths = existing.intermediatePaths.filter((filePath) => filePath.endsWith(".pending"));
  if (casPaths.length === 0 && pendingPaths.length === 0) return false;
  assertSafe(Boolean(existing.cleanupOwnerPath), "Recovery journal CAS has no cleanup election.");
  const election = await readRecoveryCleanupElection(existing.cleanupOwnerPath as string);
  await assertDeadSameHostRecoveryOwner(election.owner, claimant, options, "Recovery cleanup election");
  const journalPath = recoveryCleanupJournalPath(recoveryClaim, existing.staleOwnerId);
  let priorPath = casPaths.find((filePath) => filePath.endsWith(".prior"));
  let nextPath = casPaths.find((filePath) => filePath.endsWith(".next"));
  assertSafe(
    casPaths.filter((filePath) => filePath.endsWith(".prior")).length <= 1
      && casPaths.filter((filePath) => filePath.endsWith(".next")).length <= 1
      && pendingPaths.length <= 1,
    "Recovery journal CAS intermediate set is ambiguous.",
  );
  if (pendingPaths.length === 1) {
    assertSafe(!nextPath, "Recovery journal has both legacy pending and CAS next state.");
    nextPath = pendingPaths[0];
  }
  let next = nextPath
    ? await readRecoveryCleanupJournal(nextPath, "Staging preparation recovery journal CAS next")
    : undefined;
  let target = await exists(journalPath) ? await readRecoveryCleanupJournal(journalPath) : undefined;
  if (!priorPath && next && target) {
    const targetIsInstalledNext = sameFilesystemObject(target.fileIdentity, next.fileIdentity)
      && sameRecoveryCleanupJournalRecord(target.record, next.record);
    if (targetIsInstalledNext) {
      assertSafe(
        samePreparationLockOwner(next.record.owner, election.owner),
        "Recovery journal CAS installed owner is inconsistent.",
      );
      await validateRecoveryCleanupJournalFilesystem(next, election, recoveryClaim, activeClaim);
      await assertRecoveryCleanupElection(election);
      target = await readRecoveryCleanupJournal(journalPath);
      next = await readRecoveryCleanupJournal(next.path, "Staging preparation recovery journal CAS next");
      assertSafe(
        sameFilesystemObject(target.fileIdentity, next.fileIdentity)
          && sameRecoveryCleanupJournalRecord(target.record, next.record),
        "Recovery journal CAS installed state changed before intermediate cleanup.",
      );
      await removeRecoveryCleanupJournal(next);
      return true;
    }
    assertSafe(
      samePreparationLockOwner(target.record.owner, election.owner),
      "Recovery journal CAS destination owner is inconsistent.",
    );
    assertValidRecoveryCleanupJournalTransition(target.record, next.record);
    const generatedPrior = recoveryCleanupJournalCasPaths(journalPath, election.owner.ownerId).priorPath;
    await assertRecoveryCleanupElection(election);
    target = await readRecoveryCleanupJournal(journalPath);
    assertSafe(
      samePreparationLockOwner(target.record.owner, election.owner),
      "Recovery journal CAS destination changed before prior recovery.",
    );
    await link(journalPath, generatedPrior);
    priorPath = generatedPrior;
  }
  if (priorPath && !nextPath) {
    const priorOnly = await readRecoveryCleanupJournal(
      priorPath,
      "Staging preparation recovery journal CAS prior",
    );
    const recoveredRecord = await deriveRecoveryCleanupJournalTransition(
      priorOnly,
      election,
      recoveryClaim,
      activeClaim,
    );
    nextPath = recoveryCleanupJournalCasPaths(journalPath, election.owner.ownerId).nextPath;
    await writeFile(nextPath, `${JSON.stringify(recoveredRecord, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    next = await readRecoveryCleanupJournal(nextPath, "Staging preparation recovery journal CAS next");
  }
  assertSafe(Boolean(priorPath && nextPath && next), "Recovery journal CAS is incomplete or ambiguous.");
  let prior = await readRecoveryCleanupJournal(priorPath as string, "Staging preparation recovery journal CAS prior");
  next = await readRecoveryCleanupJournal(nextPath as string, "Staging preparation recovery journal CAS next");
  assertSafe(
    samePreparationLockOwner(prior.record.owner, election.owner)
      && samePreparationLockOwner(next.record.owner, election.owner),
    "Recovery journal CAS owner is inconsistent.",
  );
  assertValidRecoveryCleanupJournalTransition(prior.record, next.record);
  await validateRecoveryCleanupJournalFilesystem(next, election, recoveryClaim, activeClaim);
  target = await exists(journalPath) ? await readRecoveryCleanupJournal(journalPath) : undefined;
  const targetIsPrior = Boolean(target
    && sameFilesystemObject(target.fileIdentity, prior.fileIdentity)
    && sameRecoveryCleanupJournalRecord(target.record, prior.record));
  const targetIsNext = Boolean(target
    && sameFilesystemObject(target.fileIdentity, next.fileIdentity)
    && sameRecoveryCleanupJournalRecord(target.record, next.record));
  assertSafe(!target || targetIsPrior || targetIsNext, "Recovery journal CAS destination was replaced or is ambiguous.");
  if (!targetIsNext) {
    prior = await readRecoveryCleanupJournal(priorPath as string, "Staging preparation recovery journal CAS prior");
    next = await readRecoveryCleanupJournal(nextPath as string, "Staging preparation recovery journal CAS next");
    await assertRecoveryCleanupElection(election);
    if (target) {
      target = await readRecoveryCleanupJournal(journalPath);
      assertSafe(
        sameFilesystemObject(target.fileIdentity, prior.fileIdentity)
          && sameRecoveryCleanupJournalRecord(target.record, prior.record),
        "Recovery journal CAS destination changed immediately before recovery.",
      );
      await removeRecoveryCleanupJournal(target);
    }
    try {
      await link(nextPath as string, journalPath);
    } catch (error) {
      if (isObject(error) && error.code === "EEXIST") {
        throw new SafeProvisionError("Recovery journal CAS destination was concurrently replaced.");
      }
      throw error;
    }
  }
  const installed = await readRecoveryCleanupJournal(journalPath);
  next = await readRecoveryCleanupJournal(nextPath as string, "Staging preparation recovery journal CAS next");
  assertSafe(
    sameFilesystemObject(installed.fileIdentity, next.fileIdentity)
      && sameRecoveryCleanupJournalRecord(installed.record, next.record),
    "Recovery journal CAS installed state is ambiguous.",
  );
  const expectedInstalled = installed;
  const expectedNext = next;
  prior = await readRecoveryCleanupJournal(priorPath as string, "Staging preparation recovery journal CAS prior");
  await removeRecoveryCleanupJournal(prior);
  await options?.afterRecoveryCleanupJournalCasInstalled?.(journalPath, nextPath as string);
  await assertRecoveryCleanupElection(election);
  await assertRecoveryCleanupJournal(expectedInstalled);
  next = await assertRecoveryCleanupJournal(expectedNext);
  await removeRecoveryCleanupJournal(next);
  return true;
}

function validateRecoveryCleanupElectionRecord(
  value: unknown,
  description: string,
): RecoveryCleanupElectionRecord {
  const owner = validatePreparationLockOwner(value, description);
  assertSafe(
    isObject(value)
      && isObject(value.recoveryCleanup)
      && value.recoveryCleanup.version === 1
      && isObject(value.recoveryCleanup.artifacts)
      && typeof value.recoveryCleanup.staleOwnerId === "string"
      && PREPARATION_OWNER_ID_PATTERN.test(value.recoveryCleanup.staleOwnerId),
    `${description} retained state is invalid.`,
  );
  const activeClaim = validatePreparationLockOwner(
    value.recoveryCleanup.activeClaim,
    `${description} retained active claim`,
  );
  const artifacts = {
    quarantine: validateStoredRecoveryArtifactIdentity(
      value.recoveryCleanup.artifacts.quarantine,
      `${description} retained quarantine artifact`,
    ),
    transition: validateStoredRecoveryArtifactIdentity(
      value.recoveryCleanup.artifacts.transition,
      `${description} retained transition artifact`,
    ),
  };
  assertSafe(
    Boolean(artifacts.quarantine || artifacts.transition),
    `${description} retained artifact state is invalid.`,
  );
  return {
    ...owner,
    recoveryCleanup: {
      activeClaim,
      artifacts,
      staleOwnerId: value.recoveryCleanup.staleOwnerId,
      version: 1,
    },
  };
}

async function readRecoveryCleanupElection(
  ownerPath: string,
  description = "Staging preparation lock recovery cleanup ownership metadata",
): Promise<RecoveryCleanupElection> {
  const before = await lstat(ownerPath, { bigint: true });
  let value: unknown;
  try {
    value = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
  } catch {
    throw new SafeProvisionError(`${description} is missing or invalid.`);
  }
  const record = validateRecoveryCleanupElectionRecord(value, description);
  const after = await lstat(ownerPath, { bigint: true });
  const beforeIdentity = canonicalFilesystemIdentity(before);
  const afterIdentity = canonicalFilesystemIdentity(after);
  assertSafe(
    before.isFile()
      && after.isFile()
      && sameExactFilesystemIdentity(beforeIdentity, afterIdentity),
    `${description} inode changed during validation.`,
  );
  return {
    activeClaim: record.recoveryCleanup.activeClaim,
    artifacts: record.recoveryCleanup.artifacts,
    ...afterIdentity,
    owner: record,
    ownerPath,
    staleOwnerId: record.recoveryCleanup.staleOwnerId,
  };
}

async function installRecoveryCleanupElection(
  ownerPath: string,
  claimant: PreparationLockOwner,
  activeClaim: PreparationLockOwner,
  staleOwnerId: string,
  quarantinedClaim: RecoveryArtifactIdentity | undefined,
  transitionOwner: RecoveryArtifactIdentity | undefined,
  options: PrepareStagingOptions["preparationLock"],
): Promise<RecoveryCleanupElection> {
  const candidatePath = `${ownerPath}.${claimant.ownerId}.candidate`;
  const artifacts = {
    quarantine: quarantinedClaim
      ? {
          dev: quarantinedClaim.dev,
          ino: quarantinedClaim.ino,
          nlink: quarantinedClaim.nlink,
          owner: quarantinedClaim.owner,
        }
      : undefined,
    transition: transitionOwner
      ? {
          dev: transitionOwner.dev,
          ino: transitionOwner.ino,
          nlink: transitionOwner.nlink,
          owner: transitionOwner.owner,
        }
      : undefined,
  };
  const record: RecoveryCleanupElectionRecord = {
    ...claimant,
    recoveryCleanup: { activeClaim, artifacts, staleOwnerId, version: 1 },
  };
  await writeFile(candidatePath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const candidateInitial = await readRecoveryCleanupElection(
    candidatePath,
    "Staging preparation lock recovery cleanup ownership candidate",
  );
  try {
    try {
      await link(candidatePath, ownerPath);
      await options?.afterRecoveryCleanupElectionCandidateLinked?.(candidatePath, ownerPath);
    } catch (error) {
      if (!(isObject(error) && error.code === "EEXIST")) throw error;
      const winner = validatePreparationLockOwner(
        await readJson(ownerPath, "Staging preparation lock recovery cleanup ownership metadata"),
        "Staging preparation lock recovery cleanup ownership metadata",
      );
      assertSafe(
        winner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
        "Staging preparation lock recovery cleanup belongs to another host.",
      );
      if (await processIsAlive(winner.pid, options?.isProcessAlive)) {
        throw new SafeProvisionError("A live staging preparation lock recovery cleanup claimant already exists.");
      }
      throw new SafeProvisionError("Staging preparation lock recovery cleanup ownership is stale or ambiguous.");
    }
  } finally {
    const candidateCurrent = await readRecoveryCleanupElection(
      candidatePath,
      "Staging preparation lock recovery cleanup ownership candidate",
    );
    assertSafe(
      sameFilesystemObject(candidateCurrent, candidateInitial)
        && samePreparationLockOwner(candidateCurrent.owner, candidateInitial.owner)
        && samePreparationLockOwner(candidateCurrent.activeClaim, candidateInitial.activeClaim)
        && candidateCurrent.staleOwnerId === candidateInitial.staleOwnerId
        && sameStoredRecoveryArtifactIdentity(
          candidateCurrent.artifacts.quarantine,
          candidateInitial.artifacts.quarantine,
        )
        && sameStoredRecoveryArtifactIdentity(
          candidateCurrent.artifacts.transition,
          candidateInitial.artifacts.transition,
        ),
      "Staging preparation lock recovery cleanup ownership candidate was replaced; cleanup was refused.",
    );
    await releaseRecoveryCleanupElection(candidateCurrent, undefined);
  }
  const identity = await readRecoveryCleanupElection(ownerPath);
  assertSafe(
    samePreparationLockOwner(identity.owner, claimant),
    "Staging preparation lock recovery cleanup ownership changed during election.",
  );
  assertSafe(
    samePreparationLockOwner(identity.activeClaim, activeClaim)
      && identity.staleOwnerId === staleOwnerId
      && sameStoredRecoveryArtifactIdentity(identity.artifacts.quarantine, artifacts.quarantine)
      && sameStoredRecoveryArtifactIdentity(identity.artifacts.transition, artifacts.transition),
    "Staging preparation lock recovery cleanup retained state changed during election.",
  );
  return identity;
}

async function assertRecoveryCleanupElection(election: RecoveryCleanupElection) {
  let current: RecoveryCleanupElection;
  try {
    current = await readRecoveryCleanupElection(election.ownerPath);
  } catch {
    throw new SafeProvisionError(
      "Staging preparation lock recovery cleanup ownership changed; removal was refused.",
    );
  }
  assertSafe(
    sameExactFilesystemIdentity(current, election)
      && samePreparationLockOwner(current.owner, election.owner)
      && samePreparationLockOwner(current.activeClaim, election.activeClaim)
      && sameStoredRecoveryArtifactIdentity(current.artifacts.quarantine, election.artifacts.quarantine)
      && sameStoredRecoveryArtifactIdentity(current.artifacts.transition, election.artifacts.transition)
      && current.staleOwnerId === election.staleOwnerId,
    "Staging preparation lock recovery cleanup ownership changed; removal was refused.",
  );
}

const RECOVERY_CLEANUP_UNLINK_ATTEMPTS = 5;

async function retryExactRecoveryCleanupUnlink(
  filePath: string,
  validateOwnership: () => Promise<void>,
  beforeUnlink: ((filePath: string, attempt: number) => Promise<void> | void) | undefined,
) {
  for (let attempt = 1; attempt <= RECOVERY_CLEANUP_UNLINK_ATTEMPTS; attempt += 1) {
    try {
      await validateOwnership();
      await beforeUnlink?.(filePath, attempt);
      await validateOwnership();
      await unlink(filePath);
      return;
    } catch (error) {
      const sharingViolation = isObject(error) && (error.code === "EPERM" || error.code === "EBUSY");
      if (!sharingViolation) {
        if (isObject(error) && error.code === "ENOENT") {
          throw new SafeProvisionError(
            "Staging preparation lock recovery cleanup ownership changed; removal was refused.",
          );
        }
        throw error;
      }
      if (attempt === RECOVERY_CLEANUP_UNLINK_ATTEMPTS) {
        throw new RecoveryCleanupRetryExhaustedError(
          "Staging preparation lock recovery cleanup failed safely and may be retried.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

async function releaseRecoveryCleanupElection(
  election: RecoveryCleanupElection,
  options: PrepareStagingOptions["preparationLock"],
) {
  await retryExactRecoveryCleanupUnlink(
    election.ownerPath,
    () => assertRecoveryCleanupElection(election),
    options?.beforeRecoveryCleanupElectionUnlink,
  );
}

async function claimRecoveryArtifact(
  observed: RecoveryArtifactIdentity,
  claimant: PreparationLockOwner,
): Promise<RecoveryArtifactClaim> {
  const claimedPath = `${observed.path}.cleanup-${claimant.ownerId}.claimed`;
  let created = false;
  try {
    await link(observed.path, claimedPath);
    created = true;
    const claimed = await assertRecoveryArtifactIdentity(observed, claimedPath);
    return { ...claimed, claimedPath, path: observed.path };
  } catch (error) {
    if (created) {
      try {
        const createdClaim = await assertRecoveryArtifactIdentity(observed, claimedPath);
        await unlinkExactOwnedRecoveryArtifact(createdClaim, undefined);
      } catch {
        throw new SafeProvisionError(
          "Staging preparation lock recovery cleanup artifact claim ownership is replaced or ambiguous.",
        );
      }
    }
    if (isObject(error) && error.code === "EEXIST") {
      throw new SafeProvisionError("Staging preparation lock recovery cleanup artifact claim already exists.");
    }
    throw error;
  }
}

async function cleanupRecoveryArtifactClaim(
  claim: RecoveryArtifactClaim,
  election: RecoveryCleanupElection,
  options: PrepareStagingOptions["preparationLock"],
  validateContext?: () => Promise<void>,
) {
  await retryExactRecoveryCleanupUnlink(
    claim.claimedPath,
    async () => {
      await validateContext?.();
      await assertRecoveryCleanupElection(election);
      const current = await assertRecoveryArtifactIdentity(claim, claim.claimedPath);
      assertSafe(
        sameExactRecoveryArtifactIdentity(current, claim),
        "Staging preparation lock recovery cleanup claim changed; removal was refused.",
      );
    },
    options?.beforeRecoveryArtifactClaimUnlink,
  );
}

async function unlinkExactOwnedRecoveryArtifact(
  expected: RecoveryArtifactIdentity,
  beforeUnlink: (() => Promise<void> | void) | undefined,
) {
  const before = await assertRecoveryArtifactIdentity(expected);
  await beforeUnlink?.();
  const after = await assertRecoveryArtifactIdentity(expected);
  assertSafe(
    sameExactRecoveryArtifactIdentity(before, after),
    "Staging preparation lock recovery owned artifact changed during cleanup; removal was refused.",
  );
  await unlink(expected.path);
}

function storedRecoveryArtifactIdentity(identity: RecoveryArtifactIdentity): StoredRecoveryArtifactIdentity {
  return {
    dev: identity.dev,
    ino: identity.ino,
    nlink: identity.nlink,
    owner: identity.owner,
  };
}

function recoveryCleanupArtifactPaths(
  recoveryClaim: string,
  staleOwnerId: string,
  cleanupOwnerId: string,
  kind: RecoveryCleanupArtifactKind,
) {
  const paths = recoveryQuarantinePaths(recoveryClaim, staleOwnerId);
  const sourcePath = kind === "quarantine" ? paths.quarantinePath : paths.transitionOwnerPath;
  return { claimedPath: `${sourcePath}.cleanup-${cleanupOwnerId}.claimed`, sourcePath };
}

function recoveryCleanupEntryPath(
  recoveryClaim: string,
  staleOwnerId: string,
  cleanupOwnerId: string,
  entry: RecoveryCleanupPendingEntry,
  claim: boolean,
) {
  const paths = recoveryCleanupArtifactPaths(recoveryClaim, staleOwnerId, cleanupOwnerId, entry.kind);
  return claim ? paths.claimedPath : paths.sourcePath;
}

function samePendingEntryIdentity(
  entry: RecoveryCleanupPendingEntry,
  expected: StoredRecoveryArtifactIdentity,
) {
  return sameFilesystemObject(entry.identity, expected)
    && samePreparationLockOwner(entry.identity.owner, expected.owner);
}

async function readExactPendingRecoveryIdentity(
  entry: RecoveryCleanupPendingEntry,
  filePath: string,
  description: string,
) {
  const identity = await readRecoveryArtifactIdentity(filePath, description);
  assertSafe(
    sameExactFilesystemIdentity(identity, entry.identity)
      && samePreparationLockOwner(identity.owner, entry.identity.owner),
    `${description} is missing, replaced, or ambiguous.`,
  );
  return identity;
}

async function validateRecoveryCleanupJournalFilesystem(
  journal: RecoveryCleanupJournal,
  election: RecoveryCleanupElection,
  recoveryClaim: string,
  activeClaim: PreparationLockOwner,
) {
  const record = journal.record;
  assertSafe(
    samePreparationLockOwner(record.owner, election.owner)
      && sameExactFilesystemIdentity(record.election, election)
      && record.staleOwnerId === election.staleOwnerId
      && samePreparationLockOwner(record.activeClaim, election.activeClaim)
      && (
        samePreparationLockOwner(activeClaim, election.activeClaim)
        || samePreparationLockOwner(activeClaim, election.owner)
      ),
    "Staging preparation lock recovery cleanup journal ownership is inconsistent.",
  );
  const originalEntries = new Map<RecoveryCleanupArtifactKind, StoredRecoveryArtifactIdentity>();
  if (election.artifacts.transition) originalEntries.set("transition", election.artifacts.transition);
  if (election.artifacts.quarantine) originalEntries.set("quarantine", election.artifacts.quarantine);
  const originalKinds = [...originalEntries.keys()].sort();
  const pendingArtifactKinds = record.pendingArtifacts.map((entry) => entry.kind).sort();
  const pendingClaimKinds = record.pendingClaims.map((entry) => entry.kind).sort();
  assertSafe(
    record.phase !== "removing_artifacts"
      || JSON.stringify(pendingClaimKinds) === JSON.stringify(originalKinds),
    "Staging preparation lock recovery cleanup journal pending claim set is incomplete or ambiguous.",
  );
  assertSafe(
    record.phase !== "removing_artifacts"
      || pendingArtifactKinds.every((kind) => pendingClaimKinds.includes(kind)),
    "Staging preparation lock recovery cleanup journal phase ownership is inconsistent.",
  );
  assertSafe(
    record.phase !== "removing_claims" || record.pendingArtifacts.length === 0,
    "Staging preparation lock recovery cleanup journal claim phase still has pending artifacts.",
  );
  assertSafe(
    record.phase !== "complete"
      || (record.pendingArtifacts.length === 0 && record.pendingClaims.length === 0),
    "Staging preparation lock recovery cleanup journal complete phase is inconsistent.",
  );
  for (const entry of [...record.pendingArtifacts, ...record.pendingClaims]) {
    const original = originalEntries.get(entry.kind);
    assertSafe(
      Boolean(original) && samePendingEntryIdentity(entry, original as StoredRecoveryArtifactIdentity),
      "Staging preparation lock recovery cleanup journal pending identity is unassociated or ambiguous.",
    );
  }

  const directory = path.dirname(recoveryClaim);
  const claimPrefix = `${path.basename(recoveryClaim)}.${election.staleOwnerId}.quarantine`;
  const observedClaimPaths = (await readdir(directory))
    .filter((name) => name.startsWith(claimPrefix) && name.includes(".cleanup-") && name.endsWith(".claimed"))
    .map((name) => path.join(directory, name))
    .sort();
  const expectedClaimPaths = record.pendingClaims
    .map((entry) => recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      entry,
      true,
    ))
    .sort();
  assertSafe(
    JSON.stringify(observedClaimPaths) === JSON.stringify(expectedClaimPaths),
    "Staging preparation lock recovery cleanup journal pending claim set is missing or ambiguous.",
  );
  for (const entry of record.pendingClaims) {
    await readExactPendingRecoveryIdentity(
      entry,
      recoveryCleanupEntryPath(recoveryClaim, election.staleOwnerId, election.owner.ownerId, entry, true),
      "Staging preparation lock recovery cleanup journal pending claim",
    );
  }

  const pendingArtifactKindSet = new Set(record.pendingArtifacts.map((entry) => entry.kind));
  for (const entry of record.pendingArtifacts) {
    await readExactPendingRecoveryIdentity(
      entry,
      recoveryCleanupEntryPath(recoveryClaim, election.staleOwnerId, election.owner.ownerId, entry, false),
      "Staging preparation lock recovery cleanup journal pending artifact",
    );
  }
  for (const [kind] of originalEntries) {
    if (pendingArtifactKindSet.has(kind)) continue;
    const sourcePath = recoveryCleanupArtifactPaths(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      kind,
    ).sourcePath;
    if (!(await exists(sourcePath))) continue;
    const successorPhase = record.phase === "installing_successor" || record.phase === "successor_quarantined";
    const recordedSuccessor = kind === "transition" ? record.successorTransition : record.successorQuarantine;
    const legitimateSuccessor = successorPhase && (
      recordedSuccessor
        ? true
        : kind === "transition"
          ? samePreparationLockOwner(activeClaim, election.activeClaim)
            || samePreparationLockOwner(activeClaim, election.owner)
          : record.phase === "installing_successor"
            && samePreparationLockOwner(activeClaim, election.activeClaim)
    );
    assertSafe(
      legitimateSuccessor,
      "Staging preparation lock recovery cleanup journal cleaned artifact path was replaced or is ambiguous.",
    );
    const successor = await readRecoveryArtifactIdentity(
      sourcePath,
      "Staging preparation lock recovery successor transition ownership metadata",
    );
    const expectedOwner = kind === "transition" ? election.owner : election.activeClaim;
    assertSafe(
      samePreparationLockOwner(successor.owner, expectedOwner)
        && (!recordedSuccessor || (
          sameExactFilesystemIdentity(successor, recordedSuccessor)
          && samePreparationLockOwner(successor.owner, recordedSuccessor.owner)
        )),
      `Staging preparation lock recovery successor ${kind} ownership is replaced or ambiguous.`,
    );
  }
}

async function installRecoveryCleanupWorkJournal(
  recoveryClaim: string,
  election: RecoveryCleanupElection,
  activeClaim: PreparationLockOwner,
  claims: Map<RecoveryCleanupArtifactKind, RecoveryArtifactClaim>,
  options: PrepareStagingOptions["preparationLock"],
) {
  const pendingArtifacts: RecoveryCleanupPendingEntry[] = [];
  const pendingClaims: RecoveryCleanupPendingEntry[] = [];
  for (const kind of ["transition", "quarantine"] as const) {
    const original = election.artifacts[kind];
    if (!original) continue;
    const paths = recoveryCleanupArtifactPaths(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      kind,
    );
    const source = await readRecoveryArtifactIdentity(
      paths.sourcePath,
      "Staging preparation lock recovery cleanup journal source artifact",
    );
    const claim = claims.get(kind);
    assertSafe(Boolean(claim), "Staging preparation lock recovery cleanup journal claim is missing.");
    const claimed = await readRecoveryArtifactIdentity(
      paths.claimedPath,
      "Staging preparation lock recovery cleanup journal claimed artifact",
    );
    assertSafe(
      sameExactFilesystemIdentity(source, claimed)
        && sameFilesystemObject(source, original)
        && samePreparationLockOwner(source.owner, original.owner),
      "Staging preparation lock recovery cleanup journal artifact identity is ambiguous.",
    );
    pendingArtifacts.push({ identity: storedRecoveryArtifactIdentity(source), kind });
    pendingClaims.push({ identity: storedRecoveryArtifactIdentity(claimed), kind });
  }
  return installRecoveryCleanupJournal(
    recoveryCleanupJournalPath(recoveryClaim, election.staleOwnerId),
    {
      activeClaim,
      election: { dev: election.dev, ino: election.ino, nlink: election.nlink },
      owner: election.owner,
      pendingArtifacts,
      pendingClaims,
      phase: "removing_artifacts",
      staleOwnerId: election.staleOwnerId,
      version: 1,
    },
    options,
  );
}

async function executeRecoveryCleanupJournal(
  initialJournal: RecoveryCleanupJournal,
  election: RecoveryCleanupElection,
  recoveryClaim: string,
  activeClaim: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  let journal = initialJournal;
  const validateCurrent = async (expected: RecoveryCleanupJournal) => {
    const current = await assertRecoveryCleanupJournal(expected);
    await assertRecoveryCleanupElection(election);
    await validateRecoveryCleanupJournalFilesystem(current, election, recoveryClaim, activeClaim);
    return current;
  };
  journal = await validateCurrent(journal);
  while (journal.record.phase === "removing_artifacts" && journal.record.pendingArtifacts.length > 0) {
    journal = await validateCurrent(journal);
    const entry = journal.record.pendingArtifacts[0] as RecoveryCleanupPendingEntry;
    const sourcePath = recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      entry,
      false,
    );
    const exactSource = await readExactPendingRecoveryIdentity(
      entry,
      sourcePath,
      "Staging preparation lock recovery cleanup journal pending artifact",
    );
    await unlinkExactOwnedRecoveryArtifact(exactSource, async () => {
      journal = await validateCurrent(journal);
    });
    await options?.afterRecoveryCleanupUnlinkBeforeJournalUpdate?.("artifact", sourcePath);
    const pendingClaims = [...journal.record.pendingClaims];
    const claimIndex = pendingClaims.findIndex((claim) => claim.kind === entry.kind);
    assertSafe(claimIndex >= 0, "Staging preparation lock recovery cleanup journal claim is missing.");
    const claimEntry = pendingClaims[claimIndex] as RecoveryCleanupPendingEntry;
    const claimPath = recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      claimEntry,
      true,
    );
    const refreshedClaim = await readRecoveryArtifactIdentity(
      claimPath,
      "Staging preparation lock recovery cleanup journal remaining claim",
    );
    assertSafe(
      sameFilesystemObject(refreshedClaim, claimEntry.identity)
        && samePreparationLockOwner(refreshedClaim.owner, claimEntry.identity.owner),
      "Staging preparation lock recovery cleanup journal remaining claim was replaced or is ambiguous.",
    );
    pendingClaims[claimIndex] = { identity: storedRecoveryArtifactIdentity(refreshedClaim), kind: claimEntry.kind };
    journal = await updateRecoveryCleanupJournal(journal, {
      ...journal.record,
      pendingArtifacts: journal.record.pendingArtifacts.slice(1),
      pendingClaims,
    }, options, async () => {
      await assertRecoveryCleanupElection(election);
    });
    await options?.afterRecoveryCleanupJournalUpdate?.("artifact", sourcePath);
  }
  if (journal.record.phase === "removing_artifacts") {
    journal = await updateRecoveryCleanupJournal(journal, {
      ...journal.record,
      pendingArtifacts: [],
      phase: "removing_claims",
    }, options, async () => {
      await assertRecoveryCleanupElection(election);
    });
  }
  while (journal.record.phase === "removing_claims" && journal.record.pendingClaims.length > 0) {
    journal = await validateCurrent(journal);
    const entry = journal.record.pendingClaims[0] as RecoveryCleanupPendingEntry;
    const claimPath = recoveryCleanupEntryPath(
      recoveryClaim,
      election.staleOwnerId,
      election.owner.ownerId,
      entry,
      true,
    );
    const exactClaim = await readExactPendingRecoveryIdentity(
      entry,
      claimPath,
      "Staging preparation lock recovery cleanup journal pending claim",
    );
    await cleanupRecoveryArtifactClaim(
      { ...exactClaim, claimedPath: claimPath, path: recoveryCleanupEntryPath(
        recoveryClaim,
        election.staleOwnerId,
        election.owner.ownerId,
        entry,
        false,
      ) },
      election,
      options,
      async () => { journal = await validateCurrent(journal); },
    );
    await options?.afterRecoveryCleanupUnlinkBeforeJournalUpdate?.("claim", claimPath);
    journal = await updateRecoveryCleanupJournal(journal, {
      ...journal.record,
      pendingClaims: journal.record.pendingClaims.slice(1),
    }, options, async () => {
      await assertRecoveryCleanupElection(election);
    });
    await options?.afterRecoveryCleanupJournalUpdate?.("claim", claimPath);
  }
  if (journal.record.phase === "removing_claims") {
    journal = await updateRecoveryCleanupJournal(journal, {
      ...journal.record,
      pendingArtifacts: [],
      pendingClaims: [],
      phase: "complete",
    }, options, async () => {
      await assertRecoveryCleanupElection(election);
    });
  }
  return journal;
}

async function adoptRecoveryCleanupSuccessorState(
  journal: RecoveryCleanupJournal,
  election: RecoveryCleanupElection,
  recoveryClaim: string,
  activeClaim: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  if (journal.record.phase !== "installing_successor") return journal;
  const { quarantinePath, transitionOwnerPath } = recoveryQuarantinePaths(recoveryClaim, election.staleOwnerId);
  let current = journal;
  if (!current.record.successorTransition && await exists(transitionOwnerPath)) {
    const transition = await readRecoveryArtifactIdentity(
      transitionOwnerPath,
      "Staging preparation lock recovery successor transition ownership metadata",
    );
    assertSafe(
      samePreparationLockOwner(transition.owner, election.owner),
      "Staging preparation lock recovery successor transition is replaced or ambiguous.",
    );
    current = await updateRecoveryCleanupJournal(
      current,
      { ...current.record, successorTransition: storedRecoveryArtifactIdentity(transition) },
      options,
      async () => { await assertRecoveryCleanupElection(election); },
    );
  }
  if (await exists(quarantinePath)) {
    assertSafe(
      Boolean(current.record.successorTransition),
      "Staging preparation lock recovery successor quarantine has no recorded transition.",
    );
    const quarantine = await readRecoveryArtifactIdentity(
      quarantinePath,
      "Staging preparation lock recovery successor quarantine ownership metadata",
    );
    assertSafe(
      samePreparationLockOwner(quarantine.owner, election.activeClaim),
      "Staging preparation lock recovery successor quarantine is replaced or ambiguous.",
    );
    if (samePreparationLockOwner(activeClaim, election.activeClaim)) {
      await assertHardLinkRelationship(recoveryClaim, quarantinePath);
    }
    current = await updateRecoveryCleanupJournal(
      current,
      {
        ...current.record,
        phase: "successor_quarantined",
        successorQuarantine: storedRecoveryArtifactIdentity(quarantine),
      },
      options,
      async () => { await assertRecoveryCleanupElection(election); },
    );
  }
  return current;
}

async function recoverRetainedRecoveryCleanup(
  recoveryClaim: string,
  existing: ExistingRecoveryQuarantine,
  activeClaim: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  assertSafe(
    Boolean(existing.cleanupOwnerPath),
    "Staging preparation lock recovery cleanup ownership is missing.",
  );
  const ownerPath = existing.cleanupOwnerPath as string;
  const observed = await readRecoveryArtifactIdentity(
    ownerPath,
    "Staging preparation lock recovery cleanup ownership metadata",
  );
  assertSafe(
    observed.owner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
    "Staging preparation lock recovery cleanup belongs to another host.",
  );
  if (await processIsAlive(observed.owner.pid, options?.isProcessAlive)) {
    throw new SafeProvisionError("A live staging preparation lock recovery cleanup claimant already exists.");
  }
  let election: RecoveryCleanupElection;
  try {
    election = await readRecoveryCleanupElection(ownerPath);
  } catch {
    throw new SafeProvisionError("Staging preparation lock recovery cleanup ownership is stale or ambiguous.");
  }
  assertSafe(
    sameExactFilesystemIdentity(observed, election)
      && samePreparationLockOwner(observed.owner, election.owner),
    "Staging preparation lock recovery cleanup ownership was replaced or is ambiguous.",
  );
  assertSafe(
    election.staleOwnerId === existing.staleOwnerId
      && (
        samePreparationLockOwner(activeClaim, election.activeClaim)
        || samePreparationLockOwner(activeClaim, election.owner)
      ),
    "Staging preparation lock recovery cleanup retained state does not match the active recovery claim.",
  );

  let journal: RecoveryCleanupJournal;
  if (existing.cleanupJournalPath) {
    journal = await readRecoveryCleanupJournal(existing.cleanupJournalPath);
  } else {
    const claims = new Map<RecoveryCleanupArtifactKind, RecoveryArtifactClaim>();
    const observedClaimPaths = new Set(existing.cleanupArtifactClaimPaths);
    const expectedClaimPaths = new Set<string>();
    for (const kind of ["transition", "quarantine"] as const) {
      const original = election.artifacts[kind];
      if (!original) continue;
      const { claimedPath, sourcePath } = recoveryCleanupArtifactPaths(
        recoveryClaim,
        election.staleOwnerId,
        election.owner.ownerId,
        kind,
      );
      expectedClaimPaths.add(claimedPath);
      let source: RecoveryArtifactIdentity;
      try {
        source = await readRecoveryArtifactIdentity(
          sourcePath,
          "Staging preparation lock recovery cleanup retained source artifact",
        );
      } catch {
        throw new SafeProvisionError(
          "Staging preparation lock recovery cleanup retained source artifact is missing or ambiguous.",
        );
      }
      assertSafe(
        sameFilesystemObject(source, original) && samePreparationLockOwner(source.owner, original.owner),
        "Staging preparation lock recovery cleanup retained source artifact was replaced or is ambiguous.",
      );
      if (observedClaimPaths.has(claimedPath)) {
        const claimed = await readRecoveryArtifactIdentity(
          claimedPath,
          "Staging preparation lock recovery cleanup retained artifact claim",
        );
        assertSafe(
          sameExactFilesystemIdentity(source, claimed)
            && samePreparationLockOwner(claimed.owner, original.owner),
          "Staging preparation lock recovery cleanup retained artifact claim was replaced or is ambiguous.",
        );
        claims.set(kind, { ...claimed, claimedPath, path: sourcePath });
      } else {
        claims.set(kind, await claimRecoveryArtifact(source, election.owner));
      }
    }
    assertSafe(
      [...observedClaimPaths].every((claimPath) => expectedClaimPaths.has(claimPath)),
      "Staging preparation lock recovery cleanup artifact claim ownership is ambiguous.",
    );
    journal = await installRecoveryCleanupWorkJournal(recoveryClaim, election, election.activeClaim, claims, options);
  }
  journal = await executeRecoveryCleanupJournal(journal, election, recoveryClaim, activeClaim, options);
  journal = await adoptRecoveryCleanupSuccessorState(journal, election, recoveryClaim, activeClaim, options);
  await releaseRecoveryCleanupElection(election, options);
  await removeRecoveryCleanupJournal(journal);
}

async function recoverOrphanedRecoveryCleanupJournal(
  recoveryClaim: string,
  existing: ExistingRecoveryQuarantine,
  activeClaim: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  assertSafe(
    Boolean(existing.cleanupJournalPath) && !existing.cleanupOwnerPath,
    "Staging preparation lock recovery cleanup journal state is invalid.",
  );
  const journal = await readRecoveryCleanupJournal(existing.cleanupJournalPath as string);
  assertSafe(
    journal.record.staleOwnerId === existing.staleOwnerId
      && journal.record.owner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
    "Staging preparation lock recovery cleanup journal belongs to another host or recovery.",
  );
  assertSafe(
    !(await processIsAlive(journal.record.owner.pid, options?.isProcessAlive)),
    "A live staging preparation lock recovery cleanup journal owner already exists.",
  );
  assertSafe(
    journal.record.phase === "complete"
      && journal.record.pendingArtifacts.length === 0
      && journal.record.pendingClaims.length === 0
      && existing.cleanupArtifactClaimPaths.length === 0
      && (
        samePreparationLockOwner(activeClaim, journal.record.activeClaim)
        || samePreparationLockOwner(activeClaim, journal.record.owner)
      ),
    "Staging preparation lock recovery cleanup journal is incomplete or ambiguous.",
  );
  assertSafe(
    !(await exists(recoveryCleanupOwnerPath(recoveryClaim, existing.staleOwnerId))),
    "Staging preparation lock recovery cleanup election changed during journal recovery.",
  );
  await removeRecoveryCleanupJournal(journal);
}

async function recoverExistingRecoveryQuarantine(
  recoveryClaim: string,
  activeClaim: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  const existing = await findExistingRecoveryQuarantine(recoveryClaim);
  if (!existing) return undefined;
  const installationCandidates = existing.intermediatePaths.filter((filePath) => filePath.endsWith(".candidate"));
  if (installationCandidates.length > 0) {
    for (const candidatePath of installationCandidates) {
      await recoverRecoveryInstallationCandidate(candidatePath, claimant, options);
    }
    return recoverExistingRecoveryQuarantine(recoveryClaim, activeClaim, claimant, options);
  }
  if (await recoverRecoveryCleanupJournalCas(recoveryClaim, existing, activeClaim, claimant, options)) {
    return recoverExistingRecoveryQuarantine(recoveryClaim, activeClaim, claimant, options);
  }
  if (existing.cleanupOwnerPath) {
    await recoverRetainedRecoveryCleanup(recoveryClaim, existing, activeClaim, claimant, options);
    return recoverExistingRecoveryQuarantine(recoveryClaim, activeClaim, claimant, options);
  }
  if (existing.cleanupJournalPath) {
    await recoverOrphanedRecoveryCleanupJournal(recoveryClaim, existing, activeClaim, claimant, options);
    return recoverExistingRecoveryQuarantine(recoveryClaim, activeClaim, claimant, options);
  }
  let quarantinedClaim: RecoveryArtifactIdentity | undefined;
  let transitionOwner: RecoveryArtifactIdentity | undefined;
  if (existing.quarantinePath) {
    quarantinedClaim = await readRecoveryArtifactIdentity(
      existing.quarantinePath,
      "Staging preparation lock recovery quarantine ownership metadata",
    );
    assertSafe(
      quarantinedClaim.owner.ownerId === existing.staleOwnerId,
      "Staging preparation lock recovery quarantine ownership is replaced or ambiguous.",
    );
    assertSafe(
      quarantinedClaim.owner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
      "Staging preparation lock recovery quarantine belongs to another host.",
    );
    assertSafe(
      !(await processIsAlive(quarantinedClaim.owner.pid, options?.isProcessAlive)),
      "A live staging preparation lock recovery quarantine claimant already exists.",
    );
  }
  if (existing.transitionOwnerPath) {
    transitionOwner = await readRecoveryArtifactIdentity(
      existing.transitionOwnerPath,
      "Staging preparation lock recovery transition ownership metadata",
    );
    assertSafe(
      transitionOwner.owner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
      "Staging preparation lock recovery transition belongs to another host.",
    );
    assertSafe(
      !(await processIsAlive(transitionOwner.owner.pid, options?.isProcessAlive)),
      "A live staging preparation lock recovery transition claimant already exists.",
    );
  }
  if (quarantinedClaim && transitionOwner) {
    if (samePreparationLockOwner(activeClaim, quarantinedClaim.owner)) {
      await assertHardLinkRelationship(recoveryClaim, existing.quarantinePath as string);
    } else {
      assertSafe(
        samePreparationLockOwner(activeClaim, transitionOwner.owner),
        "Staging preparation lock recovery quarantine is replaced or ambiguous.",
      );
    }
  } else if (quarantinedClaim) {
    assertSafe(
      samePreparationLockOwner(activeClaim, quarantinedClaim.owner),
      "Staging preparation lock recovery quarantine is replaced or ambiguous.",
    );
    await assertHardLinkRelationship(recoveryClaim, existing.quarantinePath as string);
  } else {
    assertSafe(
      transitionOwner
        && (activeClaim.ownerId === existing.staleOwnerId || samePreparationLockOwner(activeClaim, transitionOwner.owner)),
      "Staging preparation lock recovery transition is replaced or ambiguous.",
    );
  }
  await options?.beforeExistingRecoveryQuarantineCleanup?.(
    existing.quarantinePath ?? existing.transitionOwnerPath as string,
  );
  const election = await installRecoveryCleanupElection(
    recoveryCleanupOwnerPath(recoveryClaim, existing.staleOwnerId),
    claimant,
    activeClaim,
    existing.staleOwnerId,
    quarantinedClaim,
    transitionOwner,
    options,
  );
  const claims = new Map<RecoveryCleanupArtifactKind, RecoveryArtifactClaim>();
  let journal: RecoveryCleanupJournal | undefined;
  try {
    await options?.afterRecoveryCleanupElection?.(election.ownerPath, claimant.ownerId);
    if (transitionOwner) claims.set("transition", await claimRecoveryArtifact(transitionOwner, claimant));
    if (!transitionOwner) {
      assertSafe(
        !(await exists(recoveryQuarantinePaths(recoveryClaim, existing.staleOwnerId).transitionOwnerPath)),
        "Staging preparation lock recovery transition was replaced during cleanup election.",
      );
    }
    if (quarantinedClaim) claims.set("quarantine", await claimRecoveryArtifact(quarantinedClaim, claimant));
    journal = await installRecoveryCleanupWorkJournal(recoveryClaim, election, activeClaim, claims, options);
    journal = await executeRecoveryCleanupJournal(journal, election, recoveryClaim, activeClaim, options);
    return { election, journal } satisfies RecoveryCleanupHandle;
  } catch (error) {
    const journalExists = journal !== undefined
      || await exists(recoveryCleanupJournalPath(recoveryClaim, existing.staleOwnerId));
    if (journalExists) {
      if (error instanceof RecoveryCleanupRetryExhaustedError) {
        throw new SafeProvisionError(
          "Staging preparation lock recovery quarantine cleanup failed safely and may be retried.",
        );
      }
      if (isObject(error) && error.code === "ENOENT") {
        throw new SafeProvisionError(
          "Staging preparation lock recovery cleanup journal pending artifact or claim is missing or ambiguous.",
        );
      }
      throw error;
    }
    let cleanupFailed = error instanceof RecoveryCleanupRetryExhaustedError;
    const claimStack = [...claims.values()];
    if (!cleanupFailed) {
      while (claimStack.length > 0) {
        try {
          const claim = claimStack[claimStack.length - 1] as RecoveryArtifactClaim;
          await cleanupRecoveryArtifactClaim(claim, election, options);
          claimStack.pop();
        } catch {
          cleanupFailed = true;
          break;
        }
      }
    }
    if (!cleanupFailed && claimStack.length === 0) {
      try {
        await releaseRecoveryCleanupElection(election, options);
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      throw new SafeProvisionError("Staging preparation lock recovery quarantine cleanup failed safely and may be retried.");
    }
    if (isObject(error) && error.code === "ENOENT") {
      throw new SafeProvisionError("Staging preparation lock recovery quarantine cleanup failed safely and may be retried.");
    }
    throw error;
  }
}

async function installRecoveryTransitionOwner(
  transitionOwnerPath: string,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  const candidatePath = `${transitionOwnerPath}.${claimant.ownerId}.candidate`;
  await writeFile(candidatePath, `${JSON.stringify(claimant, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const candidateInitial = await readRecoveryArtifactIdentity(
    candidatePath,
    "Staging preparation lock recovery transition ownership candidate",
  );
  try {
    try {
      await link(candidatePath, transitionOwnerPath);
      await options?.afterRecoveryTransitionCandidateLinked?.(candidatePath, transitionOwnerPath);
    } catch (error) {
      if (!(isObject(error) && error.code === "EEXIST")) throw error;
      const winner = validatePreparationLockOwner(
        await readJson(transitionOwnerPath, "Staging preparation lock recovery transition ownership metadata"),
        "Staging preparation lock recovery transition ownership metadata",
      );
      assertSafe(
        winner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
        "Staging preparation lock recovery transition belongs to another host.",
      );
      if (await processIsAlive(winner.pid, options?.isProcessAlive)) {
        throw new SafeProvisionError("A live staging preparation lock recovery transition claimant already exists.");
      }
      throw new SafeProvisionError("Staging preparation lock recovery transition ownership is ambiguous.");
    }
  } finally {
    const candidateCurrent = await readRecoveryArtifactIdentity(
      candidatePath,
      "Staging preparation lock recovery transition ownership candidate",
    );
    assertSafe(
      sameFilesystemObject(candidateCurrent, candidateInitial)
        && samePreparationLockOwner(candidateCurrent.owner, candidateInitial.owner),
      "Staging preparation lock recovery transition ownership candidate was replaced; cleanup was refused.",
    );
    await unlinkExactOwnedRecoveryArtifact(candidateCurrent, undefined);
  }
  const identity = await readRecoveryArtifactIdentity(
    transitionOwnerPath,
    "Staging preparation lock recovery transition ownership metadata",
  );
  assertSafe(
    samePreparationLockOwner(identity.owner, claimant),
    "Staging preparation lock recovery transition ownership changed during installation.",
  );
  return identity;
}

async function replaceDeadRecoveryClaim(
  recoveryClaim: string,
  existingClaim: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  let cleanupHandle = await recoverExistingRecoveryQuarantine(recoveryClaim, existingClaim, claimant, options);
  const { quarantinePath, transitionOwnerPath } = recoveryQuarantinePaths(recoveryClaim, existingClaim.ownerId);
  let ownsQuarantine = false;
  let ownsTransitionOwner = false;
  let replacementInstalled = false;
  let quarantineIdentity: RecoveryArtifactIdentity | undefined;
  let transitionOwnerIdentity: RecoveryArtifactIdentity | undefined;
  try {
    if (cleanupHandle) {
      cleanupHandle.journal = await updateRecoveryCleanupJournal(
        cleanupHandle.journal,
        { ...cleanupHandle.journal.record, phase: "installing_successor" },
        options,
        async () => { await assertRecoveryCleanupElection(cleanupHandle?.election as RecoveryCleanupElection); },
      );
    }
    transitionOwnerIdentity = await installRecoveryTransitionOwner(transitionOwnerPath, claimant, options);
    ownsTransitionOwner = true;
    if (cleanupHandle) {
      cleanupHandle.journal = await updateRecoveryCleanupJournal(
        cleanupHandle.journal,
        {
          ...cleanupHandle.journal.record,
          successorTransition: storedRecoveryArtifactIdentity(transitionOwnerIdentity),
        },
        options,
        async () => { await assertRecoveryCleanupElection(cleanupHandle?.election as RecoveryCleanupElection); },
      );
    }
    const claimBeforeQuarantine = validatePreparationLockOwner(
      await readJson(recoveryClaim, "Staging preparation lock recovery ownership metadata"),
      "Staging preparation lock recovery ownership metadata",
    );
    assertSafe(
      samePreparationLockOwner(claimBeforeQuarantine, existingClaim),
      "Staging preparation lock recovery ownership changed before quarantine; reclaim was refused.",
    );
    try {
      await link(recoveryClaim, quarantinePath);
      ownsQuarantine = true;
    } catch (error) {
      if (isObject(error) && error.code === "EEXIST") {
        throw new SafeProvisionError("A staging preparation lock recovery claimant transition is active.");
      }
      throw error;
    }
    quarantineIdentity = await readRecoveryArtifactIdentity(
      quarantinePath,
      "Staging preparation lock recovery quarantine ownership metadata",
    );
    if (cleanupHandle) {
      cleanupHandle.journal = await updateRecoveryCleanupJournal(
        cleanupHandle.journal,
        {
          ...cleanupHandle.journal.record,
          phase: "successor_quarantined",
          successorQuarantine: storedRecoveryArtifactIdentity(quarantineIdentity),
        },
        options,
        async () => { await assertRecoveryCleanupElection(cleanupHandle?.election as RecoveryCleanupElection); },
      );
    }
    await options?.afterRecoveryClaimQuarantined?.(quarantinePath);
    assertSafe(
      samePreparationLockOwner(quarantineIdentity.owner, existingClaim),
      "Staging preparation lock recovery quarantine ownership changed; reclaim was refused.",
    );
    const currentClaimIdentity = await readRecoveryArtifactIdentity(
      recoveryClaim,
      "Staging preparation lock recovery ownership metadata",
    );
    assertSafe(
      samePreparationLockOwner(currentClaimIdentity.owner, existingClaim)
        && sameFilesystemObject(currentClaimIdentity, quarantineIdentity),
      "Staging preparation lock recovery ownership changed; reclaim was refused.",
    );
    assertSafe(
      currentClaimIdentity.owner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
      "Staging preparation lock recovery belongs to another host and cannot be proven stale.",
    );
    assertSafe(
      !(await processIsAlive(currentClaimIdentity.owner.pid, options?.isProcessAlive)),
      "A live staging preparation lock recovery claimant already exists.",
    );
    await unlinkExactOwnedRecoveryArtifact(currentClaimIdentity, async () => {
      assertSafe(
        !(await processIsAlive(currentClaimIdentity.owner.pid, options?.isProcessAlive)),
        "A live staging preparation lock recovery claimant already exists.",
      );
    });
    try {
      await writeFile(recoveryClaim, `${JSON.stringify(claimant, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      replacementInstalled = true;
    } catch (error) {
      if (!(isObject(error) && error.code === "EEXIST")) throw error;
      const winner = validatePreparationLockOwner(
        await readJson(recoveryClaim, "Staging preparation lock recovery ownership metadata"),
        "Staging preparation lock recovery ownership metadata",
      );
      assertSafe(
        winner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
        "Staging preparation lock recovery belongs to another host and cannot be proven stale.",
      );
      if (await processIsAlive(winner.pid, options?.isProcessAlive)) {
        throw new SafeProvisionError("A live staging preparation lock recovery claimant already exists.");
      }
      throw new SafeProvisionError("Staging preparation lock recovery ownership changed during reclaim.");
    }
  } finally {
    let cleanupFailed = false;
    if (ownsQuarantine) {
      try {
        assertSafe(Boolean(quarantineIdentity), "Staging preparation lock recovery quarantine identity is missing.");
        await unlinkExactOwnedRecoveryArtifact(
          quarantineIdentity as RecoveryArtifactIdentity,
          () => options?.beforeRecoveryClaimCleanup?.(quarantinePath, "quarantine"),
        );
      } catch {
        cleanupFailed = true;
      }
    }
    if (ownsTransitionOwner && !replacementInstalled && !cleanupFailed) {
      try {
        assertSafe(Boolean(transitionOwnerIdentity), "Staging preparation lock recovery transition identity is missing.");
        await unlinkExactOwnedRecoveryArtifact(
          transitionOwnerIdentity as RecoveryArtifactIdentity,
          () => options?.beforeRecoveryClaimCleanup?.(transitionOwnerPath, "transition"),
        );
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupHandle) {
      let releaseIsSerialized = !cleanupFailed;
      if (!releaseIsSerialized && ownsTransitionOwner && transitionOwnerIdentity) {
        try {
          await assertRecoveryArtifactIdentity(transitionOwnerIdentity);
          releaseIsSerialized = true;
        } catch {
          releaseIsSerialized = false;
        }
      }
      if (releaseIsSerialized) {
        try {
          await releaseRecoveryCleanupElection(cleanupHandle.election, options);
          await removeRecoveryCleanupJournal(cleanupHandle.journal);
        } catch {
          cleanupFailed = true;
        }
      }
    }
    if (cleanupFailed) {
      throw new SafeProvisionError("Staging preparation lock recovery transition cleanup failed safely and may be retried.");
    }
  }
}

async function tryInstallPreparationLock(lockDirectory: string, owner: PreparationLockOwner) {
  const candidateDirectory = path.join(
    path.dirname(lockDirectory),
    `staging-prepare-lock-candidate-${owner.ownerId}`,
  );
  await cleanupPreparationLockDirectory(candidateDirectory);
  await mkdir(candidateDirectory);
  await writeFile(path.join(candidateDirectory, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(candidateDirectory, lockDirectory);
    return true;
  } catch (error) {
    await cleanupPreparationLockDirectory(candidateDirectory);
    if (await exists(lockDirectory)) return false;
    throw error;
  }
}

async function quarantineOwnedPreparationLock(
  lockDirectory: string,
  quarantineDirectory: string,
  observedOwner: PreparationLockOwner,
  claimant: PreparationLockOwner,
  transitionOwnerPath?: string,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [currentOwner, currentClaim] = await Promise.all([
      readJson(path.join(lockDirectory, "owner.json"), "Staging preparation lock ownership metadata")
        .then((value) => validatePreparationLockOwner(value)),
      readJson(path.join(lockDirectory, "recovery-owner.json"), "Staging preparation lock recovery ownership metadata")
        .then((value) => validatePreparationLockOwner(
          value,
          "Staging preparation lock recovery ownership metadata",
        )),
    ]);
    assertSafe(
      samePreparationLockOwner(currentOwner, observedOwner),
      "Staging preparation lock ownership changed before quarantine.",
    );
    assertSafe(
      samePreparationLockOwner(currentClaim, claimant),
      "Staging preparation lock recovery ownership changed before quarantine.",
    );
    if (transitionOwnerPath) {
      const transitionOwner = validatePreparationLockOwner(
        await readJson(
          transitionOwnerPath,
          "Staging preparation lock recovery transition ownership metadata",
        ),
        "Staging preparation lock recovery transition ownership metadata",
      );
      assertSafe(
        samePreparationLockOwner(transitionOwner, claimant),
        "Staging preparation lock recovery transition ownership changed before quarantine.",
      );
    }
    try {
      await rename(lockDirectory, quarantineDirectory);
      return;
    } catch (error) {
      const retryableWindowsSharingViolation = isObject(error)
        && (error.code === "EPERM" || error.code === "EBUSY")
        && attempt < 4;
      if (!retryableWindowsSharingViolation) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw new SafeProvisionError("Staging preparation lock quarantine could not be completed safely.");
}

async function reclaimDeadPreparationLock(
  lockDirectory: string,
  observedOwner: PreparationLockOwner,
  claimant: PreparationLockOwner,
  options: PrepareStagingOptions["preparationLock"],
) {
  const recoveryClaim = path.join(lockDirectory, "recovery-owner.json");
  let ownsRecoveryClaim = false;
  let lockQuarantined = false;
  let recoveryTransition: ReturnType<typeof recoveryQuarantinePaths> | undefined;
  let ownsRecoveryTransition = false;
  try {
    try {
      await writeFile(recoveryClaim, `${JSON.stringify(claimant, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      ownsRecoveryClaim = true;
    } catch (error) {
      if (!(isObject(error) && error.code === "EEXIST")) throw error;
      const existingClaim = validatePreparationLockOwner(
        await readJson(recoveryClaim, "Staging preparation lock recovery ownership metadata"),
        "Staging preparation lock recovery ownership metadata",
      );
      const localHost = claimant.hostname.toLowerCase();
      assertSafe(
        existingClaim.hostname.toLowerCase() === localHost,
        "Staging preparation lock recovery belongs to another host and cannot be proven stale.",
      );
      if (await processIsAlive(existingClaim.pid, options?.isProcessAlive)) {
        throw new SafeProvisionError("A live staging preparation lock recovery claimant already exists.");
      }
      recoveryTransition = recoveryQuarantinePaths(recoveryClaim, existingClaim.ownerId);
      await replaceDeadRecoveryClaim(recoveryClaim, existingClaim, claimant, options);
      ownsRecoveryClaim = true;
      ownsRecoveryTransition = true;
    }
    await options?.afterRecoveryClaimAcquired?.();
    const currentOwner = validatePreparationLockOwner(
      await readJson(path.join(lockDirectory, "owner.json"), "Staging preparation lock ownership metadata"),
    );
    assertSafe(
      currentOwner.ownerId === observedOwner.ownerId,
      "Staging preparation lock ownership changed during stale recovery.",
    );
    assertSafe(
      currentOwner.hostname.toLowerCase() === claimant.hostname.toLowerCase(),
      "Staging preparation lock owner belongs to another host and cannot be proven stale.",
    );
    assertSafe(
      !(await processIsAlive(currentOwner.pid, options?.isProcessAlive)),
      "A live staging preparation lock owner blocks this prepare operation.",
    );
    const quarantineDirectory = path.join(
      path.dirname(lockDirectory),
      `staging-prepare-lock-stale-${observedOwner.ownerId}-${claimant.ownerId}`,
    );
    await quarantineOwnedPreparationLock(
      lockDirectory,
      quarantineDirectory,
      observedOwner,
      claimant,
      ownsRecoveryTransition ? recoveryTransition?.transitionOwnerPath : undefined,
    );
    lockQuarantined = true;
    if (ownsRecoveryTransition && recoveryTransition) {
      const movedTransitionOwnerPath = path.join(
        quarantineDirectory,
        path.basename(recoveryTransition.transitionOwnerPath),
      );
      const transitionOwner = await readRecoveryArtifactIdentity(
        movedTransitionOwnerPath,
        "Staging preparation lock recovery transition ownership metadata",
      );
      assertSafe(
        samePreparationLockOwner(transitionOwner.owner, claimant),
        "Staging preparation lock recovery transition ownership changed after quarantine; cleanup was refused.",
      );
      await unlinkExactOwnedRecoveryArtifact(transitionOwner, undefined);
      ownsRecoveryTransition = false;
    }
    await cleanupPreparationLockDirectory(quarantineDirectory);
  } catch (error) {
    if (!lockQuarantined && recoveryTransition && await exists(recoveryTransition.quarantinePath)) {
      throw error;
    }
    if (!lockQuarantined && (ownsRecoveryClaim || ownsRecoveryTransition)) {
      try {
        if (await exists(recoveryClaim)) {
          const currentClaim = await readRecoveryArtifactIdentity(
            recoveryClaim,
            "Staging preparation lock recovery ownership metadata",
          );
          if (samePreparationLockOwner(currentClaim.owner, claimant)) {
            await unlinkExactOwnedRecoveryArtifact(currentClaim, undefined);
            ownsRecoveryClaim = false;
          } else {
            assertSafe(
              !ownsRecoveryClaim,
              "Staging preparation lock recovery ownership changed; claimant cleanup was refused.",
            );
          }
        }
        if (ownsRecoveryTransition && recoveryTransition && await exists(recoveryTransition.transitionOwnerPath)) {
          const transitionOwner = await readRecoveryArtifactIdentity(
            recoveryTransition.transitionOwnerPath,
            "Staging preparation lock recovery transition ownership metadata",
          );
          assertSafe(
            samePreparationLockOwner(transitionOwner.owner, claimant),
            "Staging preparation lock recovery transition ownership changed; claimant cleanup was refused.",
          );
          await unlinkExactOwnedRecoveryArtifact(transitionOwner, undefined);
        }
      } catch {
        throw new SafeProvisionError("Staging preparation lock recovery failed and claimant-owned cleanup could not be completed safely.");
      }
    }
    throw error;
  }
}

async function acquirePreparationLock(
  paths: PreparationPaths,
  options: PrepareStagingOptions["preparationLock"],
) {
  const lockDirectory = preparationLockDirectory(paths);
  await mkdir(path.dirname(lockDirectory), { recursive: true });
  const owner: PreparationLockOwner = {
    version: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: nodeHostname(),
    acquiredAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await tryInstallPreparationLock(lockDirectory, owner)) return { lockDirectory, owner };
    const observedOwner = validatePreparationLockOwner(
      await readJson(path.join(lockDirectory, "owner.json"), "Staging preparation lock ownership metadata"),
    );
    assertSafe(
      observedOwner.hostname.toLowerCase() === owner.hostname.toLowerCase(),
      "Staging preparation lock owner belongs to another host and cannot be proven stale.",
    );
    if (await processIsAlive(observedOwner.pid, options?.isProcessAlive)) {
      throw new SafeProvisionError("A live staging preparation lock owner blocks this prepare operation.");
    }
    await reclaimDeadPreparationLock(lockDirectory, observedOwner, owner, options);
  }
  throw new SafeProvisionError("Staging preparation lock acquisition could not be completed safely.");
}

async function releasePreparationLock(handle: PreparationLockHandle) {
  const owner = validatePreparationLockOwner(
    await readJson(path.join(handle.lockDirectory, "owner.json"), "Staging preparation lock ownership metadata"),
  );
  assertSafe(
    owner.ownerId === handle.owner.ownerId
      && owner.pid === handle.owner.pid
      && owner.hostname.toLowerCase() === handle.owner.hostname.toLowerCase(),
    "Staging preparation lock ownership changed; release was refused.",
  );
  const releaseDirectory = path.join(
    path.dirname(handle.lockDirectory),
    `staging-prepare-lock-release-${handle.owner.ownerId}`,
  );
  await rename(handle.lockDirectory, releaseDirectory);
  await cleanupPreparationLockDirectory(releaseDirectory);
}

async function withPreparationLock<T>(
  paths: PreparationPaths,
  options: PrepareStagingOptions["preparationLock"],
  action: () => Promise<T>,
) {
  const handle = await acquirePreparationLock(paths, options);
  try {
    return await action();
  } finally {
    await releasePreparationLock(handle);
  }
}

function environmentValue(source: string, name: string) {
  const values = source.split(/\r?\n/).flatMap((line) => line.startsWith(`${name}=`) ? [line.slice(name.length + 1)] : []);
  assertSafe(values.length <= 1, `The staging environment contains a duplicate ${name} entry.`);
  return values[0];
}

interface PreparationTransactionEntry {
  backupPath: string;
  destination: string;
  existed: boolean;
  stagedPath: string;
}

interface PreparationTransactionJournal {
  entries: PreparationTransactionEntry[];
  runId: string;
  status: "staging" | "prepared" | "rolling_back" | "rolled_back" | "committed";
  transactionDirectory: string;
  version: 1;
}

function preparationDestinations(paths: PreparationPaths) {
  return [
    paths.preRotationSecrets,
    paths.environment,
    paths.configs.application,
    paths.configs.ingress,
    paths.secretFiles.compatibility,
    paths.secretFiles.application,
    paths.secretFiles.ingress,
    paths.secretFiles.jobs,
  ].map((candidate) => path.resolve(candidate));
}

function validatePreparationJournal(value: unknown, paths: PreparationPaths) {
  assertSafe(isObject(value) && value.version === 1, "The staging preparation transaction journal is invalid.");
  assertRunId(value.runId);
  assertSafe(
    value.status === "staging"
      || value.status === "prepared"
      || value.status === "rolling_back"
      || value.status === "rolled_back"
      || value.status === "committed",
    "The staging preparation transaction status is invalid.",
  );
  const expectedDirectory = path.resolve(path.dirname(paths.transactionJournal), `staging-prepare-${value.runId}`);
  assertSafe(value.transactionDirectory === expectedDirectory, "The staging preparation transaction directory is invalid.");
  assertSafe(Array.isArray(value.entries) && value.entries.length > 0, "The staging preparation transaction entries are invalid.");
  const allowed = new Set(preparationDestinations(paths));
  const destinations = new Set<string>();
  const entries = value.entries.map((candidate, index): PreparationTransactionEntry => {
    assertSafe(isObject(candidate), "A staging preparation transaction entry is invalid.");
    const destination = typeof candidate.destination === "string" ? path.resolve(candidate.destination) : "";
    const stagedPath = typeof candidate.stagedPath === "string" ? path.resolve(candidate.stagedPath) : "";
    const backupPath = typeof candidate.backupPath === "string" ? path.resolve(candidate.backupPath) : "";
    assertSafe(allowed.has(destination) && !destinations.has(destination), "A transaction destination is outside the exact staging preparation set.");
    assertSafe(stagedPath === path.join(expectedDirectory, `${index}.staged`), "A transaction staged path is invalid.");
    assertSafe(backupPath === path.join(expectedDirectory, `${index}.backup`), "A transaction backup path is invalid.");
    assertSafe(typeof candidate.existed === "boolean", "A transaction backup state is invalid.");
    destinations.add(destination);
    return { destination, stagedPath, backupPath, existed: candidate.existed };
  });
  return {
    version: 1,
    runId: value.runId,
    status: value.status,
    transactionDirectory: expectedDirectory,
    entries,
  } as PreparationTransactionJournal;
}

async function cleanupPreparationTransaction(
  journal: PreparationTransactionJournal,
  journalPath: string,
) {
  for (const [index, entry] of journal.entries.entries()) {
    await unlinkIfPresent(entry.stagedPath);
    await unlinkIfPresent(entry.backupPath);
    await unlinkIfPresent(path.join(journal.transactionDirectory, `${index}.restore.pending`));
  }
  await rmdirIfPresent(journal.transactionDirectory);
  await unlinkIfPresent(journalPath);
}

async function rollbackPreparationTransaction(
  journal: PreparationTransactionJournal,
  journalPath: string,
) {
  if (journal.status === "prepared") {
    const rollingBack = { ...journal, status: "rolling_back" as const };
    await writeAtomic(journalPath, `${JSON.stringify(rollingBack, null, 2)}\n`);
    journal.status = "rolling_back";
  }
  assertSafe(journal.status === "rolling_back", "Only a prepared transaction can be rolled back.");
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.existed) {
      assertSafe(await exists(entry.backupPath), "A staging preparation transaction backup is missing; rollback was refused.");
      const restorePath = path.join(journal.transactionDirectory, `${index}.restore.pending`);
      await writeFile(restorePath, await readFile(entry.backupPath), { mode: 0o600 });
      await rename(restorePath, entry.destination);
    } else {
      await unlinkIfPresent(entry.destination);
    }
  }
  const rolledBack = { ...journal, status: "rolled_back" as const };
  await writeAtomic(journalPath, `${JSON.stringify(rolledBack, null, 2)}\n`);
  journal.status = "rolled_back";
  await cleanupPreparationTransaction(journal, journalPath);
}

async function recoverPreparationTransaction(paths: PreparationPaths) {
  if (!(await exists(paths.transactionJournal))) return;
  const journal = validatePreparationJournal(
    await readJson(paths.transactionJournal, "Staging preparation transaction journal"),
    paths,
  );
  if (journal.status === "prepared" || journal.status === "rolling_back") {
    await rollbackPreparationTransaction(journal, paths.transactionJournal);
  } else {
    await cleanupPreparationTransaction(journal, paths.transactionJournal);
  }
}

async function commitPreparationTransaction(
  paths: PreparationPaths,
  outputs: Array<{ contents: string; destination: string }>,
  hook?: (index: number, destination: string) => Promise<void> | void,
  atomicRenameHook?: (temporaryPath: string, destination: string) => Promise<void> | void,
) {
  const runId = randomUUID();
  const transactionDirectory = path.resolve(path.dirname(paths.transactionJournal), `staging-prepare-${runId}`);
  await mkdir(transactionDirectory, { recursive: true });
  const entries: PreparationTransactionEntry[] = [];
  let journal: PreparationTransactionJournal | undefined;
  let journalWritten = false;
  try {
    for (const [index, output] of outputs.entries()) {
      const destination = path.resolve(output.destination);
      const stagedPath = path.join(transactionDirectory, `${index}.staged`);
      const backupPath = path.join(transactionDirectory, `${index}.backup`);
      const existed = await exists(destination);
      entries.push({ destination, stagedPath, backupPath, existed });
    }
    assertSafe(
      new Set(entries.map(({ destination }) => destination)).size === entries.length,
      "Staging preparation contains duplicate transaction destinations.",
    );
    journal = { version: 1, runId, status: "staging", transactionDirectory, entries };
    validatePreparationJournal(journal, paths);
    await writeAtomic(paths.transactionJournal, `${JSON.stringify(journal, null, 2)}\n`);
    journalWritten = true;
    for (const [index, output] of outputs.entries()) {
      const entry = entries[index] as PreparationTransactionEntry;
      await writeFile(entry.stagedPath, output.contents, { mode: 0o600 });
      if (entry.existed) await writeFile(entry.backupPath, await readFile(entry.destination), { mode: 0o600 });
    }
    const prepared = { ...journal, status: "prepared" as const };
    await writeAtomic(paths.transactionJournal, `${JSON.stringify(prepared, null, 2)}\n`);
    journal.status = "prepared";
    for (const [index, entry] of entries.entries()) {
      await hook?.(index, entry.destination);
      await atomicRenameHook?.(entry.stagedPath, entry.destination);
      await rename(entry.stagedPath, entry.destination);
    }
    const committed = { ...journal, status: "committed" as const };
    await writeAtomic(paths.transactionJournal, `${JSON.stringify(committed, null, 2)}\n`);
    journal.status = "committed";
    await cleanupPreparationTransaction(journal, paths.transactionJournal);
  } catch (error) {
    try {
      if (journalWritten && journal && (journal.status === "prepared" || journal.status === "rolling_back")) {
        await rollbackPreparationTransaction(journal, paths.transactionJournal);
      }
      else if (journalWritten && journal) await cleanupPreparationTransaction(journal, paths.transactionJournal);
      else if (journal) await cleanupPreparationTransaction(journal, paths.transactionJournal);
      else {
        for (const entry of entries) {
          await unlinkIfPresent(entry.stagedPath);
          await unlinkIfPresent(entry.backupPath);
        }
        await rmdirIfPresent(transactionDirectory);
      }
    } catch {
      throw new SafeProvisionError("Staging preparation failed and rollback could not be completed; the transaction journal was retained.");
    }
    if (error instanceof SafeProvisionError) throw error;
    throw new SafeProvisionError("Staging preparation transaction failed and all prior replacements were rolled back.");
  }
}

async function prepareStagingFilesLocked(options: PrepareStagingOptions) {
  await recoverPreparationTransaction(options.paths);
  const [accountValue, capacityValue, environment, applicationConfig, ingressConfig] = await Promise.all([
    readJson(options.paths.accountEvidence, "Authenticated account resource evidence"),
    readJson(options.paths.capacityEvidence, "Staging capacity evidence"),
    readFile(options.paths.environment, "utf8"),
    readFile(options.paths.configs.application, "utf8"),
    readFile(options.paths.configs.ingress, "utf8"),
  ]);
  const account = validateAccountEvidence(accountValue);
  validateCapacityEvidence(capacityValue);
  const origins = deriveWorkersDevOrigins(account, options.confirmations);
  const existingSecretFiles = (await Promise.all(
    Object.values(options.paths.secretFiles).map(async (filePath) => ({ filePath, present: await exists(filePath) })),
  )).filter(({ present }) => present);
  if (existingSecretFiles.length > 0) {
    assertSafe(options.rotate, "Existing staging secret files require an explicit --rotate flag.");
    assertSafe(options.confirmedEmptyStagingData, "Secret rotation requires explicit confirmation that staging data is empty.");
  }

  const secretMaterial = createSecretMaterial(options.randomBytes);
  const patchedEnvironment = patchEnvironmentText(environment, {
    SESSION_PEPPER: secretMaterial.values.SESSION_PEPPER,
    DATA_HASH_PEPPER: secretMaterial.values.DATA_HASH_PEPPER,
    FIELD_ENCRYPTION_KEY: secretMaterial.values.FIELD_ENCRYPTION_KEY,
  });
  const patchedConfigs = patchOriginConfigs({ application: applicationConfig, ingress: ingressConfig }, origins);
  const priorSecrets = {
    SESSION_PEPPER: environmentValue(environment, "SESSION_PEPPER"),
    FIELD_ENCRYPTION_KEY: environmentValue(environment, "FIELD_ENCRYPTION_KEY"),
  };
  const hasPriorSecrets = Boolean(priorSecrets.SESSION_PEPPER || priorSecrets.FIELD_ENCRYPTION_KEY);
  const outputs: Array<{ contents: string; destination: string }> = [];
  if (hasPriorSecrets) {
    assertSafe(!(await exists(options.paths.preRotationSecrets)), "A pre-rotation staging secret backup already exists; rotation was refused.");
    outputs.push({ destination: options.paths.preRotationSecrets, contents: `${JSON.stringify(priorSecrets, null, 2)}\n` });
  }
  outputs.push(
    { destination: options.paths.environment, contents: patchedEnvironment },
    { destination: options.paths.configs.application, contents: patchedConfigs.application },
    { destination: options.paths.configs.ingress, contents: patchedConfigs.ingress },
  );
  for (const runtime of ["compatibility", "application", "ingress", "jobs"] as const) {
    outputs.push({
      destination: options.paths.secretFiles[runtime],
      contents: `${JSON.stringify(secretMaterial.payloads[runtime], null, 2)}\n`,
    });
  }
  await commitPreparationTransaction(
    options.paths,
    outputs,
    options.transactionHooks?.beforeReplace,
    options.transactionHooks?.beforeAtomicRename,
  );
  return { origins };
}

export async function prepareStagingFiles(options: PrepareStagingOptions) {
  return withPreparationLock(
    options.paths,
    options.preparationLock,
    () => prepareStagingFilesLocked(options),
  );
}

async function verifySecretFiles(paths: PreparationPaths["secretFiles"]) {
  const payloads = {
    compatibility: await readJson(paths.compatibility, "Compatibility secret file"),
    application: await readJson(paths.application, "Application secret file"),
    ingress: await readJson(paths.ingress, "Ingress secret file"),
    jobs: await readJson(paths.jobs, "Jobs secret file"),
  };
  verifySecretPayloads(payloads);
}

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type WranglerRunner = (invocation: WranglerInvocation) => Promise<CommandResult>;

export const defaultWranglerRunner: WranglerRunner = async (invocation) => new Promise((resolve) => {
  execFile(invocation.file, invocation.args, {
    cwd: invocation.cwd,
    encoding: "utf8",
    env: invocation.environment,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    resolve({
      exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      stderr,
      stdout,
    });
  });
});

function parseEnvironmentFile(source: string) {
  const environment: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    assertSafe(separator > 0, "The staging environment file contains an invalid entry.");
    const name = line.slice(0, separator);
    assertSafe(/^[A-Z][A-Z0-9_]*$/.test(name), "The staging environment file contains an invalid variable name.");
    assertSafe(environment[name] === undefined, `The staging environment contains a duplicate ${name} entry.`);
    environment[name] = line.slice(separator + 1);
  }
  return environment;
}

function verifyWranglerAccount(stdout: string, accountId: string) {
  let identity: unknown;
  try {
    identity = JSON.parse(stdout);
  } catch {
    throw new SafeProvisionError("Wrangler authentication did not return valid JSON.");
  }
  assertSafe(isObject(identity) && identity.loggedIn === true && Array.isArray(identity.accounts), "Wrangler authentication could not be verified.");
  const ownsAccount = identity.accounts.some((candidate) => isObject(candidate) && candidate.id === accountId);
  assertSafe(ownsAccount, "The authenticated Cloudflare account does not match the verified staging evidence.");
}

function bindVerifiedAccount(invocation: WranglerInvocation, accountId: string): WranglerInvocation {
  return {
    ...invocation,
    environment: { ...invocation.environment, CLOUDFLARE_ACCOUNT_ID: accountId },
  };
}

async function runWranglerSafely(
  runner: WranglerRunner,
  invocation: WranglerInvocation,
  description: string,
) {
  let result: CommandResult;
  try {
    result = await runner(invocation);
  } catch {
    throw new SafeProvisionError(`${description} failed safely without exposing child-process details.`);
  }
  assertSafe(
    result.exitCode === 0,
    `${description} failed safely without exposing child-process details.`,
  );
  return result.stdout;
}

async function resolveWranglerVersion(explicitVersion?: string) {
  if (explicitVersion !== undefined) return validateWranglerVersion(explicitVersion);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(new URL("../../node_modules/wrangler/package.json", import.meta.url), "utf8"));
  } catch {
    throw new SafeProvisionError("The installed Wrangler version could not be verified.");
  }
  assertSafe(isObject(manifest) && typeof manifest.version === "string", "The installed Wrangler version could not be verified.");
  return validateWranglerVersion(manifest.version);
}

function operationEntries(
  runId: string,
  existing: Partial<Record<DatabaseBinding, HyperdriveResource>>,
) {
  return Object.fromEntries(HYPERDRIVE_SPECS.map((spec) => {
    const resource = existing[spec.binding];
    const entry: HyperdriveOperationEntry = resource
      ? {
          descriptor: expectedDescriptor(spec),
          state: "resolved",
          attempted: false,
          id: resource.id,
          disposition: "reused",
          runId,
        }
      : {
          descriptor: expectedDescriptor(spec),
          state: "pending",
          attempted: false,
          runId,
        };
    return [spec.binding, entry];
  })) as Record<DatabaseBinding, HyperdriveOperationEntry>;
}

function accountWithOperation(account: AccountEvidence, operation: HyperdriveOperation): AccountEvidence {
  return { ...account, hyperdriveOperation: operation };
}

async function persistOperation(
  filePath: string,
  account: AccountEvidence,
  operation: HyperdriveOperation,
) {
  validateHyperdriveOperation(operation);
  await writeAtomic(filePath, `${JSON.stringify(accountWithOperation(account, operation), null, 2)}\n`);
}

async function fetchExactHyperdrive(
  runner: WranglerRunner,
  cwd: string,
  accountId: string,
  entry: HyperdriveListEntry,
  spec: HyperdriveSpec,
  origin: HyperdriveOrigin,
) {
  const stdout = await runWranglerSafely(
    runner,
    bindVerifiedAccount(buildHyperdriveGetInvocation(entry.id, cwd), accountId),
    "Hyperdrive get command",
  );
  const resource = parseHyperdriveGetOutput(stdout);
  assertSafe(resource.id === entry.id, `The same-name Hyperdrive does not match the recorded list ID: ${spec.name}.`);
  selectReusableHyperdrive([resource], spec, origin);
  return resource;
}

async function exactResourcesFromList(
  runner: WranglerRunner,
  cwd: string,
  accountId: string,
  entries: readonly HyperdriveListEntry[],
  origins: Readonly<Record<DatabaseBinding, HyperdriveOrigin>>,
) {
  const resources: Partial<Record<DatabaseBinding, HyperdriveResource>> = {};
  for (const spec of HYPERDRIVE_SPECS) {
    const entry = selectExactListEntry(entries, spec, origins[spec.binding]);
    if (entry) resources[spec.binding] = await fetchExactHyperdrive(
      runner,
      cwd,
      accountId,
      entry,
      spec,
      origins[spec.binding],
    );
  }
  return resources;
}

async function reconcileAmbiguousCreate(
  runner: WranglerRunner,
  options: ProvisionHyperdrivesOptions,
  account: AccountEvidence,
  spec: HyperdriveSpec,
  origin: HyperdriveOrigin,
  parsedCreateId?: string,
) {
  try {
    const listOutput = await runWranglerSafely(
      runner,
      bindVerifiedAccount(buildHyperdriveListInvocation(options.cwd), account.accountId),
      "Hyperdrive reconciliation list command",
    );
    const entry = selectExactListEntry(parseHyperdriveListOutput(listOutput), spec, origin);
    assertSafe(entry, "The ambiguous create was not present in the reconciled list.");
    assertSafe(parsedCreateId === undefined || entry.id === parsedCreateId, "The reconciled Hyperdrive ID differs from create output.");
    const resource = await fetchExactHyperdrive(runner, options.cwd, account.accountId, entry, spec, origin);
    return { resource, disposition: parsedCreateId === undefined ? "reused" as const : "created" as const };
  } catch {
    throw new SafeProvisionError("Hyperdrive create command failed safely; ambiguous create could not be reconciled.");
  }
}

async function createAndVerifyHyperdrive(
  runner: WranglerRunner,
  options: ProvisionHyperdrivesOptions,
  account: AccountEvidence,
  spec: HyperdriveSpec,
  origin: HyperdriveOrigin,
) {
  let parsedCreateId: string | undefined;
  try {
    const result = await runner(bindVerifiedAccount(
      buildHyperdriveCreateInvocation(spec, origin, options.cwd),
      account.accountId,
    ));
    if (result.exitCode === 0) {
      parsedCreateId = parseHyperdriveCreateOutput(result.stdout).id;
      const stdout = await runWranglerSafely(
        runner,
        bindVerifiedAccount(buildHyperdriveGetInvocation(parsedCreateId, options.cwd), account.accountId),
        "Hyperdrive get command",
      );
      const resource = parseHyperdriveGetOutput(stdout);
      assertSafe(resource.id === parsedCreateId, "The created Hyperdrive ID does not match get metadata.");
      selectReusableHyperdrive([resource], spec, origin);
      return { resource, disposition: "created" as const };
    }
  } catch {
    // A thrown command, malformed output, or invalid get result is ambiguous and must be reconciled.
  }
  return reconcileAmbiguousCreate(runner, options, account, spec, origin, parsedCreateId);
}

function operationForCleanup(evidence: unknown) {
  assertSafe(isObject(evidence) && evidence.projectRef === STAGING_PROJECT_REF, "Cleanup evidence is not bound to the staging project.");
  return validateHyperdriveOperation(evidence.hyperdriveOperation);
}

export function createdHyperdriveCleanupTargets(evidence: unknown, runId: string) {
  assertRunId(runId);
  const operation = operationForCleanup(evidence);
  assertSafe(operation.runId === runId, "Cleanup refused resources from a foreign run.");
  return HYPERDRIVE_SPECS.flatMap(({ binding }) => {
    const entry = operation.resources[binding];
    return entry.state === "resolved" && entry.disposition === "created"
      ? [{ binding, id: entry.id as string }]
      : [];
  });
}

export function assertHyperdriveCleanupTarget(
  evidence: unknown,
  runId: string,
  binding: string,
  id: string,
) {
  assertRunId(runId);
  assertResourceId(id);
  assertSafe(EXPECTED_DATABASE_ROLES.has(binding as DatabaseBinding), "Cleanup refused an unexpected binding.");
  const operation = operationForCleanup(evidence);
  assertSafe(operation.runId === runId, "Cleanup refused a resource from a foreign run.");
  const entry = operation.resources[binding as DatabaseBinding];
  assertSafe(entry.state === "resolved" && entry.id === id, "Cleanup refused an unrecorded resource target.");
  assertSafe(entry.disposition === "created", "Cleanup refused a reused resource.");
  return { binding: binding as DatabaseBinding, id };
}

export async function provisionHyperdrives(options: ProvisionHyperdrivesOptions) {
  const runner = options.runner ?? defaultWranglerRunner;
  const now = options.now ?? Date.now;
  const initialNow = now();
  const [accountValue, capacityValue, environmentText, applicationSource, ingressSource, jobsSource] = await Promise.all([
    readJson(options.paths.accountEvidence, "Authenticated account resource evidence"),
    readJson(options.paths.capacityEvidence, "Staging capacity evidence"),
    readFile(options.paths.environment, "utf8"),
    readFile(options.paths.configs.application, "utf8"),
    readFile(options.paths.configs.ingress, "utf8"),
    readFile(options.paths.configs.jobs, "utf8"),
  ]);
  const { account } = validateMutationPreflight(accountValue, capacityValue, initialNow);
  await resolveWranglerVersion(options.wranglerVersion);
  const settings = validateCapacityEnvironment(parseEnvironmentFile(environmentText));

  const whoami = await runWranglerSafely(
    runner,
    buildWranglerWhoamiInvocation(options.cwd),
    "Wrangler authentication check",
  );
  verifyWranglerAccount(whoami, account.accountId);
  const listOutput = await runWranglerSafely(
    runner,
    bindVerifiedAccount(buildHyperdriveListInvocation(options.cwd), account.accountId),
    "Hyperdrive list command",
  );
  const listedResources = await exactResourcesFromList(
    runner,
    options.cwd,
    account.accountId,
    parseHyperdriveListOutput(listOutput),
    settings.hyperdriveOrigins,
  );

  let operation = account.hyperdriveOperation;
  if (!operation) {
    const runId = (options.runIdFactory ?? randomUUID)();
    assertRunId(runId);
    operation = {
      runId,
      startedAt: new Date(initialNow).toISOString(),
      status: "pending",
      resources: operationEntries(runId, listedResources),
    };
    if (Object.values(operation.resources).every(({ state }) => state === "resolved")) operation.status = "complete";
    await persistOperation(options.paths.accountEvidence, account, operation);
  } else {
    for (const spec of HYPERDRIVE_SPECS) {
      const entry = operation.resources[spec.binding];
      const listed = listedResources[spec.binding];
      if (entry.state === "resolved") {
        assertSafe(
          listed?.id === entry.id,
          `The recorded ${spec.binding} Hyperdrive ID does not match the exact account resource.`,
        );
      } else if (listed) {
        operation.resources[spec.binding] = {
          ...entry,
          state: "resolved",
          id: listed.id,
          disposition: "reused",
        };
      } else {
        assertSafe(
          !entry.attempted,
          `The pending mutation for ${spec.binding} requires manual reconciliation before any retry.`,
        );
      }
    }
    if (Object.values(operation.resources).every(({ state }) => state === "resolved")) operation.status = "complete";
    await persistOperation(options.paths.accountEvidence, account, operation);
  }

  for (const spec of HYPERDRIVE_SPECS) {
    const entry = operation.resources[spec.binding];
    if (entry.state === "resolved") continue;
    validateMutationPreflight(accountWithOperation(account, operation), capacityValue, now());
    operation.resources[spec.binding] = { ...entry, attempted: true };
    await persistOperation(options.paths.accountEvidence, account, operation);
    const created = await createAndVerifyHyperdrive(
      runner,
      options,
      account,
      spec,
      settings.hyperdriveOrigins[spec.binding],
    );
    operation.resources[spec.binding] = {
      ...operation.resources[spec.binding],
      state: "resolved",
      id: created.resource.id,
      disposition: created.disposition,
    };
    if (Object.values(operation.resources).every(({ state }) => state === "resolved")) operation.status = "complete";
    await persistOperation(options.paths.accountEvidence, account, operation);
  }
  operation.status = "complete";
  await persistOperation(options.paths.accountEvidence, account, operation);

  const completeIds = Object.fromEntries(HYPERDRIVE_SPECS.map(({ binding }) => {
    const id = operation.resources[binding].id;
    assertResourceId(id);
    return [binding, id];
  }));
  const patched = patchHyperdriveBindings({
    application: applicationSource,
    ingress: ingressSource,
    jobs: jobsSource,
  }, completeIds);
  await writeAtomic(options.paths.configs.application, patched.application);
  await writeAtomic(options.paths.configs.ingress, patched.ingress);
  await writeAtomic(options.paths.configs.jobs, patched.jobs);
  return completeIds;
}

const defaultPaths: PreparationPaths = {
  accountEvidence: path.resolve(".cloudflare", "staging-resource-ids.json"),
  capacityEvidence: path.resolve(".cloudflare", "evidence", "capacity.json"),
  configs: {
    application: path.resolve("cloudflare", "application", "wrangler.jsonc"),
    ingress: path.resolve("cloudflare", "ingress", "wrangler.jsonc"),
  },
  environment: path.resolve(".env.staging"),
  preRotationSecrets: path.resolve(".cloudflare", "pre-rotation-secrets.json"),
  transactionJournal: path.resolve(".cloudflare", "evidence", "staging-prepare-transaction.json"),
  secretFiles: {
    compatibility: path.resolve(".cloudflare", "staging-compat-secrets.json"),
    application: path.resolve(".cloudflare", "staging-application-secrets.json"),
    ingress: path.resolve(".cloudflare", "staging-ingress-secrets.json"),
    jobs: path.resolve(".cloudflare", "staging-jobs-secrets.json"),
  },
};

const defaultHyperdrivePaths: HyperdriveProvisionPaths = {
  accountEvidence: defaultPaths.accountEvidence,
  capacityEvidence: defaultPaths.capacityEvidence,
  environment: defaultPaths.environment,
  configs: {
    application: defaultPaths.configs.application,
    ingress: defaultPaths.configs.ingress,
    jobs: path.resolve("cloudflare", "jobs", "wrangler.jsonc"),
  },
};

export interface ProvisionCommandContext {
  cwd: string;
  hyperdrivePaths: HyperdriveProvisionPaths;
  preparationPaths: PreparationPaths;
  randomBytes: (size: number) => Uint8Array;
  runner: WranglerRunner;
}

const defaultCommandContext: ProvisionCommandContext = {
  cwd: process.cwd(),
  hyperdrivePaths: defaultHyperdrivePaths,
  preparationPaths: defaultPaths,
  randomBytes: nodeRandomBytes,
  runner: defaultWranglerRunner,
};

function optionValue(args: readonly string[], name: string) {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export async function runProvisionCommand(
  args: string[],
  overrides: Partial<ProvisionCommandContext> = {},
) {
  const context = { ...defaultCommandContext, ...overrides };
  const command = args[0];
  if (command === "prepare") {
    const application = optionValue(args, "confirm-application-origin");
    const ingress = optionValue(args, "confirm-ingress-origin");
    assertSafe(application && ingress, "Prepare requires both exact --confirm-*-origin values.");
    await prepareStagingFiles({
      paths: context.preparationPaths,
      confirmations: { application, ingress },
      randomBytes: context.randomBytes,
      rotate: args.includes("--rotate"),
      confirmedEmptyStagingData: args.includes("--confirm-empty-staging-data"),
    });
    return "Prepared redacted Cloudflare staging origins and least-privilege secret files.";
  }
  if (command === "verify-secrets") {
    await verifySecretFiles(context.preparationPaths.secretFiles);
    return "Verified least-privilege staging secret files.";
  }
  if (command === "hyperdrive") {
    await provisionHyperdrives({
      cwd: context.cwd,
      paths: context.hyperdrivePaths,
      runner: context.runner,
    });
    return "Bound four verified Cloudflare staging Hyperdrives.";
  }
  throw new SafeProvisionError("Usage: provision.ts prepare|hyperdrive|verify-secrets");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProvisionCommand(process.argv.slice(2)).then((message) => {
    process.stdout.write(`${message}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof SafeProvisionError
      ? error.message
      : "Cloudflare staging provisioning failed without exposing sensitive details.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
