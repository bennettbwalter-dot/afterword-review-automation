export type OnboardingAccountType = "business" | "agency";
export const onboardingSteps = { business: ["Account", "Business", "Location", "Google"], agency: ["Account", "Agency", "Billing"] } as const;
export function onboardingResumePath(accountType: OnboardingAccountType, step: string) { return accountType === "business" && step === "google_connection" ? "/signup/business/google" : accountType === "agency" ? "/signup/agency" : "/signup/business"; }
