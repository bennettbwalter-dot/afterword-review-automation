# Product and commercial rules

This document controls pricing, onboarding, messaging allowances and prospect-data boundaries for Review Anchor. Product copy, checkout, sales material and billing code must match it.

## Product boundary

Review Anchor is a reputation and customer-growth platform for businesses that connect their own locations. The first product area covers review requests, QR links, review monitoring, reply support and reporting.

Do not build a ranked prospect database from Google Maps or Places content. Do not store Google-derived business names, ratings, review counts or review samples as a reusable lead-generation dataset.

Lead generation stays outside the customer platform and uses manual research, licensed directories, partnerships, referrals, paid advertising or data providers that grant commercial-use rights. A future import tool may accept a list supplied by an authorised user after they confirm their right to use it.

Keep experimental prospecting and data collection out of the Google Cloud project and organisation paths that support production Business Profile connections.

## Pricing

| Offer | Setup | Subscription | Locations | Included SMS | Additional SMS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reputation Pro monthly | £149 | £39 per month | 1 | 100 segments per month | £10 per 100 segments |
| Reputation Pro annual | £149 | £390 per year | 1 | 100 segments per month | £10 per 100 segments |
| Reputation Multi | £249 for 2–3 locations or £349 for 4–5 | £79 per month | Up to 5 | 300 pooled segments per month | £10 per 100 pooled segments |

An additional Multi location costs £10 per month after the first five, subject to a pricing review. Scope larger or unusual implementations before quoting them.

Charge the setup fee before implementation starts. Do not offer a free trial or routinely waive setup. Apply discounts to subscription periods, not implementation work.

## Implementation guarantee

Pay the setup fee and complete onboarding. If we cannot configure and deliver the review-request system agreed during setup, we will refund the setup fee.

The guarantee covers the work Review Anchor controls: agreed configuration, QR and review links, email and SMS workflows, templates, location setup, staff access and reporting configuration.

It does not guarantee review counts, ratings, customer participation, search rankings, enquiries, sales or revenue.

## SMS accounting and controls

Count provider-billable SMS segments, not message requests or customers.

The account dashboard must show:

- The current allowance and billing-period reset date.
- Used and remaining segments.
- Usage for each location on a Multi account.
- Estimated overage charges.
- Alerts at 75%, 90% and 100%.

The owner chooses one exhaustion policy:

- Buy the next 100-segment bundle for £10.
- Pause SMS at the allowance while email requests continue.

Do not create an unlimited-SMS plan or an account that can produce an unexpected overage without a recorded owner setting.

## Non-Stripe implementation boundary

The platform calculates GSM-7 or UCS-2 billable segments from the final rendered SMS, then reserves the pooled allowance before calling the provider. Accepted and ambiguous provider outcomes count toward the safety limit; definite failures release their reservation. Multi usage is grouped by location and combined at business level.

The automatic-bundle preference may be recorded before Stripe is connected, but it must not create credit or permit an unpaid overage. At the allowance, SMS is held while email continues. A later signed Stripe webhook must be the only route that marks a £10 bundle paid and increases the allowance.

## Product and claims rules

- Send the same neutral route to every eligible customer. Do not add review gating.
- Do not offer incentives tied to a positive review or star rating.
- Do not advertise a Google-dependent feature as live until approval and a real integration test support the claim.
- Keep review detection separate from estimated conversion. Do not claim person-level attribution that Google does not provide.
- Do not promise a review count, rating increase, ranking improvement, enquiry volume or revenue result.

## Changelog from the previous specification

- Removed automated Google Maps prospect discovery and derivative prospect scoring.
- Removed the 14-day free trial.
- Added the £149 single-location setup fee and scoped Multi setup pricing.
- Set Reputation Multi to 300 pooled SMS segments per month.
- Set extra SMS to £10 per 100 segments for both plans.
- Added usage totals, location breakdowns, alert thresholds and owner-controlled exhaustion policies.
- Added the non-Stripe segment-reservation and safe-hold boundary; paid bundles remain a later Stripe-owned action.
- Separated prospecting operations from the production reputation platform and its Google dependencies.
