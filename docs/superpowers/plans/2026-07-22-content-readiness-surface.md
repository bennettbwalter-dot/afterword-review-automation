# Content Readiness Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Content's generic empty state with accurate, location-contextual, read-only workflow and capability readiness states without enabling upload, publication, billing, or provider behavior.

**Architecture:** Keep `ContentView` presentational beneath the existing URL-scoped `WorkspaceContextBar`. Add one typed Content-domain module containing immutable fail-closed source, capability, and queue-stage records; render it with semantic static markup and feature-local CSS. No runtime documentation reads, API calls, persistence, or provider inference are introduced.

**Tech Stack:** React 19, TypeScript 7, React DOM server rendering, Node test runner, existing CSS design tokens.

## Global Constraints

- Preserve Create, Uploads, Approvals, Scheduled, Published, and Failed.
- Every external capability is explicitly unavailable in this slice.
- Do not read evidence Markdown at runtime or infer readiness from OAuth/demo data.
- Do not display review text or offer reviews as a content source.
- Do not render file inputs, upload, publish, schedule, connect, billing, or generation controls.
- Manual content remains independent of MobileWAN.
- Do not add routes, repository queries, database work, migrations, workers, secrets, billing, Storage signing, adapters, or mutations.
- Do not claim live browser, provider, Storage, database, or GPU verification.
- Use red-green-refactor and commit only the named files.

---

## File map

- Create `src/features/content/content-readiness.ts`: typed source guidance, unavailable capabilities, and queue zero states.
- Modify `src/features/content/ContentView.tsx`: static Create and queue views.
- Modify `src/styles.css`: responsive readiness layout.
- Create `tests/content-readiness.test.ts`: domain and rendered contract tests.
- Modify `tests/google-profile-policy.test.ts`: cross-feature source boundary after the module split.

## Task 1: Add the fail-closed readiness model

**Files:**

- Create: `src/features/content/content-readiness.ts`
- Create: `tests/content-readiness.test.ts`

**Interfaces:**

- Consumes: `ContentTab` from `src/routing.ts`.
- Produces: `ContentSourceGuidance`, `ContentCapabilityKey`, `ContentReadinessCapability`, `ContentStageState`, `CONTENT_SOURCE_GUIDANCE`, `CONTENT_READINESS_CAPABILITIES`, `CONTENT_STAGE_STATES`.
- Invariant: every capability has `status: "unavailable"`.

- [ ] **Step 1: Write the failing domain test**

Create `tests/content-readiness.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_READINESS_CAPABILITIES,
  CONTENT_SOURCE_GUIDANCE,
  CONTENT_STAGE_STATES,
} from "../src/features/content/content-readiness.js";

test("Content readiness is explicit, complete, and fail closed", () => {
  assert.deepEqual(CONTENT_SOURCE_GUIDANCE.map((source) => [source.id, source.label]), [
    ["service", "Service"],
    ["offer", "Offer"],
    ["social_idea", "Campaign or post idea"],
  ]);
  assert.deepEqual(CONTENT_READINESS_CAPABILITIES.map((capability) => capability.id), [
    "manual-media", "google-business-profile", "facebook", "instagram", "linkedin", "youtube", "mobilewan",
  ]);
  assert.ok(CONTENT_READINESS_CAPABILITIES.every((capability) => capability.status === "unavailable"));
  assert.ok(CONTENT_READINESS_CAPABILITIES.every((capability) => capability.reason.trim().length > 0));
  assert.notEqual(
    CONTENT_READINESS_CAPABILITIES.find((capability) => capability.id === "manual-media")?.reason,
    CONTENT_READINESS_CAPABILITIES.find((capability) => capability.id === "mobilewan")?.reason,
  );
  assert.deepEqual(Object.keys(CONTENT_STAGE_STATES), ["uploads", "approvals", "scheduled", "published", "failed"]);
});
```

- [ ] **Step 2: Run RED**

Run `node --import tsx --test tests/content-readiness.test.ts`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `content-readiness.js`.

- [ ] **Step 3: Create the typed model**

Create `src/features/content/content-readiness.ts`:

```ts
import type { ContentTab } from "../../routing";

export interface ContentSourceGuidance {
  id: "service" | "offer" | "social_idea";
  label: string;
  description: string;
}

export type ContentCapabilityKey = "manual-media" | "google-business-profile" | "facebook" | "instagram" | "linkedin" | "youtube" | "mobilewan";

export interface ContentReadinessCapability {
  id: ContentCapabilityKey;
  label: string;
  category: "manual" | "destination" | "generation";
  status: "unavailable";
  reason: string;
}

export interface ContentStageState { title: string; description: string; }

export const CONTENT_SOURCE_GUIDANCE = [
  { id: "service", label: "Service", description: "Explain a service and the customer need it solves." },
  { id: "offer", label: "Offer", description: "Describe a time-bound offer with accurate terms." },
  { id: "social_idea", label: "Campaign or post idea", description: "Start from an original campaign or post brief." },
] as const satisfies readonly ContentSourceGuidance[];

export const CONTENT_READINESS_CAPABILITIES = [
  { id: "manual-media", label: "Manual image and video", category: "manual", status: "unavailable", reason: "Private media Storage, resumable path isolation, validation, and moderation must be proven first." },
  { id: "google-business-profile", label: "Google Business Profile", category: "destination", status: "unavailable", reason: "Publishing scopes, exact destination selection, reconciliation, and a controlled pilot are not yet proven." },
  { id: "facebook", label: "Facebook Page", category: "destination", status: "unavailable", reason: "Meta approval, Page enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "instagram", label: "Instagram professional account", category: "destination", status: "unavailable", reason: "Meta approval, professional-account enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "linkedin", label: "LinkedIn organisation", category: "destination", status: "unavailable", reason: "LinkedIn approval, organisation enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "youtube", label: "YouTube channel", category: "destination", status: "unavailable", reason: "YouTube project approval, channel enumeration, required scopes, reconciliation, and a controlled pilot are not yet proven." },
  { id: "mobilewan", label: "MobileWAN short video", category: "generation", status: "unavailable", reason: "Managed GPU benchmarks, legal clearance, moderation, private Storage, and approved prices are still required." },
] as const satisfies readonly ContentReadinessCapability[];

type QueueContentTab = Exclude<ContentTab, "create">;

export const CONTENT_STAGE_STATES: Readonly<Record<QueueContentTab, ContentStageState>> = {
  uploads: { title: "No validated uploads yet", description: "Media upload remains unavailable until private Storage and validation are proven." },
  approvals: { title: "No revisions awaiting approval", description: "Immutable content revisions and approval commands are not enabled." },
  scheduled: { title: "No approved content is scheduled", description: "Scheduling remains unavailable until its entitlement and destination workflows are proven." },
  published: { title: "No verified publications yet", description: "Only reconciled provider receipts will appear here after a destination passes its release gate." },
  failed: { title: "No failed content attempts", description: "Failed generation and destination attempts will remain independent when those workflows are enabled." },
};
```

- [ ] **Step 4: Run GREEN**

Run `node --import tsx --test tests/content-readiness.test.ts`.

Expected: 1 test passes, 0 fail.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd run typecheck
git diff --check
git add src/features/content/content-readiness.ts tests/content-readiness.test.ts
git commit -m "feat: define content readiness states"
```

Expected: both checks exit 0; commit includes exactly the two named files.

## Task 2: Render accessible readiness and queue states

**Files:**

- Modify: `src/features/content/ContentView.tsx`
- Modify: `src/styles.css`
- Modify: `tests/content-readiness.test.ts`
- Modify: `tests/google-profile-policy.test.ts`

**Interfaces:**

- Consumes the three constants from Task 1.
- Preserves `ContentView({ tab, onTabChange, children })` and `ContentTab` routing.
- Produces static semantic markup; the only buttons remain the six tabs.

- [ ] **Step 1: Add failing rendered tests**

Append to `tests/content-readiness.test.ts`:

```ts
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContentTab } from "../src/routing.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { ContentView } = await import("../src/features/content/ContentView.js");

const CONTENT_TAB_LABELS: Record<ContentTab, string> = {
  create: "Create", uploads: "Uploads", approvals: "Approvals", scheduled: "Scheduled", published: "Published", failed: "Failed",
};
const renderContent = (tab: ContentTab) => renderToStaticMarkup(createElement(ContentView, { tab, onTabChange: () => {} }));

test("Create separates manual content from unavailable generation and destinations", () => {
  const markup = renderContent("create");
  for (const expected of ["Service", "Offer", "Campaign or post idea", "Manual image and video", "Google Business Profile", "Facebook Page", "Instagram professional account", "LinkedIn organisation", "YouTube channel", "MobileWAN short video"]) {
    assert.match(markup, new RegExp(expected));
  }
  assert.equal((markup.match(/>Unavailable</gu) ?? []).length, 7);
  assert.doesNotMatch(markup, /Google review|review source/iu);
  assert.doesNotMatch(markup, /<input|<form|type="file"|<a\s/iu);
  assert.equal((markup.match(/<button/gu) ?? []).length, 6);
});

test("every Content queue tab renders its own truthful zero state", () => {
  for (const [tab, expected] of [["uploads", "No validated uploads yet"], ["approvals", "No revisions awaiting approval"], ["scheduled", "No approved content is scheduled"], ["published", "No verified publications yet"], ["failed", "No failed content attempts"]] as const) {
    const markup = renderContent(tab);
    assert.match(markup, new RegExp(expected));
    assert.match(markup, new RegExp(`<button[^>]*aria-current="page"[^>]*>${CONTENT_TAB_LABELS[tab]}</button>`));
  }
});
```

- [ ] **Step 2: Strengthen the cross-feature policy test**

In `tests/google-profile-policy.test.ts`, read both Content files:

```ts
const contentView = await readFile(path.resolve("src", "features", "content", "ContentView.tsx"), "utf8");
const contentReadiness = await readFile(path.resolve("src", "features", "content", "content-readiness.ts"), "utf8");
const content = `${contentView}\n${contentReadiness}`;
```

Retain `assert.doesNotMatch(content, /review source|Google review/i);` and add:

```ts
assert.doesNotMatch(content, /fetch\(|apiRequest|type=["']file["']|Publish now|Generate video/i);
```

- [ ] **Step 3: Run RED**

Run `node --import tsx --test tests/content-readiness.test.ts tests/google-profile-policy.test.ts`.

Expected: the domain test passes; rendered tests fail because `ContentView` still has the generic empty state.

- [ ] **Step 4: Implement semantic static views**

In `ContentView.tsx`, add this import below the existing type imports:

```tsx
import {
  CONTENT_READINESS_CAPABILITIES,
  CONTENT_SOURCE_GUIDANCE,
  CONTENT_STAGE_STATES,
} from "./content-readiness";
```

Then add:

```tsx
function CreateReadiness() {
  return <div className="content-readiness">
    <section className="panel content-readiness__intro" aria-labelledby="content-create-title">
      <span className="eyebrow">Manual-first workflow</span>
      <h2 id="content-create-title">Prepare approved business content</h2>
      <p>Start with an original business source. Manual media remains independent of paid video generation, and every destination opens only after its own release evidence is proven.</p>
      <div className="content-source-grid" aria-label="Permitted content sources">{CONTENT_SOURCE_GUIDANCE.map((source) => <article key={source.id}><h3>{source.label}</h3><p>{source.description}</p></article>)}</div>
    </section>
    <section className="panel content-capability-ledger" aria-labelledby="content-readiness-title">
      <header><div><span className="eyebrow">Release gates</span><h2 id="content-readiness-title">Capability readiness</h2></div><p>Availability is assessed separately. One missing provider never enables or disables another by implication.</p></header>
      <div>{CONTENT_READINESS_CAPABILITIES.map((capability) => <article key={capability.id}><div><h3>{capability.label}</h3><p>{capability.reason}</p></div><span aria-label={`${capability.label}: unavailable`}>Unavailable</span></article>)}</div>
    </section>
  </div>;
}

function QueueZeroState({ tab }: { tab: Exclude<ContentTab, "create"> }) {
  const state = CONTENT_STAGE_STATES[tab];
  return <section className="panel empty-state content-stage-state"><span className="eyebrow">{tabs.find((item) => item.id === tab)?.label}</span><h2>{state.title}</h2><p>{state.description}</p></section>;
}
```

Replace the generic default child with:

```tsx
{children ?? (tab === "create" ? <CreateReadiness /> : <QueueZeroState tab={tab} />)}
```

- [ ] **Step 5: Add responsive styles**

After `.product-feature` in `src/styles.css`, add:

```css
.content-readiness { display: grid; gap: var(--space-md); min-width: 0; }
.content-readiness__intro, .content-capability-ledger { display: grid; gap: var(--space-md); }
.content-readiness__intro > p, .content-capability-ledger > header p, .content-source-grid p, .content-capability-ledger article p { color: var(--color-muted); }
.content-source-grid, .content-capability-ledger > div { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: var(--space-sm); }
.content-source-grid article, .content-capability-ledger article { min-width: 0; padding: var(--space-sm); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-sm); background: var(--color-paper); }
.content-capability-ledger > header, .content-capability-ledger article { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-sm); }
.content-capability-ledger article > span { flex: 0 0 auto; padding: 0.2rem 0.45rem; border: var(--rule-hair) solid var(--color-warning); border-radius: 999px; color: var(--color-warning); font-size: var(--text-xs); font-weight: 750; }
.content-stage-state { min-height: 16rem; }
@media (max-width: 40rem) {
  .content-capability-ledger > header, .content-capability-ledger article { align-items: stretch; flex-direction: column; }
  .content-capability-ledger article > span { align-self: flex-start; }
}
```

- [ ] **Step 6: Run GREEN**

Run `node --import tsx --test tests/content-readiness.test.ts tests/google-profile-policy.test.ts tests/workspace-routing.test.ts`.

Expected: all focused tests pass.

- [ ] **Step 7: Run the complete local gate**

```powershell
npm.cmd run check
npm.cmd run build:demo
git diff --check
git status --short
```

Expected: secret scan, typecheck, full tests, production build, demo build, and diff hygiene pass. Status lists only the four intended Task 2 files.

- [ ] **Step 8: Perform independent review**

Review the diff against `docs/superpowers/specs/2026-07-22-content-readiness-surface-design.md`. Reject any implied working capability, runtime evidence inference, review-content source, interactive upload/publish/generate/billing control, lost tab accessibility, or unrelated backend change. Resolve every critical or important finding and rerun Step 7.

- [ ] **Step 9: Commit the rendered surface**

```powershell
git add src/features/content/ContentView.tsx src/styles.css tests/content-readiness.test.ts tests/google-profile-policy.test.ts
git diff --cached --check
git commit -m "feat: show content readiness states"
```

Expected: commit includes exactly the four named files.

## Final handoff

- Record both commit hashes and the independent review verdict in `.superpowers/sdd/review-anchor-simplified-progress.md` without staging the ignored ledger.
- Push only after fresh verification on final HEAD.
- Report verification as local; do not claim live browser rendering or external readiness.
