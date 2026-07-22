import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("operator documentation describes the simplified routes and current migration boundary", async () => {
  const files = await Promise.all([
    "README.md",
    "docs/production-readiness.md",
    "docs/architecture.md",
    "docs/pilot-runbook.md",
  ].map((file) => readFile(path.resolve(file), "utf8")));
  const documentation = files.join("\n");

  assert.match(documentation, /\/app\/home/i);
  assert.match(documentation, /\/app\/google-profile/i);
  assert.match(documentation, /migrations? 008(?:\s*(?:through|-|to)\s*011|.*009.*010.*011)/i);
  assert.match(documentation, /migration 012[^\n]*(?:paused|not applied|must not)/i);
  assert.match(documentation, /signup[^\n]*(?:implemented|endpoint|onboarding)/i);
  assert.match(documentation, /transactional email[^\n]*(?:gate|blocked|required|unavailable)/i);
  assert.doesNotMatch(documentation, /No signup endpoint exists/i);
});
