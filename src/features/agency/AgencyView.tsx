import type { ReactNode } from "react";

export function AgencyView({ children }: { children: ReactNode }) {
  return <div className="product-feature product-feature--agency">{children}</div>;
}
