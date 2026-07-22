import { createHash, timingSafeEqual } from "node:crypto";

import Fastify, { type FastifyRequest } from "fastify";
import pg from "pg";

import { createAsyncScope } from "../../shared/async-scope";
import {
  createFastifyFetchHandler,
  runInEventScope,
  type EventScopedCapabilities,
} from "../../shared/http";
import { verifyPassword } from "../../../server/security/crypto";

const { Client } = pg;

const EXPECTED_DATABASE_ROLES = {
  AUTH_DB: "afterword_auth_login",
  RUNTIME_DB: "afterword_runtime_login",
  INGRESS_DB: "afterword_ingress_login",
  WORKER_DB: "afterword_worker_login",
} as const;

const COMPATIBILITY_PASSWORD = "Cloudflare compatibility password 2026!";
const COMPATIBILITY_HASH = "scrypt$16384$8$1$XrtXOb8CvTz77fgedLmkKg$8Kx_JFypoqhWfIdL42mShiNIIlivAaaWykxhNBQmNeAZwrELwxESLKrYBEzcqnMBBujrcdYJaMOUX0-Uw29rDQ";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const MARKER_PATTERN = /^[A-Za-z0-9_-]{1,120}-(?:left|right)$/;

export interface CompatibilityEnv {
  COMPAT_GATE_TOKEN: string;
  AUTH_DB: Hyperdrive;
  RUNTIME_DB: Hyperdrive;
  INGRESS_DB: Hyperdrive;
  WORKER_DB: Hyperdrive;
}

interface CompatibilityRequestCapabilities extends EventScopedCapabilities {
  clients: Set<InstanceType<typeof Client>>;
  env: CompatibilityEnv;
  marker: string;
}

interface RawRequest extends FastifyRequest {
  rawBody?: Buffer;
}

interface IsolationContext {
  sessionHashHex: string;
  ownBusinessId: string;
  otherBusinessId: string;
}

class CompatibilityError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const requestScope = createAsyncScope<CompatibilityRequestCapabilities>("compatibility request");
const contextBarriers = new Map<string, {
  markers: Set<string>;
  promise: Promise<void>;
  resolve: () => void;
}>();

function secureTokenMatch(actual: string | undefined, expected: string | undefined) {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

function requestMarker(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/compat/context/")) return "compatibility-request";
  return decodeURIComponent(pathname.slice("/compat/context/".length));
}

async function waitForContextPair(marker: string) {
  if (!MARKER_PATTERN.test(marker)) {
    throw new CompatibilityError(400, "INVALID_MARKER", "The compatibility marker is invalid.");
  }

  const pair = marker.replace(/-(?:left|right)$/, "");
  let barrier = contextBarriers.get(pair);
  if (!barrier) {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    barrier = { markers: new Set(), promise, resolve };
    contextBarriers.set(pair, barrier);
  }

  barrier.markers.add(marker);
  if (barrier.markers.size === 2) barrier.resolve();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      barrier.promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new CompatibilityError(409, "CONTEXT_PAIR_TIMEOUT", "The compatibility pair did not interleave.")),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (contextBarriers.get(pair) === barrier) contextBarriers.delete(pair);
  }
}

async function connect(binding: Hyperdrive) {
  const client = new Client({
    connectionString: binding.connectionString,
    application_name: "review-anchor-staging-compat",
  });
  requestScope.current.clients.add(client);
  try {
    await client.connect();
    return client;
  } catch {
    throw new CompatibilityError(503, "DATABASE_UNAVAILABLE", "A compatibility database capability is unavailable.");
  }
}

function isolationContexts(body: unknown): [IsolationContext, IsolationContext] {
  const contexts = (body as { contexts?: unknown } | null)?.contexts;
  if (!Array.isArray(contexts) || contexts.length !== 2) {
    throw new CompatibilityError(400, "INVALID_ISOLATION_FIXTURE", "Exactly two synthetic isolation contexts are required.");
  }

  const parsed = contexts.map((value) => {
    const candidate = value as Partial<IsolationContext> | null;
    if (
      !candidate
      || typeof candidate.sessionHashHex !== "string"
      || !HASH_PATTERN.test(candidate.sessionHashHex)
      || typeof candidate.ownBusinessId !== "string"
      || !UUID_PATTERN.test(candidate.ownBusinessId)
      || typeof candidate.otherBusinessId !== "string"
      || !UUID_PATTERN.test(candidate.otherBusinessId)
      || candidate.ownBusinessId === candidate.otherBusinessId
    ) {
      throw new CompatibilityError(400, "INVALID_ISOLATION_FIXTURE", "The synthetic isolation context is invalid.");
    }
    return candidate as IsolationContext;
  });

  if (
    parsed[0].sessionHashHex === parsed[1].sessionHashHex
    || parsed[0].ownBusinessId !== parsed[1].otherBusinessId
    || parsed[1].ownBusinessId !== parsed[0].otherBusinessId
  ) {
    throw new CompatibilityError(400, "INVALID_ISOLATION_FIXTURE", "The synthetic isolation pair is inconsistent.");
  }
  return [parsed[0], parsed[1]];
}

async function assertIsolation(context: IsolationContext) {
  const authClient = await connect(requestScope.current.env.AUTH_DB);
  const session = await authClient.query<{ resolved: boolean }>(
    "select exists(select 1 from app_private.resolve_auth_session(decode($1, 'hex'))) as resolved",
    [context.sessionHashHex],
  );
  const sessionResolved = session.rows[0]?.resolved === true;

  const runtimeClient = await connect(requestScope.current.env.RUNTIME_DB);
  await runtimeClient.query("begin");
  try {
    await runtimeClient.query(
      "select app_private.set_request_context_from_session(decode($1, 'hex'), null)",
      [context.sessionHashHex],
    );
    const visibility = await runtimeClient.query<{ own_visible: boolean; other_visible: boolean }>(
      `select
        exists(select 1 from public.businesses where id = $1::uuid) as own_visible,
        exists(select 1 from public.businesses where id = $2::uuid) as other_visible`,
      [context.ownBusinessId, context.otherBusinessId],
    );
    await runtimeClient.query("commit");
    return {
      sessionResolved,
      ownTenantVisible: visibility.rows[0]?.own_visible === true,
      otherTenantDenied: visibility.rows[0]?.other_visible === false,
    };
  } catch {
    await runtimeClient.query("rollback").catch(() => undefined);
    throw new CompatibilityError(503, "ISOLATION_ASSERTION_FAILED", "The tenant-isolation assertion could not complete.");
  }
}

async function buildCompatibilityApp() {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    (request as RawRequest).rawBody = rawBody;
    try {
      done(null, rawBody.length === 0 ? {} : JSON.parse(rawBody.toString("utf8")) as unknown);
    } catch {
      done(new CompatibilityError(400, "INVALID_JSON", "The request body is not valid JSON."), undefined);
    }
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      (request as RawRequest).rawBody = rawBody;
      done(null, Object.fromEntries(new URLSearchParams(rawBody.toString("utf8"))));
    },
  );

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.split("?", 1)[0] === "/health") return;
    if (!secureTokenMatch(bearerToken(request), requestScope.current.env.COMPAT_GATE_TOKEN)) {
      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "The compatibility gate token is required.", requestId: request.id },
      });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/compat/raw", async (request) => {
    const rawBody = (request as RawRequest).rawBody ?? Buffer.alloc(0);
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    return {
      sha256: createHash("sha256").update(rawBody).digest("hex"),
      parsedBodyType: contentType === "application/x-www-form-urlencoded" ? "form" : "json",
    };
  });

  app.get<{ Params: { marker: string } }>("/compat/context/:marker", async (request) => {
    await waitForContextPair(request.params.marker);
    return { marker: requestScope.current.marker };
  });

  app.get("/compat/database", async () => {
    const roles = [];
    for (const [bindingName, expected] of Object.entries(EXPECTED_DATABASE_ROLES)) {
      const binding = requestScope.current.env[bindingName as keyof typeof EXPECTED_DATABASE_ROLES];
      const client = await connect(binding);
      const identity = await client.query<{ current_user: string; database_name: string }>(
        "select current_user, current_database() as database_name",
      );
      const actual = identity.rows[0]?.current_user ?? "unresolved";
      roles.push({ expected, actual, matches: actual === expected, databaseResolved: Boolean(identity.rows[0]?.database_name) });
    }
    return { roles };
  });

  app.post("/compat/isolation", async (request) => {
    const contexts = isolationContexts(request.body);
    return { contexts: await Promise.all(contexts.map(assertIsolation)) };
  });

  app.post("/compat/scrypt", async () => {
    const startedAt = performance.now();
    const valid = await verifyPassword(COMPATIBILITY_PASSWORD, COMPATIBILITY_HASH);
    const invalid = await verifyPassword(`${COMPATIBILITY_PASSWORD} invalid`, COMPATIBILITY_HASH);
    return { valid, invalid, durationMs: performance.now() - startedAt };
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: "NOT_FOUND", message: "The requested compatibility resource was not found.", requestId: request.id },
  }));
  app.setErrorHandler((error, request, reply) => {
    const compatibilityError = error instanceof CompatibilityError ? error : undefined;
    return reply.code(compatibilityError?.statusCode ?? 500).send({
      error: {
        code: compatibilityError?.code ?? "COMPATIBILITY_ASSERTION_FAILED",
        message: compatibilityError?.message ?? "The compatibility assertion could not complete.",
        requestId: request.id,
      },
    });
  });

  return app;
}

let fetchHandlerPromise: ReturnType<typeof createFastifyFetchHandler> | undefined;

function compatibilityFetchHandler() {
  fetchHandlerPromise ??= buildCompatibilityApp().then(createFastifyFetchHandler);
  return fetchHandlerPromise;
}

export default {
  async fetch(request: Request, env: CompatibilityEnv): Promise<Response> {
    const capabilities: CompatibilityRequestCapabilities = {
      clients: new Set(),
      env,
      marker: requestMarker(request),
      async close() {
        const clients = [...this.clients];
        this.clients.clear();
        await Promise.all(clients.map(async (client) => {
          await client.end().catch(() => undefined);
        }));
      },
    };

    return runInEventScope(requestScope, capabilities, async () => {
      const fetch = await compatibilityFetchHandler();
      return fetch(request);
    });
  },
} satisfies ExportedHandler<CompatibilityEnv>;
