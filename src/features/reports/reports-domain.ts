import type { BusinessAccount, LocationReportSummary, TenantMetrics } from "../../platform/domain";

export interface ReportProjection {
  locationReports: readonly LocationReportSummary[];
  isCombinedReport: boolean;
  reportBusiness: BusinessAccount;
  metrics: TenantMetrics;
}

export function canCombineReportLocations(business: BusinessAccount): boolean {
  return (business.locationReports?.length ?? 0) > 1;
}

export function reportScopeAfterLocationSelection(
  previousLocationId: string | undefined,
  nextLocationId: string | undefined,
  combined: boolean,
): boolean {
  return previousLocationId === nextLocationId ? combined : false;
}

export function combinedReportMetrics(business: BusinessAccount): TenantMetrics {
  const locations = business.locationReports ?? [];
  const totalReviews = locations.reduce((sum, location) => sum + location.totalReviews, 0);
  const rating = totalReviews === 0
    ? 0
    : locations.reduce((sum, location) => sum + (location.rating * location.totalReviews), 0) / totalReviews;

  return {
    ...business.metrics,
    completedJobs: locations.reduce((sum, location) => sum + location.completedJobs, 0),
    delivered: locations.reduce((sum, location) => sum + location.delivered, 0),
    uniqueClicks: locations.reduce((sum, location) => sum + location.uniqueClicks, 0),
    reviewsDetected: locations.reduce((sum, location) => sum + location.reviewsDetected, 0),
    rating,
    totalReviews,
  };
}

export function buildReportProjection(
  business: BusinessAccount,
  selectedBusiness: BusinessAccount,
  combined: boolean,
): ReportProjection {
  const locationReports = business.locationReports ?? [];
  const isCombinedReport = combined && locationReports.length > 1;
  const reportBusiness = isCombinedReport
    ? { ...business, metrics: combinedReportMetrics(business) }
    : selectedBusiness;

  return { locationReports, isCombinedReport, reportBusiness, metrics: reportBusiness.metrics };
}
