# Render pilot deployment

The Render deployment keeps the application API, public ingress and delivery worker in separate services. The application service also serves the production React build, which keeps login cookies and authenticated API requests on one origin. None of the Blueprint files creates the database because the database roles and four login URLs must exist before the services receive their secrets.

## Hobby/free preview

The root `render.yaml` is the safe zero-cost default for a Render Hobby workspace; `render.hobby.yaml` is retained as an explicit alias. Both deploy only the application API and public ingress as separate Free web services. They deliberately omit the delivery worker because Render does not support Free background-worker instances. Queued email/SMS delivery, scheduled Google review sync, token-revocation processing and billing-period rolls therefore do not run in this topology.

Use a dedicated Supabase project for this application, provision the least-privilege roles described below, and enter only `AUTH_DATABASE_URL`, `RUNTIME_DATABASE_URL` and `INGRESS_DATABASE_URL` when the Hobby Blueprint prompts. Do not inject the platform administrator or migration URL into either service. Free Render web services spin down after periods without inbound traffic and have workspace usage limits, while the Supabase Free plan has its own quotas and inactivity policy. Treat this topology as a technical preview until both providers' current limits and backup requirements have been reviewed for a real pilot.

When creating the Blueprint in Render, leave Blueprint Path empty so Render uses the free root `render.yaml`. Stripe Checkout and all delivery providers remain disabled.

## Paid pilot

Do not deploy the Blueprint until the Render dashboard shows the expected monthly price. The later paid topology is preserved in `render.paid.yaml`; it uses three paid Starter services and the same capability-separated Supabase database connections as the Hobby topology. Keep the Render services in Frankfurt and the Supabase project in a nearby EU region.

## Supabase database first

1. Create a dedicated Supabase project. Record its project reference and Session Pooler host from the Connect dialog. Do not reuse a project owned by another product.
2. Run `npm run db:prepare:supabase -- --project-ref <project-ref> --pooler-host <session-pooler-host>`. This preserves existing local secrets, generates independent role passwords where needed, writes the capability-specific URLs to the ignored `.env`, and creates a temporary privileged bootstrap SQL file.
3. While signed in to that Supabase project, run the generated bootstrap SQL once in the SQL Editor. Delete the temporary file immediately after it succeeds; it contains database-role passwords. The bootstrap creates the marker, capability and login roles without granting Supabase platform privileges.
4. Run `npm run db:migrate` twice, then `npm run db:test:isolation`. The second migration run must report every migration as already applied, proving history and checksums are stable.
5. Copy only the capability-specific Session Pooler URLs into the matching Render services:
   - `AUTH_DATABASE_URL` uses `afterword_auth_login`.
   - `RUNTIME_DATABASE_URL` uses `afterword_runtime_login`.
   - `INGRESS_DATABASE_URL` uses `afterword_ingress_login`.
   - `WORKER_DATABASE_URL` uses `afterword_worker_login`.

The application service receives auth and runtime URLs, ingress receives only the ingress URL, and the worker receives only the worker URL. All services use `DATABASE_SSL=require` with the bundled official Supabase root certificate and share the same 32-byte base64url `FIELD_ENCRYPTION_KEY`; Render prompts for that key and each database URL during Blueprint creation. `MIGRATION_DATABASE_URL` stays local or in a deployment-only secret manager. Stripe Checkout remains disabled and provider secrets are added only to the process that uses them after the database-only pilot passes.

## Deploy services

Create or update the Blueprint with `render.paid.yaml` as the Blueprint Path. Confirm the service names remain `review-anchor-api`, `review-anchor-ingress` and `review-anchor-worker`, because their generated `onrender.com` URLs are part of the configured origin and callback URLs. Enter the capability-specific database URLs and the same field-encryption key when prompted.

After the first deploy:

1. Confirm both `/api/v1/health` endpoints return HTTP 200.
2. Confirm the API root serves the React application with CSP, immutable asset caching and `X-Robots-Tag: noindex, nofollow, noarchive`.
3. Run the one-business bootstrap with `BOOTSTRAP_PLAN=pro_monthly` and keep all providers and Stripe Checkout disabled.
4. Confirm no Render service contains the Supabase platform administrator or migration URL; keep only its assigned least-privilege Session Pooler credentials.
5. Continue the acceptance sequence in `pilot-runbook.md` before adding Google, Twilio, SendGrid or Stripe webhook secrets.
