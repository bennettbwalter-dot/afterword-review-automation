import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
