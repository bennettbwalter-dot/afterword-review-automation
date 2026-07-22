import type { GoogleProfileSnapshot } from "../../platform/api";

export type GoogleProfileContentContext = { businessId: string; locationId: string };

export function openContentForGoogleProfileSnapshot(snapshot: GoogleProfileSnapshot, onOpenContent: (context: GoogleProfileContentContext) => void) {
  onOpenContent({ businessId: snapshot.businessId, locationId: snapshot.locationId });
}

export function PostsMediaTab({ snapshot, onOpenContent }: { snapshot: GoogleProfileSnapshot; onOpenContent: (context: GoogleProfileContentContext) => void }) {
  return <section className="panel empty-state"><h2>Create posts and media in Content.</h2><p>Publishing stays unavailable until the destination is authorised and proven. Draft, review and keep this location’s content together in one place.</p><button type="button" className="button button--primary" onClick={() => openContentForGoogleProfileSnapshot(snapshot, onOpenContent)}>Open Content</button></section>;
}
