import { describe, expect, it } from "vitest";

import { createAsyncScope } from "../../cloudflare/shared/async-scope";
import {
  applicationRoute,
  ingressRoute,
} from "../../cloudflare/shared/routing";

const request = (method: string, path: string) => ({
  method,
  url: `https://staging.example${path}`,
});

describe("application routing", () => {
  const publicReviewOrigin = "https://reviews.example";

  it.each([
    ["GET", "/api/v1/health", { owner: "fastify" }],
    ["GET", "/api/v1/workspace", { owner: "fastify" }],
    ["GET", "/app", { owner: "assets" }],
    ["GET", "/workspace", { owner: "assets" }],
    ["POST", "/workspace", { owner: "not-found" }],
  ])("routes %s %s to %o", (method, path, expected) => {
    expect(applicationRoute(request(method, path), publicReviewOrigin)).toEqual(expected);
  });

  it("redirects review requests to the public review origin with their query", () => {
    expect(
      applicationRoute(
        request("GET", "/r/token?preview=1&source=email"),
        publicReviewOrigin,
      ),
    ).toEqual({
      owner: "redirect",
      location: "https://reviews.example/r/token?preview=1&source=email",
    });
  });
});

describe("ingress routing", () => {
  it.each([
    ["GET", "/api/v1/public/review-flows/token", { owner: "fastify" }],
    ["POST", "/webhooks/stripe", { owner: "fastify" }],
    ["GET", "/r/token", { owner: "assets" }],
    ["POST", "/r/token", { owner: "not-found" }],
    ["GET", "/app", { owner: "not-found" }],
    ["GET", "/workspace", { owner: "not-found" }],
    ["GET", "/api/v1/workspace", { owner: "not-found" }],
    ["GET", "/assets/app.4f3a2b1c.js", { owner: "assets" }],
  ])("routes %s %s to %o", (method, path, expected) => {
    expect(ingressRoute(request(method, path))).toEqual(expected);
  });
});

describe("request scoped bindings", () => {
  it("keeps interleaved async work bound to its own store", async () => {
    const scope = createAsyncScope<{ marker: string }>("test bindings");
    let releaseFirst!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstReachedBarrier!: () => void;
    const firstReached = new Promise<void>((resolve) => {
      firstReachedBarrier = resolve;
    });

    const first = scope.run({ marker: "first" }, async () => {
      const before = scope.current.marker;
      firstReachedBarrier();
      await firstBarrier;
      return [before, scope.current.marker];
    });

    await firstReached;
    const second = scope.run({ marker: "second" }, async () => {
      const before = scope.current.marker;
      await Promise.resolve();
      return [before, scope.current.marker];
    });

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      ["first", "first"],
      ["second", "second"],
    ]);
  });

  it("rejects binding access outside a request scope", () => {
    const scope = createAsyncScope<{ marker: string }>("test bindings");

    expect(() => scope.current.marker).toThrow("test bindings is unavailable outside a request scope");
  });
});
