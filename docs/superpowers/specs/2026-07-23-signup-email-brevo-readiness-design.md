# Review Anchor Signup Email and Brevo Readiness Design

**Date:** 23 July 2026
**Status:** Approved
**Branch:** `codex/signup-email-readiness`

## Objective

Make signup verification honest, recoverable, and provider-ready without asking Review Anchor customers to configure an email service. Review Anchor owns one transactional-email account and verified sender domain. Businesses use Review Anchor; Review Anchor operates the provider.

Brevo is the first provider because its transactional API, delivery webhooks, free pilot allowance, and paid upgrade path fit an early multi-tenant launch. The application retains a provider-neutral boundary so Brevo can be replaced without changing product flows or stored lifecycle states.

## Decisions

- Review Anchor owns the Brevo account, API key, sender verification, templates, and webhooks.
- Individual businesses do not create Brevo accounts or paste provider credentials into Review Anchor.
- Account verification is sent from a Review Anchor-controlled address such as `accounts@notify.reviewanchor.co.uk`.
- Future review-request email uses a separate Review Anchor-controlled sender such as `reviews@notify.reviewanchor.co.uk`, with the business name visible and the business address set as `Reply-To`.
- The phrase “resend verification link” describes a product action. It does not refer to the Resend email company.
- Brevo is hidden behind a narrow transactional-email interface. Domain logic never imports a Brevo SDK or exposes Brevo identifiers to browsers.
- No provider secret, verification token, full delivery payload, or email body is written to logs or audit metadata.

## Alternatives considered

### MailerSend

MailerSend is suitable for transactional email, but its current free allowance is smaller. It remains a viable later adapter, not the first implementation.

### Amazon SES

SES is inexpensive at scale, but initial production access, reputation management, bounce handling, and operational setup are less suitable for the first self-service pilot.

### Customer-owned providers

Requiring each business to connect an email service improves sender-domain ownership but creates a large onboarding and support burden. It is deferred as an optional enterprise capability.

### Standard marketing-email platforms

Signup verification and security messages are transactional. They must not require marketing-list subscription or be implemented as campaigns.

## Scope

This slice includes:

- server-owned signup-email availability;
- Brevo transactional verification delivery;
- delivery-state persistence;
- bounded, enumeration-resistant resend;
- honest signup and check-email UI states;
- safe provider error handling and audit evidence;
- provider-neutral tests and Brevo contract tests;
- documentation and deployment configuration.

This slice does not include:

- live Brevo credentials or DNS changes;
- a production send;
- marketing campaigns or newsletters;
- completed-job review-request email delivery;
- password reset;
- customer-owned domains;
- migration 012 or any target database mutation.

Review-request email will reuse the same provider boundary in the later neutral messaging slice.

## User flow

1. A visitor opens signup.
2. The UI loads a no-store server capability describing whether account email is available.
3. If unavailable, signup is disabled with an honest retryable explanation. No intent is created.
4. If available, the visitor submits email, display name, and account type.
5. The server creates or safely suppresses an opaque signup request under the existing enumeration-resistant rules.
6. For a deliverable request, the server sends a short-lived verification link through Brevo.
7. The browser moves to Check Email using an opaque request receipt, not the raw email as authority.
8. The screen states that the request was accepted but delivery cannot be confirmed. It never claims an email was sent, and provider acceptance or failure remains internal to prevent account enumeration.
9. When the server permits it, the visitor can request another link. The command is rate-limited, rotates the verification token, and returns a bounded next-attempt time.
10. Verification remains single-use. Registration continues through the existing signed, short-lived cookie.

An existing account, suppressed address, and new address receive equivalent public response values and shapes. Internal delivery outcomes remain server-only.

## Architecture

### Provider-neutral interface

The existing transactional-email provider becomes a narrow interface:

```ts
interface TransactionalEmailProvider {
  availability(): TransactionalEmailAvailability;
  sendAccountVerification(input: AccountVerificationEmail): Promise<{
    providerMessageId: string;
  }>;
}
```

`TransactionalEmailAvailability` contains only a configured/available state and a safe reason class. It never contains credentials.

The application injects the provider for tests. Production constructs a Brevo adapter only when the capability is explicitly enabled and all required settings are present.

### Brevo adapter

The adapter calls Brevo’s documented `POST https://api.brevo.com/v3/smtp/email` endpoint with a server-only `api-key` header. It uses a verified sender, version-controlled Review Anchor HTML and text content, the recipient, and the short-lived verification URL. No Brevo dashboard template identifier is required.

The adapter:

- enforces an outbound timeout;
- sends one recipient per verification request;
- validates the success response and provider message identifier;
- maps HTTP, timeout, and malformed-response failures into safe provider error classes;
- never retries an ambiguous send inside the HTTP request;
- never logs the API key, verification URL, recipient, or rendered body.

Reference: [Brevo transactional email API](https://developers.brevo.com/reference/send-transac-email).

### Configuration

Provider settings use server-only environment variables:

- `SIGNUP_EMAIL_ENABLED`
- `TRANSACTIONAL_EMAIL_PROVIDER=brevo`
- `BREVO_API_KEY`
- `BREVO_ACCOUNT_SENDER_EMAIL`
- `BREVO_ACCOUNT_SENDER_NAME`

Production may start with signup email disabled. Enabling the capability with incomplete Brevo settings fails configuration validation. No variable uses a `VITE_` prefix.

### Persistence

A new forward-only provider-independent migration follows migration 019 and does not make migration 012 deployable.

Signup intents gain:

- delivery state: `pending`, `accepted`, `failed`, or `suppressed`;
- delivery attempt count;
- last delivery attempt timestamp;
- next delivery attempt timestamp;
- provider message identifier hash or bounded non-secret reference;
- opaque resend receipt hash;
- last safe failure class.

Database functions own state transitions and row locking. A resend can proceed only when:

- the opaque receipt matches;
- the intent remains active and unregistered;
- the verification window remains valid;
- the minimum retry interval has elapsed;
- the bounded attempt count has not been reached.

Resend rotates the verification token. Older tokens become invalid. Concurrent resend requests cannot create two active tokens or two authorised attempts.

### HTTP API

#### `GET /api/v1/auth/signup-capability`

Returns a no-store public state:

```json
{
  "available": true,
  "provider": "transactional_email"
}
```

The provider field is generic. The browser does not need to know Brevo.

#### `POST /api/v1/auth/signup-intents`

Requires same origin and existing rate limiting. When globally unavailable it returns a deterministic `503 SIGNUP_EMAIL_UNAVAILABLE` before creating an intent.

When accepted, it returns an enumeration-resistant response with:

- `accepted`;
- `delivery: "unconfirmed"`;
- honest copy stating that delivery cannot be confirmed;
- opaque resend receipt;
- next resend time when applicable.

Test-only debug tokens remain restricted to the existing test environment.

#### `POST /api/v1/auth/signup-intents/resend`

Accepts only the opaque resend receipt. It does not accept an email address. It is same-origin, separately rate-limited, idempotent for concurrent requests, and returns generic state.

#### Existing verification and registration routes

The verification route continues hashing the supplied token, consuming it once, and issuing the short-lived signed registration cookie. Registration behaviour remains unchanged.

## Enumeration resistance

Public response status, values, shape, and copy must not disclose whether an email already has an account. Provider acceptance, provider failure, existing-account suppression, and deliverable-intent paths therefore use the same generic unconfirmed response.

Provider rejection is stored internally. Public copy may say:

> We could not confirm delivery. Try again when the resend option becomes available.

It must not say:

> We sent an email.

Timing-sensitive paths should do comparable bounded work where practical. Exact provider errors never reach the browser.

## User interface

### Signup

- Loading: “Checking email availability…”
- Available: normal signup form.
- Unavailable: “Account email is temporarily unavailable. No verification request was created.” with Retry.
- Submission failure: clear, non-enumerating error.

### Check Email

The page no longer claims unconditionally that an email was sent. It shows:

- the request was accepted but delivery cannot be confirmed;
- resend available at a stated time;
- resend in progress;
- resend requested;
- retry unavailable after the bounded limit.

The email may be displayed only as the address the visitor just entered; it grants no authority. A browser refresh preserves resend capability through the opaque receipt.

No Brevo name, API status, or configuration detail appears in customer-facing UI.

## Delivery events

Brevo supports sent, delivered, deferred, bounce, spam, blocked, error, unsubscribe, open, and click events through transactional webhooks. This slice documents the future ingress contract but does not expose a webhook without signature/authentication evidence and replay-safe processing.

Until webhook verification is implemented, a provider-accepted API call means only “accepted by provider,” not delivered. UI and documentation use those exact terms.

Reference: [Brevo transactional webhooks](https://developers.brevo.com/docs/transactional-webhooks).

## Security and privacy

- Brevo credentials exist only in server/deployment secret storage.
- Verification and resend tokens are random, opaque, hashed at rest, short-lived, and single-use.
- Same-origin checks and route rate limits remain mandatory.
- Raw emails, tokens, URLs, bodies, and provider payloads are excluded from logs and audit metadata.
- Provider message references are bounded and treated as sensitive operational metadata.
- Delivery failures do not weaken verification or registration requirements.
- The static demo performs no Brevo requests and simulates no delivery.

## Testing

Implementation starts with failing tests covering:

- disabled capability creates no intent;
- incomplete enabled Brevo configuration fails closed;
- successful Brevo contract, headers, template data, timeout, and response validation;
- provider rejection records failure and never returns sent copy;
- existing and new addresses retain equivalent public response values and shapes;
- resend receipt hashing, cooldown, attempt limit, rotation, concurrency, and replay;
- old verification token rejection after resend;
- test-only debug token isolation;
- signup capability and resend route origin/rate-limit controls;
- Signup and Check Email loading, unavailable, unconfirmed, and resend states;
- secret scan and log redaction.

The slice then runs:

- focused onboarding and provider tests;
- PostgreSQL migration and tenant-isolation tests;
- complete application test/typecheck/build;
- Cloudflare tests and typecheck;
- production and demo builds;
- zero-vulnerability production audit;
- browser verification at desktop and mobile sizes;
- `git diff --check`;
- independent spec, code, and security review;
- GitHub Application Security and Database Security.

## Rollout boundary

Local and CI success proves provider-independent behaviour and the Brevo wire contract against a fake server. It does not prove inbox delivery.

Before production signup is enabled, the owner must separately:

1. create the Brevo account;
2. verify the Review Anchor sender domain;
3. store the API key and template identifier as deployment secrets;
4. send controlled verification messages to representative inbox providers;
5. confirm SPF, DKIM, and DMARC alignment;
6. retain provider acceptance, delivery, bounce, and complaint evidence;
7. set a paid-plan alert before the free allowance becomes operationally restrictive.

No target database migration, provider account mutation, DNS change, or live email is authorised by this design.

## Completion criteria

This slice is complete when signup availability is server-owned, unavailable email prevents intent creation, accepted and failed delivery states are honest, resend is bounded and enumeration-resistant, Brevo is isolated behind the provider interface, all required local/CI/browser reviews pass, and production remains disabled until live provider evidence exists.
