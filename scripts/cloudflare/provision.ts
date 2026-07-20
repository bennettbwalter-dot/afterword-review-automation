import { execFile } from "node:child_process";
import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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

export interface AccountEvidence {
  accountId: string;
  accountVerified: true;
  freePlanVerified: true;
  hyperdriveAvailableWithoutUpgrade: true;
  monthlyRecurringCostUsd: 0;
  projectRef: typeof STAGING_PROJECT_REF;
  queuesAvailableWithoutUpgrade: true;
  version: 1;
  workersDevSubdomain: string;
  hyperdrives?: Partial<Record<DatabaseBinding, string>>;
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
}

export interface PrepareStagingOptions {
  confirmations: WorkersDevOrigins;
  confirmedEmptyStagingData: boolean;
  paths: PreparationPaths;
  randomBytes?: (size: number) => Uint8Array;
  rotate: boolean;
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
  paths: HyperdriveProvisionPaths;
  runner?: WranglerRunner;
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

class SafeProvisionError extends Error {}

function assertSafe(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SafeProvisionError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateAccountEvidence(value: unknown): AccountEvidence {
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
  if (value.hyperdrives !== undefined) {
    assertSafe(isObject(value.hyperdrives), "Recorded Hyperdrive identifiers are invalid.");
    for (const [binding, id] of Object.entries(value.hyperdrives)) {
      assertSafe(EXPECTED_DATABASE_ROLES.has(binding as DatabaseBinding), "An unexpected Hyperdrive binding was recorded.");
      assertResourceId(id);
    }
  }
  return value as unknown as AccountEvidence;
}

export function validateCapacityEvidence(value: unknown): CapacityEvidence {
  assertSafe(isObject(value) && value.version === 1 && value.passed === true, "Capacity evidence is missing or invalid.");
  assertSafe(value.projectRef === STAGING_PROJECT_REF, "Capacity evidence is not bound to the staging project.");
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
  return wranglerInvocation(cwd, ["hyperdrive", "list", "--json"]);
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
    "--json",
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
  assertSafe(isObject(value.caching) && typeof value.caching.disabled === "boolean", "Wrangler returned invalid Hyperdrive caching metadata.");
  assertSafe(typeof value.origin_connection_limit === "number", "Wrangler returned an invalid Hyperdrive connection limit.");
  assertSafe(typeof value.sslmode === "string", "Wrangler returned invalid Hyperdrive TLS metadata.");
  return value as unknown as HyperdriveResource;
}

export function parseHyperdriveListOutput(stdout: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new SafeProvisionError("Hyperdrive listing did not return valid Wrangler JSON.");
  }
  const values = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && parsed.success === true && Array.isArray(parsed.result)
      ? parsed.result
      : undefined;
  assertSafe(values, "Hyperdrive listing did not return a successful Wrangler JSON result.");
  return values.map(validateHyperdriveResource);
}

function parseHyperdriveCreateOutput(stdout: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new SafeProvisionError("Hyperdrive create did not return valid Wrangler JSON.");
  }
  const value = isObject(parsed) && parsed.success === true ? parsed.result : parsed;
  return validateHyperdriveResource(value);
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

function environmentValue(source: string, name: string) {
  const values = source.split(/\r?\n/).flatMap((line) => line.startsWith(`${name}=`) ? [line.slice(name.length + 1)] : []);
  assertSafe(values.length <= 1, `The staging environment contains a duplicate ${name} entry.`);
  return values[0];
}

export async function prepareStagingFiles(options: PrepareStagingOptions) {
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
  if (hasPriorSecrets) {
    assertSafe(!(await exists(options.paths.preRotationSecrets)), "A pre-rotation staging secret backup already exists; rotation was refused.");
    await writeAtomic(options.paths.preRotationSecrets, `${JSON.stringify(priorSecrets, null, 2)}\n`);
  }

  await writeAtomic(options.paths.environment, patchedEnvironment);
  await writeAtomic(options.paths.configs.application, patchedConfigs.application);
  await writeAtomic(options.paths.configs.ingress, patchedConfigs.ingress);
  for (const runtime of ["compatibility", "application", "ingress", "jobs"] as const) {
    await writeAtomic(options.paths.secretFiles[runtime], `${JSON.stringify(secretMaterial.payloads[runtime], null, 2)}\n`);
  }
  return { origins };
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

export async function provisionHyperdrives(options: ProvisionHyperdrivesOptions) {
  const runner = options.runner ?? defaultWranglerRunner;
  const [accountValue, capacityValue, environmentText, applicationSource, ingressSource, jobsSource] = await Promise.all([
    readJson(options.paths.accountEvidence, "Authenticated account resource evidence"),
    readJson(options.paths.capacityEvidence, "Staging capacity evidence"),
    readFile(options.paths.environment, "utf8"),
    readFile(options.paths.configs.application, "utf8"),
    readFile(options.paths.configs.ingress, "utf8"),
    readFile(options.paths.configs.jobs, "utf8"),
  ]);
  const account = validateAccountEvidence(accountValue);
  validateCapacityEvidence(capacityValue);
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
  const resources = parseHyperdriveListOutput(listOutput);

  const ids: Partial<Record<DatabaseBinding, string>> = {};
  const missing: HyperdriveSpec[] = [];
  for (const spec of HYPERDRIVE_SPECS) {
    const reusable = selectReusableHyperdrive(resources, spec, settings.hyperdriveOrigins[spec.binding]);
    const recorded = account.hyperdrives?.[spec.binding];
    if (recorded !== undefined) {
      assertSafe(
        reusable === recorded,
        `The recorded ${spec.binding} Hyperdrive ID does not match the exact account resource.`,
      );
    }
    if (reusable) ids[spec.binding] = reusable;
    else missing.push(spec);
  }

  for (const spec of missing) {
    const stdout = await runWranglerSafely(
      runner,
      bindVerifiedAccount(
        buildHyperdriveCreateInvocation(spec, settings.hyperdriveOrigins[spec.binding], options.cwd),
        account.accountId,
      ),
      "Hyperdrive create command",
    );
    const created = parseHyperdriveCreateOutput(stdout);
    const id = selectReusableHyperdrive([created], spec, settings.hyperdriveOrigins[spec.binding]);
    assertResourceId(id);
    ids[spec.binding] = id;
    await writeAtomic(options.paths.accountEvidence, `${JSON.stringify({
      ...account,
      hyperdrives: { ...(account.hyperdrives ?? {}), ...ids },
    }, null, 2)}\n`);
  }

  const completeIds = Object.fromEntries(HYPERDRIVE_SPECS.map(({ binding }) => {
    const id = ids[binding];
    assertResourceId(id);
    return [binding, id];
  }));
  const patched = patchHyperdriveBindings({
    application: applicationSource,
    ingress: ingressSource,
    jobs: jobsSource,
  }, completeIds);
  await writeAtomic(options.paths.accountEvidence, `${JSON.stringify({
    ...account,
    hyperdrives: completeIds,
  }, null, 2)}\n`);
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
