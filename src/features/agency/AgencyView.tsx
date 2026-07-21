import type { ReactNode } from "react";
import { AgencyGrantDialog } from "./AgencyGrantDialog";
import { ActiveAgencyGrantControls } from "./ActiveAgencyGrantControls";

export function AgencyView({ children, agencyId, canRevoke = false }: { children: ReactNode; agencyId?: string; canRevoke?: boolean }) {
  return <div className="product-feature product-feature--agency">{children}{agencyId && <><ActiveAgencyGrantControls agencyId={agencyId} canRevoke={canRevoke} /><AgencyGrantDialog agencyId={agencyId} /></>}</div>;
}
