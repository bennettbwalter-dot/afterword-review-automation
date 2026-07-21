import type { ActorRole, BusinessRole } from "./platform/domain";

export type AppView =
  | "home"
  | "google-profile"
  | "content"
  | "reports"
  | "settings-billing"
  | "agency"
  | "operations-exceptions"
  | "operations-audit";

export type GoogleProfileTab = "profile" | "reviews" | "requests-qr" | "posts-media";
export type ContentTab = "create" | "uploads" | "approvals" | "scheduled" | "published" | "failed";
export type SettingsBillingTab = "connections" | "billing";

export type WorkspaceRouteContext = {
  businessId?: string;
  locationId?: string;
  googleProfileTab?: GoogleProfileTab;
  contentTab?: ContentTab;
  settingsBillingTab?: SettingsBillingTab;
};

export type ParsedWorkspaceRoute = WorkspaceRouteContext & {
  view: AppView;
  legacy: boolean;
};

export const APP_VIEW_PATHS: Record<AppView, string> = {
  home: "/app/home",
  "google-profile": "/app/google-profile",
  content: "/app/content",
  reports: "/app/reports",
  "settings-billing": "/app/settings-billing",
  agency: "/app/agency",
  "operations-exceptions": "/app/operations/exceptions",
  "operations-audit": "/app/operations/audit",
};

export const CLIENT_APP_VIEWS: AppView[] = ["home", "google-profile", "content", "reports", "settings-billing"];
export const AGENCY_APP_VIEWS: AppView[] = ["agency", "operations-exceptions", "operations-audit"];
const TENANT_READ_APP_VIEWS: AppView[] = ["home", "google-profile", "content", "reports"];

const googleProfileTabs = new Set<GoogleProfileTab>(["profile", "reviews", "requests-qr", "posts-media"]);
const contentTabs = new Set<ContentTab>(["create", "uploads", "approvals", "scheduled", "published", "failed"]);
const settingsBillingTabs = new Set<SettingsBillingTab>(["connections", "billing"]);

function normalizedPath(pathname: string) {
  return (pathname.replace(/\/+$/, "") || "/").toLowerCase();
}

export function parseWorkspaceRoute(pathname: string, search = ""): ParsedWorkspaceRoute | undefined {
  const path = normalizedPath(pathname);
  const context = workspaceContextFromSearch(search);
  const direct = (view: AppView, extra: Partial<WorkspaceRouteContext> = {}): ParsedWorkspaceRoute => ({ view, legacy: false, ...context, ...extra });
  const legacy = (view: AppView, extra: Partial<WorkspaceRouteContext> = {}): ParsedWorkspaceRoute => ({ view, legacy: true, ...context, ...extra });

  if (path === "/app/home") return direct("home");
  if (path === "/app/google-profile") return direct("google-profile", { googleProfileTab: "profile" });
  if (path.startsWith("/app/google-profile/")) {
    const tab = path.slice("/app/google-profile/".length) as GoogleProfileTab;
    return googleProfileTabs.has(tab) ? direct("google-profile", { googleProfileTab: tab }) : undefined;
  }
  if (path === "/app/content") return direct("content", { contentTab: "create" });
  if (path.startsWith("/app/content/")) {
    const tab = path.slice("/app/content/".length) as ContentTab;
    return contentTabs.has(tab) ? direct("content", { contentTab: tab }) : undefined;
  }
  if (path === "/app/reports") return direct("reports");
  if (path === "/app/settings-billing") return direct("settings-billing", { settingsBillingTab: "connections" });
  if (path.startsWith("/app/settings-billing/")) {
    const tab = path.slice("/app/settings-billing/".length) as SettingsBillingTab;
    return settingsBillingTabs.has(tab) ? direct("settings-billing", { settingsBillingTab: tab }) : undefined;
  }
  if (path === "/app/agency") return direct("agency");
  if (path === "/app/operations/exceptions") return direct("operations-exceptions");
  if (path === "/app/operations/audit") return direct("operations-audit");

  if (["/app", "/app/growth", "/workspace"].includes(path)) return legacy("home");
  if (path === "/app/reviews") return legacy("google-profile", { googleProfileTab: "reviews" });
  if (["/app/requests", "/app/automation", "/app/qr-codes"].includes(path)) return legacy("google-profile", { googleProfileTab: "requests-qr" });
  if (path === "/app/integrations") return legacy("settings-billing", { settingsBillingTab: "connections" });
  if (path === "/app/team-billing") return legacy("settings-billing", { settingsBillingTab: "billing" });
  if (["/app/portfolio", "/app/clients"].includes(path)) return legacy("agency");
  if (path === "/app/exceptions") return legacy("operations-exceptions");
  if (path === "/app/audit") return legacy("operations-audit");
  return undefined;
}

export function appViewFromPath(pathname: string): AppView | undefined {
  return parseWorkspaceRoute(pathname)?.view;
}

export function defaultAppView(role?: ActorRole, hasSupportSession = false, businessRole?: BusinessRole): AppView {
  if (role === "agency_admin" && !hasSupportSession) return "agency";
  if (role === "business_owner" && businessRole === "billing") return "settings-billing";
  return "home";
}

export function isAppViewAllowed(view: AppView, role: ActorRole, hasSupportSession = false, businessRole?: BusinessRole) {
  if (role === "agency_admin" && !hasSupportSession) return AGENCY_APP_VIEWS.includes(view);
  if (role === "business_owner" && businessRole === "billing") return view === "settings-billing";
  if (role === "business_owner" && !["owner", "admin"].includes(businessRole ?? "")) return TENANT_READ_APP_VIEWS.includes(view);
  return CLIENT_APP_VIEWS.includes(view);
}

export function workspaceRoute(view: AppView, context: WorkspaceRouteContext = {}, search = "") {
  let path = APP_VIEW_PATHS[view];
  if (view === "google-profile" && context.googleProfileTab && context.googleProfileTab !== "profile") path += `/${context.googleProfileTab}`;
  if (view === "content" && context.contentTab && context.contentTab !== "create") path += `/${context.contentTab}`;
  if (view === "settings-billing" && context.settingsBillingTab) path += `/${context.settingsBillingTab}`;

  const params = new URLSearchParams(search);
  if (context.businessId) params.set("business", context.businessId); else params.delete("business");
  if (context.locationId) params.set("location", context.locationId); else params.delete("location");
  const serialized = params.toString();
  return `${path}${serialized ? `?${serialized}` : ""}`;
}

export function workspaceLocationForBusiness(routeContext: WorkspaceRouteContext, businessId: string | undefined, requestedLocationId: string | undefined, defaultLocationId: string | undefined) {
  if (requestedLocationId) return requestedLocationId;
  const routeMatchesBusiness = !routeContext.businessId || routeContext.businessId === businessId;
  return (routeMatchesBusiness ? routeContext.locationId : undefined) ?? defaultLocationId;
}

export function workspaceBusinessForSession(routeContext: WorkspaceRouteContext, role: ActorRole, sessionBusinessId?: string, supportBusinessId?: string) {
  if (role === "agency_admin") return supportBusinessId ?? routeContext.businessId;
  return routeContext.businessId ?? sessionBusinessId;
}

export function workspaceContextFromSearch(search: string): WorkspaceRouteContext {
  const params = new URLSearchParams(search);
  const businessId = params.get("business")?.trim() || undefined;
  const locationId = params.get("location")?.trim() || undefined;
  return { ...(businessId ? { businessId } : {}), ...(locationId ? { locationId } : {}) };
}

export function publicReviewPreviewUrl(reviewUrl: string) { return `${reviewUrl}${reviewUrl.includes("?") ? "&" : "?"}preview=1`; }
export function isPublicReviewPreview(search: string) { return new URLSearchParams(search).get("preview") === "1"; }
