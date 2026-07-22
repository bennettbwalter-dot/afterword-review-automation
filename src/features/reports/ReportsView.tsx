import React, { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Printer } from "lucide-react";
import type { BusinessAccount } from "../../platform/domain";
import {
  buildReportProjection,
  canCombineReportLocations,
  reportScopeAfterLocationSelection,
} from "./reports-domain";

export interface ReportsViewProps {
  business: BusinessAccount;
  selectedBusiness: BusinessAccount;
  demoMode: boolean;
  BrandComponent: ComponentType<{ compact?: boolean }>;
  ButtonComponent: ComponentType<{
    children: ReactNode;
    variant?: "primary" | "secondary" | "quiet" | "danger";
    onClick?: () => void;
  }>;
  DemoNoticeComponent: ComponentType;
  StarsComponent: ComponentType<{ rating: number; size?: number }>;
  onPrint?: () => void;
}

export function ReportsView({
  business,
  selectedBusiness,
  demoMode,
  BrandComponent,
  ButtonComponent,
  DemoNoticeComponent,
  StarsComponent,
  onPrint,
}: ReportsViewProps) {
  const [combined, setCombined] = useState(false);
  const previousLocationId = useRef(selectedBusiness.locationId);
  useEffect(() => {
    const nextCombined = reportScopeAfterLocationSelection(previousLocationId.current, selectedBusiness.locationId, combined);
    if (nextCombined !== combined) setCombined(nextCombined);
    previousLocationId.current = selectedBusiness.locationId;
  }, [combined, selectedBusiness.locationId]);

  const { locationReports, isCombinedReport, reportBusiness, metrics } = buildReportProjection(business, selectedBusiness, combined);
  const operationalTone = reportBusiness.healthTone === "success" ? "success" : "warning";
  const generatedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const integrationChecks = [
    { label: "Completed-job intake", state: reportBusiness.integrations.jobIntake },
    { label: "Google review sync", state: reportBusiness.integrations.google },
    { label: "Messaging delivery", state: reportBusiness.integrations.messaging },
  ];
  const printReport = onPrint ?? (() => window.print());

  return (
    <React.Fragment>
    <div className="view-stack">
      <DemoNoticeComponent />
      <section className="report-shell">
        <header className="report-toolbar"><div><span>{demoMode ? "Monthly report" : "Operational snapshot"}</span><strong>{demoMode ? "July 2026" : generatedOn}</strong></div><div className="report-toolbar__actions">{canCombineReportLocations(business) && <div className="report-scope-toggle" aria-label="Report scope"><button type="button" className={!combined ? "is-active" : undefined} onClick={() => setCombined(false)}>Selected location</button><button type="button" className={combined ? "is-active" : undefined} onClick={() => setCombined(true)}>All locations</button></div>}<ButtonComponent variant="secondary" onClick={printReport}><Printer size={16} /> Print report</ButtonComponent></div></header>
        <article className="report-paper">
          <header><BrandComponent /><span>{reportBusiness.name} · {isCombinedReport ? `Combined ${locationReports.length}-location report` : reportBusiness.locationName}</span><small>{demoMode ? "1–31 July 2026 · Sample report" : `Generated ${generatedOn} · Authenticated current totals`}</small></header>
          <section className="report-intro"><p>{demoMode ? reportBusiness.healthTone === "success" ? "Your review-request system ran without an integration failure this month." : `The system protected customer messaging while ${reportBusiness.health.toLowerCase()} needs attention.` : reportBusiness.healthTone === "success" ? "Current durable records show the configured review-request system operating without a reported integration failure." : `Customer messaging remains protected while ${reportBusiness.health.toLowerCase()} needs attention.`}</p><span className={`status-pill status-pill--${operationalTone}`}>{reportBusiness.healthTone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {reportBusiness.health}</span></section>
          <section className="report-metrics"><div><span>Completed jobs</span><strong>{metrics.completedJobs}</strong></div><div><span>Requests delivered</span><strong>{metrics.delivered}</strong></div><div><span>Unique link clicks</span><strong>{metrics.uniqueClicks}</strong></div><div><span>{demoMode ? "New reviews detected" : "Reviews cached"}</span><strong>{metrics.reviewsDetected}</strong></div></section>
          <section className="report-rating"><div><span>Google rating</span><strong>{metrics.rating.toFixed(1)}</strong><StarsComponent rating={Math.round(metrics.rating)} size={17} /></div><p>{demoMode ? `${metrics.totalReviews} total reviews at month end.` : `${metrics.totalReviews} total Google reviews in the current snapshot.`} Review detection is not exact job-level attribution; estimated conversion is reported separately.</p></section>
          {isCombinedReport && <section className="report-locations"><h2>Location performance</h2><div className="report-locations__table" role="table" aria-label="Location-level report"><div className="report-locations__head" role="row"><span role="columnheader">Location</span><span role="columnheader">Jobs</span><span role="columnheader">Delivered</span><span role="columnheader">Clicks</span><span role="columnheader">Reviews</span><span role="columnheader">Rating</span><span role="columnheader">SMS</span></div>{locationReports.map((location) => <div role="row" key={location.id}><strong role="cell">{location.name}</strong><span role="cell">{location.completedJobs}</span><span role="cell">{location.delivered}</span><span role="cell">{location.uniqueClicks}</span><span role="cell">{location.reviewsDetected}</span><span role="cell">{location.rating.toFixed(1)}</span><span role="cell">{location.smsSegments}</span></div>)}</div><p>Combined totals appear above. Each row is calculated from records scoped to that location.</p></section>}
          {demoMode ? (
            <section className="report-events"><h2>Operational checks</h2><div><span><CheckCircle2 size={16} /> Completed-job trigger</span><strong>Healthy</strong></div><div><span>{reportBusiness.healthTone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} Google review sync</span><strong>{reportBusiness.healthTone === "success" ? "Healthy" : "Attention"}</strong></div><div><span><CheckCircle2 size={16} /> Suppression list</span><strong>4 contacts</strong></div><div><span><AlertTriangle size={16} /> Failed delivery rate</span><strong>2.4%</strong></div></section>
          ) : (
            <section className="report-events"><h2>Operational checks</h2>{integrationChecks.map((check) => <div key={check.label}><span>{check.state.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {check.label}</span><strong>{check.state.status}</strong></div>)}<div><span><AlertTriangle size={16} /> Review attribution</span><strong>Estimated</strong></div></section>
          )}
          <section className="report-unavailable-outcome" aria-labelledby="publishing-outcomes-title">
            <div><h2 id="publishing-outcomes-title">Publishing outcomes</h2><span>Unavailable</span></div>
            <p>Only independently reconciled destination receipts will appear after a destination passes approval, enumeration, retry and reconciliation, and a controlled pilot.</p>
          </section>
          <section className="report-unavailable-outcome" aria-labelledby="mobilewan-usage-title">
            <div><h2 id="mobilewan-usage-title">MobileWAN usage</h2><span>Unavailable</span></div>
            <p>Usage requires a managed GPU benchmark, legal and moderation clearance, private Storage, a commercial account and credit ledger, and approved pricing.</p>
          </section>
          <footer><span>Review Anchor · Review automation</span><span>{demoMode ? "Sample data · Not a live client report" : "Authenticated tenant report"}</span></footer>
        </article>
      </section>
    </div>
    </React.Fragment>
  );
}
