import assert from "node:assert/strict";
import test from "node:test";
import { estimateSmsSegments } from "../server/messaging/sms-segments.js";

test("GSM-7 messages use single and concatenated segment limits", () => {
  assert.deepEqual(estimateSmsSegments("A".repeat(160)), {
    encoding: "GSM-7",
    units: 160,
    segments: 1,
  });
  assert.equal(estimateSmsSegments("A".repeat(161)).segments, 2);
  assert.equal(estimateSmsSegments("A".repeat(306)).segments, 2);
  assert.equal(estimateSmsSegments("A".repeat(307)).segments, 3);
});

test("GSM-7 extension characters consume two units", () => {
  const estimate = estimateSmsSegments("{".repeat(81));
  assert.equal(estimate.encoding, "GSM-7");
  assert.equal(estimate.units, 162);
  assert.equal(estimate.segments, 2);
});

test("Unicode and emoji use UCS-2 UTF-16 code-unit limits", () => {
  assert.deepEqual(estimateSmsSegments("✓".repeat(70)), {
    encoding: "UCS-2",
    units: 70,
    segments: 1,
  });
  assert.equal(estimateSmsSegments("✓".repeat(71)).segments, 2);
  assert.equal(estimateSmsSegments("😀".repeat(36)).units, 72);
  assert.equal(estimateSmsSegments("😀".repeat(36)).segments, 2);
});

test("empty content reports zero segments", () => {
  assert.equal(estimateSmsSegments("").segments, 0);
});
