import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function extractPublicMarketingSource(source: string): string {
  const dataStart = source.indexOf("const STORY_STEPS");
  const dataEnd = source.indexOf("const CLIENT_NAV");
  const componentStart = source.indexOf("function MarketingNav");
  const componentEnd = source.indexOf("function AppSidebar");

  assert.ok(dataStart >= 0, "STORY_STEPS source boundary is missing");
  assert.ok(dataEnd > dataStart, "CLIENT_NAV source boundary is missing");
  assert.ok(componentStart >= 0, "MarketingNav source boundary is missing");
  assert.ok(componentEnd > componentStart, "AppSidebar source boundary is missing");

  return `${source.slice(dataStart, dataEnd)}\n${source.slice(componentStart, componentEnd)}`;
}

const marketingSource = extractPublicMarketingSource(appSource);

const unsupportedClaimPatterns = [
  /\bsocial(?: media)? (?:publishing|posting)\b/iu,
  /\bautomatic(?:ally)? (?:social(?: media)? )?post(?:ing|s)?\b/iu,
  /\b(?:(?:media|images?|photos?|videos?)\b[^.!?\r\n]{0,40}\bupload(?:s|ed|ing)?|upload(?:s|ed|ing)?\b[^.!?\r\n]{0,40}\b(?:media|images?|photos?|videos?))\b/iu,
  /\bAI(?:-powered)? (?:content|video) generation\b/iu,
  /\bgenerate (?:a |your )?(?:social(?: media)? posts?|videos?)\b/iu,
  /\b(?:Google\b[^.!?\r\n]{0,48}\b(?:posts?|publish(?:es|ed|ing)?|media)|(?:posts?|publish(?:es|ed|ing)?|media)\b[^.!?\r\n]{0,48}\bGoogle(?:\s+(?:posts?|publishing|media))?)\b/iu,
  /\b(?:reviews?\b[^.!?\r\n]{0,40}\b(?:repl(?:y|ies|ied|ying)|respond(?:s|ed|ing)?)|(?:repl(?:y|ies|ied|ying)|respond(?:s|ed|ing)?)\b[^.!?\r\n]{0,40}\breviews?)\b/iu,
  /\b(?:double|increase|boost|grow|get more|win more)\b[^.!?\r\n]{0,80}\b(?:reviews?|ratings?|rankings?|enquiries|customers?|revenue)\b/iu,
  /\b(?:guarantee|promise)\b[^.!?\r\n]{0,80}\b(?:more reviews?|higher ratings?|rankings?|enquiries|customers?|revenue)\b/iu,
];

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasConnectedFaqCaveat(after: string, claim: string): boolean {
  const answer = after.match(/^\s*\?\s*(?:no|not currently)\s*[.!]\s*([^.!?]{0,80})/iu)?.[1];
  if (!answer) return false;

  const references = [escapeRegExp(claim), "this (?:feature|capability)"];
  if (/Google/iu.test(claim) && /posts?|publish|media/iu.test(claim)) references.push("publishing", "posting", "Google (?:posts?|publishing|media)");
  if (/upload/iu.test(claim) && /media|images?|photos?|videos?/iu.test(claim)) references.push("uploads?", "uploading", "(?:media|image|photo|video) uploads?");
  if (/reviews?/iu.test(claim) && /repl|respond/iu.test(claim)) references.push("review (?:replies|responses)", "replying", "responding");

  const capabilityState = new RegExp(
    `\\b(?:${references.join("|")})\\b\\s+(?:is|are|remains?)\\s+(?:(?:currently|yet)\\s+)?(?:not available|unavailable|blocked|disabled)\\b`,
    "iu",
  );
  return capabilityState.test(answer);
}

function hasExplicitCaveat(source: string, index: number, length: number, claim: string): boolean {
  const before = source.slice(Math.max(0, index - 80), index);
  const after = source.slice(index + length, index + length + 160);
  const internalNegation = /\b(?:(?:is|are|was|were)\s+(?:(?:currently|yet)\s+)?not|can(?:not|['’]t)\s+be|(?:do|does|did)\s+not\s+(?:include|support)|(?:don|doesn|didn)['’]t\s+(?:include|support))\b/iu;
  const immediatePrefix = /(?:\b(?:(?:do|does|did)\s+not\s+(?:include|support)|(?:don|doesn|didn)['’]t\s+(?:include|support)|can(?:not|['’]t)|do not|don['’]t|does not|doesn['’]t|will not|won['’]t|never|unable to|not able to)\s+(?:(?:currently|yet)\s+)?|\bno\s+)$/iu;
  const immediateNegatedSuffix = /^\s+(?:(?:is|are|was|were)\s+(?:(?:currently|yet)\s+)?not\b|can(?:not|['’]t)\s+be\b)/iu;
  const immediateStateSuffix = /^\s+(?:is|are|remains?)\s+(?:(?:currently|yet)\s+)?(?:not available|unavailable|blocked|disabled)\b/iu;

  return internalNegation.test(claim)
    || immediatePrefix.test(before)
    || immediateNegatedSuffix.test(after)
    || immediateStateSuffix.test(after)
    || hasConnectedFaqCaveat(after, claim);
}

function findUnsupportedClaims(source: string): string[] {
  return unsupportedClaimPatterns.flatMap((pattern) => {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
    return [...source.matchAll(globalPattern)]
      .filter((match) => !hasExplicitCaveat(source, match.index, match[0].length, match[0]))
      .map((match) => match[0]);
  });
}

function sourceRange(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `${startMarker} source boundary is missing`);
  assert.ok(end > start, `${endMarker} source boundary is missing`);
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
    "Media uploads are available",
    "Google post publishing is included",
    "Review replies are included",
    "Publish directly to Google",
    "Can we publish Google posts? No. Email is unavailable.",
    "Double your reviews and revenue",
    "Boost your rankings",
    "Guarantee more reviews",
  ];
  const permitted = [
    "We cannot publish to Google",
    "We do not reply to Google reviews",
    "We don’t publish to Google",
    "We can’t reply to Google reviews",
    "Images are not uploaded",
    "Google posts cannot be published",
    "Reviews cannot be replied to",
    "Google Profile does not include social media publishing",
    "This capability is currently unavailable",
    "Social media publishing is not available",
    "No guarantee of more reviews or revenue",
    "Can we publish Google posts? No. Publishing is unavailable.",
    "Can we publish Google posts? No. This capability is currently unavailable.",
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
