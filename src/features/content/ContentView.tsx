import type { ReactNode } from "react";
import type { ContentTab } from "../../routing";
import {
  CONTENT_READINESS_CAPABILITIES,
  CONTENT_SOURCE_GUIDANCE,
  CONTENT_STAGE_STATES,
} from "./content-readiness";

const tabs: Array<{ id: ContentTab; label: string }> = [
  { id: "create", label: "Create" }, { id: "uploads", label: "Uploads" }, { id: "approvals", label: "Approvals" }, { id: "scheduled", label: "Scheduled" }, { id: "published", label: "Published" }, { id: "failed", label: "Failed" },
];

function CreateReadiness() {
  return <div className="content-readiness">
    <section className="panel content-readiness-intro">
      <div>
        <p className="content-readiness-eyebrow">Manual-first workflow</p>
        <h2>Prepare approved business content</h2>
        <p className="content-readiness-copy">Start with original business sources. Manual image and video remain independent from paid video generation, and every destination needs its own release evidence.</p>
      </div>
      <div className="content-source-grid">
        {CONTENT_SOURCE_GUIDANCE.map((source) => <article key={source.id}>
          <h3>{source.label}</h3>
          <p>{source.description}</p>
        </article>)}
      </div>
    </section>
    <section className="panel content-readiness-capabilities">
      <div className="content-capability-header">
        <div>
          <p className="content-readiness-eyebrow">Release gates</p>
          <h2>Capability readiness</h2>
        </div>
        <p className="content-readiness-copy">Availability is assessed separately for manual media, each destination, and paid video generation.</p>
      </div>
      <div className="content-capability-grid">
        {CONTENT_READINESS_CAPABILITIES.map((capability) => <article key={capability.id} aria-label={`${capability.label}: unavailable`}>
          <div>
            <h3>{capability.label}</h3>
            <p>{capability.reason}</p>
          </div>
          <span className="content-unavailable">Unavailable</span>
        </article>)}
      </div>
    </section>
  </div>;
}

function QueueZeroState({ tab }: { tab: Exclude<ContentTab, "create"> }) {
  const state = CONTENT_STAGE_STATES[tab];
  const label = tabs.find((item) => item.id === tab)?.label;

  return <section className="panel empty-state content-stage-state">
    <p className="content-readiness-eyebrow">{label}</p>
    <h2>{state.title}</h2>
    <p>{state.description}</p>
  </section>;
}

export function ContentView({ tab, onTabChange, children }: { tab: ContentTab; onTabChange: (tab: ContentTab) => void; children?: ReactNode }) {
  return <div className="product-feature"><nav className="product-tabs" aria-label="Content sections">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "is-active" : undefined} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTabChange(item.id)}>{item.label}</button>)}</nav>{children ?? (tab === "create" ? <CreateReadiness /> : <QueueZeroState tab={tab} />)}</div>;
}
