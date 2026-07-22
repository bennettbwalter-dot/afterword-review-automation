export type PublicationCapabilityId =
  | "google-posts-media"
  | "facebook-page"
  | "instagram-professional"
  | "linkedin-organisation"
  | "youtube-channel";

export interface PublicationCapability {
  readonly id: PublicationCapabilityId;
  readonly label: string;
  readonly status: "unavailable";
  readonly prerequisites: string;
}

export const PUBLICATION_CAPABILITIES = [
  {
    id: "google-posts-media",
    label: "Google posts and media",
    status: "unavailable",
    prerequisites: "Requires approved write scopes, exact location capability, destination reconciliation, and a controlled pilot.",
  },
  {
    id: "facebook-page",
    label: "Facebook Page",
    status: "unavailable",
    prerequisites: "Requires Meta app approval, required Page scopes, exact Page enumeration, reconciliation, and a controlled pilot.",
  },
  {
    id: "instagram-professional",
    label: "Instagram professional account",
    status: "unavailable",
    prerequisites: "Requires Meta app approval, professional-account linkage and enumeration, required scopes, reconciliation, and a controlled pilot.",
  },
  {
    id: "linkedin-organisation",
    label: "LinkedIn organisation",
    status: "unavailable",
    prerequisites: "Requires LinkedIn app approval, an authorised organisation or Page role, organisation enumeration, reconciliation, and a controlled pilot.",
  },
  {
    id: "youtube-channel",
    label: "YouTube channel",
    status: "unavailable",
    prerequisites: "Requires an approved API project, required scopes, exact channel enumeration, upload reconciliation, and a controlled pilot.",
  },
] as const satisfies readonly PublicationCapability[];
