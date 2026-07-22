import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUSINESSES, type BusinessAccount } from "../src/platform/domain.js";
import type { ServiceStatus } from "../src/platform/api.js";
import type { ConnectionsViewProps } from "../src/features/settings/ConnectionsView.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { ConnectionsView } = await import("../src/features/settings/ConnectionsView.js");

const seededBusiness = BUSINESSES[0];
assert.ok(seededBusiness);
const business: BusinessAccount = {
  ...seededBusiness,
  integrations: {
    google: { status: "Healthy", tone: "success", lastEvent: "Google sync completed" },
    messaging: { status: "Attention", tone: "warning", lastEvent: "Messaging configuration checked" },
    jobIntake: { status: "Healthy", tone: "success", lastEvent: "Completed job received" },
  },
};
const configuredServices: ServiceStatus[] = [
  { key: "google", label: "Google Business Profile", configured: true, requires: [], detail: "Configured for review sync." },
  { key: "messaging", label: "Messaging", configured: false, requires: ["provider credentials"], detail: "Not configured." },
];
const Button = ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => createElement("button", { type: "button", disabled }, children);
const StatusPill = ({ children }: { children: ReactNode }) => createElement("span", null, children);
const DemoNotice = () => createElement("aside", null, "Sample data");

function render(overrides: Partial<ConnectionsViewProps> = {}) {
  return renderToStaticMarkup(createElement(ConnectionsView, {
    business,
    onConnect: () => undefined,
    canConfigure: true,
    services: configuredServices,
    servicesLoading: false,
    demoMode: false,
    ButtonComponent: Button,
    StatusPillComponent: StatusPill,
    DemoNoticeComponent: DemoNotice,
    ...overrides,
  }));
}

test("preserves scoped operational status, service availability, and event summaries", () => {
  const markup = render();
  for (const text of [
    "Google Business Profile", "Review sync and direct review destination", "Google sync completed",
    "Messaging provider", "SMS and email delivery events", "Messaging configuration checked",
    "Completed-job intake", "Receives genuine customer job completions", "Completed job received",
    "Service availability", "1/2 configured", "Needs: provider credentials", "Integration event log",
    business.name.replace("&", "&amp;"),
  ]) assert.ok(markup.includes(text), `missing ${text}`);
});

test("keeps publication readiness separate and unavailable despite healthy Google operations", () => {
  const markup = render();
  assert.match(markup, /Publication readiness/);
  assert.equal((markup.match(/>Unavailable</g) ?? []).length, 5);
  for (const label of ["Google posts and media", "Facebook Page", "Instagram professional account", "LinkedIn organisation", "YouTube channel"]) {
    assert.ok(markup.includes(label), `missing ${label}`);
  }
  const ledger = markup.match(/<section[^>]*aria-labelledby="publication-readiness-title"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.doesNotMatch(ledger, /<button|<a\b|<input|<select|<form/u);
  assert.doesNotMatch(ledger, /oauth|token|secret|page id|channel id|connected|healthy|publish now|schedule/i);
});

test("gives publication ledger copy its own full-width card layout", () => {
  const viewSource = readFileSync(new URL("../src/features/settings/ConnectionsView.tsx", import.meta.url), "utf8");
  const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(viewSource, /className="integration-card integration-card--publication-readiness"/u);
  assert.match(stylesSource, /\.integration-card--publication-readiness\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}/u);
});

test("Google setup follows configured, loading, authorization, and demo rules", () => {
  assert.match(render(), />Review setup<\/button>/);
  assert.doesNotMatch(render(), /<button[^>]*disabled=""[^>]*>Review setup<\/button>/);
  assert.match(render({ canConfigure: false }), /<button[^>]*disabled=""[^>]*>Review setup<\/button>/);
  assert.match(render({ servicesLoading: true }), /<button[^>]*disabled=""[^>]*>Checking availability…<\/button>/);
  assert.match(render({ services: [] }), /<button[^>]*disabled=""[^>]*>Unavailable<\/button>/);
  const demo = render({ demoMode: true });
  assert.match(demo, /Connection setup requires an authenticated deployment/);
  assert.doesNotMatch(demo, />Review setup<\/button>/);
});

test("App composes the extracted view without social callbacks or readiness injection", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function IntegrationsView/u);
  const call = source.match(/<ConnectionsView\b[\s\S]*?\/>/su)?.[0] ?? "";
  assert.match(call, /business=\{contextBusiness\}/u);
  assert.match(call, /onConnect=\{\(\) => void beginGoogleConnection\(\)\}/u);
  assert.match(call, /canConfigure=\{canConfigure && !supportSession\}/u);
  assert.match(call, /services=\{services\}/u);
  assert.match(call, /servicesLoading=\{servicesLoading\}/u);
  assert.match(call, /demoMode=\{IS_DEMO_MODE\}/u);
  assert.doesNotMatch(call, /meta|facebook|instagram|linkedin|youtube|oauth|token|secret|destination|readiness/iu);
});
