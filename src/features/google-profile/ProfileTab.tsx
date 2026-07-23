import { AlertTriangle, CheckCircle2, MapPin, Send, Webhook } from "lucide-react";
import { type ReactNode } from "react";
import { IS_DEMO_MODE, type GoogleProfileSnapshot, type ServiceStatus } from "../../platform/api";
import type { BusinessAccount } from "../../platform/domain";
import { googleProfileWriteCapabilityLedger } from "./google-profile-domain";

function StatusPill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function Button({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className="button button--secondary" onClick={onClick} disabled={disabled}>{children}</button>;
}

function DemoNotice() {
  if (!IS_DEMO_MODE) return null;
  return <div className="demo-notice"><span className="demo-label">Sample data</span><p>This workspace is interactive but simulated. No Google account is connected and no message will be sent.</p></div>;
}

export function ProfileTab({ business, snapshot, onConnect, canConfigure, services, servicesLoading, servicesError = "", onRetryServices = () => undefined }: { business: BusinessAccount; snapshot: GoogleProfileSnapshot; onConnect: () => void; canConfigure: boolean; services: ServiceStatus[]; servicesLoading: boolean; servicesError?: string; onRetryServices?: () => void }) {
  const integrations = [
    { key: "google", name: "Google Business Profile", detail: "Review sync and direct review destination", state: business.integrations.google, icon: MapPin },
    { key: "messaging", name: "Messaging provider", detail: "SMS and email delivery events", state: business.integrations.messaging, icon: Send },
    { key: "jobIntake", name: "Completed-job intake", detail: "Receives genuine customer job completions", state: business.integrations.jobIntake, icon: Webhook },
  ];
  const attentionCount = integrations.filter((integration) => integration.state.tone !== "success").length;
  const googleAvailable = services.find((service) => service.key === "google")?.configured ?? false;
  const statusUnavailable = !IS_DEMO_MODE && Boolean(servicesError);

  return <>
    <section className="google-capability-ledger" aria-label="Google write capabilities"><header><span>Write capabilities</span><small>Each action is enabled only after its own approval and controlled pilot.</small></header><div>{googleProfileWriteCapabilityLedger(snapshot).map((capability) => <article key={capability.key}><div><strong>{capability.label}</strong><small>{capability.reason}</small></div><span>{capability.status}</span></article>)}</div></section>
    <div className="view-stack">
      <DemoNotice />
    <section className="integration-grid">
      {integrations.map((integration) => {
        const Icon = integration.icon;
        const isGoogle = integration.key === "google";
        const blocked = isGoogle && !IS_DEMO_MODE && (servicesLoading || statusUnavailable || !googleAvailable);
        const statusLabel = isGoogle && servicesLoading
          ? "Checking status"
          : statusUnavailable && isGoogle
            ? "Status unavailable"
            : blocked
              ? "Not configured"
              : integration.state.status;
        return <article className="integration-card" key={integration.name}>
          <span className="integration-card__icon"><Icon size={22} /></span>
          <div><h2>{integration.name}</h2><p>{integration.detail}</p></div>
          <StatusPill tone={blocked ? "warning" : integration.state.tone}>{statusLabel}</StatusPill>
          {isGoogle && IS_DEMO_MODE ? <small className="integration-card__status-note">Connection setup requires an authenticated deployment and is unavailable in the seeded demo.</small>
            : isGoogle && statusUnavailable ? <Button onClick={onRetryServices}>Retry status</Button>
            : isGoogle ? <Button disabled={!canConfigure || blocked} onClick={!blocked ? onConnect : undefined}>{servicesLoading ? "Checking availability…" : blocked ? "Unavailable" : "Review setup"}</Button>
              : <small className="integration-card__status-note">Status is read from the shared workspace backend.</small>}
        </article>;
      })}
    </section>
    {!IS_DEMO_MODE && services.length > 0 && <section className="panel integration-log">
      <header className="panel__head"><div><h2>Service availability</h2><p>What this deployment can currently do</p></div><StatusPill tone={services.every((service) => service.configured) ? "success" : "warning"}>{services.filter((service) => service.configured).length}/{services.length} configured</StatusPill></header>
      {services.map((service) => <div key={service.key}><span>{service.configured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {service.label}</span><small>{service.detail}{!service.configured && service.requires.length > 0 && ` Needs: ${service.requires.join(", ")}.`}</small></div>)}
    </section>}
      <section className="panel integration-log"><header className="panel__head"><div><h2>Integration event log</h2><p>{IS_DEMO_MODE ? "Latest sample events" : "Latest provider state"} · {business.name}</p></div><StatusPill tone={attentionCount ? "warning" : "success"}>{attentionCount ? `${attentionCount} need attention` : "No failures"}</StatusPill></header>{integrations.map((integration) => <div key={integration.key}><span>{integration.state.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {integration.name}</span><small>{integration.state.lastEvent}</small></div>)}</section>
    </div>
  </>;
}
