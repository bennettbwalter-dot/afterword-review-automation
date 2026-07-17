import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const excludedPrefixes = [".agents/", ".codex/", ".git/", "dist/", "node_modules/", "output/"];
const patterns = [
  { label: "Stripe secret or restricted API key", expression: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}\b/g },
  { label: "Stripe webhook signing secret", expression: /\bwhsec_[A-Za-z0-9]{16,}\b/g },
];

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);
const findings = [];

for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (excludedPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;
  let stats;
  try {
    stats = statSync(file);
  } catch {
    continue;
  }
  if (!stats.isFile() || stats.size > 2 * 1024 * 1024) continue;
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(content)) findings.push(`${normalized}: ${pattern.label}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Potential committed secrets detected:\n${findings.map((finding) => `- ${finding}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("No Stripe API or webhook secrets found in repository files.\n");
}
