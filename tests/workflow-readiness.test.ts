import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isGoogleReviewDestinationDispatchable } from "../server/repository/postgres.js";

const baseEvidence = {
  runtimeReviewUri: "https://g.page/r/example/review",
  runtimeReviewUriAllowed: true,
  connectionDisabledAt: null,
};

test("Google review destination readiness mirrors dispatch-allowed connection health", () => {
  for (const connectionHealth of [
    "connected",
    "healthy",
    "delayed",
    "rate_limited",
    "provider_unavailable",
    "failing",
  ]) {
    assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth }), true, connectionHealth);
  }

  for (const connectionHealth of ["authentication_required", "permission_revoked", "disabled"]) {
    assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth }), false, connectionHealth);
  }
});

test("Google review destination readiness fails closed on missing, invalid or disabled evidence", () => {
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: null }), false);
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: "healthy", runtimeReviewUri: null }), false);
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: "healthy", runtimeReviewUriAllowed: false }), false);
  assert.equal(isGoogleReviewDestinationDispatchable({ ...baseEvidence, connectionHealth: "healthy", connectionDisabledAt: new Date() }), false);
});

test("the shipped product source does not advertise retired product surfaces", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const shippedUiFiles = readdirSync(root, { recursive: true })
    .map((entry) => join(root, entry))
    .filter((path) => /\.(?:tsx?|css)$/u.test(path));
  const productSource = shippedUiFiles.map((path) => readFileSync(path, "utf8")).join("\n").toLowerCase().replace(/[\s_-]+/gu, "");

  for (const retiredClaim of [
    "heatmap", "keywordtracking", "airankingaudit", "ranktracker", "citation", "directoryintegration",
    "trackinguptotenkeywords", "aiplatformrankingaudits", "citationmanagement", "citationduplicateprotection",
    "automaticdirectorysynchronisation", "automaticdirectorysynchronization", "automaticnegativereviewflagging",
    "sentimentgating", "positiveonlyreviewroutes", "appreciationmessageautomation", "onemilliondatapoints",
    "websitewidget", "whitelabel", "geotagging", "imagedripping", "autonomousstrategy", "custompermission",
    "googledrivemediaimports", "webhookmediaimports", "companycam", "zapier", "gbpauditleadwebhooks",
    "instantaianswers", "professionaleditor", "professionalvideoeditor", "multiclipcampaignbuilder", "unlimitedusers",
  ]) {
    assert.equal(productSource.includes(retiredClaim), false, `must not advertise ${retiredClaim}`);
  }
});

test("workspace headers describe only currently rendered product surfaces", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8").toLowerCase();
  for (const unsupportedClaim of ["action inbox", "allowance summary", "approvals, failures, and client allowance use"]) {
    assert.equal(appSource.includes(unsupportedClaim), false, `must not claim ${unsupportedClaim}`);
  }
});

test("external feasibility evidence uses anchored release-gate metadata", () => {
  const evidenceRoot = fileURLToPath(new URL("../docs/evidence", import.meta.url));
  const requiredEvidence = [
    "mobilewan-feasibility.md",
    "private-storage-feasibility.md",
    "platform-capability-readiness.md",
    "licensing-and-moderation-readiness.md",
  ];

  for (const evidenceFile of requiredEvidence) {
    const path = join(evidenceRoot, evidenceFile);
    assert.equal(existsSync(path), true, `missing ${evidenceFile}`);
    const contents = readFileSync(path, "utf8");
    assert.match(contents, /^- \*\*Decision:\*\*\s+\S.+$/mu, `${evidenceFile} must have a Decision metadata line`);
    assert.match(contents, /^- \*\*Date:\*\*\s+\d{4}-\d{2}-\d{2}\s*$/mu, `${evidenceFile} must have an ISO Date metadata line`);
    assert.match(contents, /^- \*\*Owner:\*\*\s+\S.+$/mu, `${evidenceFile} must have an Owner metadata line`);
    assert.match(contents, /^- \*\*State:\*\*\s+(?:blocked|passed)\s*$/mu, `${evidenceFile} must have an exact blocked or passed State`);

    const immutableMetadata = contents.match(/^- \*\*Immutable revision(?: \([^)]+\))?:\*\*\s+(.+)$/gmu) ?? [];
    assert.ok(immutableMetadata.length > 0, `${evidenceFile} must include immutable revision metadata`);
    assert.ok(
      immutableMetadata.some((line) => /[a-f0-9]{40}/iu.test(line) || /(?:not applicable|n\/a)\s*[:—-]\s*.+/iu.test(line)),
      `${evidenceFile} must pin a revision or explain why no revision applies`,
    );
  }
});

test("MobileWAN benchmark wrapper requires complete snapshot provenance and one qualifying GPU", () => {
  const benchmark = readFileSync(new URL("../scripts/mobilewan/benchmark.ps1", import.meta.url), "utf8");
  assert.match(benchmark, /Get-ChildItem\s+-LiteralPath\s+\$Snapshot\s+-Recurse\s+-File/u, "must enumerate every snapshot file");
  assert.match(benchmark, /must contain exactly one entry for every snapshot file/u, "must require one manifest entry per file");
  assert.match(benchmark, /if\s*\(\$GpuRecords\.Count\s+-ne\s+1\)/u, "must reject mixed-GPU hosts");
});
