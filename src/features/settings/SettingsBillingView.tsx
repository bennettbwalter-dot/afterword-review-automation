import type { ReactNode } from "react";
import type { SettingsBillingTab } from "../../routing";

export function SettingsBillingView({ tab, onTabChange, children, canAccessConnections = true }: { tab: SettingsBillingTab; onTabChange: (tab: SettingsBillingTab) => void; children: ReactNode; canAccessConnections?: boolean }) {
  return <div className="product-feature"><nav className="product-tabs" aria-label="Settings and billing sections">{canAccessConnections && <button type="button" className={tab === "connections" ? "is-active" : undefined} aria-current={tab === "connections" ? "page" : undefined} onClick={() => onTabChange("connections")}>Connections</button>}<button type="button" className={tab === "billing" ? "is-active" : undefined} aria-current={tab === "billing" ? "page" : undefined} onClick={() => onTabChange("billing")}>Billing</button></nav>{children}</div>;
}
