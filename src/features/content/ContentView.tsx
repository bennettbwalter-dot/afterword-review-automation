import type { ReactNode } from "react";
import type { ContentTab } from "../../routing";

const tabs: Array<{ id: ContentTab; label: string }> = [
  { id: "create", label: "Create" }, { id: "uploads", label: "Uploads" }, { id: "approvals", label: "Approvals" }, { id: "scheduled", label: "Scheduled" }, { id: "published", label: "Published" }, { id: "failed", label: "Failed" },
];

export function ContentView({ tab, onTabChange, children }: { tab: ContentTab; onTabChange: (tab: ContentTab) => void; children?: ReactNode }) {
  return <div className="product-feature"><nav className="product-tabs" aria-label="Content sections">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "is-active" : undefined} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTabChange(item.id)}>{item.label}</button>)}</nav>{children ?? <section className="panel empty-state"><h2>Content publishing is not enabled for this workspace.</h2><p>There are no draft, upload, or publishing controls available until a connected publishing workflow is authorised.</p></section>}</div>;
}
