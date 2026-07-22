import { createHash } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { createAsyncScope } from "../../cloudflare/shared/async-scope";
import {
  createFastifyFetchHandler,
  createScopedFastifyFetchHandler,
  runInEventScope,
  type EventScopedCapabilities,
} from "../../cloudflare/shared/http";
import compatWorker, { type CompatibilityEnv } from "../../cloudflare/compat/src/index";

interface RawRequest extends FastifyRequest {
  rawBody?: Buffer;
}

interface TestCapabilities extends EventScopedCapabilities {
  marker: string;
}

function errorShapeApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    (request as RawRequest).rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody.toString("utf8")) as unknown);
    } catch {
      done(Object.assign(new Error("The request body is not valid JSON."), {
        code: "INVALID_JSON",
        statusCode: 400,
      }), undefined);
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

  app.get("/bridge", async () => ({ ok: true }));
  app.get("/headers", async (_request, reply) => {
    reply.raw.setHeader("x-duplicate", ["first", "second"]);
    reply.raw.setHeader("set-cookie", ["one=1; Path=/", "two=2; Path=/; HttpOnly"]);
    return { ok: true };
  });
  app.post("/raw", async (request) => {
    const rawBody = (request as RawRequest).rawBody ?? Buffer.alloc(0);
    return {
      body: request.body,
      rawBase64: rawBody.toString("base64"),
      sha256: createHash("sha256").update(rawBody).digest("hex"),
    };
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: "NOT_FOUND", message: "The requested API resource was not found.", requestId: request.id },
  }));
  app.setErrorHandler((error, request, reply) => {
    const possible = error as { code?: unknown; message?: unknown; statusCode?: number };
    return reply.code(possible.statusCode ?? 500).send({
      error: {
        code: typeof possible.code === "string" ? possible.code : "INTERNAL_ERROR",
        message: String(possible.message ?? "The request failed."),
        requestId: request.id,
      },
    });
  });

  return app;
}

describe("Fastify Worker HTTP bridge", () => {
  it("returns a Fastify response through a Worker Request", async () => {
    const fetch = await createFastifyFetchHandler(errorShapeApp());

    const response = await fetch(new Request("https://staging.example/bridge"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("preserves duplicate headers and separate Set-Cookie values", async () => {
    const fetch = await createFastifyFetchHandler(errorShapeApp());

    const response = await fetch(new Request("https://staging.example/headers"));

    expect(response.headers.get("x-duplicate")).toBe("first, second");
    expect(response.headers.getSetCookie()).toEqual([
      "one=1; Path=/",
      "two=2; Path=/; HttpOnly",
    ]);
  });

  it.each([
    {
      contentType: "application/json",
      raw: '{"message":"Review  Anchor","nested":{"ok":true}}\n',
      parsed: { message: "Review  Anchor", nested: { ok: true } },
    },
    {
      contentType: "application/x-www-form-urlencoded",
      raw: "name=Review+Anchor&note=a%2Bb%20c&empty=",
      parsed: { name: "Review Anchor", note: "a+b c", empty: "" },
    },
  ])("preserves exact $contentType bytes before parsing", async ({ contentType, raw, parsed }) => {
    const fetch = await createFastifyFetchHandler(errorShapeApp());

    const response = await fetch(new Request("https://staging.example/raw", {
      method: "POST",
      headers: { "content-type": contentType },
      body: raw,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: parsed,
      rawBase64: Buffer.from(raw).toString("base64"),
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
  });

  it("keeps interleaved bridged requests in their own async scope", async () => {
    const scope = createAsyncScope<TestCapabilities>("compatibility request");
    const closed: string[] = [];
    let releaseFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstReached!: () => void;
    const firstAtBarrier = new Promise<void>((resolve) => {
      firstReached = resolve;
    });
    const app = Fastify({ logger: false });
    app.get("/context/:marker", async () => {
      const before = scope.current.marker;
      if (before === "first") {
        firstReached();
        await firstBarrier;
      } else {
        await firstAtBarrier;
        releaseFirst();
      }
      return { before, after: scope.current.marker };
    });
    const fetch = await createScopedFastifyFetchHandler(app, scope, (request) => {
      const marker = new URL(request.url).pathname.split("/").at(-1) ?? "missing";
      return {
        marker,
        async close() {
          closed.push(marker);
        },
      };
    });

    const [first, second] = await Promise.all([
      fetch(new Request("https://staging.example/context/first")),
      fetch(new Request("https://staging.example/context/second")),
    ]);

    await expect(first.json()).resolves.toEqual({ before: "first", after: "first" });
    await expect(second.json()).resolves.toEqual({ before: "second", after: "second" });
    expect(closed.sort()).toEqual(["first", "second"]);
  });

  it("returns Fastify error shapes for unsupported methods and malformed bodies", async () => {
    const fetch = await createFastifyFetchHandler(errorShapeApp());

    const unsupported = await fetch(new Request("https://staging.example/bridge", { method: "PATCH" }));
    const malformed = await fetch(new Request("https://staging.example/raw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }));

    expect(unsupported.status).toBe(404);
    expect(await unsupported.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
  });

  it.each(["success", "failure"])("closes event-scoped capabilities after %s", async (outcome) => {
    const scope = createAsyncScope<TestCapabilities>("compatibility request");
    let closed = false;
    const capabilities: TestCapabilities = {
      marker: outcome,
      async close() {
        closed = true;
      },
    };

    const operation = runInEventScope(scope, capabilities, async () => {
      expect(scope.current.marker).toBe(outcome);
      if (outcome === "failure") throw new Error("expected failure");
      return "ok";
    });

    if (outcome === "failure") await expect(operation).rejects.toThrow("expected failure");
    else await expect(operation).resolves.toBe("ok");
    expect(closed).toBe(true);
  });
});

describe("compatibility Worker", () => {
  const token = "synthetic-compatibility-gate-token";
  const env = { COMPAT_GATE_TOKEN: token } as CompatibilityEnv;
  const request = (path: string, init?: RequestInit, authenticated = true) => {
    const headers = new Headers(init?.headers);
    if (authenticated) headers.set("authorization", `Bearer ${token}`);
    return new Request(`https://review-anchor-staging-compat.example${path}`, { ...init, headers });
  };
  const fetchCompat = (input: Request) => compatWorker.fetch(input, env);

  it("keeps health public while rejecting unauthenticated assertions", async () => {
    const health = await fetchCompat(request("/health", undefined, false));
    const unauthorized = await fetchCompat(request("/compat/raw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }, false));

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("reports only the raw-body hash and parsed body type", async () => {
    const raw = '{"compatibility":"exact bytes"}\n';
    const response = await fetchCompat(request("/compat/raw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }));

    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(payload).toEqual({
      parsedBodyType: "json",
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
    expect(JSON.stringify(payload)).not.toContain("exact bytes");
  });

  it("returns the correct marker for paired interleaved requests", async () => {
    const [left, right] = await Promise.all([
      fetchCompat(request("/compat/context/pair-1-left")),
      fetchCompat(request("/compat/context/pair-1-right")),
    ]);

    await expect(left.json()).resolves.toEqual({ marker: "pair-1-left" });
    await expect(right.json()).resolves.toEqual({ marker: "pair-1-right" });
  });

  it("checks both valid and invalid fixed scrypt passwords without returning the hash", async () => {
    const response = await fetchCompat(request("/compat/scrypt", { method: "POST" }));

    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(payload).toMatchObject({ valid: true, invalid: false });
    expect(payload.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(payload)).not.toContain("scrypt$");
  });
});
