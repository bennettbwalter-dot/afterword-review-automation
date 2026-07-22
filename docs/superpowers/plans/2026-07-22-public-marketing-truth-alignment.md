# Public Marketing Truth Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the public marketing page with Review Anchor's proven Google-first product and prevent obsolete or unsupported claims from returning.

**Architecture:** Keep the existing public marketing components, layout, callbacks, and routes in `src/App.tsx`. Add one source-level contract test that isolates the marketing section of that file, checks the approved copy and runtime-mode labels, and rejects complete unsupported claims without banning generic words used in factual sample or no-guarantee text.

**Tech Stack:** React 18, TypeScript, Node.js built-in test runner, `node:assert/strict`, Vite

## Global Constraints

- Public copy may describe only Google Profile, neutral review requests and QR, selected-location operational reporting, and connection/readiness visibility.
- Do not claim social publishing, media upload, content generation, video generation, Google Profile writes, review replies, or any unavailable provider capability.
- Do not promise more reviews, higher ratings, rankings, enquiries, customers, or revenue.
- Preserve no-review-gating, three-touch maximum, opt-out, attribution, no-outcome-guarantee, pricing, SMS allowance, email allowance, and implementation-guarantee semantics.
- Demo-only workflow states must be visibly labelled as sample or demo behavior.
- Preserve the existing components, layout, CSS, heading hierarchy, landmarks, controls, callbacks, routes, menu behavior, theme behavior, and reduced-motion scrolling.
- Demo/authenticated CTA labels derive only from the existing `IS_DEMO_MODE` constant.
- Do not add a CMS, copy registry, API request, readiness lookup, dependency, or provider integration.
- The implementation diff is limited to `src/App.tsx` and `tests/marketing-truth.test.ts`; this plan document and the approved design spec are documentation checkpoints, not implementation files.
- Do not mutate a live database, provider, Storage bucket, billing account, social destination, Google connection, or MobileWAN resource.
- Browser rendering and live provider behavior are not proven by local source tests or builds and must not be claimed as verified.

---

### Task 1: Add the marketing truth contract and align public copy

**Files:**
- Create: `tests/marketing-truth.test.ts`
- Modify: `src/App.tsx:439-474`
- Modify: `src/App.tsx:500-508`
- Modify: `src/App.tsx:642-660`
- Modify: `src/App.tsx:699-710`
- Modify: `src/App.tsx:759-761`

**Interfaces:**
- Consumes: the existing file-level `IS_DEMO_MODE: boolean`, `onOpenDemo: () => void`, and `onStartSetup: () => void` behavior in `src/App.tsx`.
- Produces: exact public copy enforced by `tests/marketing-truth.test.ts`; no new runtime export, prop, route, or API.

- [ ] **Step 1: Write the failing marketing contract test**

Create `tests/marketing-truth.test.ts` with exactly this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const marketingStart = appSource.indexOf("function MarketingNav");
const marketingEnd = appSource.indexOf("function AppSidebar");

assert.ok(marketingStart >= 0, "MarketingNav source boundary is missing");
assert.ok(marketingEnd > marketingStart, "AppSidebar source boundary is missing");

const marketingSource = appSource.slice(marketingStart, marketingEnd);

function count(source: string, text: string): number {
  return source.split(text).length - 1;
}

test("public hero describes the proven Google-first product", () => {
  for (const copy of [
    "Google review requests, kept honest",
    "Make every review request honest and easy to track.",
    "Review Anchor gives local businesses one workspace for Google Profile, neutral review requests and QR, selected-location reporting, and connection readiness.",
    "No review gating",
    "Three-touch maximum",
    "Location-scoped records",
  ]) assert.ok(marketingSource.includes(copy), `missing approved hero copy: ${copy}`);
});

test("workspace calls to action retain callbacks and derive labels from demo mode", () => {
  assert.equal(count(marketingSource, '{IS_DEMO_MODE ? "Product demo" : "Workspace"}'), 1);
  assert.equal(count(marketingSource, '{IS_DEMO_MODE ? "Preview workspace" : "Open workspace"}'), 2);
  assert.ok(marketingSource.includes('className="nav-demo-link" onClick={onOpenDemo}'));
  assert.ok(marketingSource.includes('<Button onClick={onStartSetup}>'));
  assert.ok(marketingSource.includes('<Button variant="secondary" onClick={onOpenDemo}>'));
  assert.ok(marketingSource.includes('{IS_DEMO_MODE ? "Open product" : "Sign in"}'));
  assert.ok(marketingSource.includes('onOpenDemo(); }}>Preview the workspace</Button>'));
  assert.ok(marketingSource.includes('{IS_DEMO_MODE ? "Open demo" : "Sign in"}'));
});

test("demo journey states are labelled as sample data", () => {
  assert.ok(marketingSource.includes("Demo workspace"));
  assert.ok(marketingSource.includes("Sample workflow"));
  assert.ok(marketingSource.includes("Sample data"));
  assert.ok(marketingSource.includes('<StatusPill tone="success"><span className="live-dot" /> Sample</StatusPill>'));
  assert.equal(marketingSource.includes("Automation live"), false);
  assert.equal(marketingSource.includes('<span className="live-dot" /> Live'), false);
});

test("oversight copy names only current operational surfaces", () => {
  for (const copy of [
    "Review Anchor dashboard",
    "Monitor reputation outcomes and exceptions.",
    "Use Google Profile, Reports, and Connections to inspect request delivery, opt-outs, cached reviews, and service status.",
    "Completed-job workflow status",
    "Request delivery, click, and opt-out totals",
    "Google review data inside Google Profile",
    "Printable location-scoped operational reports",
  ]) assert.ok(marketingSource.includes(copy), `missing approved oversight copy: ${copy}`);
});

test("footer uses Google-first operational positioning for both runtime modes", () => {
  assert.ok(marketingSource.includes("Honest Google review requests, clearly tracked."));
  assert.ok(marketingSource.includes('{IS_DEMO_MODE ? "Google-first reputation operations - Seeded product demo" : "Google-first reputation operations - Protected business workspace"}'));
});

test("retired and unsupported public claims are absent", () => {
  for (const retired of [
    "Growth Suite",
    "Get more reviews. Win more customers.",
    "Business growth, starting with reviews",
    "Exception alerts",
  ]) assert.equal(appSource.includes(retired), false, `retired claim remains: ${retired}`);

  assert.doesNotMatch(
    marketingSource,
    /social publishing|automatic social post(?:ing|s)?|upload (?:your )?(?:image|video|media)|AI (?:content|video) generation|generate (?:a )?(?:social post|video)|publish (?:to|on) Google|reply to (?:Google )?reviews?/iu,
  );
});

test("honesty guardrails and Google access caveat remain", () => {
  assert.ok(marketingSource.includes("Every eligible customer gets the same neutral route."));
  assert.ok(marketingSource.includes("STOP cancels pending messages and blocks future enrolment."));
  assert.ok(marketingSource.includes("We do not guarantee review counts, ratings, search rankings, enquiries or revenue."));
  assert.ok(marketingSource.includes("Availability still depends on approved Google Business Profile API access."));
});
```

- [ ] **Step 2: Run the focused test and verify the old marketing copy fails the contract**

Run:

```powershell
node --import tsx --test tests/marketing-truth.test.ts
```

Expected: FAIL in the hero, CTA, sample-state, oversight, footer, and retired-claim tests because `src/App.tsx` still contains the old Growth Suite and outcome-promising copy. The source-boundary assertions and honesty-guardrail test should pass.

- [ ] **Step 3: Replace only the approved public copy in `src/App.tsx`**

In `MarketingNav`, preserve the button and callback and change its child to:

```tsx
<button type="button" className="nav-demo-link" onClick={onOpenDemo}>
  {IS_DEMO_MODE ? "Product demo" : "Workspace"}
</button>
```

In `HeroJourney`, keep the existing figure, business, location, and status styling, changing only the visible status copy:

```tsx
<StatusPill tone="success"><span className="live-dot" /> Sample workflow</StatusPill>
```

In `JourneyCanvas`, keep the existing status pill and change only its visible status copy:

```tsx
<StatusPill tone="success"><span className="live-dot" /> Sample</StatusPill>
```

Replace the hero copy, primary CTA child, and third trust item with:

```tsx
<p className="hero-kicker"><span className="live-dot" /> Google review requests, kept honest</p>
<h1 id="hero-title">Make every review request honest and easy to track.</h1>
<p className="hero-lede">Review Anchor gives local businesses one workspace for Google Profile, neutral review requests and QR, selected-location reporting, and connection readiness.</p>
<div className="hero-actions">
  <Button onClick={onStartSetup}>{IS_DEMO_MODE ? "Preview workspace" : "Open workspace"} <ArrowRight size={17} aria-hidden="true" /></Button>
  <Button variant="secondary" onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>
    Watch the workflow
  </Button>
</div>
<div className="hero-trust-row">
  <span><ShieldCheck size={16} /> No review gating</span>
  <span><Clock3 size={16} /> Three-touch maximum</span>
  <span><Bell size={16} /> Location-scoped records</span>
</div>
```

Keep the oversight label and heading, then replace its paragraph, checklist, and CTA child with:

```tsx
<p>Use Google Profile, Reports, and Connections to inspect request delivery, opt-outs, cached reviews, and service status.</p>
<ul className="check-list">
  <li><Check size={17} /> Completed-job workflow status</li>
  <li><Check size={17} /> Request delivery, click, and opt-out totals</li>
  <li><Check size={17} /> Google review data inside Google Profile</li>
  <li><Check size={17} /> Printable location-scoped operational reports</li>
</ul>
<Button variant="secondary" onClick={onOpenDemo}>{IS_DEMO_MODE ? "Preview workspace" : "Open workspace"} <ArrowRight size={17} /></Button>
```

Replace the statement footer contents while preserving its element structure, brand, and copyright:

```tsx
<footer className="statement-footer">
  <p>Honest Google review requests, clearly tracked.</p>
  <div><Brand compact /><span>{IS_DEMO_MODE ? "Google-first reputation operations - Seeded product demo" : "Google-first reputation operations - Protected business workspace"}</span><span>© 2026</span></div>
</footer>
```

Do not edit `src/styles.css`, pricing, FAQ, workflow behavior, imports, authenticated workspace components, or any provider/server file.

- [ ] **Step 4: Run the marketing contract and verify it passes**

Run:

```powershell
node --import tsx --test tests/marketing-truth.test.ts
```

Expected: PASS with 7 tests, 0 failures.

- [ ] **Step 5: Run focused adjacent workflow and security regression tests**

Run:

```powershell
node --import tsx --test tests/marketing-truth.test.ts tests/workflow-readiness.test.ts tests/home-view.test.ts
npm.cmd run test:security
```

Expected: both commands exit 0; marketing truth, workflow readiness, Home composition, platform security, and backend security tests all pass.

- [ ] **Step 6: Confirm the implementation file scope and commit the slice**

Run:

```powershell
git diff --check
git status --short
git diff --name-only HEAD
```

Expected: no diff-hygiene errors; only `src/App.tsx` and `tests/marketing-truth.test.ts` are implementation changes. The plan document may also be present if its documentation commit has not yet been made.

Commit:

```powershell
git add -- src/App.tsx tests/marketing-truth.test.ts
git commit -m "feat: align public marketing with Google-first product"
```

Expected: one focused implementation commit; no CSS, API, provider, database, billing, Storage, or MobileWAN file is included.

---

### Task 2: Validate and independently review the complete slice

**Files:**
- Verify: `src/App.tsx`
- Verify: `tests/marketing-truth.test.ts`
- Verify: `docs/superpowers/specs/2026-07-22-public-marketing-truth-alignment-design.md`
- Verify: `docs/superpowers/plans/2026-07-22-public-marketing-truth-alignment.md`

**Interfaces:**
- Consumes: the committed marketing copy and contract from Task 1.
- Produces: local build/test evidence and a clean independent-review verdict; no runtime interface or new file.

- [ ] **Step 1: Run the complete local validation gate**

Run each command separately so a failure identifies its gate:

```powershell
npm.cmd run security:secrets
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd run build:demo
git diff --check
```

Expected: every command exits 0. Record exact test totals from `npm.cmd run test`; do not infer browser or live-provider success from either build.

- [ ] **Step 2: Prove the implementation stayed within its approved boundary**

Run:

```powershell
git diff --name-only 45e08c4..HEAD
git show --stat --oneline HEAD
git status --short --branch
```

Expected: the implementation commit changes only `src/App.tsx` and `tests/marketing-truth.test.ts`; the planning commit changes only this plan document and the design spec's approval status; the worktree is clean after both commits. No CSS, API, server, provider, database, migration, billing, Storage, moderation, GPU, social, or MobileWAN file appears.

- [ ] **Step 3: Perform the required two-stage independent review**

Dispatch a fresh spec-compliance reviewer with the approved design and implementation diff. Require it to verify every exact copy requirement, prohibited claim, retained disclosure, CTA callback, runtime-mode label, and file-scope constraint.

If spec compliance is clean, dispatch a different fresh code-quality reviewer. Require it to inspect test robustness, source-boundary extraction, regex breadth, TypeScript/Node compatibility, formatting, and unintended behavior changes.

Expected: both reviewers return no open Critical or Important findings. Fix any valid finding with the smallest scoped change, rerun Task 1 Steps 4-5 and Task 2 Steps 1-2, commit the fix separately, and repeat both reviews.

- [ ] **Step 4: Push the reviewed branch without deploying**

Run:

```powershell
git push origin codex/simplified-product
```

Expected: push succeeds and local `codex/simplified-product` matches `origin/codex/simplified-product`. Do not deploy the demo or authenticated runtime, and do not claim browser visual verification.
