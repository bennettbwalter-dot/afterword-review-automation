import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, MapPin, Send, Webhook } from "lucide-react";
import type { ServiceStatus } from "../../platform/api";
import type { BusinessAccount } from "../../platform/domain";
import { PUBLICATION_CAPABILITIES } from "./connection-readiness";

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  onClick?: () => void;
  disabled?: boolean;
};
type StatusPillProps = { tone?: string; children: ReactNode };

export interface ConnectionsViewProps {
  business: BusinessAccount;
  onConnect: () => void;
  canConfigure: boolean;
  services: ServiceStatus[];
  servicesLoading: boolean;
  demoMode: boolean;
  ButtonComponent: ComponentType<ButtonProps>;
  StatusPillComponent: ComponentType<StatusPillProps>;
  DemoNoticeComponent: ComponentType;
}

export function ConnectionsView({
  business,
  onConnect,
  canConfigure,
  services,
  servicesLoading,
  demoMode,
  ButtonComponent,
  StatusPillComponent,
  DemoNoticeComponent,
}: ConnectionsViewProps) {
  const integrations = [
    { key: "google", name: "Google Business Profile", detail: "Review sync and direct review destination", state: business.integrations.google, icon: MapPin },
    { key: "messaging", name: "Messaging provider", detail: "SMS and email delivery events", state: business.integrations.messaging, icon: Send },
    { key: "jobIntake", name: "Completed-job intake", detail: "Receives genuine customer job completions", state: business.integrations.jobIntake, icon: Webhook },
  ];
  const attentionCount = integrations.filter((integration) => integration.state.tone !== "success").length;
  const googleService = services.find((service) => service.key === "google");
  const googleAvailable = googleService?.configured ?? false;

  return (
    <div className="view-stack">
      <DemoNoticeComponent />
      <section className="integration-grid">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const isGoogle = integration.key === "google";
          const blocked = isGoogle && !demoMode && (servicesLoading || !googleAvailable);
          return (
            <article className="integration-card" key={integration.name}>
              <span className="integration-card__icon"><Icon size={22} /></span>
              <div><h2>{integration.name}</h2><p>{integration.detail}</p></div>
              <StatusPillComponent tone={blocked ? "warning" : integration.state.tone}>{blocked ? "Not configured" : integration.state.status}</StatusPillComponent>
              {isGoogle && demoMode ? (
                <small className="integration-card__status-note">Connection setup requires an authenticated deployment and is unavailable in the seeded demo.</small>
              ) : isGoogle ? (
                <ButtonComponent variant="secondary" disabled={!canConfigure || blocked} onClick={!blocked ? onConnect : undefined}>
                  {servicesLoading && !demoMode ? "Checking availability…" : blocked ? "Unavailable" : "Review setup"}
                </ButtonComponent>
              ) : <small className="integration-card__status-note">Status is read from the shared workspace backend.</small>}
            </article>
          );
        })}
      </section>
      <section className="panel" aria-labelledby="publication-readiness-title">
        <header className="panel__head">
          <div>
            <h2 id="publication-readiness-title">Publication readiness</h2>
            <p>Operational connection health does not approve a publishing destination.</p>
          </div>
        </header>
        <div className="integration-grid">
          {PUBLICATION_CAPABILITIES.map((capability) => (
            <article className="integration-card" key={capability.id}>
              <div><h3>{capability.label}</h3><p>{capability.prerequisites}</p></div>
              <span className="status-pill status-pill--warning">Unavailable</span>
            </article>
          ))}
        </div>
      </section>
      {!demoMode && services.length > 0 && (
        <section className="panel integration-log">
          <header className="panel__head">
            <div><h2>Service availability</h2><p>What this deployment can currently do</p></div>
            <StatusPillComponent tone={services.every((service) => service.configured) ? "success" : "warning"}>
              {services.filter((service) => service.configured).length}/{services.length} configured
            </StatusPillComponent>
          </header>
          {services.map((service) => (
            <div key={service.key}>
              <span>
                {service.configured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {service.label}
              </span>
              <small>
                {service.detail}
                {!service.configured && service.requires.length > 0 && ` Needs: ${service.requires.join(", ")}.`}
              </small>
            </div>
          ))}
        </section>
      )}
      <section className="panel integration-log">
        <header className="panel__head"><div><h2>Integration event log</h2><p>{demoMode ? "Latest sample events" : "Latest provider state"} · {business.name}</p></div><StatusPillComponent tone={attentionCount ? "warning" : "success"}>{attentionCount ? `${attentionCount} need attention` : "No failures"}</StatusPillComponent></header>
        {integrations.map((integration) => <div key={integration.key}><span>{integration.state.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {integration.name}</span><small>{integration.state.lastEvent}</small></div>)}
      </section>
    </div>
  );
}
