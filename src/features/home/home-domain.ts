import type { BusinessAccount, RequestRecord } from "../../platform/domain";
import type { AppView, WorkspaceRouteContext } from "../../routing";

export type HomeModuleId = "google-profile" | "reviews" | "requests-qr" | "content" | "reports" | "connections" | "billing";
export type HomeModuleIcon = "profile" | "reviews" | "requests" | "content" | "reports" | "connections" | "billing";

export interface HomeModule {
  readonly id: HomeModuleId;
  readonly view: AppView;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
  readonly icon: HomeModuleIcon;
  readonly routeContext?: WorkspaceRouteContext;
}

export interface HomeLocationAggregate {
  readonly id: string;
  readonly name: string;
  readonly completedJobs: number;
  readonly delivered: number;
  readonly uniqueClicks: number;
}

export interface HomeProjection {
  readonly locations: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly activeLocation: HomeLocationAggregate;
  readonly requestCount: number;
}

export const HOME_MODULES = [
  { id: "google-profile", view: "google-profile", title: "Google Profile", detail: "Open the selected location's Google Profile workspace.", action: "Open Profile", icon: "profile", routeContext: { googleProfileTab: "profile" } },
  { id: "reviews", view: "google-profile", title: "Reviews", detail: "Read Google review records inside their protected profile boundary.", action: "Open Reviews", icon: "reviews", routeContext: { googleProfileTab: "reviews" } },
  { id: "requests-qr", view: "google-profile", title: "Requests & QR", detail: "Manage neutral review requests, workflow state, and QR access.", action: "Open Requests & QR", icon: "requests", routeContext: { googleProfileTab: "requests-qr" } },
  { id: "content", view: "content", title: "Content", detail: "Open the manual-first content workspace and readiness journey.", action: "Open Content", icon: "content", routeContext: { contentTab: "create" } },
  { id: "reports", view: "reports", title: "Reports", detail: "Review location-scoped operational performance and proof of value.", action: "Open Reports", icon: "reports" },
  { id: "connections", view: "settings-billing", title: "Connections", detail: "Check operational services and publication readiness separately.", action: "Open Connections", icon: "connections", routeContext: { settingsBillingTab: "connections" } },
  { id: "billing", view: "settings-billing", title: "Billing", detail: "Open the authorised account, plan, team, and SMS allowance view.", action: "Open Billing", icon: "billing", routeContext: { settingsBillingTab: "billing" } },
] as const satisfies readonly HomeModule[];

export function buildHomeProjection(business: BusinessAccount, requests: readonly RequestRecord[], selectedLocationId?: string): HomeProjection {
  const sourceLocations = business.locationReports?.length
    ? business.locationReports
    : [{ id: business.locationId ?? business.id, name: business.locationName, completedJobs: business.metrics.completedJobs, delivered: business.metrics.delivered, uniqueClicks: business.metrics.uniqueClicks }];
  const projectedLocations = sourceLocations.map(({ id, name, completedJobs, delivered, uniqueClicks }) => ({ id, name, completedJobs, delivered, uniqueClicks }));
  const activeLocation = projectedLocations.find(({ id }) => id === selectedLocationId) ?? projectedLocations[0];
  if (!activeLocation) throw new Error("Scoped business must expose at least one Home location.");
  return {
    locations: projectedLocations.map(({ id, name }) => ({ id, name })),
    activeLocation,
    requestCount: requests.filter(({ businessId, locationId }) => businessId === business.id && locationId === activeLocation.id).length,
  };
}
