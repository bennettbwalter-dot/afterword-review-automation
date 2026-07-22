import { httpServerHandler } from "cloudflare:node";
import type { FastifyInstance } from "fastify";

import type { AsyncScope } from "./async-scope";

export interface EventScopedCapabilities {
  close(): Promise<void>;
}

export type FastifyFetchHandler = (request: Request) => Promise<Response>;

export async function createFastifyFetchHandler(app: FastifyInstance): Promise<FastifyFetchHandler> {
  await app.ready();
  const handler = httpServerHandler(
    app.server as unknown as Parameters<typeof httpServerHandler>[0],
  );
  if (!handler.fetch) {
    throw new Error("The Cloudflare Node HTTP bridge did not expose a Fetch handler.");
  }
  return handler.fetch.bind(handler) as FastifyFetchHandler;
}

export async function runInEventScope<T extends EventScopedCapabilities, R>(
  scope: AsyncScope<T>,
  capabilities: T,
  operation: () => R | Promise<R>,
): Promise<R> {
  try {
    return await scope.run(capabilities, operation);
  } finally {
    await capabilities.close();
  }
}

export async function createScopedFastifyFetchHandler<T extends EventScopedCapabilities>(
  app: FastifyInstance,
  scope: AsyncScope<T>,
  createCapabilities: (request: Request) => T | Promise<T>,
) {
  const fetch = await createFastifyFetchHandler(app);

  return async (request: Request): Promise<Response> => {
    const capabilities = await createCapabilities(request);
    return runInEventScope(scope, capabilities, () => fetch(request));
  };
}
