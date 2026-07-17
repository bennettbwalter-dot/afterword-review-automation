# Render pilot deployment

The Render deployment keeps the application API, public ingress and delivery worker in separate services. The application service also serves the production React build, which keeps login cookies and authenticated API requests on one origin. `render.yaml` intentionally does not create the database because the database roles and four login URLs must exist before the services receive their secrets.

Do not deploy the Blueprint until the Render dashboard shows the expected monthly price. The Blueprint uses three paid Starter services. Use a paid PostgreSQL instance for a real pilot because Render's free database expires after 30 days and has no backups. Keep all resources in Frankfurt so the services can use Render's private database URL.

## Database first

1. Create a dedicated PostgreSQL 15 or newer database in Frankfurt. Keep its default administrator URL only as `MIGRATION_DATABASE_URL`; never inject it into an application service.
2. Generate four independent random passwords and set `AUTH_DATABASE_PASSWORD`, `RUNTIME_DATABASE_PASSWORD`, `INGRESS_DATABASE_PASSWORD` and `WORKER_DATABASE_PASSWORD` in a local environment or secret manager.
3. Run `npm run db:provision`. This creates six `NOLOGIN`, `NOBYPASSRLS` capability roles, four matching login roles, transfers database/schema ownership to `afterword_migration_owner`, removes public database access and grants each login only its matching group role.
4. Run `npm run db:migrate`, then `npm run db:test:isolation`.
5. Build four internal database URLs by replacing only the username and password in the Render internal URL:
   - `AUTH_DATABASE_URL` uses `afterword_auth_login`.
   - `RUNTIME_DATABASE_URL` uses `afterword_runtime_login`.
   - `INGRESS_DATABASE_URL` uses `afterword_ingress_login`.
   - `WORKER_DATABASE_URL` uses `afterword_worker_login`.

The application service receives auth and runtime URLs, ingress receives only the ingress URL, and the worker receives only the worker URL. All three use the same 32-byte base64url `FIELD_ENCRYPTION_KEY`; Render prompts for this and each database URL during Blueprint creation. Stripe Checkout remains disabled and provider secrets are added only to the process that uses them after the database-only pilot passes.

## Deploy services

Create a Blueprint from the repository's root `render.yaml`. Confirm the service names remain `review-anchor-api`, `review-anchor-ingress` and `review-anchor-worker`, because their generated `onrender.com` URLs are part of the configured origin and callback URLs. Enter the capability-specific database URLs and the same field-encryption key when prompted.

After the first deploy:

1. Confirm both `/api/v1/health` endpoints return HTTP 200.
2. Confirm the API root serves the React application with CSP, immutable asset caching and `X-Robots-Tag: noindex, nofollow, noarchive`.
3. Run the one-business bootstrap with `BOOTSTRAP_PLAN=pro_monthly` and keep all providers and Stripe Checkout disabled.
4. Restrict the database's external access after migration/testing; Render services should use only the internal URLs.
5. Continue the acceptance sequence in `pilot-runbook.md` before adding Google, Twilio, SendGrid or Stripe webhook secrets.
