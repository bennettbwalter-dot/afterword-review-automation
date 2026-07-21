import type { ReactNode } from "react";
import { AgencyGrantDialog } from "./AgencyGrantDialog";
import { ActiveAgencyGrantControls } from "./ActiveAgencyGrantControls";

export function AgencyView({ children, agencyId }: { children: ReactNode; agencyId?: string }) {
  return <div className="product-feature product-feature--agency">{children}{agencyId && <><ActiveAgencyGrantControls agencyId={agencyId} /><AgencyGrantDialog agencyId={agencyId} /></>}</div>;
}
