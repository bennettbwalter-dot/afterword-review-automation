import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Google Profile review and request tabs render only the selected-location snapshot", async () => {
  const app = await readFile(path.resolve("src", "App.tsx"), "utf8");
  const profileView = await readFile(path.resolve("src", "features", "google-profile", "GoogleProfileView.tsx"), "utf8");
  const googleProfileStart = app.indexOf('view === "google-profile"');
  const googleProfileSource = app.slice(googleProfileStart, app.indexOf('view === "content"', googleProfileStart));

  assert.ok(googleProfileStart >= 0, "Google Profile view must remain explicit");
  assert.match(googleProfileSource, /reviews=\{snapshot\.reviews\}/u);
  assert.match(googleProfileSource, /requests=\{snapshot\.requests\}/u);
  assert.match(googleProfileSource, /workflow=\{snapshot\.workflow \?\? undefined\}/u);
  assert.match(googleProfileSource, /record=\{snapshot\.qr\}/u);
  assert.doesNotMatch(googleProfileSource, /reviews=\{reviews\}/u);
  assert.doesNotMatch(googleProfileSource, /requests=\{requests\}/u);
  assert.doesNotMatch(googleProfileSource, /qrCodesByBusiness\[business\.id\]/u);

  assert.match(profileView, /children: \(snapshot: GoogleProfileSnapshot\) => ReactNode/u);
  assert.match(profileView, /if \(snapshotError\) return/u);
  assert.match(profileView, /if \(!snapshot\) return/u);
  assert.match(profileView, /children\(snapshot\)/u);
  assert.match(profileView, /if \(current\) setSnapshot\(next\)/u);
  assert.match(profileView, /googleProfileSnapshotState\(\{ businessId, locationId, snapshot, snapshotError \}\)/u);
});
