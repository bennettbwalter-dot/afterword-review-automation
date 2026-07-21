import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Link2,
  MapPin,
  MessageSquareText,
  QrCode,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";
import type {
  BusinessAccount,
  RequestRecord,
  ReviewRecord,
  SessionContext,
} from "../platform/domain";
import { IS_DEMO_MODE } from "../platform/api";
import { isAppViewAllowed, type AppView, type WorkspaceRouteContext } from "../routing";

type GrowthSuiteProps = {
  business: BusinessAccount;
  businesses: BusinessAccount[];
  requests: RequestRecord[];
  reviews: ReviewRecord[];
  session: SessionContext;
  agencyMode: boolean;
  canConfigure: boolean;
  canManageBilling: boolean;
  selectedLocationId?: string;
  onSelectLocation: (locationId: string) => void;
  onNavigate: (view: AppView, context?: WorkspaceRouteContext) => void;
  onAddJob: () => void;
};

type ModuleCard = {
  view: AppView;
  title: string;
  detail: string;
  action: string;
  icon: typeof Star;
  routeContext?: WorkspaceRouteContext;
};

export const HOME_MODULES: ModuleCard[] = [
  {
    view: "google-profile",
    title: "Review Anchor",
    detail: "Monitor Google reviews and owner-reply status for this location.",
    action: "Open Reviews",
    icon: Star,
    routeContext: { googleProfileTab: "reviews" },
  },
  {
    view: "google-profile",
    title: "Customer requests",
    detail: "Track completed jobs, consent evidence, delivery and conversions.",
    action: "Open Requests",
    icon: UsersRound,
    routeContext: { googleProfileTab: "requests-qr" },
  },
  {
    view: "google-profile",
    title: "Review workflow",
    detail: "See the neutral request sequence and its protected sending state.",
    action: "Open Workflow",
    icon: Activity,
    routeContext: { googleProfileTab: "requests-qr" },
  },
  {
    view: "google-profile",
    title: "Review QR codes",
    detail: "Use the permanent Google review destination and scan reporting.",
    action: "Open QR Codes",
    icon: QrCode,
    routeContext: { googleProfileTab: "requests-qr" },
  },
  {
    view: "reports",
    title: "Reputation reports",
    detail: "Review performance, location results and proof of value.",
    action: "Open Reports",
    icon: FileText,
  },
  {
    view: "settings-billing",
    title: "Connected services",
    detail: "Manage Google, messaging and completed-job intake readiness.",
    action: "Open Integrations",
    icon: Link2,
    routeContext: { settingsBillingTab: "connections" },
  },
  {
    view: "settings-billing",
    title: "Account and billing",
    detail: "Use the same tenant members, plan and SMS allowance as Review Anchor.",
    action: "Open Account",
    icon: Building2,
    routeContext: { settingsBillingTab: "billing" },
  },
];

function Stars({ rating }: { rating: number }) {
  return (
    <span className="growth-rating" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      <Star size={15} fill="currentColor" aria-hidden="true" />
      {rating.toFixed(1)}
    </span>
  );
}

function AgencyGrowthDashboard({ businesses, session, onNavigate }: Pick<GrowthSuiteProps, "businesses" | "session" | "onNavigate">) {
  const healthy = businesses.filter((business) => business.healthTone === "success").length;
  const reviews = businesses.reduce((total, business) => total + business.metrics.reviewsDetected, 0);
  const needsAttention = businesses.length - healthy;

  return (
    <div className="growth-suite" data-testid="growth-suite-agency">
      <section className="growth-hero growth-hero--agency">
        <div>
          <span className="eyebrow">Growth Suite · agency portfolio</span>
          <h2>One account boundary for every client.</h2>
          <p>
            Portfolio signals come from the authenticated Review Anchor workspace. Client review and customer records
            remain hidden until an audited support session is opened from Clients.
          </p>
        </div>
        <div className="growth-session-chip"><ShieldCheck size={17} /> {session.userName} · Agency admin</div>
      </section>

      <section className="growth-metrics" aria-label="Agency growth summary">
        <article><span>Managed businesses</span><strong>{businesses.length}</strong><small>Current authorised portfolio</small></article>
        <article><span>Healthy accounts</span><strong>{IS_DEMO_MODE ? healthy : "Scoped"}</strong><small>{IS_DEMO_MODE ? "Review automation operating normally" : "Available inside authorised client support"}</small></article>
        <article><span>Reviews detected</span><strong>{IS_DEMO_MODE ? reviews : "Scoped"}</strong><small>{IS_DEMO_MODE ? "Across seeded portfolio summaries" : "Tenant review records remain protected"}</small></article>
        <article><span>Needs attention</span><strong>{IS_DEMO_MODE ? needsAttention : "Scoped"}</strong><small>Open via protected client controls</small></article>
      </section>

      <section className="growth-native-panel">
        <div>
          <span className="growth-native-panel__icon"><ShieldCheck size={23} /></span>
          <div><h3>Tenant access stays explicit</h3><p>Choose a client, open a scoped support session, then use Review Anchor without creating a second account or copying customer data.</p></div>
        </div>
        <button className="button" type="button" onClick={() => onNavigate("agency")}>Open Agency <ArrowRight size={16} /></button>
      </section>
    </div>
  );
}

export default function GrowthSuite(props: GrowthSuiteProps) {
  if (props.agencyMode) {
    return <AgencyGrowthDashboard businesses={props.businesses} session={props.session} onNavigate={props.onNavigate} />;
  }

  const {
    business,
    requests,
    reviews,
    session,
    canConfigure,
    canManageBilling,
    selectedLocationId,
    onSelectLocation,
    onNavigate,
    onAddJob,
  } = props;
  const locations = business.locationReports?.length
    ? business.locationReports
    : [{
        id: business.locationId ?? business.id,
        name: business.locationName,
        completedJobs: business.metrics.completedJobs,
        delivered: business.metrics.delivered,
        uniqueClicks: business.metrics.uniqueClicks,
        reviewsDetected: business.metrics.reviewsDetected,
        rating: business.metrics.rating,
        totalReviews: business.metrics.totalReviews,
        smsSegments: business.billing?.smsUsed ?? 0,
      }];
  const activeLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0];
  const effectiveLocationId = activeLocation?.id;
  const locationRequests = requests.filter((request) => request.locationId === effectiveLocationId);
  const locationReviews = reviews.filter((review) => review.locationId === effectiveLocationId);
  const latestReviews = locationReviews.slice(0, 3);
  const availableModules = HOME_MODULES.filter((module) => (
    isAppViewAllowed(module.view, session.role, session.role === "agency_admin", session.businessRole)
  ));

  return (
    <div className="growth-suite" data-testid="growth-suite-business">
      <section className="growth-hero">
        <div>
          <span className="eyebrow">Workspace Home · {business.name}</span>
          <h2>Keep your Google Profile current and customer requests moving.</h2>
          <p>
            Review Anchor keeps Google Profile, review requests, reports, and settings in the same workspace. Every module below uses the same
            signed-in account, tenant, business, location, billing record and protected customer data.
          </p>
          <div className="growth-hero__actions">
            <button className="button" type="button" onClick={() => onNavigate("google-profile")}>
              <Star size={16} /> Open Review Anchor
            </button>
            {canConfigure
              ? <button className="button button--secondary" type="button" onClick={onAddJob}><ClipboardCheck size={16} /> Add completed job</button>
              : <small>Your role has read-only access to completed jobs.</small>}
          </div>
        </div>
        <div className="growth-context-card">
          <span><ShieldCheck size={16} /> Signed in as {session.userName}</span>
          <strong>{business.name}</strong>
          <label htmlFor="growth-location">Business location</label>
          <select
            id="growth-location"
            value={effectiveLocationId}
            onChange={(event) => onSelectLocation(event.target.value)}
          >
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <small><MapPin size={14} /> The selected location is preserved across the workspace.</small>
        </div>
      </section>

      <section className="growth-metrics" aria-label="Selected location reputation summary">
        <article><span>Google rating</span><strong>{activeLocation?.rating ? activeLocation.rating.toFixed(1) : "—"}</strong><small>{activeLocation?.totalReviews ?? 0} review records</small></article>
        <article><span>Reviews detected</span><strong>{activeLocation?.reviewsDetected ?? 0}</strong><small>Current reporting window</small></article>
        <article><span>Requests delivered</span><strong>{activeLocation?.delivered ?? 0}</strong><small>{activeLocation?.completedJobs ?? 0} completed jobs</small></article>
        <article><span>Automation</span><strong>{business.automationState}</strong><small>{business.lastSuccess}</small></article>
      </section>

      <section className="growth-anchor-panel">
        <header>
          <div><span className="growth-anchor-panel__mark"><Star size={21} fill="currentColor" /></span><div><small>Main reputation module</small><h3>Review Anchor</h3></div></div>
          <button className="button button--secondary" type="button" onClick={() => onNavigate("google-profile")}>View Google Profile <ArrowRight size={16} /></button>
        </header>
        {latestReviews.length > 0 ? (
          <div className="growth-review-list">
            {latestReviews.map((review) => (
              <article key={review.id}>
                <div><strong>{review.name}</strong><Stars rating={review.rating} /></div>
                <p>{review.body}</p>
                <small>{review.date} · {review.replied ? "Owner reply recorded" : "Awaiting owner reply"}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="growth-empty-state">
            <MessageSquareText size={24} />
            <div><h3>No reviews for this location yet</h3><p>Connect Google or wait for the next review sync. No sample reviews are shown.</p></div>
            <button className="button button--secondary" type="button" onClick={() => onNavigate("settings-billing")}>Check connections</button>
          </div>
        )}
      </section>

      <section className="growth-module-section" aria-labelledby="growth-modules-title">
        <div className="growth-section-head"><div><span className="eyebrow">Connected workspace</span><h3 id="growth-modules-title">Reputation tools</h3></div><p>{locationRequests.length} requests in the selected location context.</p></div>
        <div className="growth-module-grid">
          {availableModules.map((module) => {
            const Icon = module.icon;
            return (
            <article key={`${module.view}-${module.title}`} className={module.view === "google-profile" ? "is-primary" : undefined}>
                <span className="growth-module-card__icon"><Icon size={20} /></span>
                <h4>{module.title}</h4>
                <p>{module.detail}</p>
                <button type="button" onClick={() => onNavigate(module.view, module.routeContext)}>{module.action} <ArrowRight size={15} /></button>
              </article>
            );
          })}
        </div>
      </section>

      {!canConfigure && (
        <div className="growth-permission-note" role="status">
          <AlertTriangle size={17} /> {canManageBilling
            ? "Customer and workflow changes are disabled for this role. Account and billing controls remain available."
            : "You have read-only access. Navigation remains available, but configuration and customer actions stay disabled."}
        </div>
      )}
      {canConfigure && business.healthTone === "success" && (
        <div className="growth-permission-note growth-permission-note--success" role="status">
          <CheckCircle2 size={17} /> Review Anchor is using the active tenant and location context shown above.
        </div>
      )}
    </div>
  );
}
