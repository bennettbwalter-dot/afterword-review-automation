# Public Marketing Truth Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the public marketing page with Review Anchor's proven Google-first product and prevent obsolete or unsupported claims from returning.

**Architecture:** Keep the existing public marketing components, layout, callbacks, and routes in `src/App.tsx`. Add one source-level contract test that combines the public marketing data range (`STORY_STEPS` through `PRICING_OFFERS`) with the public marketing component range, checks approved copy and callback-bound runtime labels, and rejects complete unsupported claims without banning factual sample or explicit unavailability/no-guarantee text.

**Tech Stack:** React 19, TypeScript, Node.js built-in test runner, `node:assert/strict`, Vite

## Global Constraints

- Public copy may describe only Google Profile, neutral review requests and QR, selected-location operational reporting, and connection/readiness visibility.
- Do not claim social publishing, media upload, content generation, video generation, Google Profile writes, review replies, or any unavailable provider capability.
- Do not promise more reviews, higher ratings, rankings, enquiries, customers, or revenue.
- Preserve no-review-gating, three-touch maximum, opt-out, attribution, no-outcome-guarantee, pricing, SMS allowance, email allowance, and implementation-guarantee semantics.
- Demo-only workflow states must be visibly labelled as sample or demo behavior.
- Preserve the existing components, layout, CSS, heading hierarchy, landmarks, controls, callbacks, routes, menu behavior, theme behavior, and reduced-motion scrolling.
- Demo/authenticated CTA labels derive only from the existing `IS_DEMO_MODE` constant.
- Do not add a CMS, copy registry, API request, readiness lookup, dependency, or provider integration.
- Runtime implementation remains limited to `src/App.tsx` and `tests/marketing-truth.test.ts`; final-review contract hardening may also correct this plan document, while the approved product copy and design spec remain unchanged.
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

- [ ] **Step 1: Write the failing marketing contract test, including final-review coverage**

Create `tests/marketing-truth.test.ts` from this final strengthened example. It supersedes the original component-only extraction and single context-blind regex.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function extractPublicMarketingSource(source: string): string {
  const dataStart = source.indexOf("const STORY_STEPS");
  const dataEnd = source.indexOf("const CLIENT_NAV");
  const componentStart = source.indexOf("function MarketingNav");
  const componentEnd = source.indexOf("function AppSidebar");
  assert.ok(dataStart >= 0 && dataEnd > dataStart, "marketing data boundaries are missing");
  assert.ok(componentStart >= 0 && componentEnd > componentStart, "marketing component boundaries are missing");
  return `${source.slice(dataStart, dataEnd)}\n${source.slice(componentStart, componentEnd)}`;
}

const marketingSource = extractPublicMarketingSource(appSource);

const unsupportedClaimPatterns = [
  /\bsocial(?: media)? (?:publishing|posting)\b/iu,
  /\bautomatic(?:ally)? (?:social(?: media)? )?post(?:ing|s)?\b/iu,
  /\bupload (?:(?:a|your) )?(?:photos?|images?|videos?|media)\b/iu,
  /\bAI(?:-powered)? (?:content|video) generation\b/iu,
  /\bgenerate (?:a |your )?(?:social(?: media)? posts?|videos?)\b/iu,
  /\b(?:publish|post)(?: (?:posts?|updates?))? (?:to |on )?Google(?: (?:Business Profile )?(?:posts?|updates?))?\b/iu,
  /\b(?:reply|respond) to (?:Google )?reviews?\b/iu,
  /\b(?:double|increase|boost|grow|get more|win more)\b[^.!?\r\n]{0,80}\b(?:reviews?|ratings?|rankings?|enquiries|customers?|revenue)\b/iu,
  /\b(?:guarantee|promise)\b[^.!?\r\n]{0,80}\b(?:more reviews?|higher ratings?|rankings?|enquiries|customers?|revenue)\b/iu,
];

function hasExplicitCaveat(source: string, index: number, length: number): boolean {
  const before = source.slice(Math.max(0, index - 80), index);
  const after = source.slice(index + length, index + length + 160);
  const immediatePrefix = /(?:\b(?:cannot|can't|do not|don't|does not|doesn't|will not|won't|never|unable to|not able to)\s+(?:(?:currently|yet)\s+)?|\bno\s+)$/iu;
  const immediateSuffix = /^\s+(?:is|are|remains?)\s+(?:not available|unavailable|blocked|disabled)\b/iu;
  const connectedFaqAnswer = /^\s*\?\s*(?:no|not currently)\s*[.!]\s*[^.!?]{0,80}\b(?:is|are)\s+(?:not available|unavailable|blocked|disabled)\b/iu;
  return immediatePrefix.test(before)
    || immediateSuffix.test(after)
    || connectedFaqAnswer.test(after);
}

function findUnsupportedClaims(source: string): string[] {
  return unsupportedClaimPatterns.flatMap((pattern) => {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
    return [...source.matchAll(globalPattern)]
      .filter((match) => !hasExplicitCaveat(source, match.index, match[0].length))
      .map((match) => match[0]);
  });
}

function sourceRange(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, `${startMarker} source range is missing`);
  return source.slice(start, end).replace(/\s+/gu, " ").trim();
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
  const navigation = sourceRange(appSource, "function MarketingNav", "function HeroJourney");
  const planDialog = sourceRange(appSource, "function PlanSelectionDialog", "function MarketingSite");
  const marketingSite = sourceRange(appSource, "function MarketingSite", "function AppSidebar");
  assert.ok(navigation.includes('<button type="button" className="nav-demo-link" onClick={onOpenDemo}> {IS_DEMO_MODE ? "Product demo" : "Workspace"} </button>'));
  assert.ok(navigation.includes('<Button variant="primary" className="marketing-nav__cta" onClick={onOpenDemo}> {IS_DEMO_MODE ? "Open product" : "Sign in"} </Button>'));
  assert.ok(planDialog.includes('<Button onClick={() => { onClose(); onOpenDemo(); }}>Preview the workspace</Button>'));
  assert.ok(marketingSite.includes('<Button onClick={onStartSetup}>{IS_DEMO_MODE ? "Preview workspace" : "Open workspace"} <ArrowRight size={17} aria-hidden="true" /></Button>'));
  assert.ok(marketingSite.includes('<Button variant="secondary" onClick={onOpenDemo}>{IS_DEMO_MODE ? "Preview workspace" : "Open workspace"} <ArrowRight size={17} /></Button>'));
  assert.ok(marketingSite.includes('<Button onClick={onOpenDemo}>{IS_DEMO_MODE ? "Open demo" : "Sign in"} <ArrowRight size={16} /></Button>'));
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

  assert.deepEqual(findUnsupportedClaims(marketingSource), []);
});

test("unsupported claims in public marketing data are detected", () => {
  const fixture = appSource.replace(
    "const CLIENT_NAV",
    'const REVIEW_FIXTURE = "Social media publishing";\n\nconst CLIENT_NAV',
  );
  assert.deepEqual(findUnsupportedClaims(extractPublicMarketingSource(fixture)), ["Social media publishing"]);
});

test("unsupported claim detection distinguishes availability claims from caveats", () => {
  const prohibited = [
    "Social media publishing",
    "Automatically post on social media",
    "Upload photos",
    "AI video generation",
    "Generate a social media post",
    "Publish Google posts",
    "Post updates to Google",
    "Respond to Google reviews",
    "Without leaving Review Anchor, publish Google posts",
    "You don’t need another tool to reply to Google reviews",
    "Never switch tabs to respond to Google reviews",
    "Upload a photo",
    "AI-powered content generation",
    "Double your reviews and revenue",
    "Boost your rankings",
    "Guarantee more reviews",
  ];
  const permitted = [
    "We cannot publish to Google",
    "We do not reply to Google reviews",
    "Social media publishing is not available",
    "No guarantee of more reviews or revenue",
    "Can we publish Google posts? No. Publishing is unavailable.",
    "We do not guarantee review counts, ratings, search rankings, enquiries or revenue.",
    "Sample Google review data",
  ];
  const missed = prohibited.filter((claim) => findUnsupportedClaims(claim).length === 0);
  const rejected = permitted.filter((caveat) => findUnsupportedClaims(caveat).length > 0);
  assert.deepEqual({ missed, rejected }, { missed: [], rejected: [] });
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

Expected during the initial copy-alignment RED: failures in the hero, CTA, sample-state, oversight, footer, and retired-claim tests. During final-review hardening, the synthetic data-range and table-driven claim fixtures must first fail against the component-only/context-blind implementation, then pass after the strengthened extraction and helper are in place.

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

Expected: PASS with 9 tests, 0 failures after final-review hardening.

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

For final-review hardening, stage only `tests/marketing-truth.test.ts` and this plan correction, then create a separate focused test commit. `src/App.tsx` should remain unchanged because the approved runtime copy and callbacks already satisfy the strengthened contract.

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

Expected: the implementation commit changes only `src/App.tsx` and `tests/marketing-truth.test.ts`; the final-review fix commit changes only the hardened contract test and this corrected plan; the earlier planning commit changes only this plan document and the design spec's approval status. The worktree is clean after the commits. No CSS, API, server, provider, database, migration, billing, Storage, moderation, GPU, social, or MobileWAN file appears.

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
