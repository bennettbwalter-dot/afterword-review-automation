# Stripe setup and verification

Review Anchor uses Stripe-hosted Checkout Sessions for a mixed cart containing one recurring subscription Price and one one-time setup-fee Price. Card details stay on Stripe. The application creates Sessions on the server, and only signature-verified webhooks can activate billing state.

The public marketing page does not create Checkout Sessions. A signed-in owner, admin or billing member starts Checkout from the tenant billing view. Agency support sessions cannot create Checkout or Customer Portal sessions.

## 1. Rotate exposed credentials

If an API key has appeared in chat, source code, logs or screenshots, roll it immediately in Stripe Workbench and review its request history. Do not reuse the exposed value, even in test mode.

Create separate test and live credentials. Prefer a restricted API key (`rk_`) with only the permissions exercised by this service. Start with Price read, Checkout Session write and Billing Portal Session write access, then use Stripe request logs to add a missing permission only when a controlled test returns 403. Apply an IP access policy where the deployment has stable egress.

The publishable key is not required by this integration because the browser redirects to the URL of a server-created hosted Checkout Session. Never add a secret or restricted key to a `VITE_` variable.

## 2. Create the Stripe catalog in test mode

Create active GBP Prices matching [`product-commercial-rules.md`](product-commercial-rules.md):

| Environment variable | Type | Amount | Interval |
| --- | --- | ---: | --- |
| `STRIPE_PRICE_PRO_MONTHLY` | Recurring | £39.00 | Monthly |
| `STRIPE_PRICE_PRO_ANNUAL` | Recurring | £390.00 | Yearly |
| `STRIPE_PRICE_MULTI_MONTHLY` | Recurring | £79.00 | Monthly |
| `STRIPE_PRICE_SETUP_PRO` | One-time | £149.00 | — |
| `STRIPE_PRICE_SETUP_MULTI_2_3` | One-time | £249.00 | — |
| `STRIPE_PRICE_SETUP_MULTI_4_5` | One-time | £349.00 | — |

The server retrieves both selected Prices before creating Checkout and rejects inactive Prices, non-GBP currency, incorrect amounts, incorrect one-time/recurring types or the wrong interval.

Do not enable Stripe Tax yet. Tax collection requires confirmed registrations and a reviewed tax treatment; merely setting `automatic_tax` does not create registrations.

## 3. Configure Customer Portal

Configure the Stripe Customer Portal in test mode for payment-method updates, invoices and the cancellation/change behaviour approved for the product. `STRIPE_PORTAL_CONFIGURATION_ID` is optional; leave it blank to use the Stripe account's default Portal configuration.

## 4. Configure the webhook endpoint

The deployed ingress URL is:

```text
https://YOUR_INGRESS_HOST/webhooks/stripe
```

Subscribe the endpoint to exactly these event types:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Store that endpoint's `whsec_` signing secret only in the ingress process secret store. The API process needs the restricted API key and Price IDs; the ingress process needs the webhook signing secret. Do not give the ingress process the Stripe API key.

For local forwarding, run Stripe CLI against the ingress port:

```powershell
stripe listen --forward-to http://127.0.0.1:4175/webhooks/stripe
```

Use the temporary signing secret printed by that command for local testing only. A Dashboard-managed endpoint has a different signing secret.

## 5. Configure environment secrets

Copy [`.env.example`](../.env.example) to the ignored local `.env`. Use the newly rotated test credentials and test Price IDs:

```dotenv
STRIPE_CHECKOUT_ENABLED=false
STRIPE_MODE=test
STRIPE_API_KEY=rk_test_REDACTED
STRIPE_WEBHOOK_SECRET=whsec_REDACTED
STRIPE_PRICE_PRO_MONTHLY=price_REDACTED
STRIPE_PRICE_PRO_ANNUAL=price_REDACTED
STRIPE_PRICE_MULTI_MONTHLY=price_REDACTED
STRIPE_PRICE_SETUP_PRO=price_REDACTED
STRIPE_PRICE_SETUP_MULTI_2_3=price_REDACTED
STRIPE_PRICE_SETUP_MULTI_4_5=price_REDACTED
STRIPE_PORTAL_CONFIGURATION_ID=
```

Keep `STRIPE_CHECKOUT_ENABLED=false` until migration 005 is applied and the pilot launch gate permits a controlled Stripe test. Then set it to `true` in both the application and ingress process environments. Capability-scoped validation requires Price/API configuration only in the application and the signing secret only in ingress.

`STRIPE_MODE=live` is rejected outside `NODE_ENV=production`, and a test/live API-key mismatch fails configuration at startup.

## 6. Apply and test

```powershell
npm.cmd run security:secrets
npm.cmd run check
npm.cmd run db:migrate
npm.cmd run dev
```

With Stripe CLI forwarding in another terminal:

1. Sign in as the pilot business owner.
2. Open **Team & billing** and choose **Activate with Stripe**.
3. Complete Checkout with a Stripe test payment method.
4. Confirm both the setup fee and subscription appear on the initial invoice.
5. Confirm `checkout.session.completed` and subscription events return HTTP 204.
6. Refresh **Team & billing** and confirm the account becomes Active only after both the active subscription and paid setup fee have been recorded.
7. Open **Manage billing** and confirm Customer Portal returns to the tenant billing view.
8. Replay the same event and confirm no second state transition or audit mutation occurs.
9. Tamper with the payload or signature and confirm HTTP 401 with no database write.
10. Exercise failed, delayed, expired, cancelled and past-due states before considering live mode.

## Deliberate boundary

Subscription Checkout and Customer Portal are implemented. Automatic £10 SMS-bundle charging and public self-registration remain disabled. A paid bundle must eventually be credited only by its own signed Stripe payment webhook; the existing SMS allowance cannot be increased from browser state or an unsigned callback.

Before live mode, complete the one-business pilot, clean PostgreSQL/RLS execution, Stripe test evidence, key-rotation rehearsal, tax/legal review and the remaining items in [`security-launch-checklist.md`](security-launch-checklist.md).
