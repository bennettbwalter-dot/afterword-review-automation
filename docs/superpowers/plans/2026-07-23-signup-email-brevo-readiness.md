# Signup Email and Brevo Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an honest, recoverable signup-verification workflow behind a provider-neutral transactional-email interface, with Brevo as the first disabled-by-default production adapter.

**Architecture:** Fastify owns public capability, intent creation, provider delivery, and resend commands. PostgreSQL owns opaque token state, cooldowns, attempt limits, rotation, and enumeration-resistant suppression. React consumes only generic capability and delivery states; Brevo credentials and identifiers stay server-side.

**Tech Stack:** Node.js 22, TypeScript 7, Fastify 5, PostgreSQL 15.9+, React 19, Node test runner, Vitest for Cloudflare, Brevo v3 transactional email API.

## Global Constraints

- Review Anchor owns the provider account and verified sender; customers never configure Brevo.
- Brevo is hidden behind `TransactionalEmailProvider`; domain and UI code never import a Brevo SDK.
- The implementation uses version-controlled inline HTML and text. No Brevo template ID is required.
- Production signup email is disabled unless `SIGNUP_EMAIL_ENABLED=true`, `TRANSACTIONAL_EMAIL_PROVIDER=brevo`, and every Brevo setting is present.
- The static demo makes no provider request and never simulates delivery.
- Public responses never reveal whether an address already has an account.
- Verification and resend tokens are random, opaque, hashed at rest, short-lived, rotated, and single-use.
- No API key, token, email address, verification URL, rendered body, or raw provider payload enters logs or audit metadata.
- Migration `012` remains paused. The new provider-independent migration is `020_signup_email_readiness.sql` and requires the same exact target/checksum manifest policy as migration `019`.
- No target database mutation, DNS change, Brevo account mutation, or real email is part of implementation.

---

## File Structure

### New files

- `server/onboarding/signup-email.ts` — provider-neutral availability, error classes, and versioned verification renderer.
- `server/providers/brevo.ts` — Brevo HTTP adapter only.
- `database/migrations/020_signup_email_readiness.sql` — delivery lifecycle, resend receipt, cooldown, and token rotation functions.
- `database/tests/008_signup_email_readiness.sql` — PostgreSQL concurrency and state-transition evidence.
- `tests/signup-email-provider.test.ts` — renderer, configuration, and Brevo wire-contract tests.
- `tests/signup-email-ui.test.ts` — server-rendered public UI state contracts.

### Modified files

- `server/config.ts` — provider and sender configuration.
- `server/app.ts` — injected provider type remains testable.
- `server/onboarding/types.ts` — intent, delivery, and resend contracts.
- `server/onboarding/postgres.ts` — focused onboarding repository implementation.
- `server/repository/postgres.ts` — shared repository implementation of the same functions.
- `server/types.ts` — `PlatformRepository` contracts.
- `server/routes/onboarding.ts` — capability, start, resend, verify, and honest failure responses.
- `src/platform/api.ts` — typed capability/start/resend client.
- `src/features/onboarding/SignupView.tsx` — availability gate.
- `src/features/onboarding/CheckEmailView.tsx` — honest delivery and resend states.
- `src/App.tsx` — opaque receipt routing rather than email-only routing.
- `tests/onboarding.test.ts` — route-level security, enumeration, and resend tests.
- `tests/database-contract.test.ts` — migration function and grant checks.
- `scripts/test-migrator.ts` — exact manifests for migrations 019 and 020.
- `.github/workflows/database-security.yml` — CI manifest includes exact checksums for 019 and 020.
- `.env.example` — names only, never values.
- `README.md`, `docs/architecture.md`, `docs/production-readiness.md` — exact evidence and remaining live gate.

---

### Task 1: Provider-neutral email contract and Brevo adapter

**Files:**
- Create: `server/onboarding/signup-email.ts`
- Create: `server/providers/brevo.ts`
- Create: `tests/signup-email-provider.test.ts`
- Modify: `server/providers/transactional-email.ts`
- Modify: `server/config.ts`
- Modify: `server/app.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces:

```ts
export type TransactionalEmailAvailability =
  | { available: true }
  | { available: false; reason: "disabled" | "incomplete_configuration" };

export interface AccountVerificationEmail {
  to: string;
  displayName: string;
  verificationUrl: string;
  expiresAt: Date;
}

export interface TransactionalEmailProvider {
  availability(): TransactionalEmailAvailability;
  sendAccountVerification(input: AccountVerificationEmail): Promise<{ providerMessageId: string }>;
}

export class TransactionalEmailDeliveryError extends Error {
  constructor(public readonly kind: "timeout" | "rejected" | "invalid_response") {
    super("Transactional email delivery failed.");
  }
}
```

- Consumes: server configuration parsed by `loadConfig`.

- [ ] **Step 1: Write failing configuration and renderer tests**

Add to `tests/signup-email-provider.test.ts`:

```ts
test("signup email can be disabled in production without provider secrets", () => {
  const config = productionConfig({ SIGNUP_EMAIL_ENABLED: "false" });
  assert.equal(config.SIGNUP_EMAIL_ENABLED, false);
});

test("enabled Brevo signup email requires every server-only sender setting", () => {
  assert.throws(
    () => productionConfig({
      SIGNUP_EMAIL_ENABLED: "true",
      TRANSACTIONAL_EMAIL_PROVIDER: "brevo",
    }),
    /BREVO_API_KEY/u,
  );
});

test("verification content is versioned, escaped, and contains one short-lived link", () => {
  const rendered = renderAccountVerificationEmail({
    displayName: "<Owner>",
    verificationUrl: "https://app.example.com/signup/verify?token=opaque",
    expiresAt: new Date("2026-07-23T12:00:00.000Z"),
  });
  assert.equal(rendered.version, "account-verification-v1");
  assert.doesNotMatch(rendered.html, /<Owner>/u);
  assert.match(rendered.html, /&lt;Owner&gt;/u);
  assert.equal(rendered.text.match(/https:\/\/app\.example\.com/g)?.length, 1);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --import tsx --test tests/signup-email-provider.test.ts
```

Expected: module/export/configuration assertions fail because the provider-neutral contract and Brevo settings do not exist.

- [ ] **Step 3: Implement the renderer and interface**

In `server/onboarding/signup-email.ts`, implement HTML escaping, fixed subject `Verify your Review Anchor account`, text and HTML bodies, and the exact interfaces above. Keep the renderer pure.

- [ ] **Step 4: Add failing Brevo wire-contract tests**

Use an injected `fetch` function:

```ts
test("Brevo sends one recipient with inline content and server-only authentication", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const provider = createBrevoTransactionalEmailProvider(config, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ messageId: "<provider-id>" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  const result = await provider.sendAccountVerification(emailInput);
  assert.equal(captured?.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(new Headers(captured?.init.headers).get("api-key"), "test-brevo-key");
  const body = JSON.parse(String(captured?.init.body));
  assert.equal(body.to.length, 1);
  assert.equal(body.to[0].email, emailInput.to);
  assert.equal(body.templateId, undefined);
  assert.match(body.htmlContent, /Verify your Review Anchor account/u);
  assert.equal(result.providerMessageId, "<provider-id>");
});
```

Also test timeout, non-2xx response, malformed JSON, missing `messageId`, and confirm thrown errors contain no recipient, token, URL, or provider response body.

- [ ] **Step 5: Implement `server/providers/brevo.ts`**

Use `AbortSignal.timeout(8_000)`, `POST https://api.brevo.com/v3/smtp/email`, headers `accept`, `content-type`, and `api-key`, one recipient, verified sender, subject, `htmlContent`, and `textContent`. Map failures to `TransactionalEmailDeliveryError`; do not retry.

- [ ] **Step 6: Replace the silent SendGrid provider**

Remove `createTransactionalEmailProvider` behaviour that silently succeeds with missing credentials. `server/providers/transactional-email.ts` should re-export the provider-neutral types temporarily or be deleted after import sites move to `server/onboarding/signup-email.ts`.

- [ ] **Step 7: Add explicit configuration**

Add:

```ts
TRANSACTIONAL_EMAIL_PROVIDER: z.enum(["brevo"]).optional(),
BREVO_API_KEY: optionalEnvironmentValue(z.string().min(20)),
BREVO_ACCOUNT_SENDER_EMAIL: optionalEnvironmentValue(z.string().email()),
BREVO_ACCOUNT_SENDER_NAME: optionalEnvironmentValue(z.string().trim().min(1).max(120)),
```

When signup email is enabled in production, require provider `brevo` and all three Brevo fields. Do not require them when disabled.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```powershell
node --import tsx --test tests/signup-email-provider.test.ts tests/backend-security.test.ts
npm.cmd run typecheck
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit**

```powershell
git add .env.example server/app.ts server/config.ts server/onboarding/signup-email.ts server/providers/brevo.ts server/providers/transactional-email.ts tests/signup-email-provider.test.ts
git commit -m "feat: add provider-neutral Brevo email adapter"
```

---

### Task 2: PostgreSQL signup delivery and resend lifecycle

**Files:**
- Create: `database/migrations/020_signup_email_readiness.sql`
- Create: `database/tests/008_signup_email_readiness.sql`
- Modify: `tests/database-contract.test.ts`
- Modify: `scripts/test-migrator.ts`
- Modify: `.github/workflows/database-security.yml`

**Interfaces:**
- Produces database functions:

```sql
app_private.create_signup_email_request(
  text, text, text, bytea, bytea, timestamptz, timestamptz
)
app_private.record_signup_email_delivery(
  uuid, text, bytea, text
)
app_private.claim_signup_email_resend(
  bytea, bytea, timestamptz, timestamptz
)
```

- `record_signup_email_delivery` accepts states `accepted` or `failed`; the provider reference is already SHA-256 hashed by the server.

- [ ] **Step 1: Write failing migration contract assertions**

Assert migration 020:

```ts
for (const column of [
  "delivery_state",
  "delivery_attempt_count",
  "last_delivery_attempt_at",
  "next_delivery_attempt_at",
  "provider_message_reference_hash",
  "resend_receipt_hash",
  "last_failure_class",
]) assert.match(schema, new RegExp(column, "i"));

assert.match(schema, /for update/is);
assert.match(schema, /delivery_attempt_count\s*<\s*3/i);
assert.match(schema, /next_delivery_attempt_at\s*<=\s*statement_timestamp\(\)/i);
```

- [ ] **Step 2: Run the contract test and confirm RED**

```powershell
node --import tsx --test tests/database-contract.test.ts
```

Expected: missing migration 020 and functions.

- [ ] **Step 3: Implement migration 020**

Alter `app_private.signup_intents` with constrained delivery columns. Replace `create_signup_intent` with `create_signup_email_request` that:

- takes both verification-token and resend-receipt hashes;
- acquires the existing email advisory lock;
- returns an opaque intent ID and `should_send_email`;
- inserts `suppressed` state for registered addresses and rate-limited requests;
- inserts `pending` state for deliverable requests;
- never returns the suppression reason publicly.

Implement `record_signup_email_delivery` under `afterword_auth`, row-locking the intent and transitioning `pending` to `accepted` or `failed`.

Implement `claim_signup_email_resend` to row-lock by receipt hash, require active/unregistered/unexpired state, enforce 60-second cooldown and maximum three delivery attempts, replace `token_hash`, set state to `pending`, increment the attempt count, and return the server-only delivery fields.

Revoke all functions from every role, then grant only to `afterword_auth`.

- [ ] **Step 4: Write database behaviour tests**

`database/tests/008_signup_email_readiness.sql` must prove:

- new address becomes `pending`;
- existing address becomes `suppressed`;
- public return columns are identical;
- accepted and failed transitions retain no raw provider value;
- resend before cooldown returns no row;
- resend after cooldown rotates the hash;
- the old verification hash cannot be consumed;
- attempt four is refused;
- two concurrent claims cannot both succeed;
- runtime, ingress, worker, ops, and public cannot execute the auth functions.

- [ ] **Step 5: Update exact migration manifests**

In `scripts/test-migrator.ts` and `.github/workflows/database-security.yml`, generate checksums for both:

```ts
const reviewedFiles = [
  "019_provider_independent_security.sql",
  "020_signup_email_readiness.sql",
];
const migrations = Object.fromEntries(reviewedFiles.map((file) => [
  file,
  migrationChecksum(readFileSync(`database/migrations/${file}`, "utf8")),
]));
```

Do not add migration 012 or wildcard approval.

- [ ] **Step 6: Run local database-independent checks**

```powershell
node --import tsx --test tests/database-contract.test.ts tests/migration-policy.test.ts
npm.cmd run typecheck
```

Expected: PASS. PostgreSQL execution remains for the database-security environment.

- [ ] **Step 7: Commit**

```powershell
git add database/migrations/020_signup_email_readiness.sql database/tests/008_signup_email_readiness.sql tests/database-contract.test.ts scripts/test-migrator.ts .github/workflows/database-security.yml
git commit -m "feat: persist signup email delivery lifecycle"
```

---

### Task 3: Repository and honest onboarding routes

**Files:**
- Modify: `server/onboarding/types.ts`
- Modify: `server/onboarding/postgres.ts`
- Modify: `server/repository/postgres.ts`
- Modify: `server/types.ts`
- Modify: `server/routes/onboarding.ts`
- Modify: `tests/onboarding.test.ts`

**Interfaces:**
- Consumes Task 1 `TransactionalEmailProvider`.
- Consumes Task 2 database functions.
- Produces:

```ts
type SignupEmailPublicState = {
  accepted: true;
  delivery: "unconfirmed";
  message: string;
  resendReceipt: string;
  resendAvailableAt?: string;
};
```

- [ ] **Step 1: Add failing route tests**

Add tests proving:

```ts
test("disabled signup email creates no intent", async () => {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/signup-intents", headers, payload });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "SIGNUP_EMAIL_UNAVAILABLE");
  assert.equal(repo.issued.length, 0);
});

test("provider rejection is recorded and never claims an email was sent", async () => {
  const response = await failedProviderApp.inject(request);
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().data.delivery, "unconfirmed");
  assert.doesNotMatch(response.json().data.message, /\bsent\b/i);
  assert.equal(repo.deliveryResults[0].state, "failed");
});

test("new and registered addresses expose the same public response", async () => {
  const publicProjection = ({ accepted, delivery, message, resendAvailableAt }) => ({
    accepted,
    delivery,
    message,
    resendAvailableAt,
  });
  assert.deepEqual(
    publicProjection(newResponse.json().data),
    publicProjection(knownResponse.json().data),
  );
});
```

Add resend tests for missing/invalid receipt, cooldown, accepted retry, token rotation, replay, same-origin denial, and rate limiting.

- [ ] **Step 2: Run onboarding tests and confirm RED**

```powershell
node --import tsx --test tests/onboarding.test.ts
```

Expected: capability/resend routes and repository methods are missing.

- [ ] **Step 3: Implement repository contracts**

Add:

```ts
createSignupEmailRequest(input: SignupEmailRequestInput): Promise<SignupEmailRequestRecord>;
recordSignupEmailDelivery(input: SignupEmailDeliveryResult): Promise<void>;
claimSignupEmailResend(input: SignupEmailResendInput): Promise<SignupEmailClaim | null>;
```

Map only bounded database columns. Never return raw hashes.

- [ ] **Step 4: Implement capability route**

`GET /api/v1/auth/signup-capability` returns `cache-control: no-store` and:

```ts
{ available: provider.availability().available, provider: "transactional_email" }
```

It never returns `brevo`, configuration names, or reasons containing secrets.

- [ ] **Step 5: Replace signup-intent behaviour**

Before creating a token, require provider availability. Generate independent 32-byte verification and resend tokens. Create the database request, call the provider only when `shouldSendEmail`, then record `accepted` with `sha256(providerMessageId)` or `failed` with the bounded error kind.

Use the same public state for provider acceptance, provider failure, and suppression:

```ts
const publicState = {
  accepted: true,
  delivery: "unconfirmed",
  message: "If that address can be used, check your inbox. Delivery cannot be confirmed.",
};
```

Never log the caught provider error object. Log only `{ requestId, failureClass }`.

- [ ] **Step 6: Implement resend route**

`POST /api/v1/auth/signup-intents/resend` accepts `{ receipt }`, generates a new verification token, claims the locked database transition, delivers when claimed, records outcome, and returns the same generic state shape.

- [ ] **Step 7: Run focused and security tests**

```powershell
node --import tsx --test tests/onboarding.test.ts tests/signup-email-provider.test.ts tests/backend-security.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add server/onboarding/types.ts server/onboarding/postgres.ts server/repository/postgres.ts server/types.ts server/routes/onboarding.ts tests/onboarding.test.ts
git commit -m "feat: add honest signup delivery and resend"
```

---

### Task 4: Signup and Check Email UI

**Files:**
- Create: `tests/signup-email-ui.test.ts`
- Modify: `src/platform/api.ts`
- Modify: `src/features/onboarding/SignupView.tsx`
- Modify: `src/features/onboarding/CheckEmailView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes Task 3 capability, start, and resend response shapes.
- Produces browser states: checking, unavailable, ready, submitting, unconfirmed, cooldown, resending, and exhausted.

- [ ] **Step 1: Write failing UI contract tests**

Server-render pure state components and assert:

```ts
assert.match(checkingMarkup, /Checking email availability/u);
assert.match(unavailableMarkup, /No verification request was created/u);
assert.doesNotMatch(unconfirmedMarkup, /We sent/u);
assert.match(cooldownMarkup, /Resend available/u);
assert.match(exhaustedMarkup, /Try again later/u);
assert.doesNotMatch(allMarkup, /Brevo|API key|provider rejection/u);
```

Add source contract assertions that routing carries `receipt`, not an email address as resend authority.

- [ ] **Step 2: Run UI tests and confirm RED**

```powershell
node --import tsx --test tests/signup-email-ui.test.ts
```

Expected: missing API and state components.

- [ ] **Step 3: Add typed platform API methods**

```ts
getSignupCapability(): Promise<{ available: boolean; provider: "transactional_email" }>;
startSignup(...): Promise<SignupEmailPublicState>;
resendSignupVerification(receipt: string): Promise<SignupEmailPublicState>;
```

- [ ] **Step 4: Implement Signup availability gate**

On mount, load capability. Disable the form during checking and when unavailable. Retry reloads capability. On success, navigate with `receipt`, `delivery: "unconfirmed"`, `resendAvailableAt`, and display-only email in router state or query parameters. Do not store tokens in local storage.

- [ ] **Step 5: Implement Check Email state machine**

Render exact honest copy from the design. Compute cooldown from server timestamp, enable resend only at zero, replace state from the resend response, and preserve the opaque receipt across refresh through the URL. Never interpret the email parameter as authority.

- [ ] **Step 6: Run focused tests and demo build**

```powershell
node --import tsx --test tests/signup-email-ui.test.ts tests/onboarding.test.ts
npm.cmd run typecheck
npm.cmd run build:demo
```

Expected: PASS. Demo build performs no provider request.

- [ ] **Step 7: Commit**

```powershell
git add src/App.tsx src/platform/api.ts src/features/onboarding/SignupView.tsx src/features/onboarding/CheckEmailView.tsx src/styles.css tests/signup-email-ui.test.ts
git commit -m "feat: add honest signup email recovery UI"
```

---

### Task 5: Documentation, full verification, and review

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/production-readiness.md`
- Modify: `docs/superpowers/specs/2026-07-23-signup-email-brevo-readiness-design.md`
- Modify only if required by test evidence: focused implementation files from Tasks 1–4

**Interfaces:**
- Consumes all prior tasks.
- Produces a reviewed, push-ready Slice 3 branch with no live-provider claim.

- [ ] **Step 1: Update documentation**

Record:

- Brevo is the first disabled-by-default adapter.
- Inline versioned content is used; no template ID is required.
- `review-anchor-demo.pages.dev` remains a static seeded demo and cannot complete real signup.
- Local and CI tests use injected fake provider responses.
- Real sender-domain, DNS, inbox delivery, bounce, complaint, and webhook evidence remain launch gates.
- Migration 020 exists locally/CI but is not applied to a target environment.

- [ ] **Step 2: Run secret and diff checks**

```powershell
npm.cmd run security:secrets
git diff --check
git status --short
```

Expected: no secret findings; `.env.brevo.local` and `.env.brevo-mcp.local` remain absent from Git status.

- [ ] **Step 3: Run complete local gates**

```powershell
npm.cmd run check
npm.cmd run test:cloudflare
npm.cmd run typecheck:cloudflare
npm.cmd run build:demo
npm.cmd audit --omit=dev --audit-level=high
```

Expected: all tests/builds/typechecks pass and production dependency audit reports zero vulnerabilities.

- [ ] **Step 4: Run browser verification**

With signup email disabled, verify:

- `/signup` reports unavailable and creates no request;
- Retry remains bounded;
- no Brevo or configuration detail is visible;
- the static demo remains navigable without backend errors.

With an injected local fake provider, verify unconfirmed, cooldown, resend, and refreshed-receipt journeys at desktop and mobile sizes. Do not load the real local key.

- [ ] **Step 5: Independent review**

Request read-only spec, quality, and security review covering enumeration, token rotation, ambiguous provider outcomes, log redaction, migration grants, demo isolation, and no live-provider use. Resolve every critical or important finding test-first.

- [ ] **Step 6: Commit documentation and review fixes**

```powershell
git add README.md docs/architecture.md docs/production-readiness.md docs/superpowers/specs/2026-07-23-signup-email-brevo-readiness-design.md
git commit -m "docs: record signup email readiness boundary"
```

- [ ] **Step 7: Push and verify GitHub**

```powershell
git push -u origin codex/signup-email-readiness
gh pr create --base master --head codex/signup-email-readiness --title "Add signup email readiness and recovery"
gh pr checks --watch --interval 10
```

Expected: Application Security and Database Security pass. Do not merge with a failed or pending required check.

---

## Deferred live-provider checklist

These steps are intentionally excluded from implementation and require a later explicit user request:

- buy and verify `review-anchor.com`;
- configure the authenticated production application origin;
- verify the Brevo sending subdomain and sender;
- move the API key from ignored local handoff into encrypted deployment secrets;
- send controlled messages to representative inbox providers;
- verify SPF, DKIM, DMARC, provider acceptance, delivery, bounce, and complaint evidence;
- implement and verify authenticated, replay-safe Brevo webhooks;
- enable production signup email.
