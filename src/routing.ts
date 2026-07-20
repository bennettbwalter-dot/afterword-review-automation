import type { ActorRole, BusinessRole, WorkspaceView } from "./platform/domain";

export type AppView = Exclude<WorkspaceView, "overview"> | "growth";

export type WorkspaceRouteContext = {
  businessId?: string;
  locationId?: string;
};

export const APP_VIEW_PATHS: Record<AppView, string> = {
  growth: "/app/growth",
  requests: "/app/requests",
  automation: "/app/automation",
  reviews: "/app/reviews",
  "qr-codes": "/app/qr-codes",
  reports: "/app/reports",
  integrations: "/app/integrations",
  "team-billing": "/app/team-billing",
  "agency-overview": "/app/portfolio",
  clients: "/app/clients",
  exceptions: "/app/exceptions",
  audit: "/app/audit",
};

export const CLIENT_APP_VIEWS: AppView[] = [
  "growth",
  "reviews",
  "requests",
  "automation",
  "qr-codes",
  "reports",
  "integrations",
  "team-billing",
];

export const AGENCY_APP_VIEWS: AppView[] = [
  "agency-overview",
  "clients",
  "exceptions",
  "audit",
  "growth",
];

const TENANT_READ_APP_VIEWS: AppView[] = [
  "growth",
  "reviews",
  "requests",
  "automation",
  "qr-codes",
  "reports",
  "integrations",
];

const PATH_TO_VIEW = new Map(
  Object.entries(APP_VIEW_PATHS).map(([view, path]) => [path, view as AppView]),
);

function normalizedPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.toLowerCase();
}

export function appViewFromPath(pathname: string): AppView | undefined {
  const path = normalizedPath(pathname);
  if (path === "/app" || path === "/app/overview" || path === "/workspace") return "growth";
  return PATH_TO_VIEW.get(path);
}

export function defaultAppView(role?: ActorRole, hasSupportSession = false, businessRole?: BusinessRole): AppView {
  if (role === "agency_admin" && !hasSupportSession) return "agency-overview";
  if (role === "business_owner" && businessRole === "billing") return "team-billing";
  return "growth";
}

export function isAppViewAllowed(view: AppView, role: ActorRole, hasSupportSession = false, businessRole?: BusinessRole) {
  if (role === "agency_admin" && !hasSupportSession) return AGENCY_APP_VIEWS.includes(view);
  if (role === "business_owner" && businessRole === "billing") return view === "team-billing";
  if (role === "business_owner" && !["owner", "admin"].includes(businessRole ?? "")) {
    return TENANT_READ_APP_VIEWS.includes(view);
  }
  return CLIENT_APP_VIEWS.includes(view);
}

export function workspaceRoute(
  view: AppView,
  context: WorkspaceRouteContext = {},
) {
  const params = new URLSearchParams();
  if (context.businessId) params.set("business", context.businessId);
  if (context.locationId) params.set("location", context.locationId);
  const search = params.toString();
  return `${APP_VIEW_PATHS[view]}${search ? `?${search}` : ""}`;
}

export function workspaceLocationForBusiness(
  routeContext: WorkspaceRouteContext,
  businessId: string | undefined,
  requestedLocationId: string | undefined,
  defaultLocationId: string | undefined,
) {
  if (requestedLocationId) return requestedLocationId;
  const routeMatchesBusiness = !routeContext.businessId || routeContext.businessId === businessId;
  return (routeMatchesBusiness ? routeContext.locationId : undefined) ?? defaultLocationId;
}

export function workspaceBusinessForSession(
  routeContext: WorkspaceRouteContext,
  role: ActorRole,
  sessionBusinessId?: string,
  supportBusinessId?: string,
) {
  if (role === "agency_admin") return supportBusinessId ?? routeContext.businessId;
  return routeContext.businessId ?? sessionBusinessId;
}

export function workspaceContextFromSearch(search: string): WorkspaceRouteContext {
  const params = new URLSearchParams(search);
  const businessId = params.get("business")?.trim() || undefined;
  const locationId = params.get("location")?.trim() || undefined;
  return {
    ...(businessId ? { businessId } : {}),
    ...(locationId ? { locationId } : {}),
  };
}

export function publicReviewPreviewUrl(reviewUrl: string) {
  return `${reviewUrl}${reviewUrl.includes("?") ? "&" : "?"}preview=1`;
}

export function isPublicReviewPreview(search: string) {
  return new URLSearchParams(search).get("preview") === "1";
}
