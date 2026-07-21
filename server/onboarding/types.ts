export type SignupAccountType = "business" | "agency";

export interface SignupIntentInput {
  email: string;
  displayName: string;
  accountType: SignupAccountType;
  tokenHash: Buffer;
  expiresAt: Date;
}

export interface VerifiedSignup {
  verifiedSignupId: string;
  email: string;
  displayName: string;
  accountType: SignupAccountType;
}

export interface RegistrationInput extends VerifiedSignup {
  passwordHash: string;
  agencyName?: string;
  businessName?: string;
  locationName?: string;
  country?: "GB" | "US";
  timezone?: string;
  directContainer: boolean;
  sessionTokenHash: Buffer;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  ipHash?: Buffer;
  userAgentFamily?: string;
}

export interface RegistrationResult {
  userId: string;
  sessionId: string;
  agencyId: string;
  businessId?: string;
  locationId?: string;
  onboardingStep: "business" | "location" | "google_connection" | "agency_setup";
}
