import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  KeyRound,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuditEvent, BusinessAccount, PlatformException, SmsOveragePolicy, WorkspaceView } from "./domain";
import { IS_DEMO_MODE } from "./api";

function ToneTag({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function AgencyDemoNotice() {
  if (!IS_DEMO_MODE) return null;
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
  onView,
  onStartSupport,
  supportAvailable,
}: {
  businesses: BusinessAccount[];
  exceptions: PlatformException[];
  onView: (view: WorkspaceView) => void;
  onStartSupport: (business: BusinessAccount) => void;
  supportAvailable: boolean;
}) {
  const healthy = businesses.filter((business) => business.healthTone === "success").length;
  const paused = businesses.filter((business) => business.automationState !== "Live").length;
  const affected = businesses.reduce((total, business) => total + business.affectedCount, 0);
  const portfolioDetailAvailable = IS_DEMO_MODE;
  return (
    <div className="view-stack">
      <AgencyDemoNotice />
      <section className="metric-grid agency-metric-grid" aria-label="Agency portfolio metrics">
        <article className="metric-card metric-card--wide"><span>Client accounts</span><strong>{businesses.length}</strong><small>{businesses.length} active locations{IS_DEMO_MODE ? " in this demo" : ""}</small></article>
        <article className="metric-card metric-card--success"><span>Healthy</span><strong>{portfolioDetailAvailable ? healthy : "Scoped"}</strong><small>{portfolioDetailAvailable ? "Normal automation and integrations" : "Open a client with authorised support access"}</small></article>
        <article className="metric-card metric-card--warning"><span>Open exceptions</span><strong>{portfolioDetailAvailable ? exceptions.length : "Scoped"}</strong><small>{portfolioDetailAvailable ? `${affected} events or messages affected` : "Tenant operational detail stays protected"}</small></article>
        <article className="metric-card"><span>Paused scopes</span><strong>{portfolioDetailAvailable ? paused : "Scoped"}</strong><small>{portfolioDetailAvailable ? "Held safely; queued work retained" : "Read inside the selected tenant session"}</small></article>
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
                  {supportAvailable
                    ? <button className="button button--secondary" type="button" onClick={() => onStartSupport(business)}>Open safely</button>
                    : <small>MFA required for tenant access</small>}
                </article>
              );
            })}
            {exceptions.length === 0 && <div className="empty-state"><ShieldCheck size={22} /><h2>{portfolioDetailAvailable ? "No open exceptions." : "Client exception detail is protected."}</h2><p>{portfolioDetailAvailable ? "There are no client issues requiring agency attention." : "Choose a client and start a scoped support session before reading tenant operations."}</p></div>}
          </div>
        </article>

        <article className="panel fleet-health-panel">
          <header className="panel__head"><div><h2>Client health</h2><p>Explicit states, not an opaque score</p></div><button className="text-action" type="button" onClick={() => onView("clients")}>All clients <ArrowRight size={15} /></button></header>
          <div className="fleet-health-list">
            {businesses.map((business) => {
              const isPaused = business.automationState !== "Live";
              return (
                <div key={business.id}>
                  <span className="client-avatar">{business.initials}</span>
                  <span><strong>{business.name}</strong><small>{portfolioDetailAvailable ? `${business.locationName} · ${business.lastSuccess}` : "Tenant detail requires scoped access"}</small></span>
                  <ToneTag tone={portfolioDetailAvailable ? business.healthTone : "muted"}>{portfolioDetailAvailable ? business.health : "Protected"}</ToneTag>
                  <small>{portfolioDetailAvailable ? isPaused ? "Sending held" : business.automationState : "Start support"}</small>
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
  onStartSupport,
  supportAvailable,
}: {
  businesses: BusinessAccount[];
  onStartSupport: (business: BusinessAccount) => void;
  supportAvailable: boolean;
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
            const isPaused = business.automationState !== "Live";
            return (
              <article className="agency-client-row" role="row" key={business.id}>
                <span role="cell" className="agency-client-row__identity"><span className="client-avatar">{business.initials}</span><span><strong>{business.name}</strong><small>{business.locationName} · {business.timezone}</small></span></span>
                <span role="cell"><ToneTag tone={IS_DEMO_MODE ? business.healthTone : "muted"}>{IS_DEMO_MODE ? business.health : "Scoped access"}</ToneTag><small>{IS_DEMO_MODE ? business.integrationSummary : "Tenant integrations remain protected"}</small></span>
                <span role="cell"><strong>{IS_DEMO_MODE ? isPaused ? "Held" : business.automationState : "Protected"}</strong><small>{IS_DEMO_MODE ? business.affectedCount ? `${business.affectedCount} affected` : "No affected work" : "Open client to inspect"}</small></span>
                <span role="cell"><strong>{IS_DEMO_MODE ? business.lastSuccess : "Tenant scoped"}</strong><small>{IS_DEMO_MODE ? business.plan : "Shared account preserved"}</small></span>
                <span role="cell" className="agency-client-row__actions">{supportAvailable ? <button className="button button--secondary" type="button" onClick={() => onStartSupport(business)}><UserCog size={16} /> Start support</button> : <small>MFA required</small>}</span>
              </article>
            );
          })}
          {filtered.length === 0 && <div className="empty-state"><Search size={22} /><h2>No matching clients.</h2><p>Try another client or location name.</p><button className="text-action" type="button" onClick={() => setQuery("")}>Clear search</button></div>}
        </div>
      </section>
    </div>
  );
}

export function ExceptionsView({
  businesses,
  exceptions,
  onStartSupport,
  supportAvailable,
}: {
  businesses: BusinessAccount[];
  exceptions: PlatformException[];
  onStartSupport: (business: BusinessAccount) => void;
  supportAvailable: boolean;
}) {
  const [filter, setFilter] = useState("All");
  const shown = filter === "All" ? exceptions : exceptions.filter((item) => item.category === filter);
  return (
    <div className="view-stack">
      <AgencyDemoNotice />
      <section className="exception-summary-strip">
        {IS_DEMO_MODE ? <>
          <span><ShieldAlert size={18} /><strong>{exceptions.filter((item) => item.tone === "danger").length} safety-critical</strong><small>Sending blocked or paused</small></span>
          <span><Clock3 size={18} /><strong>{exceptions.filter((item) => item.category === "Delayed").length} delayed</strong><small>Automatic backoff active</small></span>
          <span><CheckCircle2 size={18} /><strong>Protection working</strong><small>No duplicate or unpermitted sends</small></span>
        </> : <>
          <span><ShieldAlert size={18} /><strong>Tenant protected</strong><small>No cross-client exception payloads</small></span>
          <span><Clock3 size={18} /><strong>Scoped access</strong><small>Open one authorised client at a time</small></span>
          <span><CheckCircle2 size={18} /><strong>Audited support</strong><small>Every support session is time bounded</small></span>
        </>}
      </section>
      <section className="panel exception-panel">
        <header className="table-toolbar"><div><strong>Open exceptions</strong><small>What failed, who is affected and what the system protected</small></div><label className="select-field"><span className="sr-only">Filter exception category</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All</option><option>Critical</option><option>Compliance</option><option>Security</option><option>Warning</option><option>Delayed</option><option>Dead letter</option></select></label></header>
        <div className="exception-list">
          {shown.map((item) => {
            const business = businesses.find((candidate) => candidate.id === item.businessId)!;
            return (
              <article key={item.id}>
                <header><span><ToneTag tone={item.tone}>{item.category}</ToneTag><small>{item.id} · began {item.startedAt}</small></span><strong>{item.title}</strong><p>{business.name} · {business.locationName}</p></header>
                <dl><div><dt>Affected</dt><dd>{item.affectedLabel}</dd></div><div><dt>System response</dt><dd>{item.protectedAction}</dd></div><div><dt>Client</dt><dd>{item.clientNotified ? "Notified" : "Notification pending"}</dd></div><div><dt>Owner</dt><dd>{item.owner}</dd></div></dl>
                <div className="exception-resolution"><ShieldCheck size={17} /><span><strong>Recommended resolution</strong><small>{item.resolution}</small></span></div>
                <footer>{supportAvailable ? <button className="button button--secondary" type="button" onClick={() => onStartSupport(business)}>Start support session</button> : <small>MFA is required before tenant access can be requested.</small>}</footer>
              </article>
            );
          })}
          {shown.length === 0 && <div className="empty-state"><ShieldCheck size={22} /><h2>{IS_DEMO_MODE ? "No matching exceptions." : "Exception detail requires client scope."}</h2><p>{IS_DEMO_MODE ? "No open issues match this category." : "Use Clients to start an authorised support session for the selected business."}</p>{filter !== "All" && <button className="text-action" type="button" onClick={() => setFilter("All")}>{IS_DEMO_MODE ? "Show all exceptions" : "Clear filter"}</button>}</div>}
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
        <header className="table-toolbar"><div className="search-field"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="audit-search">Search audit history</label><input id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, action or correlation ID" /></div><span><KeyRound size={16} /> Append-only {IS_DEMO_MODE ? "demo " : ""}history</span></header>
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

export function TeamBillingView({
  business,
  canConfigure,
  canManageStripe,
  canViewTeamMembers,
  onSaveSmsPolicy,
  onStartCheckout,
  onOpenBillingPortal,
  stripeCheckoutEnabled,
  stripePortalEnabled,
}: {
  business: BusinessAccount;
  canConfigure: boolean;
  canManageStripe: boolean;
  canViewTeamMembers: boolean;
  onSaveSmsPolicy: (policy: SmsOveragePolicy) => Promise<void>;
  onStartCheckout: () => Promise<void>;
  onOpenBillingPortal: () => Promise<void>;
  stripeCheckoutEnabled: boolean;
  stripePortalEnabled: boolean;
}) {
  const billing = business.billing;
  const [smsPolicy, setSmsPolicy] = useState<SmsOveragePolicy>(billing?.smsOveragePolicy ?? "pause_sms");
  const [savedPolicy, setSavedPolicy] = useState<SmsOveragePolicy>(billing?.smsOveragePolicy ?? "pause_sms");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [billingAction, setBillingAction] = useState<"checkout" | "portal" | null>(null);
  const [billingError, setBillingError] = useState("");

  useEffect(() => {
    const nextPolicy = business.billing?.smsOveragePolicy ?? "pause_sms";
    setSmsPolicy(nextPolicy);
    setSavedPolicy(nextPolicy);
  }, [business.id, business.billing?.smsOveragePolicy]);

  const usedPercent = billing ? Math.round((billing.smsUsed / billing.smsAllowance) * 100) : 0;
  const remaining = billing ? Math.max(0, billing.smsAllowance - billing.smsUsed) : 0;
  const estimatedOverage = billing && billing.smsUsed > billing.smsAllowance
    ? Math.ceil((billing.smsUsed - billing.smsAllowance) / 100) * 10
    : 0;
  const savePolicy = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await onSaveSmsPolicy(smsPolicy);
      setSavedPolicy(smsPolicy);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The SMS usage setting could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const runBillingAction = async (action: "checkout" | "portal") => {
    setBillingAction(action);
    setBillingError("");
    try {
      if (action === "checkout") await onStartCheckout();
      else await onOpenBillingPortal();
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Stripe billing could not be opened.");
      setBillingAction(null);
    }
  };

  return (
    <div className="view-stack">
      <div className="demo-notice"><span className="demo-label">Tenant scoped</span><p>Team and billing data below belongs only to {business.name}. Production membership checks are enforced by the API and database.</p></div>
      <section className="team-billing-grid">
      <article className="panel team-panel"><header className="panel__head"><div><h2>Team members</h2><p>Roles apply only inside this business</p></div></header>{canViewTeamMembers && business.teamMembers.length > 0 ? <div className="team-list">{business.teamMembers.map((member) => <div key={member.name}><span className="client-avatar">{member.initials}</span><span><strong>{member.name}</strong><small>{member.role}</small></span><ToneTag tone="success">Active</ToneTag></div>)}</div> : <div className="empty-state"><UsersRound size={22} /><h3>Member directory unavailable.</h3><p>This role can use the billing workspace but cannot enumerate other account members.</p></div>}<p className="panel-note"><ShieldCheck size={16} /> Team invitations are hidden until the audited invitation endpoint is available.</p></article>
        <article className="panel billing-panel">
          <header className="panel__head"><div><h2>Subscription and SMS</h2><p>Plan allowance, pooled usage and account controls</p></div><ToneTag tone="accent">{business.plan}</ToneTag></header>
          {billing ? <>
            <div className="billing-summary">
              <span><small>Subscription</small><strong>{billing.subscriptionPrice} · {billing.billingCycle}</strong></span>
              <span><small>Setup pricing</small><strong>{billing.setupFee} · {billing.setupFeePaid ? "Paid" : "Not paid"}</strong></span>
              <span><small>Renewal</small><strong>{billing.renewalDate}</strong></span>
              <span><small>Status</small><strong>{billing.subscriptionStatus}</strong></span>
            </div>
            <div className="billing-action-row">
              {billing.stripeSubscriptionReady || billing.subscriptionStatus === "Active" || billing.subscriptionStatus === "Past due"
                ? <button className="button button--secondary" type="button" disabled={!canManageStripe || !stripePortalEnabled || billingAction !== null} onClick={() => void runBillingAction("portal")}>{billingAction === "portal" ? "Opening billing…" : "Manage billing"}</button>
                : <button className="button" type="button" disabled={!canManageStripe || !stripeCheckoutEnabled || billingAction !== null} onClick={() => void runBillingAction("checkout")}>{billingAction === "checkout" ? "Opening secure checkout…" : "Activate with Stripe"}</button>}
              <p>{!canManageStripe
                ? "Stripe actions require a direct owner, administrator or billing-role session; support sessions remain read-only for payment changes."
                : (billing.stripeSubscriptionReady || billing.subscriptionStatus === "Active" || billing.subscriptionStatus === "Past due")
                  ? stripePortalEnabled ? "Stripe hosts billing management. Review Anchor never receives card details." : "The Stripe billing portal is not available for this deployment."
                  : stripeCheckoutEnabled ? "Stripe hosts payment collection. Review Anchor never receives card details." : "Stripe Checkout is not available for this deployment."}</p>
            </div>
            {billingError && <p className="field-error" role="alert">{billingError}</p>}
            <section className="sms-usage" aria-labelledby="sms-usage-title">
              <div className="sms-usage__head"><div><small>Current billing period</small><h3 id="sms-usage-title">SMS segment usage</h3></div><ToneTag tone={usedPercent >= 75 ? "warning" : "success"}>{usedPercent}% used</ToneTag></div>
              <progress max={billing.smsAllowance} value={Math.min(billing.smsUsed, billing.smsAllowance)} aria-label={`${billing.smsUsed} of ${billing.smsAllowance} SMS segments used`} />
              <div className="sms-usage__numbers">
                <span><small>Allowance</small><strong>{billing.smsAllowance}</strong></span>
                <span><small>Used</small><strong>{billing.smsUsed}</strong></span>
                <span><small>Pending outcome</small><strong>{billing.smsPending}</strong></span>
                <span><small>Remaining</small><strong>{remaining}</strong></span>
                <span><small>Estimated overage</small><strong>£{estimatedOverage.toFixed(2)}</strong></span>
              </div>
              <div className="sms-thresholds" aria-label="Usage notification thresholds">
                {[75, 90, 100].map((threshold) => <span key={threshold} className={billing.reachedThresholds.includes(threshold) || usedPercent >= threshold ? "is-reached" : undefined}>{threshold}% alert</span>)}
                <small>Resets {billing.renewalDate}</small>
              </div>
              <div className="sms-location-usage"><h4>Usage by location</h4>{billing.smsUsageByLocation.map((location) => <div key={location.locationName}><span>{location.locationName}</span><strong>{location.used} used{location.pending ? ` · ${location.pending} pending` : ""}</strong></div>)}</div>
            </section>
            <fieldset className="sms-policy" disabled={!canConfigure}>
              <legend>When the allowance runs out</legend>
              <label><input type="radio" name={`sms-policy-${business.id}`} value="auto_top_up" checked={smsPolicy === "auto_top_up"} onChange={() => setSmsPolicy("auto_top_up")} /><span><strong>Buy the next bundle</strong><small>Add 100 pooled SMS segments for £10.</small></span></label>
              <label><input type="radio" name={`sms-policy-${business.id}`} value="pause_sms" checked={smsPolicy === "pause_sms"} onChange={() => setSmsPolicy("pause_sms")} /><span><strong>Pause SMS</strong><small>Email requests continue until the allowance resets.</small></span></label>
            </fieldset>
            {smsPolicy === "auto_top_up" && billing.subscriptionStatus !== "Active" && <p className="panel-note"><ShieldAlert size={16} /> Auto top-up is saved, but SMS will remain held at the allowance until Stripe billing is activated.</p>}
            <button className="button button--secondary" type="button" disabled={!canConfigure || saving || smsPolicy === savedPolicy} onClick={() => void savePolicy()}>{saving ? "Saving…" : smsPolicy === savedPolicy ? "Usage setting saved" : "Save usage setting"}</button>
            {saveError && <p className="field-error" role="alert">{saveError}</p>}
          </> : <div className="billing-unavailable"><ShieldAlert size={20} /><div><strong>Production billing is disabled</strong><p>Activate Stripe, segment metering and the pilot launch gates before showing live subscription or usage data.</p></div></div>}
        </article>
      </section>
    </div>
  );
}
