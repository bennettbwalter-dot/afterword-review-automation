import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Clock3,
  ListFilter,
  Mail,
  MessageSquareText,
  Plus,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { IS_DEMO_MODE, type GoogleProfileSnapshot } from "../../platform/api";
import type { BusinessAccount, LocationWorkflowSummary, QrCodeRecord, RequestRecord, RequestStatus } from "../../platform/domain";
import { requestDataForGoogleProfileSnapshot } from "./google-profile-domain";

const STATUS_TONES: Record<RequestStatus, string> = {
  Queued: "warning",
  Delivered: "neutral",
  Clicked: "accent",
  Reviewed: "success",
  "Opted out": "muted",
  Blocked: "warning",
};

const BLOCKED_GOOGLE_CONNECTION_HEALTH = new Set(["authentication_required", "permission_revoked", "disabled"]);

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function StatusPill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function Button({ children, onClick, variant = "primary", disabled }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary"; disabled?: boolean }) {
  return <button type="button" className={`button button--${variant}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function DemoNotice() {
  if (!IS_DEMO_MODE) return null;
  return <div className="demo-notice"><span className="demo-label">Sample data</span><p>This workspace is interactive but simulated. No Google account is connected and no message will be sent.</p></div>;
}

function RequestsList({ requests, onAddJob, canConfigure }: { requests: RequestRecord[]; onAddJob: () => void; canConfigure: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | RequestStatus>("All");
  const filtered = useMemo(
    () => requests.filter((request) => (status === "All" || request.status === status) && `${request.customer} ${request.job}`.toLowerCase().includes(query.toLowerCase())),
    [query, requests, status],
  );

  return (
    <div className="view-stack">
      <DemoNotice />
      <section className="panel request-table-panel">
        <header className="table-toolbar">
          <div className="search-field"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="request-search">Search requests</label><input id="request-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer or job" /></div>
          <label className="select-field"><ListFilter size={16} aria-hidden="true" /><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value as "All" | RequestStatus)}><option>All</option><option>Queued</option><option>Delivered</option><option>Clicked</option><option>Reviewed</option><option>Opted out</option><option>Blocked</option></select><ChevronDown size={15} aria-hidden="true" /></label>
          {canConfigure && <Button onClick={onAddJob}><Plus size={16} /> Add completed job</Button>}
        </header>
        {requests.length === 0 ? (
          <div className="empty-state"><ClipboardCheck size={24} /><h2>No completed jobs yet.</h2><p>{canConfigure ? "Add a genuine completed job with consent evidence to start its review-request workflow." : "Your role can view request history but cannot add completed jobs."}</p>{canConfigure && <Button onClick={onAddJob}><Plus size={16} /> Add completed job</Button>}</div>
        ) : filtered.length > 0 ? (
          <>
            <div className="request-table" role="table" aria-label="Review requests">
              <div className="request-table__head" role="row"><span role="columnheader">Customer</span><span role="columnheader">Job</span><span role="columnheader">Channel</span><span role="columnheader">Created</span><span role="columnheader">Status</span></div>
              {filtered.map((request) => (
                <div className="request-table__row" role="row" key={request.id}>
                  <span role="cell"><strong>{request.customer}</strong><small>{request.id} · {request.destination} · consent {request.consentStatus.toLowerCase()}</small></span>
                  <span role="cell">{request.job}</span>
                  <span role="cell">{request.channel === "SMS" ? <Smartphone size={15} /> : <Mail size={15} />}{request.channel}</span>
                  <span role="cell">{request.createdAt}</span>
                  <span role="cell"><StatusPill tone={STATUS_TONES[request.status]}>{request.status}</StatusPill></span>
                </div>
              ))}
            </div>
            <div className="request-cards">
              {filtered.map((request) => (
                <article key={request.id}>
                  <div><strong>{request.customer}</strong><StatusPill tone={STATUS_TONES[request.status]}>{request.status}</StatusPill></div>
                  <p>{request.job}</p><small>{request.channel} · {request.destination} · consent {request.consentStatus.toLowerCase()} · {request.createdAt}</small>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state"><Search size={24} /><h2>No matching requests.</h2><p>Change the search or status filter to see more completed jobs.</p><Button variant="secondary" onClick={() => { setQuery(""); setStatus("All"); }}>Clear filters</Button></div>
        )}
      </section>
    </div>
  );
}

function workflowGapLabel(seconds: number) {
  if (seconds <= 0) return "No extra delay";
  if (seconds % 86_400 === 0) return `${seconds / 86_400} ${seconds === 86_400 ? "day" : "days"}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} ${seconds === 3_600 ? "hour" : "hours"}`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

function AutomationStatus({
  business,
  requests,
  workflow,
  onOpenIntegrations,
}: {
  business: BusinessAccount;
  requests: RequestRecord[];
  workflow?: LocationWorkflowSummary;
  onOpenIntegrations: () => void;
}) {
  const channels = useMemo(() => workflow?.channels ?? [], [workflow?.channels]);
  const defaultChannel = channels.find((candidate) => candidate.enabled)?.channel ?? channels[0]?.channel ?? "sms";
  const [selectedChannel, setSelectedChannel] = useState<"sms" | "email">(defaultChannel);
  useEffect(() => {
    if (!channels.some((candidate) => candidate.channel === selectedChannel)) setSelectedChannel(defaultChannel);
  }, [channels, defaultChannel, selectedChannel]);
  const channel = channels.find((candidate) => candidate.channel === selectedChannel)
    ?? channels.find((candidate) => candidate.enabled)
    ?? channels[0];
  const touchCount = Math.min(Math.max(channel?.maxMessages ?? 1, 1), 3);
  const gap = workflowGapLabel(channel?.minimumGapSeconds ?? 0);
  const nodes = useMemo(() => {
    const result: Array<{ id: string; label: string; description: string; icon: LucideIcon; message: boolean }> = [
      { id: "trigger", label: "Job completed", description: "Authenticated completed-job record", icon: Webhook, message: false },
      { id: "request", label: "Send review request", description: `${channel?.channel.toUpperCase() ?? "Message"} · approved template`, icon: MessageSquareText, message: true },
    ];
    for (let touch = 2; touch <= touchCount; touch += 1) {
      result.push({ id: `wait-${touch}`, label: `Wait ${gap}`, description: "Cancel on reply, review or opt-out", icon: Clock3, message: false });
      result.push({ id: `followup-${touch}`, label: `Polite follow-up ${touch - 1}`, description: `${channel?.channel.toUpperCase() ?? "Message"} · touch ${touch} of ${touchCount}`, icon: Send, message: true });
    }
    result.push({ id: "end", label: "End sequence", description: `Maximum ${touchCount} ${touchCount === 1 ? "message" : "messages"}`, icon: CheckCircle2, message: false });
    return result;
  }, [channel?.channel, gap, touchCount]);
  const [selected, setSelected] = useState("request");
  const selectedNode = nodes.find((node) => node.id === selected) ?? nodes[1] ?? nodes[0];
  const SelectedIcon = selectedNode.icon;
  const previewName = requests[0]?.customer.split(" ")[0] ?? "Customer";
  const template = channel?.template;
  const runtimeUrl = workflow?.reviewDestination?.runtimeUrl;
  const connectionHealth = workflow?.reviewDestination?.connectionHealth;
  const destinationReady = Boolean(
    runtimeUrl
    && connectionHealth
    && !BLOCKED_GOOGLE_CONNECTION_HEALTH.has(connectionHealth),
  );
  const configured = Boolean(
    channel?.enabled
    && template
    && template.includesBusinessIdentity
    && template.includesUnsubscribe
    && destinationReady,
  );
  const preview = template?.body
    .replaceAll("{{first_name}}", previewName)
    .replaceAll("{{business_name}}", business.name)
    .replaceAll("{{review_link}}", destinationReady && runtimeUrl ? runtimeUrl : "[review destination unavailable]");

  if (!workflow || !channel) {
    return <div className="view-stack"><DemoNotice /><section className="panel empty-state"><Clock3 size={24} /><h2>No messaging policy for this location.</h2><p>The shared backend has not returned an SMS or email workflow for {business.locationName}. Connect the required services before sending review requests.</p><Button onClick={onOpenIntegrations}>Open integrations</Button></section></div>;
  }

  return (
    <div className="automation-layout">
      <section className="automation-canvas panel">
        <header className="automation-canvas__head">
          <div><h2>Google review request policy</h2><p>{business.locationName} · rule {channel.ruleVersion} · {channel.timezone}</p></div>
          <div className="automation-canvas__controls">
            {channels.length > 1 && <label className="select-field"><span className="sr-only">Messaging channel</span><select value={channel.channel} onChange={(event) => setSelectedChannel(event.target.value as "sms" | "email")}>{channels.map((candidate) => <option key={candidate.channel} value={candidate.channel}>{candidate.channel.toUpperCase()} · {candidate.enabled ? "enabled" : "disabled"}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></label>}
            <StatusPill tone={configured ? "success" : channel.enabled ? "warning" : "muted"}>{configured ? "Configured" : channel.enabled ? "Incomplete" : "Disabled"}</StatusPill>
          </div>
        </header>
        <div className="automation-access-note"><ShieldCheck size={16} /><span>{IS_DEMO_MODE ? "This is a seeded demo policy." : "This read-only view comes from the selected location’s messaging policy, approved template and Google destination."} Changes remain protected by backend permissions.</span></div>
        <div className="automation-guardrail">
          <ShieldCheck size={17} />
          <span><strong>Review gating blocked</strong> · {channel.sendWindowStart}–{channel.sendWindowEnd} sending window · maximum {touchCount} {touchCount === 1 ? "message" : "messages"}</span>
        </div>
        <div className="automation-flow">
          {nodes.map((node, index) => {
            const Icon = node.icon;
            return (
              <div className="automation-flow__item" key={node.id}>
                <button type="button" className={cx("automation-node", selectedNode.id === node.id && "is-selected")} onClick={() => setSelected(node.id)}>
                  <span><Icon size={18} /></span>
                  <span><strong>{node.label}</strong><small>{node.description}</small></span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                {index < nodes.length - 1 && <span className="automation-connector" aria-hidden="true"><Circle size={7} /></span>}
              </div>
            );
          })}
        </div>
      </section>
      <aside className="automation-editor panel">
        <header className="automation-editor__head"><span><SelectedIcon size={18} /></span><div><small>Workflow step</small><h2>{selectedNode.label}</h2></div></header>
        {selectedNode.message ? template ? (
          <>
            <div className={cx("template-validation", (!template.includesBusinessIdentity || !template.includesUnsubscribe || !destinationReady) && "template-validation--warning")} role="status"><ShieldCheck size={17} /><span><strong>{template.includesBusinessIdentity && template.includesUnsubscribe && destinationReady ? "Required template evidence present" : "Workflow configuration incomplete"}</strong><small>Business identity: {template.includesBusinessIdentity ? "present" : "missing"} · opt-out: {template.includesUnsubscribe ? "present" : "missing"} · Google destination: {destinationReady ? "ready" : "unavailable"}{connectionHealth ? ` (${connectionHealth.replaceAll("_", " ")})` : ""}.</small></span></div>
            {workflow.reviewDestination?.qrUrl && !workflow.reviewDestination.matchesRuntime && <div className="workspace-inline-error" role="alert"><AlertTriangle size={17} /><span>The runtime Google destination and QR destination do not match. Sending remains a backend-controlled operation.</span></div>}
            <figure className="message-preview"><figcaption>Approved template v{template.version}</figcaption><div><p>{preview}</p><span>{channel.channel.toUpperCase()} preview · approved {template.approvedAt}</span></div></figure>
          </>
        ) : <div className="empty-state"><AlertTriangle size={22} /><h3>No approved template.</h3><p>This policy cannot send until an active template version is available.</p><Button onClick={onOpenIntegrations}>Check integrations</Button></div> : (
          <div className="editor-summary"><SelectedIcon size={22} /><h3>{selectedNode.label}</h3><p>{selectedNode.description}. This backend policy step has no customer-facing copy.</p></div>
        )}
      </aside>
    </div>
  );
}

export type GoogleProfileQrRenderer = ComponentType<{ business: BusinessAccount; record: QrCodeRecord }>;

export function RequestsQrTab({ business, snapshot, onAddJob, canConfigure, onOpenIntegrations, QrRenderer }: { business: BusinessAccount; snapshot: GoogleProfileSnapshot; onAddJob: () => void; canConfigure: boolean; onOpenIntegrations: () => void; QrRenderer: GoogleProfileQrRenderer }) {
  const { requests, workflow, qr } = requestDataForGoogleProfileSnapshot(snapshot);
  return <><RequestsList requests={requests} onAddJob={onAddJob} canConfigure={canConfigure} /><AutomationStatus business={business} requests={requests} workflow={workflow ?? undefined} onOpenIntegrations={onOpenIntegrations} />{qr ? <QrRenderer business={business} record={qr} /> : <section className="panel empty-state"><QrCode size={24} /><h2>No QR code for this location.</h2><p>Connect a verified Google review destination before generating location-specific artwork.</p><Button onClick={onOpenIntegrations}>Open connections</Button></section>}</>;
}
