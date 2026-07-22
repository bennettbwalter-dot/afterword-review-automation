import type { Pool } from "pg";
import type { RegistrationInput, RegistrationResult, SignupIntentInput, VerifiedSignup } from "./types.js";

export class OnboardingPostgres {
  constructor(private readonly authPool: Pool) {}
  async createSignupIntent(input: SignupIntentInput) {
    const result = await this.authPool.query("select * from app_private.create_signup_intent($1,$2,$3,$4,$5)", [input.email, input.displayName, input.accountType, input.tokenHash, input.expiresAt]);
    return { accepted: Boolean(result.rows[0]?.accepted), shouldSendEmail: Boolean(result.rows[0]?.should_send_email) };
  }
  async consumeSignupIntent(tokenHash: Buffer): Promise<VerifiedSignup | null> {
    const result = await this.authPool.query("select * from app_private.consume_signup_intent($1)", [tokenHash]);
    const row = result.rows[0];
    return row ? { verifiedSignupId: row.verified_signup_id, email: row.email, displayName: row.display_name, accountType: row.account_type } : null;
  }
  async registerVerifiedSignup(input: RegistrationInput): Promise<RegistrationResult> {
    const result = await this.authPool.query("select * from app_private.register_verified_signup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [input.verifiedSignupId, input.passwordHash, input.agencyName ?? null, input.businessName ?? null, input.locationName ?? null, input.country ?? null, input.timezone ?? null, input.directContainer, input.sessionTokenHash, input.idleExpiresAt, input.absoluteExpiresAt, input.ipHash ?? null, input.userAgentFamily ?? null]);
    const row = result.rows[0];
    if (!row) throw new Error("Verified signup registration was not created.");
    return { userId: row.user_id, sessionId: row.session_id, agencyId: row.agency_id, businessId: row.business_id ?? undefined, locationId: row.location_id ?? undefined, onboardingStep: row.onboarding_step };
  }
}
