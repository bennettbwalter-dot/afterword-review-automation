import type { ReactNode } from "react";
import type { GoogleProfileTab } from "../../routing";

const tabs: Array<{ id: GoogleProfileTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "reviews", label: "Reviews" },
  { id: "requests-qr", label: "Requests & QR" },
  { id: "posts-media", label: "Posts & media" },
];

export function GoogleProfileView({ tab, onTabChange, children }: { tab: GoogleProfileTab; onTabChange: (tab: GoogleProfileTab) => void; children: ReactNode }) {
  return <div className="product-feature"><nav className="product-tabs" aria-label="Google Profile sections">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "is-active" : undefined} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTabChange(item.id)}>{item.label}</button>)}</nav>{children}</div>;
}
