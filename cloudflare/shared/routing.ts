export type RouteDecision =
  | { owner: "fastify" }
  | { owner: "assets" }
  | { owner: "redirect"; location: string }
  | { owner: "not-found" };

const isGetOrHead = (method: string) => method === "GET" || method === "HEAD";
const isReviewPath = (pathname: string) => pathname === "/r" || pathname.startsWith("/r/");
const isPublicApiPath = (pathname: string) =>
  pathname === "/api/v1/public" || pathname.startsWith("/api/v1/public/");
const isWebhookPath = (pathname: string) =>
  pathname === "/webhooks" || pathname.startsWith("/webhooks/");
const fingerprintedAsset = /(?:[-.])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export function applicationRoute(
  request: Pick<Request, "method" | "url">,
  publicReviewOrigin: string,
): RouteDecision {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    return { owner: "fastify" };
  }

  if (isReviewPath(url.pathname)) {
    const destination = new URL(publicReviewOrigin);
    destination.pathname = url.pathname;
    destination.search = url.search;
    destination.hash = "";
    return { owner: "redirect", location: destination.toString() };
  }

  return isGetOrHead(request.method)
    ? { owner: "assets" }
    : { owner: "not-found" };
}

export function ingressRoute(
  request: Pick<Request, "method" | "url">,
): RouteDecision {
  const url = new URL(request.url);

  if (isPublicApiPath(url.pathname) || isWebhookPath(url.pathname)) {
    return { owner: "fastify" };
  }

  if (
    isGetOrHead(request.method) &&
    (isReviewPath(url.pathname) || fingerprintedAsset.test(url.pathname))
  ) {
    return { owner: "assets" };
  }

  return { owner: "not-found" };
}
