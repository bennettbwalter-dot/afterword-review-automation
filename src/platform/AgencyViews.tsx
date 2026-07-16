import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  KeyRound,
  PauseCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  UsersRound,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { AuditEvent, BusinessAccount, PlatformException, WorkspaceView } from "./domain";

function ToneTag({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function AgencyDemoNotice() {
  return (
    <div className="demo-notice demo-notice--quiet">
      <span className="demo-label">Agency preview</span>
      <p>Portfolio summaries contain seeded operational data only. Production tenant data requires server-enforced access and an audited support session.</p>
    </div>
  );
}

export function AgencyOverviewView({
  businesses,
  exceptions,
  pausedBusinessIds,
  onView,
  onStartSupport,
}: {
  businesses: BusinessAccount[];
  exceptions: PlatformException[];
  pausedBusinessIds: ReadonlySet<string>;
  onView: (view: WorkspaceView) => void;
  onStartSupport: (business: BusinessAccount) => void;
}) {
  const healthy = businesses.filter((business) => business.healthTone === "success").length;
  const paused = businesses.filter((business) => business.automationState !== "Live" || pausedBusinessIds.has(business.id)).length;
  const affected = businesses.reduce((total, business) => total + business.affectedCount, 0);
  return (
    <div className="view-stack">
      <AgencyDemoNotice />
      <section className="metric-grid agency-metric-grid" aria-label="Agency portfolio metrics">
        <article className="metric-card metric-card--wide"><span>Client accounts</span><strong>{businesses.length}</strong><small>{businesses.length} active locations in this demo</small></article>
        <article className="metric-card metric-card--success"><span>Healthy</span><strong>{healthy}</strong><small>Normal automation and integrations</small></article>
        <article className="metric-card metric-card--warning"><span>Open exceptions</span><strong>{exceptions.length}</strong><small>{affected} events or messages affected</small></article>
        <article className="metric-card"><span>Paused scopes</span><strong>{paused}</strong><small>Held safely; queued work retained</small></article>
      </section>

      <section className="agency-dashboard-grid">
        <article className="panel agency-attention-panel">
          <header className="panel__head"><div><h2>Needs attention</h2><p>Sorted by safety and client impact</p></div><button className="text-action" type="button" onClick={() => onView("exceptions")}>View all <ArrowRight size={15} /></button></header>
          <div className="agency-exception-list">
            {exceptions.slice(0, 4).map((item) => {
              const business = businesses.find((candidate) => candidate.id === item.businessId)!;
              return (
                <article key={item.id}>
                  <span className={`agency-exception-list__icon agency-exception-list__icon--${item.tone}`}><AlertTriangle size={17} /></span>
                  <div><span><ToneTag tone={item.tone}>{item.category}</ToneTag><small>{item.id}</small></span><strong>{item.title}</strong><p>{business.name} · {business.locationName} · {item.affectedLabel}</p></div>
                  <button className="button button--secondary" type="button" onClick={() => onStartSupport(business)}>Open safely</button>
                </article>
              );
            })}
          </div>
        </article>

        <article className="panel fleet-health-panel">
          <header className="panel__head"><div><h2>Client health</h2><p>Explicit states, not an opaque score</p></div><button className="text-action" type="button" onClick={() => onView("clients")}>All clients <ArrowRight size={15} /></button></header>
          <div className="fleet-health-list">
            {businesses.map((business) => {
              const isPaused = business.automationState !== "Live" || pausedBusinessIds.has(business.id);
              return (
                <div key={business.id}>
                  <span className="client-avatar">{business.initials}</span>
                  <span><strong>{business.name}</strong><small>{business.locationName} · {business.lastSuccess}</small></span>
                  <ToneTag tone={business.healthTone}>{business.health}</ToneTag>
                  <small>{isPaused ? "Sending held" : business.automationState}</small>
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
}

export function ClientsView({
  businesses,
  pausedBusinessIds,
  onStartSupport,
  onPause,
}: {
  businesses: BusinessAccount[];
  pausedBusinessIds: ReadonlySet<string>;
  onStartSupport: (business: BusinessAccount) => void;
  onPause: (business: BusinessAccount) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => businesses.filter((business) => `${business.name} ${business.locationName}`.toLowerCase().includes(query.toLowerCase())),
    [businesses, query],
  );
  return (
    <div className="view-stack">
      <AgencyDemoNotice />
      <section className="panel agency-client-panel">
        <header className="table-toolbar agency-client-toolbar">
          <div className="search-field"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="client-search">Search clients</label><input id="client-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client or location" /></div>
          <span>{filtered.length} accounts · tenant summaries only</span>
        </header>
        <div className="agency-client-list" role="table" aria-label="Agency client accounts">
          <div className="agency-client-list__head" role="row"><span role="columnheader">Client</span><span role="columnheader">Health</span><span role="columnheader">Automation</span><span role="columnheader">Last success</span><span role="columnheader">Actions</span></div>
          {filtered.map((business) => {
            const isManuallyPaused = pausedBusinessIds.has(business.id);
            const isSystemProtected = business.automationState !== "Live" && !isManuallyPaused;
            const isPaused = isManuallyPaused || isSystemProtected;
            return (
              <article className="agency-client-row" role="row" key={business.id}>
                <span role="cell" className="agency-client-row__identity"><span className="client-avatar">{business.initials}</span><span><strong>{business.name}</strong><small>{business.locationName} · {business.timezone}</small></span></span>
                <span role="cell"><ToneTag tone={business.healthTone}>{business.health}</ToneTag><small>{business.integrationSummary}</small></span>
                <span role="cell"><strong>{isPaused ? "Held" : business.automationState}</strong><small>{business.affectedCount ? `${business.affectedCount} affected` : "No affected work"}</small></span>
                <span role="cell"><strong>{business.lastSuccess}</strong><small>{business.plan}</small></span>
                <span role="cell" className="agency-client-row__actions"><button className="button button--secondary" type="button" onClick={() => onStartSupport(business)}><UserCog size={16} /> Start support</button><button className="button button--quiet" type="button" disabled={isSystemProtected} onClick={() => onPause(business)}>{isSystemProtected ? <ShieldAlert size={16} /> : <PauseCircle size={16} />} {isSystemProtected ? "System protected" : isManuallyPaused ? "Resume scope" : "Pause scope"}</button></span>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function ExceptionsView({
  businesses,
  exceptions,
  pausedBusinessIds,
  onStartSupport,
  onPause,
}: {
  businesses: BusinessAccount[];
  exceptions: PlatformException[];
  pausedBusinessIds: ReadonlySet<string>;
  onStartSupport: (business: BusinessAccount) => void;
  onPause: (business: BusinessAccount) => void;
}) {
  const [filter, setFilter] = useState("All");
  const shown = filter === "All" ? exceptions : exceptions.filter((item) => item.category === filter);
  return (
    <div className="view-stack">
      <AgencyDemoNotice />
      <section className="exception-summary-strip">
        <span><ShieldAlert size={18} /><strong>{exceptions.filter((item) => item.tone === "danger").length} safety-critical</strong><small>Sending blocked or paused</small></span>
        <span><Clock3 size={18} /><strong>{exceptions.filter((item) => item.category === "Delayed").length} delayed</strong><small>Automatic backoff active</small></span>
        <span><CheckCircle2 size={18} /><strong>Protection working</strong><small>No duplicate or unpermitted sends</small></span>
      </section>
      <section className="panel exception-panel">
        <header className="table-toolbar"><div><strong>Open exceptions</strong><small>What failed, who is affected and what the system protected</small></div><label className="select-field"><span className="sr-only">Filter exception category</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All</option><option>Critical</option><option>Compliance</option><option>Security</option><option>Warning</option><option>Delayed</option></select></label></header>
        <div className="exception-list">
          {shown.map((item) => {
            const business = businesses.find((candidate) => candidate.id === item.businessId)!;
            const isManuallyPaused = pausedBusinessIds.has(business.id);
            const isSystemProtected = business.automationState !== "Live" && !isManuallyPaused;
            return (
              <article key={item.id}>
                <header><span><ToneTag tone={item.tone}>{item.category}</ToneTag><small>{item.id} · began {item.startedAt}</small></span><strong>{item.title}</strong><p>{business.name} · {business.locationName}</p></header>
                <dl><div><dt>Affected</dt><dd>{item.affectedLabel}</dd></div><div><dt>System response</dt><dd>{item.protectedAction}</dd></div><div><dt>Client</dt><dd>{item.clientNotified ? "Notified" : "Notification pending"}</dd></div><div><dt>Owner</dt><dd>{item.owner}</dd></div></dl>
                <div className="exception-resolution"><ShieldCheck size={17} /><span><strong>Recommended resolution</strong><small>{item.resolution}</small></span></div>
                <footer><button className="button button--secondary" type="button" onClick={() => onStartSupport(business)}>Start support session</button><button className="button button--quiet" type="button" disabled={isSystemProtected} onClick={() => onPause(business)}>{isSystemProtected ? <ShieldAlert size={16} /> : <PauseCircle size={16} />} {isSystemProtected ? "System protected" : isManuallyPaused ? "Resume scope" : "Pause scope"}</button></footer>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function AuditLogView({ businesses, events }: { businesses: BusinessAccount[]; events: AuditEvent[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => events.filter((event) => {
      const business = event.businessId ? businesses.find((candidate) => candidate.id === event.businessId) : undefined;
      return `${event.id} ${event.correlationId} ${event.supportSessionId ?? ""} ${event.actor} ${event.action} ${event.resource} ${event.reason ?? ""} ${business?.name ?? "Platform"} ${business?.locationName ?? ""}`.toLowerCase().includes(query.toLowerCase());
    }),
    [businesses, events, query],
  );
  return (
    <div className="view-stack">
      <AgencyDemoNotice />
      <section className="panel audit-panel">
        <header className="table-toolbar"><div className="search-field"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="audit-search">Search audit history</label><input id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, action or correlation ID" /></div><span><KeyRound size={16} /> Append-only demo history</span></header>
        <div className="audit-list" role="table" aria-label="Administrative audit history">
          <div className="audit-list__head" role="row"><span role="columnheader">Time</span><span role="columnheader">Actor</span><span role="columnheader">Tenant</span><span role="columnheader">Action and resource</span><span role="columnheader">Outcome</span><span role="columnheader">Correlation</span></div>
          {filtered.map((event) => {
            const business = event.businessId ? businesses.find((candidate) => candidate.id === event.businessId) : undefined;
            return (
              <article className="audit-row" role="row" key={event.id}>
                <span role="cell"><strong>{event.occurredAt}</strong><small>{event.id}</small></span>
                <span role="cell"><strong>{event.actor}</strong><small>{event.actorType}</small></span>
                <span role="cell"><strong>{business?.name ?? "Platform"}</strong><small>{business?.locationName ?? "System scope"}</small></span>
                <span role="cell"><strong>{event.action}</strong><small>{event.resource}{event.reason ? ` · ${event.reason}` : ""}</small></span>
                <span role="cell"><ToneTag tone={event.outcome === "Blocked" ? "warning" : "success"}>{event.outcome}</ToneTag><small>{event.supportSessionId ?? "No support session"}</small></span>
                <span role="cell"><strong>{event.correlationId}</strong><small>Masked metadata only</small></span>
              </article>
            );
          })}
          {filtered.length === 0 && <div className="empty-state audit-empty"><Search size={24} /><h2>No matching audit events.</h2><p>Search by actor, tenant, action, event ID, support session, or correlation ID.</p></div>}
        </div>
      </section>
    </div>
  );
}

export function TeamBillingView({ business, canConfigure }: { business: BusinessAccount; canConfigure: boolean }) {
  return (
    <div className="view-stack">
      <div className="demo-notice"><span className="demo-label">Tenant scoped</span><p>Team and billing data below belongs only to {business.name}. Production membership checks are enforced by the API and database.</p></div>
      <section className="team-billing-grid">
        <article className="panel team-panel"><header className="panel__head"><div><h2>Team members</h2><p>Roles apply only inside this business</p></div><button className="button button--secondary" type="button" disabled aria-label={canConfigure ? "Invitations are simulated in this demo" : "View-only support cannot invite members"}><UsersRound size={16} /> Invite · Demo</button></header><div className="team-list">{business.teamMembers.map((member) => <div key={member.name}><span className="client-avatar">{member.initials}</span><span><strong>{member.name}</strong><small>{member.role}</small></span><ToneTag tone="success">Active</ToneTag></div>)}</div><p className="panel-note"><ShieldCheck size={16} /> Owners cannot remove the final active owner or grant a role above their own.</p></article>
        <article className="panel billing-panel"><header className="panel__head"><div><h2>Subscription</h2><p>Business-level plan and message usage</p></div><ToneTag tone="accent">{business.plan}</ToneTag></header><div className="billing-summary"><span><small>Plan</small><strong>{business.plan}</strong></span><span><small>Renewal</small><strong>1 Aug 2026</strong></span><span><small>Messaging</small><strong>Billed separately</strong></span></div><button className="button button--secondary" type="button" disabled aria-label={canConfigure ? "Billing management is simulated in this demo" : "View-only support cannot manage billing"}>Billing · Demo</button></article>
      </section>
    </div>
  );
}
