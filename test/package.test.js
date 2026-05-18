import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package metadata is discoverable and release scripts exist", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.bin.boundaries, "src/cli.js");
  assert.equal(packageJson.repository.type, "git");
  assert.match(packageJson.repository.url, /howells/);
  assert.match(packageJson.homepage, /npmjs\.com/);
  assert.equal(packageJson.scripts.prepack, "npm test && npm run validate:skill");
  assert.equal(packageJson.scripts["smoke:install"], "node scripts/smoke-install.mjs");
  assert.equal(packageJson.keywords.includes("turborepo"), true);
});
