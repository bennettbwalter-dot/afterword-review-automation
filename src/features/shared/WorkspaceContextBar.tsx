import { MapPin } from "lucide-react";
import type { BusinessAccount } from "../../platform/domain";

export function WorkspaceContextBar({ business, locationId, onSelectLocation }: {
  business: BusinessAccount;
  locationId?: string;
  onSelectLocation: (locationId: string) => void;
}) {
  const locations = business.locationReports?.length ? business.locationReports : [{ id: business.locationId ?? business.id, name: business.locationName }];
  return (
    <section className="workspace-context-bar" aria-label="Business and location context">
      <span><MapPin size={16} aria-hidden="true" /><strong>{business.name}</strong></span>
      <label>Location<select value={locationId} onChange={(event) => onSelectLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
    </section>
  );
}
