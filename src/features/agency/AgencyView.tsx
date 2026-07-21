import type { ReactNode } from "react";
import { AgencyGrantDialog } from "./AgencyGrantDialog";

export function AgencyView({ children, agencyId }: { children: ReactNode; agencyId?: string }) {
  return <div className="product-feature product-feature--agency">{children}{agencyId && <AgencyGrantDialog agencyId={agencyId} />}</div>;
}
