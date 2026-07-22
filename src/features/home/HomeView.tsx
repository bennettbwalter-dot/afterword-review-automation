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
  QrCode,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { BusinessAccount, RequestRecord, SessionContext } from "../../platform/domain";
import { isAppViewAllowed, type AppView, type WorkspaceRouteContext } from "../../routing";
import { HOME_MODULES, buildHomeProjection } from "./home-domain";

export interface HomeViewProps {
  business: BusinessAccount;
  requests: RequestRecord[];
  session: SessionContext;
  canConfigure: boolean;
  canManageBilling: boolean;
  selectedLocationId?: string;
  onSelectLocation: (locationId: string) => void;
  onNavigate: (view: AppView, context?: WorkspaceRouteContext) => void;
  onAddJob: () => void;
}

const HOME_ICONS = {
  profile: MapPin,
  reviews: Star,
  requests: QrCode,
  content: Activity,
  reports: FileText,
  connections: Link2,
  billing: Building2,
} as const;

export function HomeView({
  business,
  requests,
  session,
  canConfigure,
  canManageBilling,
  selectedLocationId,
  onSelectLocation,
  onNavigate,
  onAddJob,
}: HomeViewProps) {
  const { locations, activeLocation, requestCount } = buildHomeProjection(business, requests, selectedLocationId);
  const availableModules = HOME_MODULES.filter((module) => (
    isAppViewAllowed(module.view, session.role, false, session.businessRole)
  ));

  return (
    <div className="product-feature product-feature--home">
      <div className="growth-suite" data-testid="home-business">
        <section className="growth-hero">
          <div>
            <span className="eyebrow">Workspace Home · {business.name}</span>
            <h2>Keep customer requests moving from one scoped workspace.</h2>
            <p>Open Google Profile, Content, Reports, Connections, and Billing without moving review records outside their protected feature.</p>
            <div className="growth-hero__actions">
              <button className="button" type="button" onClick={() => onNavigate("google-profile", { googleProfileTab: "profile" })}>
                <Star size={16} /> Open Google Profile
              </button>
              {canConfigure
                ? <button className="button button--secondary" type="button" onClick={onAddJob}><ClipboardCheck size={16} /> Add completed job</button>
                : <small>Your role has read-only access to completed jobs.</small>}
            </div>
          </div>
          <div className="growth-context-card">
            <span><ShieldCheck size={16} /> Signed in as {session.userName}</span>
            <strong>{business.name}</strong>
            <label htmlFor="home-location">Business location</label>
            <select id="home-location" value={activeLocation.id} onChange={(event) => onSelectLocation(event.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
            <small><MapPin size={14} /> The selected location is preserved across the workspace.</small>
          </div>
        </section>

        <section className="growth-metrics" aria-label="Selected location operational summary">
          <article><span>Completed jobs</span><strong>{activeLocation.completedJobs}</strong><small>Selected location workflow volume</small></article>
          <article><span>Requests delivered</span><strong>{activeLocation.delivered}</strong><small>Neutral request delivery count</small></article>
          <article><span>Unique link clicks</span><strong>{activeLocation.uniqueClicks}</strong><small>Aggregate request-link activity</small></article>
          <article><span>Automation</span><strong>{business.automationState}</strong><small>{business.lastSuccess}</small></article>
        </section>

        <section className="growth-module-section" aria-labelledby="home-modules-title">
          <div className="growth-section-head">
            <div><span className="eyebrow">Scoped workspace</span><h3 id="home-modules-title">Product areas</h3></div>
            <p>{requestCount} {requestCount === 1 ? "request" : "requests"} in the selected location context.</p>
          </div>
          <div className="growth-module-grid">
            {availableModules.map((module) => {
              const Icon = HOME_ICONS[module.icon];
              return (
                <article key={module.id} className={module.id === "google-profile" ? "is-primary" : undefined}>
                  <span className="growth-module-card__icon"><Icon size={20} /></span>
                  <h4>{module.title}</h4>
                  <p>{module.detail}</p>
                  <button type="button" onClick={() => onNavigate(module.view, "routeContext" in module ? module.routeContext : undefined)}>{module.action} <ArrowRight size={15} /></button>
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
            <CheckCircle2 size={17} /> Home is using the active tenant and location context shown above.
          </div>
        )}
      </div>
    </div>
  );
}
