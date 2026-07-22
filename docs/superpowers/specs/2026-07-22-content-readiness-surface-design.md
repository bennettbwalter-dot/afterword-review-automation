# Content Readiness Surface Design

**Date:** 2026-07-22

**Status:** Design direction approved; written-spec review pending

## Purpose

Replace Content's single generic empty state with an honest, location-scoped readiness surface. The screen should explain the intended manual content workflow and show why each external capability remains unavailable without presenting unfinished controls as operational.

This is provider-independent UI work. It does not enable upload, generation, approval, scheduling, publication, billing, or any provider mutation.

## Product contract

- Preserve the existing Content tabs: Create, Uploads, Approvals, Scheduled, Published, and Failed.
- Preserve the business and location selected by the canonical workspace URL.
- The Create tab explains the future workflow from manual asset upload through approval and publication.
- Uploads, Approvals, Scheduled, Published, and Failed show distinct zero states appropriate to their stage.
- Show private media Storage, Google Business Profile publication, Facebook, Instagram, LinkedIn, YouTube, and MobileWAN as separate capabilities.
- Every capability is unavailable by default and includes a concise reason or prerequisite.
- Manual content remains conceptually independent of MobileWAN: GPU unavailability must never imply that manual content requires generation.
- Do not display Google review text or offer Google reviews as a content source.
- Do not render upload inputs, file pickers, publish/schedule buttons, connection buttons, billing calls to action, or generation controls.
- Do not advertise `Download for manual upload` until a validated downloadable rendition actually exists.

## Architecture

Keep `ContentView` as a presentational feature component. Add a small typed, immutable readiness model local to the Content feature. The current implementation supplies an explicit fail-closed model in which all external capabilities are unavailable.

The component must not read Markdown evidence documents at runtime, infer readiness from OAuth presence, or derive provider approval from demo data. A future scoped API may replace the static fail-closed model only after it has authoritative provider, destination, Storage, moderation, and MobileWAN health evidence.

No server route, repository query, database schema, migration, worker, secret, or provider adapter is part of this slice.

## User interface

### Create

Show a short workflow overview and capability readiness list. The manual path should be described as the primary route, while its current blocker is private Storage and moderation proof. MobileWAN appears as a separate paid-generation capability with its managed-GPU, legal, moderation, benchmark, and pricing prerequisites.

Publication destinations appear individually. Google Business Profile, Facebook, Instagram, LinkedIn, and YouTube each remain unavailable until that destination's own approval, scopes, destination enumeration, retry/reconciliation, and controlled pilot are proven.

### Queue tabs

- **Uploads:** no validated uploads yet; media upload is unavailable pending private Storage proof.
- **Approvals:** no immutable revisions awaiting approval.
- **Scheduled:** no approved content is scheduled; scheduling is not enabled.
- **Published:** no verified publication receipts exist.
- **Failed:** no failed content or destination attempts exist.

These are truthful zero states, not fabricated activity.

## Accessibility and responsive behavior

- Keep the existing tab navigation semantics and `aria-current` behavior.
- Readiness items use text labels as well as visual state; colour is not the sole signal.
- Headings follow a logical order.
- The layout must work within the existing responsive product shell without horizontal overflow.
- No disabled interactive elements are used where static explanatory content is sufficient.

## Testing

Add rendered component tests that verify:

- each tab produces its own stage-specific state;
- the Create view names the manual path and separates it from MobileWAN;
- all five publication destinations are individually unavailable;
- Storage and MobileWAN blockers are visible;
- no upload input, publish/schedule/generate control, connection action, or billing action renders;
- Google reviews are absent as a source and review text does not appear;
- the selected tab retains accessible current-page semantics.

Retain existing Google Profile boundary, workspace-routing, full test, typecheck, production-build, demo-build, secret-scan, and diff-hygiene gates.

## Explicit exclusions

- No uploads or signed Storage intents.
- No content drafts or persistence.
- No approval commands or immutable content revisions.
- No schedules, publication jobs, destination enumeration, or adapters.
- No MobileWAN provider contract, worker, job, or placeholder output.
- No Stripe subscriptions, prices, allowances, or credits.
- No migration or live database work.
- No claim of live browser or provider verification.

## Completion criteria

The slice is complete when every Content tab renders an accurate read-only state, external capabilities fail closed individually, policy tests prevent premature controls or review-content leakage, all local verification gates pass, and independent review finds no open critical or important issue.
