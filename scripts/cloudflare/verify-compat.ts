import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { CompatibilityFixtureManifest } from "./compat-fixture.js";

const RESOURCE_IDS_PATH = path.resolve(".cloudflare", "staging-resource-ids.json");
const FIXTURE_PATH = path.resolve(".cloudflare", "evidence", "compat-fixture.json");
const RESULTS_PATH = path.resolve(".cloudflare", "evidence", "compat-results.json");
const EXPECTED_ROLES = new Map([
  ["AUTH_DB", "afterword_auth_login"],
  ["RUNTIME_DB", "afterword_runtime_login"],
  ["INGRESS_DB", "afterword_ingress_login"],
  ["WORKER_DB", "afterword_worker_login"],
]);

class SafeVerificationError extends Error {}

export interface AccountResources {
  accountId?: unknown;
  workersDevSubdomain?: unknown;
}

interface ValidatedAccountResources {
  accountId: string;
  workersDevSubdomain: string;
}

export interface WranglerInvocation {
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  file: string;
}

export interface WranglerCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type WranglerRunner = (invocation: WranglerInvocation) => Promise<WranglerCommandResult>;

interface RoleResult {
  actual?: unknown;
  databaseResolved?: unknown;
  expected?: unknown;
  matches?: unknown;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SafeVerificationError(message);
}

async function readJson<T>(filePath: string, description: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    throw new SafeVerificationError(`${description} is missing or invalid.`);
  }
}

function validateAccountResources(resources: AccountResources): ValidatedAccountResources {
  assert(
    typeof resources.accountId === "string" && /^[0-9a-f]{32}$/i.test(resources.accountId),
    "The authenticated Cloudflare account identifier is invalid.",
  );
  assert(
    typeof resources.workersDevSubdomain === "string"
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(resources.workersDevSubdomain),
    "The authenticated account Workers.dev subdomain is invalid.",
  );
  return {
    accountId: resources.accountId.toLowerCase(),
    workersDevSubdomain: resources.workersDevSubdomain.toLowerCase(),
  };
}

function compatibilityBaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
  resources: ValidatedAccountResources,
) {
  const value = environment.COMPAT_BASE_URL?.trim();
  assert(value, "COMPAT_BASE_URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeVerificationError("COMPAT_BASE_URL is invalid.");
  }
  assert(url.protocol === "https:", "COMPAT_BASE_URL must use HTTPS.");
  assert(
    url.hostname.toLowerCase() === `review-anchor-staging-compat.${resources.workersDevSubdomain}.workers.dev`,
    "COMPAT_BASE_URL does not belong to the authenticated account Workers.dev subdomain.",
  );
  assert(url.pathname === "/" && !url.search && !url.hash, "COMPAT_BASE_URL must be an origin without a path or query.");
  return url;
}

function gateToken(environment: Readonly<Record<string, string | undefined>>) {
  const value = environment.COMPAT_GATE_TOKEN?.trim();
  assert(value && value.length >= 32, "COMPAT_GATE_TOKEN is required and must be an opaque token.");
  return value;
}

function wranglerAuthenticationEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
  const environment: NodeJS.ProcessEnv = {
    CI: "true",
    NO_COLOR: "1",
    WRANGLER_SEND_METRICS: "false",
  };
  for (const name of allowed) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
}

const defaultWranglerRunner: WranglerRunner = async (invocation) => new Promise((resolve) => {
  execFile(
    invocation.file,
    invocation.args,
    {
      cwd: invocation.cwd,
      encoding: "utf8",
      env: invocation.environment,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
    (error, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stderr,
        stdout,
      });
    },
  );
});

async function verifyWranglerAccountOwnership(
  resources: ValidatedAccountResources,
  runner: WranglerRunner,
) {
  const invocation: WranglerInvocation = {
    args: [path.resolve("node_modules", "wrangler", "bin", "wrangler.js"), "whoami", "--json"],
    cwd: process.cwd(),
    environment: wranglerAuthenticationEnvironment(process.env),
    file: process.execPath,
  };
  const result = await runner(invocation);
  if (result.exitCode !== 0) {
    throw new SafeVerificationError("Wrangler authentication could not be verified.");
  }
  let identity: { accounts?: unknown; loggedIn?: unknown };
  try {
    identity = JSON.parse(result.stdout) as typeof identity;
  } catch {
    throw new SafeVerificationError("Wrangler authentication returned invalid JSON.");
  }
  assert(identity.loggedIn === true && Array.isArray(identity.accounts), "Wrangler authentication could not be verified.");
  const ownsAccount = identity.accounts.some((account) => {
    const candidate = account as { id?: unknown } | null;
    return candidate?.id === resources.accountId;
  });
  assert(ownsAccount, "The recorded Cloudflare account is not available to the current Wrangler authentication.");
}

export async function authorizeCompatibilityTarget(
  environment: Readonly<Record<string, string | undefined>>,
  accountResources: AccountResources,
  runner: WranglerRunner = defaultWranglerRunner,
) {
  const resources = validateAccountResources(accountResources);
  const baseUrl = compatibilityBaseUrl(environment, resources);
  await verifyWranglerAccountOwnership(resources, runner);
  return { baseUrl, token: gateToken(environment) };
}

async function requestJson<T>(
  baseUrl: URL,
  token: string,
  pathname: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<{ durationMs: number; value: T }> {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set("authorization", `Bearer ${token}`);
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(new URL(pathname, baseUrl), { ...init, headers, redirect: "error" });
  } catch {
    throw new SafeVerificationError(`The ${pathname} compatibility request failed.`);
  }
  const durationMs = performance.now() - startedAt;
  assert(response.ok, `The ${pathname} compatibility assertion returned a non-success status.`);
  try {
    return { durationMs, value: await response.json() as T };
  } catch {
    throw new SafeVerificationError(`The ${pathname} compatibility response was not valid JSON.`);
  }
}

async function verifyHealth(baseUrl: URL, token: string) {
  const cold = await requestJson<{ ok?: unknown }>(baseUrl, token, "/health", {}, false);
  const warm = await requestJson<{ ok?: unknown }>(baseUrl, token, "/health", {}, false);
  assert(cold.value.ok === true && warm.value.ok === true, "Cold or warm health failed.");
  return { coldMs: cold.durationMs, warmMs: warm.durationMs };
}

async function verifyRawBodies(baseUrl: URL, token: string) {
  const samples = [
    {
      contentType: "application/json",
      expectedType: "json",
      raw: '{"compatibility":"exact  json bytes","ok":true}\n',
    },
    {
      contentType: "application/x-www-form-urlencoded",
      expectedType: "form",
      raw: "name=Review+Anchor&encoded=a%2Bb%20c&empty=",
    },
  ];
  for (const sample of samples) {
    const result = await requestJson<{ parsedBodyType?: unknown; sha256?: unknown }>(
      baseUrl,
      token,
      "/compat/raw",
      { method: "POST", headers: { "content-type": sample.contentType }, body: sample.raw },
    );
    assert(
      result.value.sha256 === sha256(sample.raw) && result.value.parsedBodyType === sample.expectedType,
      `The ${sample.expectedType} raw-body assertion failed.`,
    );
  }
}

async function verifyContextIsolation(baseUrl: URL, token: string) {
  const pairs = Array.from({ length: 20 }, (_, index) => {
    const prefix = `compat-${index.toString().padStart(2, "0")}`;
    return [`${prefix}-left`, `${prefix}-right`] as const;
  });
  await Promise.all(pairs.map(async ([leftMarker, rightMarker]) => {
    const [left, right] = await Promise.all([
      requestJson<{ marker?: unknown }>(baseUrl, token, `/compat/context/${leftMarker}`),
      requestJson<{ marker?: unknown }>(baseUrl, token, `/compat/context/${rightMarker}`),
    ]);
    assert(left.value.marker === leftMarker, "A left compatibility marker leaked across request scope.");
    assert(right.value.marker === rightMarker, "A right compatibility marker leaked across request scope.");
  }));
}

async function verifyDatabaseRoles(baseUrl: URL, token: string) {
  const result = await requestJson<{ roles?: unknown }>(baseUrl, token, "/compat/database");
  assert(Array.isArray(result.value.roles) && result.value.roles.length === 4, "The database role assertion is incomplete.");
  const seen = new Set<string>();
  for (const role of result.value.roles as RoleResult[]) {
    assert(typeof role.expected === "string", "An expected database role is invalid.");
    const expected = [...EXPECTED_ROLES.values()].find((name) => name === role.expected);
    assert(expected, "An unexpected database role was returned.");
    assert(
      role.expected === expected
        && role.actual === expected
        && role.matches === true
        && role.databaseResolved === true,
      `The ${expected} database role assertion failed.`,
    );
    seen.add(expected);
  }
  assert(seen.size === EXPECTED_ROLES.size, "Not every database role was asserted.");
}

async function fixtureContexts() {
  const manifest = await readJson<CompatibilityFixtureManifest>(FIXTURE_PATH, "Compatibility fixture manifest");
  assert(manifest.version === 1 && manifest.projectRef === "cwwgvkepocldophqzijf", "The compatibility fixture project is invalid.");
  assert(Array.isArray(manifest.contexts) && manifest.contexts.length === 2, "The compatibility fixture pair is incomplete.");
  return manifest.contexts.map((context) => ({
    sessionHashHex: context.sessionHashHex,
    ownBusinessId: context.businessId,
    otherBusinessId: context.otherBusinessId,
  }));
}

async function verifyTenantIsolation(baseUrl: URL, token: string) {
  const contexts = await fixtureContexts();
  const result = await requestJson<{ contexts?: unknown }>(baseUrl, token, "/compat/isolation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contexts }),
  });
  assert(Array.isArray(result.value.contexts) && result.value.contexts.length === 2, "The tenant-isolation result is incomplete.");
  for (const context of result.value.contexts as Array<Record<string, unknown>>) {
    assert(
      context.sessionResolved === true
        && context.ownTenantVisible === true
        && context.otherTenantDenied === true,
      "A synthetic tenant-isolation assertion failed.",
    );
  }
}

async function verifyScrypt(baseUrl: URL, token: string) {
  const samples = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await requestJson<{ durationMs?: unknown; invalid?: unknown; valid?: unknown }>(
      baseUrl,
      token,
      "/compat/scrypt",
      { method: "POST" },
    );
    assert(
      result.value.valid === true
        && result.value.invalid === false
        && typeof result.value.durationMs === "number"
        && Number.isFinite(result.value.durationMs)
        && result.value.durationMs >= 0,
      "A valid or invalid scrypt assertion failed.",
    );
    samples.push({
      invocationMs: result.durationMs,
      scryptPairMs: result.value.durationMs,
      valid: true,
      invalid: false,
    });
  }
  return samples;
}

async function main() {
  const accountResources = await readJson<AccountResources>(
    RESOURCE_IDS_PATH,
    "Authenticated account resource evidence",
  );
  const { baseUrl, token } = await authorizeCompatibilityTarget(process.env, accountResources);
  const health = await verifyHealth(baseUrl, token);
  await verifyRawBodies(baseUrl, token);
  await verifyContextIsolation(baseUrl, token);
  await verifyDatabaseRoles(baseUrl, token);
  await verifyTenantIsolation(baseUrl, token);
  const scrypt = await verifyScrypt(baseUrl, token);

  const evidence = {
    version: 1,
    passed: true,
    health,
    rawBodies: { json: true, form: true },
    contextPairs: 20,
    databaseRoles: [...EXPECTED_ROLES.values()],
    tenantIsolation: { ownTenantVisible: true, otherTenantDenied: true },
    scrypt,
    cpuMetricsInspectionRequired: true,
  };
  await mkdir(path.dirname(RESULTS_PATH), { recursive: true });
  await writeFile(RESULTS_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write("Compatibility verification passed; inspect Cloudflare CPU metrics before continuing.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof SafeVerificationError
      ? error.message
      : "Compatibility verification failed without exposing request or environment details.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
