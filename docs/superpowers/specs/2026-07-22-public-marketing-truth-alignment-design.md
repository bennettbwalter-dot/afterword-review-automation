# Public Marketing Truth Alignment Design

**Date:** 2026-07-22

**Status:** Approved for implementation

## Purpose

Align Review Anchor's public marketing copy with the simplified Google-first product that actually exists. Retire the obsolete "Growth Suite" name, remove outcome-promising language, and describe only proven product surfaces or explicitly disclosed demo behavior.

This is a bounded copy-and-contract slice. It keeps the existing marketing layout, component structure, pricing cards, navigation behavior, theme behavior, and workflow interaction. It does not redesign the landing page or add a product capability.

## Product contract

- Public copy may describe Google Profile, neutral review requests and QR, selected-location operational reporting, and connection/readiness visibility.
- Public copy must not claim social publishing, media upload, content generation, video generation, Google Profile writes, review replies, or any provider capability that remains unavailable.
- Public copy must not promise more reviews, higher ratings, rankings, enquiries, customers, or revenue.
- Preserve explicit no-review-gating, three-touch maximum, opt-out, attribution, and no-outcome-guarantee disclosures.
- Demo-only visuals and workflow states must visibly identify themselves as sample or demo behavior.
- Pricing, plan, SMS allowance, and implementation-guarantee semantics remain unchanged in this slice.
- The authenticated workspace remains the destination of all workspace/demo CTAs; no new route or external link is introduced.

## Approaches considered

### Recommended: copy alignment plus an executed marketing contract

Update the stale and overbroad copy in the existing marketing components, then add an executed source-level contract test for the approved labels, disclosures, and prohibited claims. This fixes the customer-facing mismatch and makes the boundary durable without restructuring the landing page.

### Rejected: replace "Growth Suite" only

A mechanical rename would leave the headline "Get more reviews. Win more customers." and other copy implying outcome guarantees or a broader dashboard than the simplified product provides.

### Rejected: redesign the marketing site

A visual redesign would add unnecessary layout, responsive, and accessibility risk. The current structure already communicates the review-request journey effectively; the defect is truthfulness and product naming.

## Architecture

Keep `MarketingNav`, `HeroJourney`, `JourneyCanvas`, `OutcomePreview`, `MarketingSite`, pricing, FAQ, and footer components in `src/App.tsx`. Change only their static labels and explanatory copy where required by this spec.

Add `tests/marketing-truth.test.ts`. It reads the shipped marketing source and asserts exact approved copy plus prohibited claim absence. The test must inspect only source under `src`, never documentation or test fixtures, so historical plan language cannot create false positives.

Do not introduce a marketing CMS, copy registry, API request, environment-dependent claim set, or provider-readiness lookup.

## Exact copy changes

### Navigation and workspace calls to action

- Marketing navigation secondary button: replace **Growth Suite** with **Product demo** in demo mode and **Workspace** in authenticated mode.
- Hero primary button: replace **Open Growth Suite** with **Preview workspace** in demo mode and **Open workspace** in authenticated mode.
- Oversight-section button: replace **Open Growth Suite** with **Preview workspace** in demo mode and **Open workspace** in authenticated mode.
- Preserve the existing primary navigation button: **Open product** in demo mode and **Sign in** in authenticated mode.
- Plan-selection dialog keeps **Preview the workspace**.
- Sticky CTA keeps **Open demo** or **Sign in** according to runtime mode.

All these actions retain their existing callbacks and routes.

### Hero positioning

Replace:

- Kicker: **Business growth, starting with reviews**
- Heading: **Get more reviews. Win more customers.**
- Lead: the current broad growth statement

With:

- Kicker: **Google review requests, kept honest**
- Heading: **Make every review request honest and easy to track.**
- Lead: **Review Anchor gives local businesses one workspace for Google Profile, neutral review requests and QR, selected-location reporting, and connection readiness.**

Keep **No review gating** and **Three-touch maximum**. Replace **Exception alerts** with **Location-scoped records** because a general customer action inbox is not part of the current simplified product.

### Demo workflow labels

- In `HeroJourney`, replace **Automation live** with **Sample workflow**.
- In `JourneyCanvas`, replace the status **Live** with **Sample**.
- Keep the visible **Demo workspace** and **Sample data** labels.
- The workflow may still illustrate genuine completed jobs, neutral SMS, follow-up timing, a Google review, and an operational report because those are explicitly sample journey content.

### Oversight section

Keep the label **Review Anchor dashboard** and heading **Monitor reputation outcomes and exceptions.**

Replace the broad paragraph with:

**Use Google Profile, Reports, and Connections to inspect request delivery, opt-outs, cached reviews, and service status.**

Use these exact checklist items:

- **Completed-job workflow status**
- **Request delivery, click, and opt-out totals**
- **Google review data inside Google Profile**
- **Printable location-scoped operational reports**

This language must not imply publishing, review replies, customer alerts, or live provider health beyond the status already available in the authenticated workspace.

### Footer

Replace the outcome-promising footer headline with:

**Honest Google review requests, clearly tracked.**

Replace the stale growth/demo descriptor with:

- **Google-first reputation operations - Seeded product demo** in demo mode.
- **Google-first reputation operations - Protected business workspace** in authenticated mode.

Keep the Review Anchor brand and copyright year.

## Copy retained intentionally

- "One honest line from finished work to Google."
- Neutral request and follow-up explanations.
- "Google is the destination. Every eligible customer gets the same neutral route."
- No sentiment branch, no incentives, immediate suppression, clear attribution, and no outcome promises.
- Pricing, paid implementation, SMS segment allowances, email allowance, and implementation-guarantee text.
- FAQ answers, including the conditional Google-connection disclosure that availability depends on approved Business Profile API access.

These statements match current product rules and do not activate an externally gated capability.

## Prohibited marketing claims

The shipped marketing source must contain none of these retired or unsupported phrases:

- **Growth Suite**
- **Get more reviews. Win more customers.**
- **Business growth, starting with reviews**
- **Exception alerts**
- social publishing or automatic social posting
- media upload availability
- AI content generation or video generation availability
- Google post/media publishing availability
- review-reply availability
- guaranteed reviews, ratings, rankings, enquiries, customers, or revenue

The words "reviews", "customers", "rating", and "revenue" remain valid inside sample data, factual workflow descriptions, pricing context, and explicit no-guarantee statements. Tests must target complete prohibited claims rather than banning these generic words.

## State and error behavior

- Demo/authenticated CTA labels derive only from the existing `IS_DEMO_MODE` constant.
- Callbacks and navigation behavior remain unchanged.
- The page introduces no new loading, error, provider, or readiness state.
- If Google access is unavailable, the existing FAQ disclosure remains the authoritative public caveat.

## Accessibility and responsive behavior

- Preserve heading hierarchy, landmarks, button elements, link destinations, menu behavior, accessible figure labels, and reduced-motion scrolling.
- Copy changes must not add new controls or remove visible button labels.
- Keep concise CTA labels so the existing navigation and sticky CTA layouts do not overflow at narrow widths.
- No CSS change is planned.

## Testing

Add `tests/marketing-truth.test.ts` with executed assertions that verify:

- exact approved hero kicker, heading, and lead;
- demo/authenticated labels for navigation, hero, and oversight CTAs are derived from `IS_DEMO_MODE`;
- sample/demo workflow labels replace live-state claims;
- the four exact oversight checklist items and paragraph exist;
- exact footer headline and mode-specific descriptor exist;
- "Growth Suite" and the three retired/outcome-promising phrases are absent from shipped source;
- unsupported social publishing, media upload, content/video generation, Google publishing, and review-reply availability claims are absent;
- the existing no-review-gating and no-outcome-guarantee statements remain;
- marketing callbacks and destinations are unchanged;
- no CSS, API, provider, database, billing, Storage, or MobileWAN file enters the implementation diff.

Run the focused marketing/workflow/security tests, secret scan, typecheck, full test suite, production build, demo build, and diff hygiene. Complete independent task and whole-slice review before pushing.

## Explicit exclusions

- No layout, CSS, responsive, illustration, pricing, or navigation redesign.
- No authenticated workspace UI change.
- No Google/social publishing, upload, generation, review-reply, or provider integration.
- No API, server, database, migration, Storage, Stripe, moderation, GPU, or MobileWAN change.
- No live provider, browser, conversion, SEO, or production-readiness claim.

## Completion criteria

The slice is complete when the public site contains no retired Growth Suite or outcome-promising language, every updated claim maps to the current simplified product or explicit sample behavior, existing routes/interactions remain unchanged, the marketing contract passes, all local gates pass, and independent review has no open critical or important findings.
